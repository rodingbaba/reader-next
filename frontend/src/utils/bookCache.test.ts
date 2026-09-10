import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cacheBookToBrowser } from './bookCache'
import * as bookshelfApi from '../api/bookshelf'
import * as browserCache from './browserCache'

vi.mock('../api/bookshelf')
vi.mock('./browserCache')
vi.mock('./appLogger', () => ({
  appLog: vi.fn(),
}))

describe('cacheBookToBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(browserCache.setBrowserCachedChapterList).mockResolvedValue(undefined)
    vi.mocked(browserCache.setBrowserCachedChapter).mockResolvedValue(undefined)
    vi.mocked(browserCache.listBrowserCachedChapterUrls).mockResolvedValue(new Set<string>())
    vi.mocked(bookshelfApi.getBookContent).mockImplementation(async ({ chapterUrl }) => `Content for ${chapterUrl}`)
  })

  it('downloads chapters concurrently for local epub book', async () => {
    const mockBook = {
      bookUrl: 'local-epub:test1234',
      name: '测试本地EPUB',
      origin: 'local-epub',
    } as any

    const chapters = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      title: `第${i + 1}章`,
      url: `local-epub:test1234#${i}`,
    }))

    const progressUpdates: number[] = []
    const result = await cacheBookToBrowser({
      book: mockBook,
      chapters,
      onProgress: (p) => progressUpdates.push(p.completed),
    })

    expect(result.total).toBe(10)
    expect(result.completed).toBe(10)
    expect(result.newlyCached).toBe(10)
    expect(bookshelfApi.getBookContent).toHaveBeenCalledTimes(10)
    expect(browserCache.setBrowserCachedChapter).toHaveBeenCalledTimes(10)
    expect(progressUpdates[progressUpdates.length - 1]).toBe(10)
  })

  it('skips already cached chapters without fetching network', async () => {
    const mockBook = {
      bookUrl: 'local-epub:test1234',
      name: '测试本地EPUB',
      origin: 'local-epub',
    } as any

    const chapters = [
      { index: 0, title: '第1章', url: 'chapter-0' },
      { index: 1, title: '第2章', url: 'chapter-1' },
      { index: 2, title: '第3章', url: 'chapter-2' },
    ]

    // 假设第 0 章和第 1 章已在本地
    vi.mocked(browserCache.listBrowserCachedChapterUrls).mockResolvedValue(new Set(['chapter-0', 'chapter-1']))

    const result = await cacheBookToBrowser({
      book: mockBook,
      chapters,
    })

    expect(result.total).toBe(3)
    expect(result.completed).toBe(3)
    expect(result.newlyCached).toBe(1)
    expect(bookshelfApi.getBookContent).toHaveBeenCalledTimes(1)
  })

  it('stops processing when signal is cancelled', async () => {
    const mockBook = {
      bookUrl: 'local-epub:test1234',
      name: '测试本地EPUB',
      origin: 'local-epub',
    } as any

    const chapters = Array.from({ length: 20 }, (_, i) => ({
      index: i,
      title: `第${i + 1}章`,
      url: `chapter-${i}`,
    }))

    const signal = { cancelled: false }
    vi.mocked(bookshelfApi.getBookContent).mockImplementation(async () => {
      signal.cancelled = true
      return 'content'
    })

    const result = await cacheBookToBrowser({
      book: mockBook,
      chapters,
      signal,
    })

    expect(result.newlyCached).toBeLessThan(20)
  })
})

