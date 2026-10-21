import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CacheLibraryModal from './CacheLibraryModal.vue'
import { useBookshelfStore } from '../stores/bookshelf'
import { useOfflineDownloadStore } from '../stores/offlineDownload'
import * as bookshelfApi from '../api/bookshelf'
import * as browserCache from '../utils/browserCache'
import * as bookCacheUtils from '../utils/bookCache'

vi.mock('../api/bookshelf', () => ({
  getBookshelfWithCacheInfo: vi.fn(),
  deleteBookCache: vi.fn(),
}))

vi.mock('../utils/browserCache', () => ({
  listBrowserCacheSummary: vi.fn(),
  deleteBrowserBookCache: vi.fn(),
  loadBrowserCacheSummarySnapshot: vi.fn(() => []),
  saveBrowserCacheSummarySnapshot: vi.fn(),
}))

vi.mock('../utils/bookCache', () => ({
  resolveBookChapters: vi.fn(),
  clearBookOfflineCache: vi.fn(),
}))

describe('CacheLibraryModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(bookshelfApi.getBookshelfWithCacheInfo).mockResolvedValue([
      { bookUrl: 'https://example.com/b1', cachedChapterCount: 15 } as any,
    ])
    vi.mocked(browserCache.listBrowserCacheSummary).mockResolvedValue([
      { bookUrl: 'https://example.com/b1', cachedChapterCount: 10, bytes: 1024, updatedAt: Date.now() },
      { bookUrl: 'local-txt:123', cachedChapterCount: 50, bytes: 2048, updatedAt: Date.now() },
    ])
  })

  it('renders both network books and local books with proper badges', async () => {
    const shelfStore = useBookshelfStore()
    shelfStore.books = [
      {
        bookUrl: 'https://example.com/b1',
        name: '斗罗大陆',
        author: '唐家三少',
        origin: 'https://example.com',
        durChapterIndex: 20,
      } as any,
      {
        bookUrl: 'local-txt:123',
        name: '诛仙.txt',
        author: '萧鼎',
        origin: 'local-txt',
        durChapterIndex: 5,
      } as any,
    ]

    const wrapper = mount(CacheLibraryModal, {
      props: { modelValue: true },
      global: {
        stubs: { Teleport: true, Transition: false },
      },
    })

    await flushPromises()

    const text = wrapper.text()
    expect(text).toContain('斗罗大陆')
    expect(text).toContain('诛仙.txt')
    expect(text).toContain('本地')
    expect(text).toContain('已离线 10 章')
    expect(text).toContain('已离线 50 章')
  })

  it('triggers download with durChapterIndex as startIndex for scope 50', async () => {
    const shelfStore = useBookshelfStore()
    const offlineStore = useOfflineDownloadStore()
    vi.spyOn(offlineStore, 'startDownload').mockResolvedValue(true)

    shelfStore.books = [
      {
        bookUrl: 'https://example.com/b1',
        name: '斗罗大陆',
        origin: 'https://example.com',
        durChapterIndex: 42,
      } as any,
    ]

    vi.mocked(bookCacheUtils.resolveBookChapters).mockResolvedValue([
      { index: 0, title: '第1章', url: 'c1' },
    ] as any)

    const wrapper = mount(CacheLibraryModal, {
      props: { modelValue: true },
      global: {
        stubs: { Teleport: true, Transition: false },
      },
    })

    await flushPromises()

    const downloadBtn = wrapper.find('.action-btn.primary')
    expect(downloadBtn.text()).toContain('下载 50 章')
    await downloadBtn.trigger('click')
    await flushPromises()

    expect(bookCacheUtils.resolveBookChapters).toHaveBeenCalledWith(shelfStore.books[0])
    expect(offlineStore.startDownload).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 50,
        startIndex: 42,
      }),
    )
  })

  it('shows downloading card when book is downloading', async () => {
    const shelfStore = useBookshelfStore()
    const offlineStore = useOfflineDownloadStore()

    shelfStore.books = [
      {
        bookUrl: 'https://example.com/b1',
        name: '斗罗大陆',
        origin: 'https://example.com',
      } as any,
    ]

    offlineStore.isDownloading = true
    offlineStore.activeBookUrl = 'https://example.com/b1'
    offlineStore.progress = 68
    offlineStore.currentChapterName = '第68章 魂骨'
    vi.spyOn(offlineStore, 'cancelDownload')

    const wrapper = mount(CacheLibraryModal, {
      props: { modelValue: true },
      global: {
        stubs: { Teleport: true, Transition: false },
      },
    })

    await flushPromises()

    expect(wrapper.find('.downloading-card').exists()).toBe(true)
    expect(wrapper.text()).toContain('68%')
    expect(wrapper.text()).toContain('第68章 魂骨')

    await wrapper.find('.mini-stop-btn').trigger('click')
    expect(offlineStore.cancelDownload).toHaveBeenCalled()
  })

  it('prioritizes offline local bookshelf cache for instant 0ms render when store is empty', async () => {
    const offlineBooks = [
      {
        bookUrl: 'local-offline:1',
        name: '离线秒戏剧本',
        author: '离线作者',
        cachedChapterCount: 88,
      },
    ]
    localStorage.setItem('reader_bookshelf_cache', JSON.stringify(offlineBooks))
    vi.mocked(browserCache.loadBrowserCacheSummarySnapshot).mockReturnValue([
      { bookUrl: 'local-offline:1', cachedChapterCount: 88, bytes: 5000, updatedAt: Date.now() },
    ])

    const wrapper = mount(CacheLibraryModal, {
      props: { modelValue: true },
      global: {
        stubs: { Teleport: true, Transition: false },
      },
    })

    // 甚至不需要等网络请求完成，挂载首帧就已经渲染离线书籍和章节数
    expect(wrapper.text()).toContain('离线秒戏剧本')
    expect(wrapper.text()).toContain('离线作者')
    expect(wrapper.text()).toContain('已离线 88 章')
  })
})

