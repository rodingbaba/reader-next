import { invokeData, isNativeApp } from './nativeBridge'
import { appLog } from './appLogger'
import { compressImageToThumbnail } from './imageCompress'
import type { BookChapter } from '../types'

const DB_NAME = 'reader-browser-cache'
const DB_VERSION = 3
const STORE_NAME = 'chapters'
const CHAPTER_LIST_STORE = 'chapter_lists'
const COVER_CACHE_STORE = 'covers'
let dbPromise: Promise<IDBDatabase> | null = null

export interface BrowserCoverCacheRecord {
  key: string
  coverUrl?: string
  dataUrl: string
  updatedAt: number
}

export interface BrowserChapterCacheRecord {
  key: string
  bookUrl: string
  chapterUrl: string
  chapterTitle: string
  content: string
  size: number
  updatedAt: number
}

export interface BrowserBookCacheSummary {
  bookUrl: string
  cachedChapterCount: number
  bytes: number
  updatedAt: number
}

/** 章节目录缓存记录 */
export interface BrowserChapterListRecord {
  bookUrl: string
  chapters: BookChapter[]
  totalChapterNum: number
  updatedAt: number
}

function cacheKey(bookUrl: string, chapterUrl: string) {
  return `${bookUrl}::${chapterUrl}`
}

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)

      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      request.onupgradeneeded = () => {
        const db = request.result
        // v1: chapters 表
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' })
          store.createIndex('bookUrl', 'bookUrl', { unique: false })
          store.createIndex('updatedAt', 'updatedAt', { unique: false })
        }
        // v2: chapter_lists 表（目录离线持久化）
        if (!db.objectStoreNames.contains(CHAPTER_LIST_STORE)) {
          db.createObjectStore(CHAPTER_LIST_STORE, { keyPath: 'bookUrl' })
        }
        // v3: covers 表（封面离线持久化）
        if (!db.objectStoreNames.contains(COVER_CACHE_STORE)) {
          db.createObjectStore(COVER_CACHE_STORE, { keyPath: 'key' })
        }
      }
    }).catch((error: unknown) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise!
}

/**
 * 在指定 store 上执行事务。
 * storeName 默认为 chapters，chapter_lists 表需显式传入。
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  handler: (store: IDBObjectStore) => Promise<T>,
  storeName: string = STORE_NAME,
): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode)
    const store = tx.objectStore(storeName)
    let result: T

    tx.oncomplete = () => {
      resolve(result)
    }
    tx.onerror = () => {
      reject(tx.error)
    }
    tx.onabort = () => {
      reject(tx.error || new Error('IndexedDB 事务已中止'))
    }

    handler(store)
      .then((res) => {
        result = res
      })
      .catch((error) => {
        reject(error)
      })
  })
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getBrowserCachedChapter(bookUrl: string, chapterUrl: string) {
  return withStore('readonly', async (store) => {
    const result = await requestToPromise(store.get(cacheKey(bookUrl, chapterUrl)))
    const record = result as BrowserChapterCacheRecord | undefined
    return record?.content || null
  })
}

export async function setBrowserCachedChapter(params: {
  bookUrl: string
  chapterUrl: string
  chapterTitle?: string
  content: string
}) {
  // Native 双写：失败不阻塞 IndexedDB 写入（IndexedDB 为权威兜底）
  if (isNativeApp()) {
    void invokeData('saveCache', params).catch((e) => {
      console.error('Native saveCache error', e)
    })
    // 不 return，继续走 IndexedDB 写入
  }

  return withStore('readwrite', async (store) => {
    const record: BrowserChapterCacheRecord = {
      key: cacheKey(params.bookUrl, params.chapterUrl),
      bookUrl: params.bookUrl,
      chapterUrl: params.chapterUrl,
      chapterTitle: params.chapterTitle || '',
      content: params.content,
      size: new Blob([params.content]).size,
      updatedAt: Date.now(),
    }
    await requestToPromise(store.put(record))
  })
}

export async function deleteBrowserBookCache(bookUrl: string) {
  // 同时清理 chapters 表与 chapter_lists 表
  await Promise.all([
    withStore('readwrite', async (store) => {
      const index = store.index('bookUrl')
      const records = await requestToPromise(index.getAll(IDBKeyRange.only(bookUrl)))
      await Promise.all((records as BrowserChapterCacheRecord[]).map((record) => requestToPromise(store.delete(record.key))))
    }, STORE_NAME),
    withStore('readwrite', async (store) => {
      await requestToPromise(store.delete(bookUrl))
    }, CHAPTER_LIST_STORE),
  ])
}

export async function countBrowserBookCache(bookUrl: string) {
  const summaries = await listBrowserCacheSummary()
  return summaries.find((item) => item.bookUrl === bookUrl)?.cachedChapterCount || 0
}

export async function listBrowserCachedChapterUrls(bookUrl: string) {
  return withStore('readonly', async (store) => {
    const index = store.index('bookUrl')
    const records = await requestToPromise(index.getAll(IDBKeyRange.only(bookUrl)))
    return new Set((records as BrowserChapterCacheRecord[]).map((record) => record.chapterUrl).filter(Boolean))
  })
}

export async function listBrowserCacheSummary(): Promise<BrowserBookCacheSummary[]> {
  return withStore('readonly', async (store) => {
    const records = await requestToPromise(store.getAll())
    const summaryMap = new Map<string, BrowserBookCacheSummary>()

      ; (records as BrowserChapterCacheRecord[]).forEach((record) => {
        const current = summaryMap.get(record.bookUrl) || {
          bookUrl: record.bookUrl,
          cachedChapterCount: 0,
          bytes: 0,
          updatedAt: 0,
        }
        current.cachedChapterCount += 1
        current.bytes += record.size || 0
        current.updatedAt = Math.max(current.updatedAt, record.updatedAt || 0)
        summaryMap.set(record.bookUrl, current)
      })

    return Array.from(summaryMap.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  })
}

export async function clearAllBrowserCache() {
  return withStore('readwrite', async (store) => {
    await requestToPromise(store.clear())
  })
}

// ─── 章节目录离线持久化（chapter_lists 表） ───

/** 写入书籍目录到本地 IndexedDB */
export async function setBrowserCachedChapterList(bookUrl: string, chapters: BookChapter[], totalChapterNum: number) {
  if (!bookUrl || !chapters?.length) return
  // 深度脱敏：将 Vue Proxy 响应式对象转换为纯原生 JS 数组，规避 WebKit 的 DataCloneError
  const plainChapters: BookChapter[] = JSON.parse(JSON.stringify(chapters))

  return withStore('readwrite', async (store) => {
    const record: BrowserChapterListRecord = {
      bookUrl,
      chapters: plainChapters,
      totalChapterNum,
      updatedAt: Date.now(),
    }
    await requestToPromise(store.put(record))
    appLog('目录', `成功落盘离线目录到 IndexedDB (${plainChapters.length} 章)`, { bookUrl })
  }, CHAPTER_LIST_STORE)
}

/** 读取书籍目录的本地缓存（离线时作为主力数据源） */
export async function getBrowserCachedChapterList(bookUrl: string): Promise<BrowserChapterListRecord | null> {
  try {
    return await withStore('readonly', async (store) => {
      const result = await requestToPromise(store.get(bookUrl))
      return (result as BrowserChapterListRecord | undefined) || null
    }, CHAPTER_LIST_STORE)
  } catch (err) {
    appLog('目录', `读取离线目录 IndexedDB 异常`, { bookUrl, err: String(err) })
    return null
  }
}

/**
 * 第二级容灾：从已离线正文表（chapters）中逆向恢复目录
 * 当本地离线目录表为空或损坏、但存在已缓存正文时触发，确保断网下书籍依然可读
 */
export async function restoreChapterListFromCacheRecords(bookUrl: string): Promise<BookChapter[]> {
  try {
    return await withStore('readonly', async (store) => {
      const index = store.index('bookUrl')
      const records = (await requestToPromise(index.getAll(IDBKeyRange.only(bookUrl)))) as BrowserChapterCacheRecord[]
      if (!records || !records.length) return []

      appLog('目录', `触发第二级正文容灾反推，找到已离线正文记录 ${records.length} 条`, { bookUrl })

      return records.map((r, i) => ({
        index: i,
        title: r.chapterTitle || `第 ${i + 1} 章`,
        url: r.chapterUrl,
      }))
    }, STORE_NAME)
  } catch (err) {
    appLog('目录', `正文容灾反推目录失败`, { bookUrl, err: String(err) })
    return []
  }
}

/**
 * 清理孤儿章节正文：删除指定 bookUrl 下不在 validChapterUrls 集合中的所有正文记录。
 * 在目录刷新后 chapter.url 变化时调用，避免旧缓存成孤儿。
 */
export async function cleanupOrphanChapters(bookUrl: string, validChapterUrls: Set<string>) {
  return withStore('readwrite', async (store) => {
    const index = store.index('bookUrl')
    const records = await requestToPromise(index.getAll(IDBKeyRange.only(bookUrl)))
    const staleRecords = (records as BrowserChapterCacheRecord[])
      .filter((record) => !validChapterUrls.has(record.chapterUrl))
    await Promise.all(staleRecords.map((record) => requestToPromise(store.delete(record.key))))
  }, STORE_NAME)
}

const COVER_SNAPSHOTS_KEY = 'reader_cover_snapshots'
const MAX_SNAPSHOTS_COUNT = 8
const MAX_SINGLE_SNAPSHOT_CHARS = 80 * 1024 // 单张 Base64 长度 <= 80KB
const MAX_TOTAL_SNAPSHOTS_CHARS = 360 * 1024 // 快照总长度 <= 360KB

interface CoverSnapshotRecord {
  key: string
  dataUrl: string
  coverUrl?: string
  updatedAt: number
}

interface MemoryCoverEntry {
  dataUrl: string
  coverUrl?: string
}
const coverMemoryCache = new Map<string, MemoryCoverEntry>()

/** 即时安全维护单个书籍的封面快照（写入内存并同步更新 localStorage 头部） */
export function updateCoverSnapshot(key: string, dataUrl: string, coverUrl?: string): void {
  if (!key || !dataUrl || !dataUrl.startsWith('data:') || dataUrl.length > MAX_SINGLE_SNAPSHOT_CHARS) return
  try {
    const raw = localStorage.getItem(COVER_SNAPSHOTS_KEY)
    let list: CoverSnapshotRecord[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) list = []

    const existingIdx = list.findIndex((item) => item.key === key)
    const record: CoverSnapshotRecord = { key, dataUrl, coverUrl, updatedAt: Date.now() }
    if (existingIdx !== -1) {
      list[existingIdx] = record
    } else {
      list.unshift(record)
      if (list.length > MAX_SNAPSHOTS_COUNT) {
        list = list.slice(0, MAX_SNAPSHOTS_COUNT)
      }
    }

    // 检查总字符数是否超标，超标则从尾部淘汰较旧快照
    let totalChars = list.reduce((sum, item) => sum + (item.dataUrl?.length || 0), 0)
    while (totalChars > MAX_TOTAL_SNAPSHOTS_CHARS && list.length > 1) {
      list.pop()
      totalChars = list.reduce((sum, item) => sum + (item.dataUrl?.length || 0), 0)
    }

    localStorage.setItem(COVER_SNAPSHOTS_KEY, JSON.stringify(list))
  } catch {
    // ignore
  }
}

/**
 * 校验缓存中的封面版本是否与当前期望的封面标识匹配（具备宽松容错性与旧版本兼容性）
 */
export function isCoverVersionMatch(cachedVersion?: string, expectedVersion?: string): boolean {
  if (!expectedVersion || !cachedVersion) return true
  if (cachedVersion === expectedVersion) return true

  const trimC = cachedVersion.trim().replace(/\/+$/, '')
  const trimE = expectedVersion.trim().replace(/\/+$/, '')
  if (trimC === trimE) return true

  try {
    const decC = decodeURIComponent(trimC)
    const decE = decodeURIComponent(trimE)
    if (decC === decE) return true
    // 兼容历史老版本写入的代理路径格式 /reader3/cover?path=...
    if (decC.includes('cover?path=')) {
      const match = decC.match(/cover\?path=([^&]+)/)
      if (match && (match[1] === trimE || decodeURIComponent(match[1]) === decE)) {
        return true
      }
    }
  } catch {
    // ignore
  }

  return false
}

/** 从 localStorage 同步预载首屏离线封面快照至内存池（0ms） */
export function loadCoverSnapshots(): void {
  try {
    const raw = localStorage.getItem(COVER_SNAPSHOTS_KEY)
    if (!raw) return
    const list = JSON.parse(raw) as CoverSnapshotRecord[]
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (item.key && item.dataUrl && !coverMemoryCache.has(item.key)) {
        coverMemoryCache.set(item.key, {
          dataUrl: item.dataUrl,
          coverUrl: item.coverUrl,
        })
      }
    }
  } catch (e) {
    console.warn('loadCoverSnapshots 异常', e)
  }
}

// 模块载入时立即同步尝试预载一次快照池
try {
  loadCoverSnapshots()
} catch {
  // ignore
}

/** 同步从内存缓存中获取封面 Base64（0ms 零等待） */
export function getCoverMemoryCache(key: string, expectedCoverUrl?: string): string | null {
  if (!key) return null
  const mem = coverMemoryCache.get(key)
  if (!mem) return null
  if (isCoverVersionMatch(mem.coverUrl, expectedCoverUrl)) {
    return mem.dataUrl
  }
  // 版本不匹配，淘汰
  coverMemoryCache.delete(key)
  return null
}

/**
 * 将书架前 6 本书的有效离线封面安全持久化到 localStorage 快照池中。
 * 具备单张 60KB、总包 250KB 硬限制及 QuotaExceededError 异常隔离。
 */
export async function saveCoverSnapshots(
  books: Array<{ bookUrl: string; customCoverUrl?: string; coverUrl?: string }>,
): Promise<void> {
  if (!Array.isArray(books) || books.length === 0) {
    try {
      localStorage.removeItem(COVER_SNAPSHOTS_KEY)
    } catch {
      // ignore
    }
    return
  }
  const targetBooks = books.slice(0, MAX_SNAPSHOTS_COUNT)
  const snapshots: CoverSnapshotRecord[] = []
  let totalChars = 0

  for (const b of targetBooks) {
    const key = b.bookUrl
    if (!key) continue
    const expected = b.customCoverUrl || b.coverUrl
    // 优先取内存，内存没有尝试查一次 IndexedDB
    let dataUrl: string | null = getCoverMemoryCache(key, expected)
    if (!dataUrl) {
      dataUrl = await getCoverCache(key, expected)
    }
    if (!dataUrl || !dataUrl.startsWith('data:')) continue
    // 单张容量硬防线：超过单张限制放弃加入快照
    if (dataUrl.length > MAX_SINGLE_SNAPSHOT_CHARS) continue
    // 总容量硬防线：超过总容量停止追加后续书籍
    if (totalChars + dataUrl.length > MAX_TOTAL_SNAPSHOTS_CHARS) break

    totalChars += dataUrl.length
    snapshots.push({
      key,
      dataUrl,
      coverUrl: expected,
      updatedAt: Date.now(),
    })
  }

  try {
    if (snapshots.length > 0) {
      localStorage.setItem(COVER_SNAPSHOTS_KEY, JSON.stringify(snapshots))
    } else {
      localStorage.removeItem(COVER_SNAPSHOTS_KEY)
    }
  } catch (err) {
    // 异常安全自愈隔离：如果触发任何 Quota 异常，清空并移除快照，绝不破坏书架与设置
    console.warn('saveCoverSnapshots 容量超限或写入失败，安全自愈清理', err)
    try {
      localStorage.removeItem(COVER_SNAPSHOTS_KEY)
    } catch {
      // ignore
    }
  }
}

/**
 * 在单个 IndexedDB 只读事务中批量预热全量书籍的封面至内存。
 * 将 30 个并发事务减少为 1 个快速事务（约 10~20ms）。
 */
export async function preloadCoversCache(
  items: Array<{ key: string; expectedCoverUrl?: string }>,
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return
  // 过滤掉内存中已命中有效版本的条目，无待查项直接返回
  const pendingItems = items.filter(({ key, expectedCoverUrl }) => {
    if (!key) return false
    if (coverMemoryCache.has(key)) {
      const mem = coverMemoryCache.get(key)!
      if (isCoverVersionMatch(mem.coverUrl, expectedCoverUrl)) {
        return false
      }
      coverMemoryCache.delete(key)
    }
    return true
  })
  if (pendingItems.length === 0) return

  try {
    await withStore(
      'readonly',
      async (store) => {
        const promises = pendingItems.map(async ({ key, expectedCoverUrl }) => {
          try {
            const record = await requestToPromise<BrowserCoverCacheRecord | undefined>(store.get(key))
            if (record?.dataUrl) {
              if (!isCoverVersionMatch(record.coverUrl, expectedCoverUrl)) {
                coverMemoryCache.delete(key)
                return
              }
              coverMemoryCache.set(key, { dataUrl: record.dataUrl, coverUrl: record.coverUrl })
            }
          } catch {
            // ignore
          }
        })
        await Promise.all(promises)
      },
      COVER_CACHE_STORE,
    )
  } catch {
    // ignore
  }
}

/**
 * 从 IndexedDB 或内存缓存中读取离线封面 Base64 Data URL。
 * @param key 书籍标识 (bookUrl)
 * @param expectedCoverUrl 期望匹配的当前封面标识/版本。若传入且与本地缓存不一致，判定缓存失效并淘汰旧图。
 */
export async function getCoverCache(key: string, expectedCoverUrl?: string): Promise<string | null> {
  if (!key) return null
  if (coverMemoryCache.has(key)) {
    const mem = coverMemoryCache.get(key)!
    if (isCoverVersionMatch(mem.coverUrl, expectedCoverUrl)) {
      return mem.dataUrl
    }
    // 内存版本不匹配，淘汰
    coverMemoryCache.delete(key)
  }
  try {
    const record = await withStore<BrowserCoverCacheRecord | undefined>(
      'readonly',
      (store) => requestToPromise(store.get(key)),
      COVER_CACHE_STORE,
    )
    if (record?.dataUrl) {
      // 若提供了期望封面版本，且本地记录已过时，淘汰本地旧缓存
      if (!isCoverVersionMatch(record.coverUrl, expectedCoverUrl)) {
        coverMemoryCache.delete(key)
        void removeCoverCache(key)
        return null
      }
      coverMemoryCache.set(key, { dataUrl: record.dataUrl, coverUrl: record.coverUrl })
      return record.dataUrl
    }
  } catch {
    // 忽略异常
  }
  return null
}

/** 将封面写入本地 IndexedDB 离线封面库 */
export async function saveCoverCache(key: string, dataUrl: string, coverUrl?: string): Promise<void> {
  if (!key || !dataUrl) return
  coverMemoryCache.set(key, { dataUrl, coverUrl })
  // 即时联动更新首屏快照池
  updateCoverSnapshot(key, dataUrl, coverUrl)
  try {
    const record: BrowserCoverCacheRecord = {
      key,
      coverUrl,
      dataUrl,
      updatedAt: Date.now(),
    }
    await withStore(
      'readwrite',
      (store) => requestToPromise(store.put(record)),
      COVER_CACHE_STORE,
    )
  } catch (err) {
    console.warn('saveCoverCache 失败', err)
  }
}

/** 清理指定书籍的离线封面（内存、IndexedDB 与首屏快照池一并同步清理） */
export async function removeCoverCache(key: string): Promise<void> {
  if (!key) return
  coverMemoryCache.delete(key)
  try {
    const raw = localStorage.getItem(COVER_SNAPSHOTS_KEY)
    if (raw) {
      const list = JSON.parse(raw) as CoverSnapshotRecord[]
      if (Array.isArray(list)) {
        const filtered = list.filter((item) => item.key !== key)
        if (filtered.length > 0) {
          localStorage.setItem(COVER_SNAPSHOTS_KEY, JSON.stringify(filtered))
        } else {
          localStorage.removeItem(COVER_SNAPSHOTS_KEY)
        }
      }
    }
  } catch {
    // 忽略异常
  }
  try {
    await withStore(
      'readwrite',
      (store) => requestToPromise(store.delete(key)),
      COVER_CACHE_STORE,
    )
  } catch {
    // 忽略异常
  }
}

/**
 * 将远程/代理图片 URL 异步抓取并转为 DataURL 缓存至 IndexedDB。
 * 供后续离线时秒开渲染。
 */
export async function cacheCoverFromUrl(key: string, url: string, coverUrl?: string): Promise<string | null> {
  if (!key || !url || url.startsWith('data:')) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()

    // 若原图大于 40KB，在客户端进行等比轻量化压缩至标准规格（~25KB），确保 Base64 稳稳进入快照池
    if (blob.size > 40 * 1024) {
      try {
        const comp = await compressImageToThumbnail(blob)
        if (comp?.dataUrl) {
          await saveCoverCache(key, comp.dataUrl, coverUrl || url)
          return comp.dataUrl
        }
      } catch {
        // 压缩失败则降级走原生 FileReader
      }
    }

    return await new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = async () => {
        const dataUrl = reader.result as string
        if (dataUrl) {
          await saveCoverCache(key, dataUrl, coverUrl || url)
          resolve(dataUrl)
        } else {
          resolve('')
        }
      }
      reader.onerror = () => resolve('')
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
