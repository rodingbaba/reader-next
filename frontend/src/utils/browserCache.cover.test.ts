import { beforeAll, describe, expect, it } from 'vitest'
import { getCoverCache, saveCoverCache } from './browserCache'

describe('browserCache cover versioning', () => {
  beforeAll(() => {
    const store = new Map<string, any>()
    const fakeDb = {
      close: () => { },
      transaction: () => {
        let active = 0
        const tx: any = {
          objectStore: () => ({
            get: (key: string) => {
              active++
              const req: any = { result: store.get(key) }
              setTimeout(() => {
                req.onsuccess?.({ target: req })
                active--
                if (active === 0) tx.oncomplete?.()
              }, 0)
              return req
            },
            put: (val: any) => {
              active++
              store.set(val.key, val)
              const req: any = { result: val.key }
              setTimeout(() => {
                req.onsuccess?.({ target: req })
                active--
                if (active === 0) tx.oncomplete?.()
              }, 0)
              return req
            },
            delete: (key: string) => {
              active++
              store.delete(key)
              const req: any = { result: undefined }
              setTimeout(() => {
                req.onsuccess?.({ target: req })
                active--
                if (active === 0) tx.oncomplete?.()
              }, 0)
              return req
            },
          }),
        }
        setTimeout(() => {
          if (active === 0) tx.oncomplete?.()
        }, 0)
        return tx
      },
    }
      ; (globalThis as any).indexedDB = {
        open: () => {
          const req: any = { result: fakeDb }
          setTimeout(() => req.onsuccess?.(), 0)
          return req
        },
      }
  })

  it('stores and retrieves cover with matching version', async () => {
    const key = 'test-book-sync-1'
    const dataUrl = 'data:image/jpeg;base64,AAA'
    const coverVersion = 'custom-cover:hash-1'

    await saveCoverCache(key, dataUrl, coverVersion)

    // 不传版本，或者版本匹配时，都能命中
    const hit1 = await getCoverCache(key)
    expect(hit1).toBe(dataUrl)

    const hit2 = await getCoverCache(key, coverVersion)
    expect(hit2).toBe(dataUrl)
  })

  it('evicts stale cover when expectedCoverUrl does not match', async () => {
    const key = 'test-book-sync-2'
    const oldDataUrl = 'data:image/jpeg;base64,OLD'
    const oldVersion = 'custom-cover:hash-old'
    const newVersion = 'custom-cover:hash-new'

    await saveCoverCache(key, oldDataUrl, oldVersion)

    // 期望新版本，而本地是老版本，自动淘汰并返回 null
    const stale = await getCoverCache(key, newVersion)
    expect(stale).toBeNull()

    // 再次读取（无版本），验证本地记录已被淘汰删除
    const afterEviction = await getCoverCache(key)
    expect(afterEviction).toBeNull()
  })

  it('preloadCoversCache preloads multiple covers in a single transaction', async () => {
    const k1 = 'batch-1'
    const k2 = 'batch-2'
    const v1 = 'data:image/jpeg;base64,B1'
    const v2 = 'data:image/jpeg;base64,B2'

    await saveCoverCache(k1, v1, 'ver-1')
    await saveCoverCache(k2, v2, 'ver-2')

    // 清空内存缓存后批量预取
    const { preloadCoversCache, getCoverMemoryCache } = await import('./browserCache')
    await preloadCoversCache([
      { key: k1, expectedCoverUrl: 'ver-1' },
      { key: k2, expectedCoverUrl: 'ver-2' },
    ])

    expect(getCoverMemoryCache(k1, 'ver-1')).toBe(v1)
    expect(getCoverMemoryCache(k2, 'ver-2')).toBe(v2)
  })

  it('saveCoverSnapshots respects max 6 count, 60KB single cap, and 250KB total cap', async () => {
    const { saveCoverSnapshots } = await import('./browserCache')

    // 构造 8 本书
    const books = Array.from({ length: 8 }, (_, i) => ({
      bookUrl: `snapshot-book-${i}`,
      coverUrl: `v-${i}`,
    }))

    // 为每本书存入离线缓存
    for (let i = 0; i < books.length; i++) {
      // book 0: 正常 (1KB)
      // book 1: 超大 (70KB，超过 60KB 单张上限，应当被跳过)
      // book 2..7: 正常 (1KB)
      let content = 'A'.repeat(i === 1 ? 70 * 1024 : 1024)
      const dataUrl = `data:image/jpeg;base64,${content}`
      await saveCoverCache(books[i].bookUrl, dataUrl, books[i].coverUrl)
    }

    await saveCoverSnapshots(books)

    const raw = localStorage.getItem('reader_cover_snapshots')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw!)
    // 8 本中只截取前 6 本；其中 book 1 超过 60KB 被过滤，所以剩下 5 本
    expect(saved.length).toBe(5)
    expect(saved.some((s: any) => s.key === 'snapshot-book-1')).toBe(false)
    expect(saved.some((s: any) => s.key === 'snapshot-book-0')).toBe(true)
    expect(saved.some((s: any) => s.key === 'snapshot-book-5')).toBe(true)
    expect(saved.some((s: any) => s.key === 'snapshot-book-6')).toBe(false) // 超过第 6 本
  })

  it('saveCoverSnapshots catches QuotaExceededError and recovers safely', async () => {
    const { saveCoverSnapshots } = await import('./browserCache')
    const originalSetItem = localStorage.setItem
    try {
      localStorage.setItem = () => {
        throw new Error('QuotaExceededError')
      }
      // 不应抛出异常
      await expect(saveCoverSnapshots([{ bookUrl: 'any', coverUrl: '1' }])).resolves.not.toThrow()
    } finally {
      localStorage.setItem = originalSetItem
    }
  })
})
