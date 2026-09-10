import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  getBookshelfWithCacheInfo,
  getBookGroups,
  deleteBook as apiDeleteBook,
  deleteBooks as apiDeleteBooks,
  saveBookGroupId as apiSaveBookGroupId,
  saveBookGroup as apiSaveBookGroup,
  deleteBookGroup as apiDeleteBookGroup,
  saveBooks as apiSaveBooks,
} from '../api/bookshelf'
import type { Book, BookGroup, SearchBook } from '../types'
import { deleteBrowserBookCache, listBrowserCacheSummary } from '../utils/browserCache'
import { isLocalTxtBook } from '../utils/localBook'
import { clearRecentReadBooks, getRecentReadBookKey, loadRecentReadBooks, removeRecentReadBook } from '../utils/recentBooks'
import { isNetworkOnline } from '../utils/nativeBridge'
import { appLog } from '../utils/appLogger'

type SearchScope = 'all' | 'group' | 'source'

type SearchPreferences = {
  scope: SearchScope
  group: string
  sourceUrl: string
}

type SearchCacheParams = SearchPreferences & {
  key: string
}

type SearchCacheEntry = SearchCacheParams & {
  results: SearchBook[]
  updatedAt: number
}

const SEARCH_PREFERENCES_KEY = 'reader-search-preferences'
const SEARCH_CACHE_TTL = 30 * 60 * 1000
const SEARCH_CACHE_LIMIT = 20

// ─── 书架本地持久化（Stale-While-Revalidate） ───
const BOOKSHELF_CACHE_KEY = 'reader_bookshelf_cache'
const BOOK_GROUPS_CACHE_KEY = 'reader_book_groups_cache'

/** 从 localStorage 读取本地缓存的书架数组 */
function loadCachedBookshelf(): Book[] {
  try {
    const raw = localStorage.getItem(BOOKSHELF_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as Book[] : []
  } catch {
    return []
  }
}

/** 从 localStorage 读取本地缓存的书架分组 */
function loadCachedGroups(): BookGroup[] {
  try {
    const raw = localStorage.getItem(BOOK_GROUPS_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as BookGroup[] : []
  } catch {
    return []
  }
}

/** 持久化书架到 localStorage */
function saveCachedBookshelf(books: Book[]) {
  try {
    localStorage.setItem(BOOKSHELF_CACHE_KEY, JSON.stringify(books))
  } catch (e) {
    console.warn('saveCachedBookshelf 失败', e)
  }
}

/** 持久化书架分组到 localStorage */
function saveCachedGroups(groups: BookGroup[]) {
  try {
    localStorage.setItem(BOOK_GROUPS_CACHE_KEY, JSON.stringify(groups))
  } catch (e) {
    console.warn('saveCachedGroups 失败', e)
  }
}

/**
 * 合并服务端书架与本地缓存的进度信息（防回弹仲裁）。
 * 服务端为元数据权威，本地 durChapterIndex/durChapterPos/durChapterTime 取最新。
 * browserCachedChapterCount 始终以本地 browserMap 为准。
 */
function mergeServerBooksWithLocalProtection(
  serverBooks: Book[],
  localBooks: Book[],
  browserMap: Map<string, number>,
): Book[] {
  const localMap = new Map(localBooks.map((b) => [b.bookUrl, b]))
  return serverBooks.map((server) => {
    const local = localMap.get(server.bookUrl)
    const browserCount = isLocalTxtBook(server) ? 0 : (browserMap.get(server.bookUrl) || 0)
    if (!local) {
      return { ...server, browserCachedChapterCount: browserCount }
    }
    // 仲裁：取进度更深的一方（durChapterIndex 更大者胜出，相同则比较 durChapterPos）
    const localDeeper = (local.durChapterIndex ?? 0) > (server.durChapterIndex ?? 0)
      || ((local.durChapterIndex ?? 0) === (server.durChapterIndex ?? 0)
        && (local.durChapterPos ?? 0) > (server.durChapterPos ?? 0))
    const mergedProgress = localDeeper
      ? {
        durChapterIndex: local.durChapterIndex,
        durChapterPos: local.durChapterPos,
        durChapterTime: local.durChapterTime,
      }
      : {
        durChapterIndex: server.durChapterIndex,
        durChapterPos: server.durChapterPos,
        durChapterTime: server.durChapterTime,
      }
    return {
      ...server,           // 服务端元数据为权威
      ...mergedProgress,   // 进度取仲裁结果
      browserCachedChapterCount: browserCount,
    }
  })
}

function loadSearchPreferences(): SearchPreferences {
  try {
    const raw = localStorage.getItem(SEARCH_PREFERENCES_KEY)
    const parsed = raw ? JSON.parse(raw) as Partial<SearchPreferences> : {}
    const scope = parsed.scope === 'all' || parsed.scope === 'group' || parsed.scope === 'source'
      ? parsed.scope
      : 'source'
    return {
      scope,
      group: typeof parsed.group === 'string' ? parsed.group : '',
      sourceUrl: typeof parsed.sourceUrl === 'string' ? parsed.sourceUrl : '',
    }
  } catch {
    return { scope: 'source', group: '', sourceUrl: '' }
  }
}

function buildSearchCacheKey(params: SearchCacheParams) {
  return JSON.stringify({
    key: params.key.trim(),
    scope: params.scope,
    group: params.group || '',
    sourceUrl: params.sourceUrl || '',
  })
}

export const useBookshelfStore = defineStore('bookshelf', () => {
  // ─── Bookshelf ───
  const books = ref<Book[]>([])
  const recentBooks = ref<Book[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const sorting = ref(false)
  // fetchBooks 并发竞态保护：每次启动递增 seq，远端段返回时若 seq 已过期则放弃写入
  let fetchBooksSeq = 0

  async function refreshRecentBooks() {
    const browserSummaries = await listBrowserCacheSummary().catch(() => [])
    const browserMap = new Map(browserSummaries.map((item) => [item.bookUrl, item.cachedChapterCount]))
    const shelfMap = new Map(books.value.map((book) => [getRecentReadBookKey(book), book]))
    recentBooks.value = loadRecentReadBooks().map((entry) => {
      const shelfBook = shelfMap.get(getRecentReadBookKey(entry))
      const merged = shelfBook
        ? {
          ...entry,
          ...shelfBook,
          recentReadAt: entry.recentReadAt,
          durChapterTime: entry.recentReadAt,
        }
        : entry
      return {
        ...merged,
        browserCachedChapterCount: isLocalTxtBook(merged) ? 0 : browserMap.get(merged.bookUrl) || merged.browserCachedChapterCount || 0,
      }
    })
  }

  async function removeRecentBook(book: Pick<Book, 'bookUrl' | 'origin'>) {
    removeRecentReadBook(book)
    await refreshRecentBooks()
  }

  async function clearAllRecentBooks() {
    clearRecentReadBooks()
    await refreshRecentBooks()
  }

  /**
   * Stale-While-Revalidate：
   * 1. 本地秒出（无远端依赖，断网直接展示缓存书架）
   * 2. 后台静默拉取远端更新，合并并刷新本地持久化
   * 3. 远端失败保留本地书架，不闪烁
   */
  async function fetchBooks() {
    const mySeq = ++fetchBooksSeq
    // 1. 优先读取本地持久化，实现 0ms 秒开书架
    if (books.value.length === 0) {
      let cached = loadCachedBookshelf()
      if (cached.length > 0) {
        // 冷启动防回退：与本地最近阅读快速融合，防止冷启动拿到滞后数据
        const recent = loadRecentReadBooks()
        if (recent.length > 0) {
          const recentMap = new Map(recent.map((r) => [r.bookUrl, r]))
          let changed = false
          cached = cached.map((b) => {
            const r = recentMap.get(b.bookUrl)
            if (!r) return b
            const rDeeper = (r.durChapterIndex ?? 0) > (b.durChapterIndex ?? 0)
              || ((r.durChapterIndex ?? 0) === (b.durChapterIndex ?? 0) && (r.durChapterPos ?? 0) > (b.durChapterPos ?? 0))
              || ((r.durChapterTime ?? 0) > (b.durChapterTime ?? 0))
            if (rDeeper) {
              changed = true
              return {
                ...b,
                durChapterIndex: r.durChapterIndex ?? b.durChapterIndex,
                durChapterTitle: r.durChapterTitle ?? b.durChapterTitle,
                durChapterPos: r.durChapterPos ?? b.durChapterPos,
                durChapterTime: r.durChapterTime ?? b.durChapterTime,
              }
            }
            return b
          })
          if (changed) {
            saveCachedBookshelf(cached)
          }
        }
        books.value = cached
        const cachedGroups = loadCachedGroups()
        if (cachedGroups.length > 0 && groups.value.length === 0) {
          groups.value = cachedGroups
        }
        appLog('书架', `优先加载本地离线书架成功，共 ${cached.length} 本书`)
        // 本地秒出后立即刷新最近阅读，不阻塞
        void refreshRecentBooks().catch(() => undefined)
      } else {
        appLog('书架', '本地无离线书架缓存')
      }
    }

    // 2. 后台静默拉取远端更新
    // 若本地已有书籍数据，无需让全局 loading 为 true，避免离线时拖拽排序被禁用
    if (books.value.length === 0) {
      loading.value = true
    }

    // 若当前检测到离线，直接完成，无需发起远端请求
    if (!isNetworkOnline() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      loading.value = false
      return
    }

    try {
      appLog('书架', '尝试静默同步远端书架...')
      const [serverBooks, browserSummaries] = await Promise.all([
        getBookshelfWithCacheInfo(),
        listBrowserCacheSummary().catch(() => []),
      ])
      // 并发竞态保护：若已被更新的 fetchBooks 覆盖，放弃本次写入
      if (mySeq !== fetchBooksSeq) return
      const browserMap = new Map(browserSummaries.map((item) => [item.bookUrl, item.cachedChapterCount]))
      // 合并服务端书架与本地进度（防回弹仲裁）
      books.value = mergeServerBooksWithLocalProtection(serverBooks, books.value, browserMap)
      // 写回本地持久化
      saveCachedBookshelf(books.value)
      await refreshRecentBooks()
      appLog('书架', `远端书架同步完成，当前共 ${books.value.length} 本书`)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reader-flush-outbox'))
      }
    } catch (err) {
      // 远端失败：保留本地书架，不重置 books.value
      appLog('书架', `远端书架同步失败: ${(err as Error).message || String(err)}，继续保持本地离线书架`)
    } finally {
      loading.value = false
    }
  }

  /**
   * 主动刷新书架（用户下拉刷新等场景）：
   * 不走本地秒出段，直接拉取远端，失败时保留本地
   */
  async function refreshBooks() {
    refreshing.value = true
    const mySeq = ++fetchBooksSeq
    try {
      appLog('书架', '用户主动刷新书架...')
      const [serverBooks, browserSummaries] = await Promise.all([
        getBookshelfWithCacheInfo(),
        listBrowserCacheSummary().catch(() => []),
      ])
      if (mySeq !== fetchBooksSeq) return
      const browserMap = new Map(browserSummaries.map((item) => [item.bookUrl, item.cachedChapterCount]))
      books.value = mergeServerBooksWithLocalProtection(serverBooks, books.value, browserMap)
      saveCachedBookshelf(books.value)
      await refreshRecentBooks()
      appLog('书架', `主动刷新书架成功，共 ${books.value.length} 本书`)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('reader-flush-outbox'))
      }
    } catch (err) {
      appLog('书架', `主动刷新书架失败: ${(err as Error).message || String(err)}，保留本地数据`)
    } finally {
      refreshing.value = false
    }
  }

  async function removeBook(book: Book) {
    await apiDeleteBook(book)
    await deleteBrowserBookCache(book.bookUrl).catch(() => undefined)
    books.value = books.value.filter((b) => b.bookUrl !== book.bookUrl)
    // 同步清理本地持久化
    saveCachedBookshelf(books.value)
    await refreshRecentBooks()
  }

  // ─── Groups ───
  const groups = ref<BookGroup[]>([])
  const activeGroupId = ref<number>(-1) // -1 = all

  const displayGroups = computed(() => {
    const all: BookGroup = { groupId: -1, groupName: '全部' }
    const ungrouped: BookGroup = { groupId: 0, groupName: '未分组' }
    return [all, ...groups.value, ungrouped]
  })

  const filteredBooks = computed(() => {
    if (activeGroupId.value === -1) return books.value
    if (activeGroupId.value === 0) {
      return books.value.filter((b) => !b.group || b.group === 0)
    }
    return books.value.filter(
      (b) => b.group && (b.group & activeGroupId.value) !== 0
    )
  })

  async function fetchGroups() {
    // 1. 优先本地秒出
    if (groups.value.length === 0) {
      const cached = loadCachedGroups()
      if (cached.length > 0) {
        groups.value = cached
      }
    }

    // 若当前离线，无需发起远端请求
    if (!isNetworkOnline() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return
    }

    try {
      const serverGroups = await getBookGroups()
      groups.value = serverGroups
      saveCachedGroups(serverGroups)
    } catch {
      // 远端失败：若本地有缓存则保留，否则置空
      const cached = loadCachedGroups()
      if (cached.length > 0) {
        groups.value = cached
      } else {
        groups.value = []
      }
    }
  }

  async function saveGroup(groupName: string, groupId = 0) {
    await apiSaveBookGroup({
      groupId,
      groupName,
      orderNo: groups.value.length,
    })
    await fetchGroups()
    return groups.value.find((group) => group.groupName === groupName)?.groupId || groupId
  }

  async function removeGroup(groupId: number) {
    await apiDeleteBookGroup(groupId)
    groups.value = groups.value.filter((group) => group.groupId !== groupId)
    // 同步清理本地持久化
    saveCachedGroups(groups.value)
    books.value = books.value.map((book) => {
      if (book.group && (book.group & groupId) !== 0) {
        return { ...book, group: book.group & ~groupId }
      }
      return book
    })
    saveCachedBookshelf(books.value)
  }

  // ─── Search ───
  const searchResults = ref<SearchBook[]>([])
  const isSearching = ref(false)
  const searchKey = ref('')
  const searchPreferences = loadSearchPreferences()
  const searchScope = ref<SearchScope>(searchPreferences.scope)
  const searchGroup = ref('')
  const searchSourceUrl = ref('')
  const searchCache = ref<SearchCacheEntry[]>([])

  function persistSearchPreferences() {
    const preferences: SearchPreferences = {
      scope: searchScope.value,
      group: searchGroup.value,
      sourceUrl: searchSourceUrl.value,
    }
    localStorage.setItem(SEARCH_PREFERENCES_KEY, JSON.stringify(preferences))
  }

  function startSearch(key: string, options: {
    scope?: SearchScope
    group?: string
    sourceUrl?: string
  } = {}) {
    const nextKey = key.trim()
    if (!nextKey) {
      clearSearch()
      return
    }

    const saved = loadSearchPreferences()
    searchScope.value = options.scope || saved.scope
    searchGroup.value = options.group ?? (searchScope.value === 'group' ? saved.group : '')
    searchSourceUrl.value = options.sourceUrl ?? (searchScope.value === 'source' ? saved.sourceUrl : '')
    searchKey.value = nextKey
    persistSearchPreferences()
  }

  function clearSearch() {
    searchResults.value = []
    searchKey.value = ''
    isSearching.value = false
  }

  function getCachedSearchResults(params: SearchCacheParams) {
    const cacheKey = buildSearchCacheKey(params)
    const now = Date.now()
    const entry = searchCache.value.find((item) => buildSearchCacheKey(item) === cacheKey)
    if (!entry) return null
    if (now - entry.updatedAt > SEARCH_CACHE_TTL) {
      searchCache.value = searchCache.value.filter((item) => item !== entry)
      return null
    }
    return entry.results.slice()
  }

  function cacheSearchResults(params: SearchCacheParams & { results: SearchBook[] }) {
    const entry: SearchCacheEntry = {
      key: params.key.trim(),
      scope: params.scope,
      group: params.group || '',
      sourceUrl: params.sourceUrl || '',
      results: params.results.slice(),
      updatedAt: Date.now(),
    }
    const cacheKey = buildSearchCacheKey(entry)
    searchCache.value = [
      entry,
      ...searchCache.value.filter((item) => buildSearchCacheKey(item) !== cacheKey),
    ].slice(0, SEARCH_CACHE_LIMIT)
  }

  const isSearchMode = computed(() => searchKey.value.length > 0)

  // ─── Edit mode and Selection ───
  const editMode = ref(false)
  const selectedBookUrls = ref<Set<string>>(new Set())

  function toggleSelection(url: string) {
    if (selectedBookUrls.value.has(url)) {
      selectedBookUrls.value.delete(url)
    } else {
      selectedBookUrls.value.add(url)
    }
  }

  function selectAll() {
    filteredBooks.value.forEach(b => selectedBookUrls.value.add(b.bookUrl))
  }

  function clearSelection() {
    selectedBookUrls.value.clear()
  }

  async function bulkDelete() {
    const toDelete = books.value
      .filter(b => selectedBookUrls.value.has(b.bookUrl))
      .map(b => ({ bookUrl: b.bookUrl, origin: b.origin }))

    if (toDelete.length === 0) return
    await apiDeleteBooks(toDelete as Book[])
    await Promise.all(toDelete.map((book) => deleteBrowserBookCache(book.bookUrl).catch(() => undefined)))
    books.value = books.value.filter(b => !selectedBookUrls.value.has(b.bookUrl))
    // 同步清理本地持久化
    saveCachedBookshelf(books.value)
    clearSelection()
  }

  async function bulkSetGroup(groupId: number) {
    const urls = Array.from(selectedBookUrls.value)
    for (const url of urls) {
      await apiSaveBookGroupId(url, groupId)
    }
    // Refresh to get updated groups
    await fetchBooks()
    clearSelection()
  }

  async function reorderBooks(draggedUrl: string, targetUrl: string) {
    if (!draggedUrl || !targetUrl || draggedUrl === targetUrl) return

    const snapshot = books.value.slice()
    const fromIndex = snapshot.findIndex((book) => book.bookUrl === draggedUrl)
    const toIndex = snapshot.findIndex((book) => book.bookUrl === targetUrl)
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return

    const next = snapshot.slice()
    const [moved] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, moved)

    books.value = next
    sorting.value = true
    try {
      await apiSaveBooks(next)
      // 成功后同步本地持久化
      saveCachedBookshelf(books.value)
    } catch (error) {
      books.value = snapshot
      throw error
    } finally {
      sorting.value = false
    }
  }

  async function moveBookToFront(bookUrl: string) {
    if (!bookUrl || books.value.length <= 1) return

    const snapshot = books.value.slice()
    const fromIndex = snapshot.findIndex((book) => book.bookUrl === bookUrl)
    if (fromIndex <= 0) return

    const next = snapshot.slice()
    const [moved] = next.splice(fromIndex, 1)
    next.unshift(moved)

    // 乐观更新：本地内存与持久化立即生效
    books.value = next
    saveCachedBookshelf(books.value)

    // 若当前检测到离线，直接完成，不触发网络请求
    if (!isNetworkOnline() || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      return
    }

    try {
      await apiSaveBooks(next)
    } catch (error) {
      // 离线或网络异常时不回滚本地书架排序，保留本地视觉连续性
      appLog('书架', `书架置顶远端同步失败: ${(error as Error).message || String(error)}，保持本地排序`)
    }
  }

  /**
   * 实时更新单本书籍的阅读进度并持久化到 localStorage
   * 翻页、滚动、换章时即刻调用，确保断网强杀进程后冷启动进度不丢失
   */
  function updateBookProgress(params: {
    bookUrl: string
    durChapterIndex?: number
    durChapterTitle?: string
    durChapterPos?: number
    durChapterTime?: number
  }) {
    if (!params.bookUrl) return
    const target = books.value.find((b) => b.bookUrl === params.bookUrl)
    if (!target) return

    let changed = false
    if (params.durChapterIndex !== undefined && params.durChapterIndex !== target.durChapterIndex) {
      target.durChapterIndex = params.durChapterIndex
      changed = true
    }
    if (params.durChapterTitle !== undefined && params.durChapterTitle !== target.durChapterTitle) {
      target.durChapterTitle = params.durChapterTitle
      changed = true
    }
    if (params.durChapterPos !== undefined && params.durChapterPos !== target.durChapterPos) {
      target.durChapterPos = params.durChapterPos
      changed = true
    }
    if (params.durChapterTime !== undefined && params.durChapterTime !== target.durChapterTime) {
      target.durChapterTime = params.durChapterTime
      changed = true
    }

    if (changed) {
      saveCachedBookshelf(books.value)
    }
  }

  return {
    books, recentBooks, loading, refreshing, sorting,
    fetchBooks, refreshBooks, removeBook,
    refreshRecentBooks, removeRecentBook, clearAllRecentBooks,
    groups, activeGroupId, displayGroups, filteredBooks,
    fetchGroups, saveGroup, removeGroup,
    searchResults, isSearching, searchKey,
    searchScope, searchGroup, searchSourceUrl, startSearch, clearSearch, isSearchMode,
    persistSearchPreferences, getCachedSearchResults, cacheSearchResults,
    editMode,
    selectedBookUrls, toggleSelection, selectAll, clearSelection,
    bulkDelete, bulkSetGroup, reorderBooks, moveBookToFront,
    updateBookProgress,
  }
})
