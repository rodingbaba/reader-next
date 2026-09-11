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
  getTodayDateString,
} from '../utils/readingTracker'

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
      }
      if (remoteBooks) {
        bookStats.value = remoteBooks
      }

      // 若远端不可用或离线，从本地缓存补充降级数据并智能融合
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
    if (!summary.value) {
      // 纯本地离线计算
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
    }

    // 智能双向融合本地书籍记录与服务端列表
    const bookMap = new Map(bookStats.value.map((b) => [b.bookUrl, b]))
    for (const [url, lb] of Object.entries(local.books)) {
      if (!lb || lb.totalDurationSecs <= 0) continue

      const existing = bookMap.get(url)
      if (existing) {
        if (lb.totalDurationSecs > existing.totalDurationSecs) {
          existing.totalDurationSecs = lb.totalDurationSecs
        }
        if (lb.totalListenSecs > existing.totalListenSecs) {
          existing.totalListenSecs = lb.totalListenSecs
        }
        if (lb.lastReadAt) {
          const prevTime = existing.lastReadTime ? Number(existing.lastReadTime) : 0
          if (lb.lastReadAt > prevTime) {
            existing.lastReadTime = lb.lastReadAt
          }
        }
      } else {
        // 本地有此书，但远端尚未收录（如离线时新读的书），将本地书目平滑并入列表
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

