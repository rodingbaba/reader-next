import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cacheBookToBrowser } from './bookCache'
import { appLog } from './appLogger'
import * as browserCache from './browserCache'
import * as bookshelfApi from '../api/bookshelf'
import type { Book } from '../types'

describe('offline fixes & optimizations', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('skips already cached chapters and persists directory before downloading', async () => {
    const book: Book = {
      name: '测试书',
      author: '作者',
      origin: 'source-1',
      bookUrl: 'book-test-1',
    }
    const chapters = [
      { title: '第1章', url: 'ch-1', index: 0 },
      { title: '第2章', url: 'ch-2', index: 1 },
      { title: '第3章', url: 'ch-3', index: 2 },
    ]

    // 模拟本地已缓存第 1 章和第 2 章
    vi.spyOn(browserCache, 'listBrowserCachedChapterUrls').mockResolvedValue(new Set(['ch-1', 'ch-2']))
    const setListSpy = vi.spyOn(browserCache, 'setBrowserCachedChapterList').mockResolvedValue(undefined as any)
    const setChapterSpy = vi.spyOn(browserCache, 'setBrowserCachedChapter').mockResolvedValue(undefined as any)
    const getContentSpy = vi.spyOn(bookshelfApi, 'getBookContent').mockResolvedValue('第3章网络正文')

    const result = await cacheBookToBrowser({
      book,
      chapters,
      startIndex: 0,
    })

    // 1. 验证下载前必须先将整本目录落盘到本地
    expect(setListSpy).toHaveBeenCalledWith('book-test-1', chapters, 3)

    // 2. 验证前 2 章已缓存，不会发起 getBookContent 网络请求
    expect(getContentSpy).toHaveBeenCalledTimes(1)
    expect(getContentSpy).toHaveBeenCalledWith({
      chapterUrl: 'ch-3',
      bookSourceUrl: 'source-1',
    })

    // 3. 验证只保存了未缓存的第 3 章
    expect(setChapterSpy).toHaveBeenCalledTimes(1)
    expect(setChapterSpy).toHaveBeenCalledWith({
      bookUrl: 'book-test-1',
      chapterUrl: 'ch-3',
      chapterTitle: '第3章',
      content: '第3章网络正文',
    })

    // 4. 验证统计结果：总共3章全部完成，新增缓存1章
    expect(result.total).toBe(3)
    expect(result.completed).toBe(3)
    expect(result.newlyCached).toBe(1)
  })

  it('reports zero newlyCached when full book is already offline', async () => {
    const book: Book = {
      name: '全本已下书籍',
      author: '作者',
      origin: 'source-1',
      bookUrl: 'book-all-cached',
    }
    const chapters = [
      { title: '第1章', url: 'ch-1', index: 0 },
      { title: '第2章', url: 'ch-2', index: 1 },
    ]

    vi.spyOn(browserCache, 'listBrowserCachedChapterUrls').mockResolvedValue(new Set(['ch-1', 'ch-2']))
    vi.spyOn(browserCache, 'setBrowserCachedChapterList').mockResolvedValue(undefined as any)
    const getContentSpy = vi.spyOn(bookshelfApi, 'getBookContent')

    const result = await cacheBookToBrowser({
      book,
      chapters,
      startIndex: 0,
    })

    expect(getContentSpy).not.toHaveBeenCalled()
    expect(result.completed).toBe(2)
    expect(result.newlyCached).toBe(0)
  })

  it('truncates long content and masks tokens in appLog', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const hugeNovelContent = '这是第一句。'.repeat(50) // 300字
    appLog('正文', '测试正文日志', {
      content: hugeNovelContent,
      accessToken: 'secret-token-123456',
      chapters: new Array(500).fill({ title: '章' }),
    })

    expect(consoleSpy).toHaveBeenCalled()
    const logCall = consoleSpy.mock.calls[0][0]

    // 包含分类
    expect(logCall).toContain('[正文]')
    // 正文被截断
    expect(logCall).toContain('正文共 300 字')
    // Token 被脱敏
    expect(logCall).toContain('******')
    expect(logCall).not.toContain('secret-token-123456')
    // 章节大数组被压缩
    expect(logCall).toContain('章节列表共 500 章')
  })
})
