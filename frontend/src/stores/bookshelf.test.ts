import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useBookshelfStore } from './bookshelf'
import { getBookshelfWithCacheInfo } from '../api/bookshelf'
import { listBrowserCacheSummary } from '../utils/browserCache'

vi.mock('../api/bookshelf', () => ({
  getBookshelfWithCacheInfo: vi.fn(),
  getBookGroups: vi.fn(),
  deleteBook: vi.fn(),
  deleteBooks: vi.fn(),
  saveBookGroupId: vi.fn(),
  saveBookGroup: vi.fn(),
  deleteBookGroup: vi.fn(),
  saveBooks: vi.fn(),
}))

vi.mock('../utils/browserCache', () => ({
  deleteBrowserBookCache: vi.fn(),
  listBrowserCacheSummary: vi.fn(),
}))

vi.mock('../utils/recentBooks', () => ({
  clearRecentReadBooks: vi.fn(),
  getRecentReadBookKey: vi.fn((book) => `${book.origin || ''}::${book.bookUrl}`),
  loadRecentReadBooks: vi.fn(() => []),
  removeRecentReadBook: vi.fn(),
}))

describe('bookshelf search state', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    })
    localStorage.clear()
    vi.mocked(getBookshelfWithCacheInfo).mockResolvedValue([])
    vi.mocked(listBrowserCacheSummary).mockResolvedValue([])
  })

  it('starts searches in single-source scope by default', () => {
    const store = useBookshelfStore()

    store.startSearch('星门')

    expect(store.searchKey).toBe('星门')
    expect(store.searchScope).toBe('source')
    expect(store.searchSourceUrl).toBe('')
    expect(store.searchGroup).toBe('')
  })


  it('does not display browser cache counts for uploaded local txt books', async () => {
    vi.mocked(getBookshelfWithCacheInfo).mockResolvedValue([
      {
        name: '本地书',
        author: '本地导入',
        origin: 'local-txt',
        bookUrl: 'local-txt:abc',
        cachedChapterCount: 12,
      },
      {
        name: '远程书',
        author: '作者',
        origin: 'https://source.example',
        bookUrl: 'https://book.example/1',
      },
    ] as never)
    vi.mocked(listBrowserCacheSummary).mockResolvedValue([
      { bookUrl: 'local-txt:abc', cachedChapterCount: 12, bytes: 100, updatedAt: 1 },
      { bookUrl: 'https://book.example/1', cachedChapterCount: 3, bytes: 200, updatedAt: 2 },
    ])
    const store = useBookshelfStore()

    await store.fetchBooks()

    expect(store.books.find((book) => book.bookUrl === 'local-txt:abc')?.browserCachedChapterCount).toBe(0)
    expect(store.books.find((book) => book.bookUrl === 'https://book.example/1')?.browserCachedChapterCount).toBe(3)
  })

  it('can start a search with the active explore source selected', () => {
    const store = useBookshelfStore()

    store.startSearch('星门', { sourceUrl: 'https://m.cuoceng.com' })

    expect(store.searchKey).toBe('星门')
    expect(store.searchScope).toBe('source')
    expect(store.searchSourceUrl).toBe('https://m.cuoceng.com')
  })

  it('remembers the last search scope for later searches', () => {
    const store = useBookshelfStore()

    store.searchScope = 'all'
    store.persistSearchPreferences()
    store.clearSearch()
    store.startSearch('星门')

    expect(store.searchScope).toBe('all')
    expect(store.searchSourceUrl).toBe('')
    expect(store.searchGroup).toBe('')
  })

  it('reuses cached search results for the same key and scope', () => {
    const store = useBookshelfStore()
    const book = {
      name: '星门',
      author: '老鹰吃小鸡',
      bookUrl: 'https://book.example/xm',
      origin: 'https://source.example',
    }

    store.cacheSearchResults({
      key: '星门',
      scope: 'source',
      group: '',
      sourceUrl: 'https://source.example',
      results: [book],
    })

    expect(store.getCachedSearchResults({
      key: '星门',
      scope: 'source',
      group: '',
      sourceUrl: 'https://source.example',
    })).toEqual([book])
    expect(store.getCachedSearchResults({
      key: '星门',
      scope: 'all',
      group: '',
      sourceUrl: '',
    })).toBeNull()
  })

  it('updateBookProgress persists progress to localStorage immediately', () => {
    const store = useBookshelfStore()
    store.books = [
      {
        name: '离线测试书',
        author: '作者',
        origin: 'source-1',
        bookUrl: 'book-offline-1',
        durChapterIndex: 2,
        durChapterPos: 100,
        durChapterTitle: '第3章',
      },
    ]

    store.updateBookProgress({
      bookUrl: 'book-offline-1',
      durChapterIndex: 5,
      durChapterPos: 800,
      durChapterTitle: '第6章',
      durChapterTime: 12345678,
    })

    const book = store.books.find((b) => b.bookUrl === 'book-offline-1')
    expect(book?.durChapterIndex).toBe(5)
    expect(book?.durChapterPos).toBe(800)
    expect(book?.durChapterTitle).toBe('第6章')

    const rawCache = localStorage.getItem('reader_bookshelf_cache')
    expect(rawCache).toBeTruthy()
    const cachedBooks = JSON.parse(rawCache!)
    expect(cachedBooks[0].durChapterIndex).toBe(5)
    expect(cachedBooks[0].durChapterPos).toBe(800)
  })

  it('cold boot offline restores cached bookshelf and merges recent books deeper progress', async () => {
    // 模拟冷启动断网：远端接口失败
    vi.mocked(getBookshelfWithCacheInfo).mockRejectedValue(new Error('Network error'))

    // 预置旧书架缓存
    localStorage.setItem('reader_bookshelf_cache', JSON.stringify([
      {
        name: '断网书',
        author: '作者',
        origin: 'source-1',
        bookUrl: 'book-offline-cold',
        durChapterIndex: 1,
        durChapterPos: 100,
        durChapterTime: 1000,
      },
    ]))

    // 预置最近阅读记录（进度更深）
    const { loadRecentReadBooks } = await import('../utils/recentBooks')
    vi.mocked(loadRecentReadBooks).mockReturnValue([
      {
        name: '断网书',
        author: '作者',
        origin: 'source-1',
        bookUrl: 'book-offline-cold',
        durChapterIndex: 8,
        durChapterPos: 500,
        durChapterTime: 2000,
        recentReadAt: 2000,
      } as any,
    ])

    const store = useBookshelfStore()
    await store.fetchBooks()

    expect(store.books.length).toBe(1)
    const book = store.books[0]
    expect(book.durChapterIndex).toBe(8)
    expect(book.durChapterPos).toBe(500)
  })
})
