import { getChapterList, getBookContent } from '../api/bookshelf'
import type { Book, BookChapter } from '../types'
import { setBrowserCachedChapter, setBrowserCachedChapterList, listBrowserCachedChapterUrls } from './browserCache'
import { appLog } from './appLogger'

export interface CacheProgress {
  total: number
  completed: number
  chapterTitle: string
}

export async function resolveBookChapters(book: Book) {
  return getChapterList({
    bookUrl: book.bookUrl,
    bookSourceUrl: book.origin,
  })
}

export async function cacheBookToBrowser(params: {
  book: Book
  chapters?: BookChapter[]
  startIndex?: number
  count?: number
  onProgress?: (progress: CacheProgress) => void
  signal?: { cancelled: boolean }
}) {
  const chapters = params.chapters || await resolveBookChapters(params.book)

  // 1. 优先将目录落盘到本地（解决离线打开无目录的阻断问题）
  await setBrowserCachedChapterList(params.book.bookUrl, chapters, chapters.length).catch((err) => {
    appLog('目录', '缓存流程中目录落盘失败', { err: String(err) })
  })

  const startIndex = Math.max(0, params.startIndex || 0)
  const sliced = chapters.slice(startIndex, params.count ? startIndex + params.count : undefined)

  if (!sliced.length) {
    return {
      total: 0,
      completed: 0,
      newlyCached: 0,
    }
  }

  // 2. 读取本机已缓存的章节集合
  const cachedUrlSet = await listBrowserCachedChapterUrls(params.book.bookUrl).catch(() => new Set<string>())
  appLog('缓存', `启动批量离线: 目标 ${sliced.length} 章 (从第 ${startIndex} 章起)`, {
    bookName: params.book.name,
    cachedCountInScope: sliced.filter(c => cachedUrlSet.has(c.url)).length,
  })

  let completed = 0
  let newlyCached = 0

  for (const chapter of sliced) {
    if (params.signal?.cancelled) {
      appLog('缓存', `离线下载被用户中断: 已完成 ${completed}/${sliced.length}`)
      break
    }

    // 3. 已在本地离线：直接跳过网络请求，无需重复抓取
    if (cachedUrlSet.has(chapter.url)) {
      completed += 1
      params.onProgress?.({
        total: sliced.length,
        completed,
        chapterTitle: chapter.title,
      })
      continue
    }

    // 4. 未在本地离线：发起网络请求拉取并写入
    const content = await getBookContent({
      chapterUrl: chapter.url,
      bookSourceUrl: params.book.origin,
    })
    await setBrowserCachedChapter({
      bookUrl: params.book.bookUrl,
      chapterUrl: chapter.url,
      chapterTitle: chapter.title,
      content,
    })
    cachedUrlSet.add(chapter.url)
    completed += 1
    newlyCached += 1

    params.onProgress?.({
      total: sliced.length,
      completed,
      chapterTitle: chapter.title,
    })
  }

  appLog('缓存', `批量离线完成: 目标共 ${sliced.length} 章, 跳过已就绪 ${completed - newlyCached} 章, 新下载 ${newlyCached} 章`)

  return {
    total: sliced.length,
    completed,
    newlyCached,
  }
}
