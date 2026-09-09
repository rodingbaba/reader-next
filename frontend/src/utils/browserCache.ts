import { invokeData, isNativeApp } from './nativeBridge'
import { appLog } from './appLogger'
import type { BookChapter } from '../types'

const DB_NAME = 'reader-browser-cache'
const DB_VERSION = 2
const STORE_NAME = 'chapters'
const CHAPTER_LIST_STORE = 'chapter_lists'
let dbPromise: Promise<IDBDatabase> | null = null

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
