import { describe, expect, it } from 'vitest'
import {
  appendAuthQueryParams,
  buildAuthHeaderValues,
  computeNeedSecureKey,
  resolveNativeAssetUrl,
  SECURE_KEY_STORAGE_KEY,
} from './secureAccess'

describe('secureAccess', () => {
  it('adds stored secure key to auth headers', () => {
    const storage = {
      getItem(key: string) {
        if (key === 'accessToken') return 'token-123'
        if (key === SECURE_KEY_STORAGE_KEY) return 'secure-456'
        return null
      },
    }

    expect(buildAuthHeaderValues(storage)).toEqual({
      accessToken: 'token-123',
      secureKey: 'secure-456',
    })
  })

  it('adds stored auth values to event source query params', () => {
    const storage = {
      getItem(key: string) {
        if (key === 'accessToken') return 'alice-token'
        if (key === SECURE_KEY_STORAGE_KEY) return 'admin-key'
        return null
      },
    }
    const params = new URLSearchParams()

    appendAuthQueryParams(params, storage)

    expect(params.get('accessToken')).toBe('alice-token')
    expect(params.get('secureKey')).toBe('admin-key')
  })

  it('requires secure key only when the server requires it and current request is not admin authorized', () => {
    expect(computeNeedSecureKey({
      secure: true,
      secureKeyRequired: true,
      adminAuthorized: false,
    })).toBe(true)

    expect(computeNeedSecureKey({
      secure: true,
      secureKeyRequired: true,
      adminAuthorized: true,
    })).toBe(false)

    expect(computeNeedSecureKey({
      secure: true,
      secureKeyRequired: false,
      adminAuthorized: false,
    })).toBe(false)
  })

  it('resolves native asset url for app environment with subpath and auth tokens', () => {
    const storage = {
      getItem(key: string) {
        if (key === 'server_base_url') return 'http://192.168.1.100:18080/reader3'
        if (key === 'accessToken') return 'my-token'
        if (key === SECURE_KEY_STORAGE_KEY) return 'my-sec-key'
        return null
      },
    }

    const url = resolveNativeAssetUrl('/reader3/searchBookMultiSSE?key=%E6%96%97%E7%BD%97%E5%A4%A7%E9%99%86', storage)
    expect(url).toBe('http://192.168.1.100:18080/reader3/searchBookMultiSSE?key=%E6%96%97%E7%BD%97%E5%A4%A7%E9%99%86&accessToken=my-token&secureKey=my-sec-key')
  })

  it('keeps relative path as-is when server_base_url is empty (web mode)', () => {
    const storage = {
      getItem() {
        return null
      },
    }

    const path = '/reader3/searchBookMultiSSE?key=test'
    expect(resolveNativeAssetUrl(path, storage)).toBe(path)
  })
})
