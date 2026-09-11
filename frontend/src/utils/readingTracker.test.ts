import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getTodayDateString,
  loadLocalReadingStats,
  saveLocalReadingStats,
  ReadingTracker,
  type LocalReadingStatsData,
} from './readingTracker'

describe('readingTracker utility', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('formats current date as YYYY-MM-DD', () => {
    const today = getTodayDateString()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('loads and saves local reading stats properly', () => {
    expect(loadLocalReadingStats()).toEqual({ daily: {}, books: {} })

    const sample: LocalReadingStatsData = {
      daily: {
        '2026-09-11': {
          readDate: '2026-09-11',
          durationSecs: 300,
          listenSecs: 180,
          books: {
            'book://1': { durationSecs: 300, listenSecs: 180 },
          },
        },
      },
      books: {
        'book://1': {
          bookUrl: 'book://1',
          bookName: '乱世书',
          author: '姬叉',
          totalDurationSecs: 300,
          totalListenSecs: 180,
          lastReadDate: '2026-09-11',
          lastReadAt: 1726000000000,
        },
      },
    }

    saveLocalReadingStats(sample)
    const loaded = loadLocalReadingStats()
    expect(loaded.daily['2026-09-11'].durationSecs).toBe(300)
    expect(loaded.daily['2026-09-11'].listenSecs).toBe(180)
    expect(loaded.books['book://1'].bookName).toBe('乱世书')
  })

  it('records external background listening accurately', () => {
    const tracker = new ReadingTracker({
      getBook: () => ({
        name: '江山如此多娇',
        author: '泥人',
        bookUrl: 'book://jiangshan',
        origin: 'local',
      }),
      isSpeaking: () => true,
      isPaused: () => false,
    })

    tracker.recordExternalListening(300, 'book://jiangshan')
    const local = loadLocalReadingStats()
    const today = getTodayDateString()

    expect(local.daily[today].listenSecs).toBe(300)
    expect(local.daily[today].durationSecs).toBe(300)
    expect(local.books['book://jiangshan'].totalDurationSecs).toBe(300)
    expect(local.books['book://jiangshan'].totalListenSecs).toBe(300)

    tracker.destroy()
  })
})

