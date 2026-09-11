import http from './http'

export interface RecordHeartbeatPayload {
  bookUrl: string
  bookName: string
  author?: string
  coverUrl?: string
  readDate?: string
  durationSecs: number
  isListening?: boolean
  chaptersDelta?: number
}

export interface DailyReadingStatItem {
  readDate: string
  durationSecs: number
  listenSecs: number
  bookCount: number
}

export interface BookReadingStatItem {
  bookUrl: string
  bookName: string
  author: string
  coverUrl?: string
  totalDurationSecs: number
  totalListenSecs: number
  firstReadDate: string
  lastReadDate: string
  lastReadTime?: number | string
  totalDays: number
  totalChaptersRead: number
}

export interface ReadingStatsSummary {
  totalDurationSecs: number
  totalListenSecs: number
  todayDurationSecs: number
  todayListenSecs: number
  totalDays: number
  streakDays: number
  totalBooks: number
  dailyStats: DailyReadingStatItem[]
}

/**
 * 上报单次阅读心跳增量
 */
export function recordReadingHeartbeat(payload: RecordHeartbeatPayload) {
  return http.post<string>('stats/record', payload).then((r) => r.data)
}

/**
 * 获取统计总览与每日热力图数据（支持按 bookUrl 过滤单书）
 */
export function getReadingStatsSummary(today?: string, bookUrl?: string) {
  return http
    .get<ReadingStatsSummary>('stats/summary', { params: { today, book_url: bookUrl } })
    .then((r) => r.data)
}

/**
 * 获取每本书的阅读统计列表
 */
export function getReadingBookStats() {
  return http.get<BookReadingStatItem[]>('stats/books').then((r) => r.data)
}

