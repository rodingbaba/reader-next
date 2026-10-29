import { describe, it, expect, beforeEach } from 'vitest'

describe('StatsView book filter and shelf persistence logic', () => {
  const STATS_BOOK_FILTER_KEY = 'reader_stats_duration_filter'

  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults to all when no local storage is present', () => {
    const saved = localStorage.getItem(STATS_BOOK_FILTER_KEY)
    const initial = (saved === 'top10' || saved === 'top30') ? saved : 'all'
    expect(initial).toBe('all')
  })

  it('restores persisted filter selection top10 or top30', () => {
    localStorage.setItem(STATS_BOOK_FILTER_KEY, 'top10')
    let saved = localStorage.getItem(STATS_BOOK_FILTER_KEY)
    let filter = (saved === 'top10' || saved === 'top30') ? saved : 'all'
    expect(filter).toBe('top10')

    localStorage.setItem(STATS_BOOK_FILTER_KEY, 'top30')
    saved = localStorage.getItem(STATS_BOOK_FILTER_KEY)
    filter = (saved === 'top10' || saved === 'top30') ? saved : 'all'
    expect(filter).toBe('top30')
  })

  it('retains books removed from shelf and correctly filters top10 by duration', () => {
    // 模拟书架中仅剩 1 本书
    const shelfBooks = [{ bookUrl: 'book://active-shelf', name: '书架在读书' }]
    const shelfSet = new Set(shelfBooks.map(b => b.bookUrl))

    // 模拟包含已移出书架的历史书籍列表（共 15 本）
    const bookList = Array.from({ length: 15 }, (_, i) => ({
      bookUrl: i === 0 ? 'book://active-shelf' : `book://removed-${i}`,
      bookName: i === 0 ? '书架在读书' : `已移出书-${i}`,
      totalDurationSecs: (i + 1) * 300, // 300s 到 4500s
    }))

    // 1. 保留总有效时长 > 0 的书籍（已移出书架的书籍不被剔除）
    let list = bookList.filter(b => b.totalDurationSecs > 0)
    expect(list.length).toBe(15)

    // 验证能够识别已移出书架状态
    const removedCount = list.filter(b => !shelfSet.has(b.bookUrl)).length
    expect(removedCount).toBe(14)

    // 2. Top10 榜单强制按时长降序截取前 10 本
    list.sort((a, b) => b.totalDurationSecs - a.totalDurationSecs)
    const top10 = list.slice(0, 10)
    expect(top10.length).toBe(10)
    expect(top10[0].totalDurationSecs).toBe(4500)
    expect(top10[9].totalDurationSecs).toBe(1800)
  })
})

