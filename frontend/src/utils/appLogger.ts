import { invokeSync, isNativeApp } from './nativeBridge'

/** 智能截断与脱敏，防止日志体积过度膨胀 */
function sanitizeDetails(details: any): any {
  if (details == null) return ''
  if (typeof details === 'string') {
    return details.length > 60 ? `${details.slice(0, 30)}... [共 ${details.length} 字]` : details
  }
  if (typeof details === 'number' || typeof details === 'boolean') {
    return details
  }
  if (Array.isArray(details)) {
    if (details.length > 5) {
      const head = details.slice(0, 3).map((item) => (typeof item === 'object' && item !== null ? (item.title || item.name || item.url || '[object]') : item))
      return `[数组共 ${details.length} 项, 前3项: ${JSON.stringify(head)}]`
    }
    return details.map(sanitizeDetails)
  }
  if (typeof details === 'object') {
    const clean: Record<string, any> = {}
    for (const [k, v] of Object.entries(details)) {
      if (k === 'content' || k === 'text' || k === 'chapterContent') {
        const textStr = String(v || '')
        clean[k] = textStr.length > 60 ? `${textStr.slice(0, 30)}... [正文共 ${textStr.length} 字]` : textStr
      } else if (k === 'chapters' && Array.isArray(v)) {
        clean[k] = `[章节列表共 ${v.length} 章]`
      } else if (k === 'accessToken' || k === 'password' || k === 'token') {
        clean[k] = '******'
      } else {
        clean[k] = sanitizeDetails(v)
      }
    }
    return clean
  }
  return String(details)
}

/**
 * 记录 App 运行诊断日志
 * @param category 分类标签，如 '网络' | '书架' | '目录' | '正文' | '缓存' | '系统'
 * @param message 简明描述
 * @param details 附加详细信息（自动截断小说正文和大数组）
 */
export function appLog(category: string, message: string, details?: any) {
  let logText = message
  if (details !== undefined) {
    try {
      const sanitized = sanitizeDetails(details)
      const detailStr = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized)
      logText = `${message} | ${detailStr}`
    } catch {
      logText = `${message} | [附加信息解析失败]`
    }
  }

  // 1. 控制台输出（浏览器/开发环境）
  console.log(`[${category}] ${logText}`)

  // 2. 原生 App 桥接输出（录入 iOS LogManager 统一导出）
  if (isNativeApp()) {
    try {
      invokeSync('log', { category, message: logText })
    } catch {
      // 忽略原生通信降级
    }
  }
}
