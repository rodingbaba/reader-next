export const SECURE_KEY_STORAGE_KEY = 'secureKey'

type StorageLike = Pick<Storage, 'getItem'>

export function buildAuthHeaderValues(storage: StorageLike) {
  const accessToken = storage.getItem('accessToken')?.trim() || ''
  const secureKey = storage.getItem(SECURE_KEY_STORAGE_KEY)?.trim() || ''

  return {
    accessToken: accessToken || undefined,
    secureKey: secureKey || undefined,
  }
}

export function appendAuthQueryParams(params: URLSearchParams, storage: StorageLike = localStorage) {
  const { accessToken, secureKey } = buildAuthHeaderValues(storage)
  if (accessToken) {
    params.set('accessToken', accessToken)
  }
  if (secureKey) {
    params.set('secureKey', secureKey)
  }
}

export function computeNeedSecureKey(params: {
  secure: boolean
  secureKeyRequired: boolean
  adminAuthorized: boolean
}) {
  return params.secure && params.secureKeyRequired && !params.adminAuthorized
}

export function readStoredSecureKey(storage: StorageLike = localStorage) {
  return storage.getItem(SECURE_KEY_STORAGE_KEY)?.trim() || ''
}

/**
 * 在 native app 环境下，将根相对路径（如 /api/...、/reader3/...）转换为
 * 绝对 URL 并附加 accessToken/secureKey 查询参数，使 <img> 等标签
 * 能直接访问需要认证的后端资源。
 *
 * 非 native 环境或已是绝对路径/data URI 时原样返回。
 */
export function resolveNativeAssetUrl(path: string, storage: StorageLike = localStorage) {
  if (!path) return path
  if (path.startsWith('data:') || path.startsWith('http') || path.startsWith('//')) {
    return path
  }
  if (!path.startsWith('/')) return path

  const baseUrl = storage.getItem('server_base_url') || ''
  if (!baseUrl) return path

  try {
    const url = new URL(baseUrl)
    const resolved = new URL(path, url.origin)
    const { accessToken, secureKey } = buildAuthHeaderValues(storage)
    if (accessToken) resolved.searchParams.set('accessToken', accessToken)
    if (secureKey) resolved.searchParams.set('secureKey', secureKey)
    return resolved.toString()
  } catch {
    return path
  }
}
