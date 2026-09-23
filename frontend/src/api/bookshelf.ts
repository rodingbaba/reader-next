import { invokeData, invokeSync, isNativeApp, isNetworkOnline } from '../utils/nativeBridge'
import http from './http'
import type { Book, BookChapter, BookGroup } from '../types'

export function getBookshelf() {
  return http.get<Book[]>('getBookshelf').then((r) => r.data)
}

export function getBookshelfWithCacheInfo() {
  return http.get<Book[]>('getShelfBookWithCacheInfo').then((r) => r.data)
}

export function getShelfBook(url: string) {
  return http.post<Book>('getShelfBook', { url }).then((r) => r.data)
}

export function saveBook(book: Partial<Book>) {
  return http.post<Book>('saveBook', book).then((r) => r.data)
}

export function saveBooks(books: Partial<Book>[]) {
  return http.post<Book[]>('saveBooks', books).then((r) => r.data)
}

export type UploadProgressCallback = (percent: number, loaded: number, total: number) => void

export function uploadTxtBook(file: File, onProgress?: UploadProgressCallback) {
  const formData = new FormData()
  formData.append('file', file)
  return http.post<Book>('uploadTxtBook', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        const percent = Math.round((e.loaded * 100) / e.total)
        onProgress(percent, e.loaded, e.total)
      }
    },
  }).then((r) => r.data)
}

export function uploadEpubBook(file: File, onProgress?: UploadProgressCallback) {
  const formData = new FormData()
  formData.append('file', file)
  return http.post<Book>('uploadEpubBook', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        const percent = Math.round((e.loaded * 100) / e.total)
        onProgress(percent, e.loaded, e.total)
      }
    },
  }).then((r) => r.data)
}

export function uploadPdfBook(file: File, onProgress?: UploadProgressCallback) {
  const formData = new FormData()
  formData.append('file', file)
  return http.post<Book>('uploadPdfBook', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        const percent = Math.round((e.loaded * 100) / e.total)
        onProgress(percent, e.loaded, e.total)
      }
    },
  }).then((r) => r.data)
}

export function uploadMobiBook(file: File, onProgress?: UploadProgressCallback) {
  const formData = new FormData()
  formData.append('file', file)
  return http.post<Book>('uploadMobiBook', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (e) => {
      if (e.total && onProgress) {
        const percent = Math.round((e.loaded * 100) / e.total)
        onProgress(percent, e.loaded, e.total)
      }
    },
  }).then((r) => r.data)
}

export function deleteBook(book: Partial<Book>, keepFiles = false) {
  return http.post<string>(`deleteBook${keepFiles ? '?keep_files=true' : ''}`, book).then((r) => r.data)
}

export function deleteBooks(books: Partial<Book>[], keepFiles = false) {
  return http.post<{ deleted: number }>(`deleteBooks${keepFiles ? '?keep_files=true' : ''}`, books).then((r) => r.data)
}

export function getBookInfo(url: string, origin?: string) {
  return http.post<Book>('getBookInfo', { url, bookSourceUrl: origin }).then((r) => r.data)
}

export function getChapterList(params: {
  bookUrl?: string
  tocUrl?: string
  bookSourceUrl?: string
  refresh?: number
}) {
  return http.post<BookChapter[]>('getChapterList', params).then((r) => r.data)
}

export async function getBookContent(params: {
  chapterUrl?: string
  bookSourceUrl?: string
  index?: number
  refresh?: number
}) {
  if (isNativeApp()) {
    try {
      const cached = await invokeData('getCache', params)
      if (cached) return cached
    } catch (e) {
      console.error('Native getCache error', e)
    }
  }
  return http.post<string>('getBookContent', params).then((r) => r.data)
}

export async function saveBookProgress(params: {
  bookUrl: string
  index: number
  position?: number
  ts?: number
}) {
  if (!isNetworkOnline()) {
    throw new Error('Offline: network unavailable')
  }
  params.ts = params.ts || Date.now()
  if (isNativeApp()) {
    const payload = {
      ...params,
      serverURL: localStorage.getItem('server_base_url') || '',
      accessToken: localStorage.getItem('accessToken') || ''
    }
    try {
      invokeSync('saveProgress', payload)
    } catch (e) {
      console.warn('Native saveProgress failed', e)
    }
  }
  return http.post<string>('saveBookProgress', params).then((r) => r.data)
}

export function deleteBookCache(bookUrl: string) {
  return http.post('deleteBookCache', { bookUrl }).then((r) => r.data)
}

// ─── Groups ───
export function getBookGroups() {
  return http.get<BookGroup[]>('getBookGroups').then((r) => r.data)
}

export function saveBookGroup(group: BookGroup) {
  return http.post<string>('saveBookGroup', group).then((r) => r.data)
}

export function deleteBookGroup(groupId: number) {
  return http.post<string>('deleteBookGroup', { groupId }).then((r) => r.data)
}

export function saveBookGroupId(bookUrl: string, groupId: number) {
  return http.post<string>('saveBookGroupId', { bookUrl, groupId }).then((r) => r.data)
}

export function setBookSource(params: {
  bookUrl: string
  newUrl: string
  bookSourceUrl: string
}) {
  return http.post<Book>('setBookSource', params).then((r) => r.data)
}

export function uploadBookCover(bookUrl: string, file: File) {
  const formData = new FormData()
  formData.append('bookUrl', bookUrl)
  formData.append('file', file)
  return http.post<Book>('uploadBookCover', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data)
}

export function resetBookCover(bookUrl: string) {
  return http.post<Book>('resetBookCover', { bookUrl }).then((r) => r.data)
}

export interface CoverImageItem {
  url: string
  thumbUrl: string
  title: string
  width?: number
  height?: number
}

export function searchCoverImages(keyword: string) {
  return http.get<CoverImageItem[]>('searchCoverImages', { params: { keyword } }).then((r) => r.data)
}

// ─── Cover helper ───
export function getCoverUrl(coverUrl?: string) {
  if (!coverUrl) return ''
  let path = coverUrl
  if (
    coverUrl.startsWith('http://') ||
    coverUrl.startsWith('https://') ||
    coverUrl.startsWith('/') ||
    coverUrl.startsWith('local-epub-cover:') ||
    coverUrl.startsWith('custom-cover:')
  ) {
    path = `/reader3/cover?path=${encodeURIComponent(coverUrl)}`
  }
  if (isNativeApp()) {
    const serverBase = (localStorage.getItem('server_base_url') || '').replace(/\/+$/, '')
    if (serverBase) {
      const originBase = serverBase.endsWith('/reader3')
        ? serverBase.slice(0, -'/reader3'.length)
        : serverBase
      return `${originBase}${path}`
    }
  }
  return path
}
