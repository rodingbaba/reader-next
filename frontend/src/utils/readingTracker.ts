import { recordReadingHeartbeat, type RecordHeartbeatPayload } from '../api/readingStats'
import type { Book } from '../types'

const LOCAL_STATS_STORAGE_KEY = 'reader-local-reading-stats-v1'
const PENDING_HEARTBEATS_KEY = 'reader-pending-reading-heartbeats-v1'
const IDLE_TIMEOUT_MS = 2 * 60 * 1000 // 2分钟无操作判定为闲置
const HEARTBEAT_STEP_SEC = 15 // 每15秒自增一次心跳
const SYNC_INTERVAL_SEC = 60 // 每60秒同步一次后端

export interface LocalBookStat {
  bookUrl: string
  bookName: string
  author: string
  coverUrl?: string
  totalDurationSecs: number
  totalListenSecs: number
  lastReadDate: string
  lastReadAt: number
}

export interface LocalDailyStat {
  readDate: string // YYYY-MM-DD
  durationSecs: number
  listenSecs: number
  books: Record<string, { durationSecs: number; listenSecs: number }>
}

export interface LocalReadingStatsData {
  daily: Record<string, LocalDailyStat>
  books: Record<string, LocalBookStat>
}

export function getTodayDateString(): string {
  const d = new Date()
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const date = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${date}`
}

export function loadLocalReadingStats(): LocalReadingStatsData {
  try {
    const raw = localStorage.getItem(LOCAL_STATS_STORAGE_KEY)
    if (!raw) return { daily: {}, books: {} }
    const parsed = JSON.parse(raw)
    return {
      daily: parsed?.daily || {},
      books: parsed?.books || {},
    }
  } catch {
    return { daily: {}, books: {} }
  }
}

export function saveLocalReadingStats(data: LocalReadingStatsData) {
  try {
    localStorage.setItem(LOCAL_STATS_STORAGE_KEY, JSON.stringify(data))
  } catch { }
}

export interface TrackerOptions {
  getBook: () => Book | null
  isSpeaking: () => boolean
  isPaused: () => boolean
}

export class ReadingTracker {
  private options: TrackerOptions
  private timer: number | null = null
  private lastActiveAt: number = Date.now()
  private unsyncedSecs: number = 0
  private unsyncedListenSecs: number = 0
  private currentChapterDelta: number = 0
  private isDestroyed = false

  constructor(options: TrackerOptions) {
    this.options = options
    this.initActivityListeners()
    this.initBridgeListener()
    this.startHeartbeat()
    void this.flushPendingHeartbeats()
  }

  public recordChapterProgress() {
    this.currentChapterDelta += 1
    this.lastActiveAt = Date.now()
  }

  public markActive() {
    this.lastActiveAt = Date.now()
  }

  private initActivityListeners() {
    const handleActivity = () => {
      this.lastActiveAt = Date.now()
    }

    window.addEventListener('scroll', handleActivity, { passive: true })
    window.addEventListener('wheel', handleActivity, { passive: true })
    window.addEventListener('touchstart', handleActivity, { passive: true })
    window.addEventListener('touchmove', handleActivity, { passive: true })
    window.addEventListener('mousedown', handleActivity, { passive: true })
    window.addEventListener('keydown', handleActivity, { passive: true })
    window.addEventListener('click', handleActivity, { passive: true })

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // 仅在非听书状态切后台时立即 flush
        if (!this.isListeningActive()) {
          this.flushNow()
        }
      } else {
        this.lastActiveAt = Date.now()
      }
    })

    window.addEventListener('pagehide', () => this.flushNow())
    window.addEventListener('beforeunload', () => this.flushNow())
  }

  private isListeningActive(): boolean {
    return this.options.isSpeaking() && !this.options.isPaused()
  }

  private initBridgeListener() {
    // 监听 iOS 原生 App 回传的后台/锁屏听书时长
    if (typeof window !== 'undefined') {
      ; (window as any).__nativeBridgeTTSDurationSync = (payload: {
        bookUrl?: string
        durationSeconds?: number
      }) => {
        if (!payload || !payload.durationSeconds || payload.durationSeconds <= 0) return
        const duration = Math.min(Math.round(payload.durationSeconds), 7200)
        this.recordExternalListening(duration, payload.bookUrl)
      }
    }
  }

  public recordExternalListening(seconds: number, specificBookUrl?: string) {
    const book = this.options.getBook()
    const targetUrl = specificBookUrl || book?.bookUrl
    if (!targetUrl) return

    const today = getTodayDateString()
    const now = Date.now()
    const local = loadLocalReadingStats()

    // 1. 更新 local daily
    if (!local.daily[today]) {
      local.daily[today] = { readDate: today, durationSecs: 0, listenSecs: 0, books: {} }
    }
    local.daily[today].durationSecs += seconds
    local.daily[today].listenSecs += seconds
    if (!local.daily[today].books[targetUrl]) {
      local.daily[today].books[targetUrl] = { durationSecs: 0, listenSecs: 0 }
    }
    local.daily[today].books[targetUrl].durationSecs += seconds
    local.daily[today].books[targetUrl].listenSecs += seconds

    // 2. 更新 local book
    const bookName = book?.name || '未知书籍'
    const author = book?.author || ''
    const coverUrl = book?.coverUrl || book?.customCoverUrl
    if (!local.books[targetUrl]) {
      local.books[targetUrl] = {
        bookUrl: targetUrl,
        bookName,
        author,
        coverUrl,
        totalDurationSecs: 0,
        totalListenSecs: 0,
        lastReadDate: today,
        lastReadAt: now,
      }
    }
    local.books[targetUrl].totalDurationSecs += seconds
    local.books[targetUrl].totalListenSecs += seconds
    local.books[targetUrl].lastReadDate = today
    local.books[targetUrl].lastReadAt = now

    saveLocalReadingStats(local)

    // 3. 上报服务端
    void recordReadingHeartbeat({
      bookUrl: targetUrl,
      bookName,
      author,
      coverUrl,
      readDate: today,
      durationSecs: seconds,
      isListening: true,
      chaptersDelta: 0,
    }).catch(() => {
      this.enqueuePendingHeartbeat({
        bookUrl: targetUrl,
        bookName,
        author,
        coverUrl,
        readDate: today,
        durationSecs: seconds,
        isListening: true,
        chaptersDelta: 0,
      })
    })
  }

  private startHeartbeat() {
    if (this.timer != null) return
    this.timer = window.setInterval(() => {
      if (this.isDestroyed) return
      this.tick()
    }, HEARTBEAT_STEP_SEC * 1000)
  }

  private tick() {
    const book = this.options.getBook()
    if (!book || !book.bookUrl) return

    const isListening = this.isListeningActive()
    const isUserActive = Date.now() - this.lastActiveAt < IDLE_TIMEOUT_MS

    // 必须处于活跃状态 或 正在听书
    if (!isListening && !isUserActive) {
      return
    }

    const step = HEARTBEAT_STEP_SEC
    this.unsyncedSecs += step
    if (isListening) {
      this.unsyncedListenSecs += step
    }

    // 更新本地聚合缓存
    this.accumulateLocalStats(book, step, isListening)

    // 达到同步周期即触发网络上报
    if (this.unsyncedSecs >= SYNC_INTERVAL_SEC) {
      this.flushNow()
    }
  }

  private accumulateLocalStats(book: Book, stepSecs: number, isListening: boolean) {
    const today = getTodayDateString()
    const now = Date.now()
    const local = loadLocalReadingStats()

    if (!local.daily[today]) {
      local.daily[today] = { readDate: today, durationSecs: 0, listenSecs: 0, books: {} }
    }
    local.daily[today].durationSecs += stepSecs
    if (isListening) {
      local.daily[today].listenSecs += stepSecs
    }

    if (!local.daily[today].books[book.bookUrl]) {
      local.daily[today].books[book.bookUrl] = { durationSecs: 0, listenSecs: 0 }
    }
    local.daily[today].books[book.bookUrl].durationSecs += stepSecs
    if (isListening) {
      local.daily[today].books[book.bookUrl].listenSecs += stepSecs
    }

    if (!local.books[book.bookUrl]) {
      local.books[book.bookUrl] = {
        bookUrl: book.bookUrl,
        bookName: book.name,
        author: book.author || '',
        coverUrl: book.coverUrl || book.customCoverUrl,
        totalDurationSecs: 0,
        totalListenSecs: 0,
        lastReadDate: today,
        lastReadAt: now,
      }
    }
    local.books[book.bookUrl].totalDurationSecs += stepSecs
    if (isListening) {
      local.books[book.bookUrl].totalListenSecs += stepSecs
    }
    local.books[book.bookUrl].lastReadDate = today
    local.books[book.bookUrl].lastReadAt = now

    saveLocalReadingStats(local)
  }

  public flushNow() {
    if (this.unsyncedSecs <= 0) return

    const book = this.options.getBook()
    if (!book || !book.bookUrl) return

    const payload: RecordHeartbeatPayload = {
      bookUrl: book.bookUrl,
      bookName: book.name,
      author: book.author || '',
      coverUrl: book.coverUrl || book.customCoverUrl,
      readDate: getTodayDateString(),
      durationSecs: this.unsyncedSecs,
      isListening: this.unsyncedListenSecs > 0,
      chaptersDelta: this.currentChapterDelta,
    }

    this.unsyncedSecs = 0
    this.unsyncedListenSecs = 0
    this.currentChapterDelta = 0

    recordReadingHeartbeat(payload).catch(() => {
      this.enqueuePendingHeartbeat(payload)
    })
  }

  private enqueuePendingHeartbeat(payload: RecordHeartbeatPayload) {
    try {
      const raw = localStorage.getItem(PENDING_HEARTBEATS_KEY)
      const list: RecordHeartbeatPayload[] = raw ? JSON.parse(raw) : []
      list.push(payload)
      localStorage.setItem(PENDING_HEARTBEATS_KEY, JSON.stringify(list.slice(-50)))
    } catch { }
  }

  private async flushPendingHeartbeats() {
    try {
      const raw = localStorage.getItem(PENDING_HEARTBEATS_KEY)
      if (!raw) return
      const list: RecordHeartbeatPayload[] = JSON.parse(raw)
      if (!Array.isArray(list) || list.length === 0) return

      localStorage.removeItem(PENDING_HEARTBEATS_KEY)
      for (const item of list) {
        await recordReadingHeartbeat(item).catch(() => {
          this.enqueuePendingHeartbeat(item)
        })
      }
    } catch { }
  }

  public destroy() {
    this.isDestroyed = true
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flushNow()
  }
}

