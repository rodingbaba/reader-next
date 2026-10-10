import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getReadingStatsSummary,
  getReadingBookStats,
  type ReadingStatsSummary,
  type BookReadingStatItem,
} from '../api/readingStats'
import {
  loadLocalReadingStats,
  loadPendingHeartbeats,
  getTodayDateString,
} from '../utils/readingTracker'

const STATS_SUMMARY_SNAPSHOT_KEY = 'reader-stats-summary-snapshot-v1'
const STATS_BOOKS_SNAPSHOT_KEY = 'reader-stats-books-snapshot-v1'

export function loadStatsSummarySnapshot(): ReadingStatsSummary | null {
  try {
    const raw = localStorage.getItem(STATS_SUMMARY_SNAPSHOT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveStatsSummarySnapshot(data: ReadingStatsSummary): void {
  try {
    localStorage.setItem(STATS_SUMMARY_SNAPSHOT_KEY, JSON.stringify(data))
  } catch { }
}

export function loadStatsBooksSnapshot(): BookReadingStatItem[] {
  try {
    const raw = localStorage.getItem(STATS_BOOKS_SNAPSHOT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveStatsBooksSnapshot(data: BookReadingStatItem[]): void {
  try {
    localStorage.setItem(STATS_BOOKS_SNAPSHOT_KEY, JSON.stringify(data))
  } catch { }
}

export const useReadingStatsStore = defineStore('readingStats', () => {
  const loading = ref(false)
  const summary = ref<ReadingStatsSummary | null>(null)
  const bookStats = ref<BookReadingStatItem[]>([])

  const totalDurationMinutes = computed(() => {
    return Math.round((summary.value?.totalDurationSecs || 0) / 60)
  })

  const totalListenMinutes = computed(() => {
    return Math.round((summary.value?.totalListenSecs || 0) / 60)
  })

  const todayDurationMinutes = computed(() => {
    return Math.round((summary.value?.todayDurationSecs || 0) / 60)
  })

  const todayListenMinutes = computed(() => {
    return Math.round((summary.value?.todayListenSecs || 0) / 60)
  })

  const streakDays = computed(() => {
    return summary.value?.streakDays || 0
  })

  const totalDays = computed(() => {
    return summary.value?.totalDays || 0
  })

  const totalBooks = computed(() => {
    return Math.max(
      summary.value?.totalBooks || 0,
      bookStats.value.filter((b) => b.totalDurationSecs > 0).length,
    )
  })

  const focusedBookUrl = ref<string | null>(null)

  async function fetchStats(targetBookUrl?: string | null) {
    loading.value = true
    const today = getTodayDateString()
    if (targetBookUrl !== undefined) {
      focusedBookUrl.value = targetBookUrl
    }

    try {
      const [remoteSummary, remoteBooks] = await Promise.all([
        getReadingStatsSummary(today, focusedBookUrl.value || undefined).catch(() => null),
        getReadingBookStats().catch(() => null),
      ])

      if (remoteSummary) {
        summary.value = remoteSummary
        saveStatsSummarySnapshot(remoteSummary)
      } else if (!summary.value) {
        // 远端不可用，优先尝试从持久化历史快照恢复全量历史与热力图
        const cached = loadStatsSummarySnapshot()
        if (cached) {
          summary.value = cached
        }
      }

      if (remoteBooks) {
        bookStats.value = remoteBooks
        saveStatsBooksSnapshot(remoteBooks)
      } else if (!bookStats.value.length) {
        // 远端不可用，优先尝试从持久化历史快照恢复全量书籍档案
        const cachedBooks = loadStatsBooksSnapshot()
        if (cachedBooks.length) {
          bookStats.value = cachedBooks
        }
      }

      // 智能双向融合：叠加本地未确认的增量心跳（Pending Deltas），确保离线听书/阅读时长绝对不被覆盖！
      mergeWithLocalStats(today)
    } finally {
      loading.value = false
    }
  }

  async function setFocusedBook(bookUrl: string | null) {
    if (focusedBookUrl.value === bookUrl) return
    focusedBookUrl.value = bookUrl
    loading.value = true
    const today = getTodayDateString()

    try {
      const remoteSummary = await getReadingStatsSummary(
        today,
        focusedBookUrl.value || undefined,
      ).catch(() => null)
      if (remoteSummary) {
        summary.value = remoteSummary
        // 若当前聚焦了具体单书，将该单书的权威聚合时长同步回列表项中，防止两者出现脱节
        if (bookUrl) {
          const item = bookStats.value.find((b) => b.bookUrl === bookUrl)
          if (item) {
            if (remoteSummary.totalDurationSecs > item.totalDurationSecs) {
              item.totalDurationSecs = remoteSummary.totalDurationSecs
            }
            if (remoteSummary.totalListenSecs > item.totalListenSecs) {
              item.totalListenSecs = remoteSummary.totalListenSecs
            }
          }
        }
      }
    } finally {
      loading.value = false
    }
  }

  function mergeWithLocalStats(today: string) {
    const local = loadLocalReadingStats()
    const pendingDeltas = loadPendingHeartbeats()

    if (!summary.value) {
      // 纯本地离线计算（既无服务端也无快照）
      let totalSecs = 0
      let totalListenSecs = 0
      const dates = Object.keys(local.daily).sort()
      const dailyList = dates.map((d) => {
        const item = local.daily[d]
        totalSecs += item.durationSecs
        totalListenSecs += item.listenSecs
        return {
          readDate: d,
          durationSecs: item.durationSecs,
          listenSecs: item.listenSecs,
          bookCount: Object.keys(item.books || {}).length,
        }
      })

      const todayStat = local.daily[today]
      summary.value = {
        totalDurationSecs: totalSecs,
        totalListenSecs,
        todayDurationSecs: todayStat?.durationSecs || 0,
        todayListenSecs: todayStat?.listenSecs || 0,
        totalDays: dates.length,
        streakDays: dates.includes(today) ? 1 : 0,
        totalBooks: Object.keys(local.books).length,
        dailyStats: dailyList,
      }
    } else {
      // 权威叠加：基准（远端或本地快照） + 本地未同步增量（Pending Deltas）
      // 保证服务端上线后，未上报完成的离线时长依然完整呈现，绝不被历史旧数据覆盖！
      if (pendingDeltas.length > 0) {
        let pendingTotalSecs = 0
        let pendingListenSecs = 0
        let pendingTodaySecs = 0
        let pendingTodayListenSecs = 0

        const dailyMap = new Map((summary.value.dailyStats || []).map((d) => [d.readDate, d]))

        for (const delta of pendingDeltas) {
          pendingTotalSecs += delta.durationSecs
          if (delta.isListening) {
            pendingListenSecs += delta.durationSecs
          }
          if (delta.readDate === today) {
            pendingTodaySecs += delta.durationSecs
            if (delta.isListening) {
              pendingTodayListenSecs += delta.durationSecs
            }
          }

          // 叠加到热力图 dailyStats
          const readDate = delta.readDate || today
          const existingDay = dailyMap.get(readDate)
          if (existingDay) {
            existingDay.durationSecs += delta.durationSecs
            if (delta.isListening) {
              existingDay.listenSecs += delta.durationSecs
            }
          } else {
            const newDay = {
              readDate,
              durationSecs: delta.durationSecs,
              listenSecs: delta.isListening ? delta.durationSecs : 0,
              bookCount: 1,
            }
            summary.value.dailyStats = summary.value.dailyStats || []
            summary.value.dailyStats.push(newDay)
            dailyMap.set(readDate, newDay)
          }
        }

        summary.value.totalDurationSecs += pendingTotalSecs
        summary.value.totalListenSecs += pendingListenSecs
        summary.value.todayDurationSecs += pendingTodaySecs
        summary.value.todayListenSecs += pendingTodayListenSecs
      }
    }

    // 智能双向融合单书列表
    const bookMap = new Map(bookStats.value.map((b) => [b.bookUrl, b]))

    // 1. 先叠加未同步增量到单书列表
    for (const delta of pendingDeltas) {
      const existing = bookMap.get(delta.bookUrl)
      if (existing) {
        existing.totalDurationSecs += delta.durationSecs
        if (delta.isListening) {
          existing.totalListenSecs += delta.durationSecs
        }
      }
    }

    // 2. 确保本地书籍全部在列表中
    for (const [url, lb] of Object.entries(local.books)) {
      if (!lb || lb.totalDurationSecs <= 0) continue

      const existing = bookMap.get(url)
      if (existing) {
        if (lb.lastReadAt) {
          const prevTime = existing.lastReadTime ? Number(existing.lastReadTime) : 0
          if (lb.lastReadAt > prevTime) {
            existing.lastReadTime = lb.lastReadAt
          }
        }
      } else {
        const newBook: BookReadingStatItem = {
          bookUrl: lb.bookUrl,
          bookName: lb.bookName,
          author: lb.author,
          coverUrl: lb.coverUrl,
          totalDurationSecs: lb.totalDurationSecs,
          totalListenSecs: lb.totalListenSecs,
          firstReadDate: lb.lastReadDate,
          lastReadDate: lb.lastReadDate,
          lastReadTime: lb.lastReadAt,
          totalDays: 1,
          totalChaptersRead: 0,
        }
        bookStats.value.push(newBook)
        bookMap.set(url, newBook)
      }
    }
  }

  return {
    loading,
    summary,
    bookStats,
    focusedBookUrl,
    totalDurationMinutes,
    totalListenMinutes,
    todayDurationMinutes,
    todayListenMinutes,
    streakDays,
    totalDays,
    totalBooks,
    fetchStats,
    setFocusedBook,
  }
})

