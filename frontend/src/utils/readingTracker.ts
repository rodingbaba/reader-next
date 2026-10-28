import { recordReadingHeartbeat, type RecordHeartbeatPayload } from '../api/readingStats'
import type { Book } from '../types'
import { isNativeApp } from './nativeBridge'

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

export function buildPendingHeartbeatKey(item: RecordHeartbeatPayload): string {
  return `${item.bookUrl}::${item.readDate}::${item.isListening ? 1 : 0}`
}

export function loadPendingHeartbeats(): RecordHeartbeatPayload[] {
  try {
    const raw = localStorage.getItem(PENDING_HEARTBEATS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function savePendingHeartbeats(list: RecordHeartbeatPayload[]): void {
  try {
    localStorage.setItem(PENDING_HEARTBEATS_KEY, JSON.stringify(list))
  } catch { }
}

export function appendPendingHeartbeat(payload: RecordHeartbeatPayload): void {
  const list = loadPendingHeartbeats()
  const key = buildPendingHeartbeatKey(payload)
  const existingIndex = list.findIndex((item) => buildPendingHeartbeatKey(item) === key)

  if (existingIndex >= 0) {
    const existing = list[existingIndex]
    existing.durationSecs += payload.durationSecs
    existing.chaptersDelta = (existing.chaptersDelta || 0) + (payload.chaptersDelta || 0)
    if (payload.bookName) existing.bookName = payload.bookName
    if (payload.author) existing.author = payload.author
    if (payload.coverUrl) existing.coverUrl = payload.coverUrl
  } else {
    list.push({ ...payload })
  }
  savePendingHeartbeats(list)
}

export function clearPendingHeartbeats(): void {
  try {
    localStorage.removeItem(PENDING_HEARTBEATS_KEY)
  } catch { }
}

/**
 * 全局排空待同步心跳池，将所有离线/未决增量推送到服务端
 * @param config 可选的网络请求配置（如短超时）
 * @returns 是否全部成功排空
 */
export async function flushAllPendingHeartbeats(config?: { timeout?: number }): Promise<boolean> {
  const list = loadPendingHeartbeats()
  if (!list.length) return true

  for (const item of [...list]) {
    try {
      await recordReadingHeartbeat(item, config)
      // 上报成功后从增量池中安全移除已 ACK 的增量
      const currentList = loadPendingHeartbeats()
      const key = buildPendingHeartbeatKey(item)
      const updated = currentList.filter((entry) => buildPendingHeartbeatKey(entry) !== key)
      savePendingHeartbeats(updated)
    } catch {
      // 网络失败保留在池中，下次继续重试，中断当前循环
      return false
    }
  }
  return true
}

/**
 * 本地超额自动补偿同步机制（Reconciliation）
 * 比较本地账本与服务端返回的单书统计：
 * 若本地记录的时长确实大于服务端（曾因断网或旧版本遗留在本地 localStorage 中），
 * 自动计算差额并生成补录心跳推送到服务端，确保服务端与所有其他端完整对齐，零数据丢失。
 */
export async function reconcileLocalStatsWithRemote(
  remoteBooks: { bookUrl: string; totalDurationSecs: number; totalListenSecs: number }[],
  config?: { timeout?: number },
): Promise<boolean> {
  const local = loadLocalReadingStats()
  if (!local.books || Object.keys(local.books).length === 0) return true

  const remoteMap = new Map(remoteBooks.map((b) => [b.bookUrl, b]))
  let hasReconciliation = false

  for (const [url, lb] of Object.entries(local.books)) {
    if (!lb || lb.totalDurationSecs <= 0) continue

    const remote = remoteMap.get(url)
    const remoteTotal = remote ? remote.totalDurationSecs : 0
    const remoteListen = remote ? remote.totalListenSecs : 0

    const diffTotal = lb.totalDurationSecs - remoteTotal
    const diffListen = lb.totalListenSecs - remoteListen

    if (diffTotal > 0) {
      // 拆分为听书差额与纯看书差额分别补录
      const listenDelta = Math.max(0, Math.min(diffListen, diffTotal))
      const readDelta = Math.max(0, diffTotal - listenDelta)

      const targetDate = lb.lastReadDate || getTodayDateString()

      if (listenDelta > 0) {
        appendPendingHeartbeat({
          bookUrl: url,
          bookName: lb.bookName || '未知书籍',
          author: lb.author || '',
          coverUrl: lb.coverUrl,
          readDate: targetDate,
          durationSecs: listenDelta,
          isListening: true,
          chaptersDelta: 0,
        })
        hasReconciliation = true
      }

      if (readDelta > 0) {
        appendPendingHeartbeat({
          bookUrl: url,
          bookName: lb.bookName || '未知书籍',
          author: lb.author || '',
          coverUrl: lb.coverUrl,
          readDate: targetDate,
          durationSecs: readDelta,
          isListening: false,
          chaptersDelta: 0,
        })
        hasReconciliation = true
      }
    }
  }

  if (hasReconciliation) {
    return await flushAllPendingHeartbeats(config)
  }
  return false
}

let activeTrackerInstance: ReadingTracker | null = null

export function setActiveTrackerInstance(instance: ReadingTracker | null) {
  activeTrackerInstance = instance
}

/**
 * 全局记录外部听书时长（即使退出阅读器界面也能准确累加并尝试上报）
 */
export function recordExternalListeningGlobal(seconds: number, specificBookUrl?: string) {
  const activeBook = activeTrackerInstance ? activeTrackerInstance.getCurrentBook() : null
  const targetUrl = specificBookUrl || activeBook?.bookUrl
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
  const existingLocalBook = local.books[targetUrl]
  const bookName = activeBook?.name || existingLocalBook?.bookName || '未知书籍'
  const author = activeBook?.author || existingLocalBook?.author || ''
  const coverUrl = activeBook?.coverUrl || activeBook?.customCoverUrl || existingLocalBook?.coverUrl

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

  // 3. 上报服务端，网络故障时安全存入本地待同步增量池
  const payload: RecordHeartbeatPayload = {
    bookUrl: targetUrl,
    bookName,
    author,
    coverUrl,
    readDate: today,
    durationSecs: seconds,
    isListening: true,
    chaptersDelta: 0,
  }

  void recordReadingHeartbeat(payload).catch(() => {
    appendPendingHeartbeat(payload)
  })
}

// 模块级全局常驻 Bridge 监听：无论用户在阅读器内部、书架还是统计页面，iOS 原生回补的听书时长都能被准确接收
if (typeof window !== 'undefined') {
  ;(window as any).__nativeBridgeTTSDurationSync = (payload: {
    bookUrl?: string
    durationSeconds?: number
  }) => {
    if (!payload || !payload.durationSeconds || payload.durationSeconds <= 0) return
    const duration = Math.min(Math.round(payload.durationSeconds), 7200)
    recordExternalListeningGlobal(duration, payload.bookUrl)
  }
}

export interface TrackerOptions {
  getBook: () => Book | null
  isSpeaking: () => boolean
  isPaused: () => boolean
  isShelfBook?: () => boolean
}

export class ReadingTracker {
  private options: TrackerOptions
  private timer: number | null = null
  private lastActiveAt: number = Date.now()
  private lastTickAt: number = Date.now()
  private unsyncedSecs: number = 0
  private unsyncedListenSecs: number = 0
  private currentChapterDelta: number = 0
  private isDestroyed = false

  constructor(options: TrackerOptions) {
    this.options = options
    setActiveTrackerInstance(this)
    this.lastActiveAt = Date.now()
    this.lastTickAt = Date.now()
    this.initActivityListeners()
    this.initBridgeListener()
    this.startHeartbeat()
    void this.flushPendingHeartbeats()
  }

  public getCurrentBook(): Book | null {
    return this.options.getBook()
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
        this.lastTickAt = Date.now()
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
    if (this.options.isShelfBook && !this.options.isShelfBook()) return
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

  /**
   * 精确结算自上次 tick 到现在的流逝时间（即使只读了 3~10 秒，在退出或切换时也能被准确捕获）
   */
  private settleElapsed(isFlushing: boolean = false): number {
    if (this.isDestroyed && !isFlushing) return 0
    if (this.options.isShelfBook && !this.options.isShelfBook()) {
      this.lastTickAt = Date.now()
      return 0
    }
    const now = Date.now()
    let elapsed = Math.round((now - this.lastTickAt) / 1000)
    this.lastTickAt = now

    // 保护：单次心跳跨度最大不超过 IDLE_TIMEOUT_MS（120秒），防止系统休眠/挂起恢复后产生脉冲式虚假高时长
    elapsed = Math.min(Math.max(0, elapsed), Math.round(IDLE_TIMEOUT_MS / 1000))

    if (elapsed <= 0) return 0

    const isListening = this.isListeningActive()
    const isUserActive = now - this.lastActiveAt < IDLE_TIMEOUT_MS

    // 必须处于活跃状态 或 正在听书
    if (!isListening && !isUserActive) {
      return 0
    }

    // 关键：在 iOS 原生 App (Hybrid) 环境下，听书时长完全由原生 TTSManager 独立统计并通过 Bridge 上报
    // Web 端自身的定时器在听书状态下必须完全静默，避免双通道重复累计导致听书与总阅读时长虚高
    if (isListening && isNativeApp()) {
      return 0
    }

    const book = this.options.getBook()
    if (!book || !book.bookUrl) return 0

    this.unsyncedSecs += elapsed
    if (isListening) {
      this.unsyncedListenSecs += elapsed
    }

    // 立即累计到本地聚合缓存
    this.accumulateLocalStats(book, elapsed, isListening)
    return elapsed
  }

  private tick() {
    this.settleElapsed(false)

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
    if (this.options.isShelfBook && !this.options.isShelfBook()) {
      this.unsyncedSecs = 0
      this.unsyncedListenSecs = 0
      this.currentChapterDelta = 0
      return
    }
    // 离开或销毁时立即结算自上次以来的流逝秒数（即使只读了 3~10 秒也能被捕获）
    this.settleElapsed(true)

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
    appendPendingHeartbeat(payload)
  }

  private async flushPendingHeartbeats() {
    await flushAllPendingHeartbeats()
  }

  public destroy() {
    this.isDestroyed = true
    if (this.timer != null) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flushNow()
    setActiveTrackerInstance(null)
  }
}

