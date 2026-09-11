import { setActivePinia, createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useReadingStatsStore } from '../src/stores/readingStats'
import * as api from '../src/api/readingStats'

vi.mock('../src/api/readingStats', () => ({
  getReadingStatsSummary: vi.fn(),
  getReadingBookStats: vi.fn(),
  recordReadingHeartbeat: vi.fn(),
}))

vi.mock('../src/utils/readingTracker', () => ({
  getTodayDateString: () => '2026-09-11',
  loadLocalReadingStats: () => ({
    daily: {},
    books: {
      'book-new': {
        bookUrl: 'book-new',
        bookName: '新读的书',
        author: '测试作者',
        totalDurationSecs: 15,
        totalListenSecs: 0,
        lastReadDate: '2026-09-11',
        lastReadAt: 1789118000000,
      },
    },
  }),
}))

describe('useReadingStatsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('unconditionally re-fetches book stats even if list already populated', async () => {
    const store = useReadingStatsStore()
    vi.mocked(api.getReadingStatsSummary).mockResolvedValue({
      totalDurationSecs: 1740,
      totalListenSecs: 1740,
      todayDurationSecs: 1740,
      todayListenSecs: 1740,
      totalDays: 1,
      streakDays: 1,
      totalBooks: 2,
      dailyStats: [],
    })
    vi.mocked(api.getReadingBookStats)
      .mockResolvedValueOnce([
        {
          bookUrl: 'book-1',
          bookName: '书1',
          author: '作者1',
          totalDurationSecs: 180,
          totalListenSecs: 180,
          firstReadDate: '2026-09-11',
          lastReadDate: '2026-09-11',
          totalDays: 1,
          totalChaptersRead: 0,
        },
      ])
      .mockResolvedValueOnce([
        {
          bookUrl: 'book-1',
          bookName: '书1',
          author: '作者1',
          totalDurationSecs: 1740,
          totalListenSecs: 1740,
          firstReadDate: '2026-09-11',
          lastReadDate: '2026-09-11',
          totalDays: 1,
          totalChaptersRead: 0,
        },
      ])

    await store.fetchStats()
    expect(store.bookStats.find((b) => b.bookUrl === 'book-1')?.totalDurationSecs).toBe(180)
    expect(store.bookStats.find((b) => b.bookUrl === 'book-new')).toBeDefined()

    await store.fetchStats()
    expect(api.getReadingBookStats).toHaveBeenCalledTimes(2)
    expect(store.bookStats.find((b) => b.bookUrl === 'book-1')?.totalDurationSecs).toBe(1740)
  })

  it('synchronizes focused book summary into bookStats list item', async () => {
    const store = useReadingStatsStore()
    store.bookStats = [
      {
        bookUrl: 'book-1',
        bookName: '书1',
        author: '作者1',
        totalDurationSecs: 180,
        totalListenSecs: 180,
        firstReadDate: '2026-09-11',
        lastReadDate: '2026-09-11',
        totalDays: 1,
        totalChaptersRead: 0,
      },
    ]

    vi.mocked(api.getReadingStatsSummary).mockResolvedValue({
      totalDurationSecs: 1740,
      totalListenSecs: 1740,
      todayDurationSecs: 1740,
      todayListenSecs: 1740,
      totalDays: 1,
      streakDays: 1,
      totalBooks: 1,
      dailyStats: [],
    })

    await store.setFocusedBook('book-1')
    expect(store.focusedBookUrl).toBe('book-1')
    expect(store.bookStats[0].totalDurationSecs).toBe(1740)
    expect(store.bookStats[0].totalListenSecs).toBe(1740)
  })
})
