import { beforeAll, describe, expect, it } from 'vitest'
import { getCoverCache, saveCoverCache } from './browserCache'

describe('browserCache cover versioning', () => {
  beforeAll(() => {
    const store = new Map<string, any>()
    const fakeDb = {
      close: () => { },
      transaction: () => {
        const tx: any = {
          objectStore: () => ({
            get: (key: string) => {
              const req: any = { result: store.get(key) }
              setTimeout(() => {
                req.onsuccess?.({ target: req })
                tx.oncomplete?.()
              }, 0)
              return req
            },
            put: (val: any) => {
              store.set(val.key, val)
              const req: any = { result: val.key }
              setTimeout(() => {
                req.onsuccess?.({ target: req })
                tx.oncomplete?.()
              }, 0)
              return req
            },
            delete: (key: string) => {
              store.delete(key)
              const req: any = { result: undefined }
              setTimeout(() => {
                req.onsuccess?.({ target: req })
                tx.oncomplete?.()
              }, 0)
              return req
            },
          }),
        }
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
})
