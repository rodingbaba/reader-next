import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { exploreBook, exploreBookGlobal, getExploreKinds } from '../api/explore'
import { useSourceStore } from './source'
import type { SearchBook, BookSource } from '../types'
import {
  getInitialExploreCategoryUrl,
  parseExploreCategories,
  type ExploreCategory,
} from '../utils/exploreCategories'

const GLOBAL_EXPLORE_SOURCE_URL = '__global_explore__'
const GLOBAL_EXPLORE_CATEGORIES: ExploreCategory[] = [
  { title: '综合', url: 'mixed' },
  { title: '排行', url: 'rank' },
  { title: '新书', url: 'new' },
  { title: '完本', url: 'finished' },
  { title: '玄幻', url: 'fantasy' },
  { title: '都市', url: 'urban' },
  { title: '历史', url: 'history' },
  { title: '科幻', url: 'sci-fi' },
  { title: '悬疑', url: 'suspense' },
]

export interface CategoryCacheItem {
  books: SearchBook[]
  page: number
  globalCursor: number
  hasMore: boolean
  updatedAt: number
}

const EXPLORE_CACHE_STORAGE_PREFIX = 'reader_explore_cache_v1_'

function getCacheKey(sourceUrl: string, categoryUrl: string): string {
  return `${sourceUrl}::${categoryUrl}`
}

function loadPersistentCache(key: string): CategoryCacheItem | null {
  try {
    if (typeof localStorage === 'undefined') return null
    const raw = localStorage.getItem(EXPLORE_CACHE_STORAGE_PREFIX + key)
    if (!raw) return null
    return JSON.parse(raw) as CategoryCacheItem
  } catch {
    return null
  }
}

function savePersistentCache(key: string, item: CategoryCacheItem) {
  try {
    if (typeof localStorage === 'undefined') return
    const toSave: CategoryCacheItem = {
      ...item,
      books: item.books.slice(0, 60), // 最多缓存 60 本书快照，保护存储配额
    }
    localStorage.setItem(EXPLORE_CACHE_STORAGE_PREFIX + key, JSON.stringify(toSave))
  } catch {
    // 忽略配额超限异常
  }
}

function removePersistentCache(key: string) {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(EXPLORE_CACHE_STORAGE_PREFIX + key)
  } catch {
    // ignore
  }
}

export const useExploreStore = defineStore('explore', () => {
  const sourceStore = useSourceStore()

  const activeSourceUrl = ref<string>('')
  const activeCategoryUrl = ref<string>('')
  
  const books = ref<SearchBook[]>([])
  const loading = ref(false)
  const refreshing = ref(false)
  const page = ref(1)
  const globalCursor = ref(0)
  const hasMore = ref(true)
  const error = ref<string | null>(null)
  const categories = ref<ExploreCategory[]>([])
  let categoryLoadId = 0

  // 内存级分类缓存映射
  const categoryCacheMap = ref<Map<string, CategoryCacheItem>>(new Map())

  // 筛选出启用了 explore 的书源
  const exploreSources = computed(() => {
    return sourceStore.sources.filter((s: BookSource) => s.enabledExplore && s.exploreUrl)
  })

  // 当前选中的书源对象
  const currentSource = computed(() => {
    return sourceStore.sources.find((s: BookSource) => s.bookSourceUrl === activeSourceUrl.value)
  })

  const globalExploreSourceUrl = computed(() => GLOBAL_EXPLORE_SOURCE_URL)
  const isGlobalMode = computed(() => activeSourceUrl.value === GLOBAL_EXPLORE_SOURCE_URL)

  function getSnapshot(key: string): CategoryCacheItem | null {
    if (categoryCacheMap.value.has(key)) {
      return categoryCacheMap.value.get(key)!
    }
    const persistent = loadPersistentCache(key)
    if (persistent) {
      categoryCacheMap.value.set(key, persistent)
      return persistent
    }
    return null
  }

  function commitSnapshot(key: string) {
    const item: CategoryCacheItem = {
      books: books.value,
      page: page.value,
      globalCursor: globalCursor.value,
      hasMore: hasMore.value,
      updatedAt: Date.now(),
    }
    categoryCacheMap.value.set(key, item)
    savePersistentCache(key, item)
  }

  async function ensureActiveSource() {
    if (exploreSources.value.length === 0) {
      activeSourceUrl.value = ''
      activeCategoryUrl.value = ''
      categories.value = []
      books.value = []
      hasMore.value = false
      return
    }

    if (!activeSourceUrl.value || isGlobalMode.value) {
      await setSource(GLOBAL_EXPLORE_SOURCE_URL)
      return
    }

    const activeSourceStillValid = exploreSources.value.some((source) => source.bookSourceUrl === activeSourceUrl.value)
    if (!activeSourceStillValid) {
      await setSource(GLOBAL_EXPLORE_SOURCE_URL)
      return
    }

    if (categories.value.length === 0 && currentSource.value) {
      await loadCategories(currentSource.value)
    }

    if (!categories.value.some((category) => category.url === activeCategoryUrl.value)) {
      const firstCategoryUrl = getInitialExploreCategoryUrl(categories.value)
      if (firstCategoryUrl) {
        setCategory(firstCategoryUrl)
      }
    }
  }

  async function setGlobalSource() {
    activeSourceUrl.value = GLOBAL_EXPLORE_SOURCE_URL
    categories.value = GLOBAL_EXPLORE_CATEGORIES
    if (!categories.value.some((category) => category.url === activeCategoryUrl.value)) {
      await setCategory(categories.value[0].url)
    }
  }

  async function loadCategories(source: BookSource) {
    const loadId = ++categoryLoadId
    let next: ExploreCategory[]
    try {
      next = await getExploreKinds({ bookSourceUrl: source.bookSourceUrl })
    } catch {
      next = parseExploreCategories(source.exploreUrl)
    }
    if (loadId === categoryLoadId && activeSourceUrl.value === source.bookSourceUrl) {
      categories.value = next
    }
  }

  async function setSource(url: string) {
    if (url === GLOBAL_EXPLORE_SOURCE_URL) {
      await setGlobalSource()
      return
    }

    const sourceChanged = activeSourceUrl.value !== url
    if (sourceChanged) {
      activeSourceUrl.value = url
      activeCategoryUrl.value = ''
      categories.value = []
      books.value = []
      hasMore.value = false
    }

    const source = currentSource.value
    if (!source) {
      categories.value = []
      activeCategoryUrl.value = ''
      books.value = []
      hasMore.value = false
      return
    }

    await loadCategories(source)
    if (activeSourceUrl.value !== source.bookSourceUrl) return

    const firstCategoryUrl = getInitialExploreCategoryUrl(categories.value)
    if (!firstCategoryUrl) {
      activeCategoryUrl.value = ''
      books.value = []
      hasMore.value = false
      return
    }

    const activeCategoryStillValid = categories.value.some((category) => category.url === activeCategoryUrl.value)
    if (sourceChanged || !activeCategoryStillValid) {
      await setCategory(firstCategoryUrl)
    }
  }

  async function setCategory(url: string) {
    const nextUrl = url.trim()
    if (!nextUrl) return
    if (activeCategoryUrl.value === nextUrl && books.value.length > 0) return

    activeCategoryUrl.value = nextUrl
    const cacheKey = getCacheKey(activeSourceUrl.value, nextUrl)
    const cached = getSnapshot(cacheKey)

    // 优先命中本地持久化与内存缓存：不刷新尽量保持，0ms 即开即显，支持弱网/离线浏览
    if (cached && cached.books.length > 0) {
      books.value = [...cached.books]
      page.value = cached.page
      globalCursor.value = cached.globalCursor
      hasMore.value = cached.hasMore
      error.value = null
      return
    }

    // 首次访问该分类无缓存时，触发拉取
    await resetAndFetch()
  }

  async function resetAndFetch() {
    books.value = []
    page.value = 1
    globalCursor.value = 0
    hasMore.value = true
    error.value = null
    await fetchMore()
  }

  /**
   * 用户手工刷新当前分类：显式清除当前分类缓存并重新全网抓取
   */
  async function refreshCurrentCategory() {
    if (refreshing.value || !activeSourceUrl.value || !activeCategoryUrl.value) return
    const cacheKey = getCacheKey(activeSourceUrl.value, activeCategoryUrl.value)
    categoryCacheMap.value.delete(cacheKey)
    removePersistentCache(cacheKey)

    refreshing.value = true
    try {
      await resetAndFetch()
    } finally {
      refreshing.value = false
    }
  }

  async function fetchMore() {
    if (loading.value || !hasMore.value || !activeSourceUrl.value || !activeCategoryUrl.value) return

    loading.value = true
    error.value = null
    const cacheKey = getCacheKey(activeSourceUrl.value, activeCategoryUrl.value)
    try {
      if (isGlobalMode.value) {
        const result = await exploreBookGlobal({
          category: activeCategoryUrl.value,
          cursor: globalCursor.value,
          limit: 20,
          scanLimit: 96,
          concurrentCount: 16,
        })
        if (result.books.length > 0) {
          books.value.push(...result.books)
        }
        globalCursor.value = result.nextCursor
        hasMore.value = result.hasMore
        commitSnapshot(cacheKey)
        return
      }

      const result = await exploreBook({
        bookSourceUrl: activeSourceUrl.value,
        ruleFindUrl: activeCategoryUrl.value,
        page: page.value,
      })

      if (result && result.length > 0) {
        books.value.push(...result)
        page.value++
      } else {
        hasMore.value = false
      }
      commitSnapshot(cacheKey)
    } catch (err: any) {
      error.value = err.message || '加载失败'
      hasMore.value = false
    } finally {
      loading.value = false
    }
  }

  // 初始化时加载书源数据
  async function init() {
    if (sourceStore.sources.length === 0) {
      await sourceStore.fetchSources()
    }
    await ensureActiveSource()
  }

  watch(exploreSources, () => {
    void ensureActiveSource()
  })

  return {
    activeSourceUrl,
    activeCategoryUrl,
    books,
    loading,
    refreshing,
    page,
    hasMore,
    error,
    exploreSources,
    currentSource,
    globalExploreSourceUrl,
    isGlobalMode,
    categories,
    init,
    setSource,
    setCategory,
    fetchMore,
    resetAndFetch,
    refreshCurrentCategory,
  }
})
