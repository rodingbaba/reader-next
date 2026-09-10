import { getChapterList, getBookContent } from '../api/bookshelf'
import type { Book, BookChapter } from '../types'
import { setBrowserCachedChapter, setBrowserCachedChapterList, listBrowserCachedChapterUrls } from './browserCache'
import { appLog } from './appLogger'
import { isLocalBook } from './localBook'

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
  const cachedInScope = sliced.filter(c => cachedUrlSet.has(c.url)).length
  appLog('缓存', `启动批量离线: 目标 ${sliced.length} 章 (从第 ${startIndex} 章起)`, {
    bookName: params.book.name,
    cachedCountInScope: cachedInScope,
  })

  let completed = 0
  let newlyCached = 0
  const pendingChapters: BookChapter[] = []

  // 3. 区分已缓存与待拉取章节
  for (const chapter of sliced) {
    if (cachedUrlSet.has(chapter.url)) {
      completed += 1
    } else {
      pendingChapters.push(chapter)
    }
  }

  // 初始进度通知（若已有部分章节已在本地缓存）
  if (completed > 0) {
    params.onProgress?.({
      total: sliced.length,
      completed,
      chapterTitle: sliced[Math.min(completed - 1, sliced.length - 1)]?.title || '',
    })
  }

  // 4. 并发拉取未离线章节：本地书籍（local-*）无外部爬虫限流风险，开启多路并发加速
  if (pendingChapters.length > 0 && !params.signal?.cancelled) {
    const isLocal = isLocalBook(params.book)
    const concurrency = isLocal ? 5 : 1
    let cursor = 0

    const worker = async () => {
      while (cursor < pendingChapters.length) {
        if (params.signal?.cancelled) {
          break
        }
        const index = cursor++
        const chapter = pendingChapters[index]
        if (!chapter) break

        try {
          const content = await getBookContent({
            chapterUrl: chapter.url,
            bookSourceUrl: params.book.origin,
          })

          if (params.signal?.cancelled) break

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
        } catch (err) {
          appLog('缓存', `章节下载写入异常: ${chapter.title}`, { err: String(err) })
          completed += 1
          params.onProgress?.({
            total: sliced.length,
            completed,
            chapterTitle: `${chapter.title} (下载失败)`,
          })
        }
      }
    }

    const workerCount = Math.min(concurrency, pendingChapters.length)
    const workers = Array.from({ length: workerCount }, () => worker())
    await Promise.all(workers)
  }

  if (params.signal?.cancelled) {
    appLog('缓存', `离线下载被用户中断: 已完成 ${completed}/${sliced.length}`)
  }

  appLog('缓存', `批量离线完成: 目标共 ${sliced.length} 章, 跳过已就绪 ${completed - newlyCached} 章, 新下载 ${newlyCached} 章`)

  return {
    total: sliced.length,
    completed,
    newlyCached,
  }
}
