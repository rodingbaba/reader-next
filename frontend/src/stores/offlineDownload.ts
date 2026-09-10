import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { Book, BookChapter } from '../types'
import { cacheBookToBrowser } from '../utils/bookCache'
import { useAppStore } from './app'
import { appLog } from '../utils/appLogger'

export const useOfflineDownloadStore = defineStore('offlineDownload', () => {
  const appStore = useAppStore()

  const activeBookUrl = ref<string | null>(null)
  const activeBookName = ref<string>('')
  const isDownloading = ref(false)
  const progress = ref(0)
  const currentStatus = ref('')
  const currentChapterName = ref('')
  const completedCount = ref(0)
  const totalCount = ref(0)

  let cancelSignal = { cancelled: false }

  function isBookDownloading(bookUrl?: string | null): boolean {
    if (!bookUrl) return false
    return isDownloading.value && activeBookUrl.value === bookUrl
  }

  async function startDownload(params: {
    book: Book
    chapters: BookChapter[]
    count: number
    startIndex?: number
  }) {
    if (isDownloading.value) {
      if (activeBookUrl.value === params.book.bookUrl) {
        appStore.showToast(`《${params.book.name}》正在后台下载中`)
      } else {
        appStore.showToast(`正在后台下载《${activeBookName.value}》，请等待完成`, 'warning')
      }
      return
    }

    activeBookUrl.value = params.book.bookUrl
    activeBookName.value = params.book.name
    isDownloading.value = true
    cancelSignal = { cancelled: false }
    progress.value = 0
    currentStatus.value = '准备下载到本机...'
    currentChapterName.value = ''
    completedCount.value = 0
    totalCount.value = 0

    appLog('缓存', `触发全局后台下载: ${params.count === 0 ? '全本离线' : `后续 ${params.count} 章`}`, {
      bookName: params.book.name,
      totalChapters: params.chapters.length,
      requestedCount: params.count,
    })

    try {
      const result = await cacheBookToBrowser({
        book: params.book,
        chapters: params.chapters,
        startIndex: params.startIndex || 0,
        count: params.count || undefined,
        signal: cancelSignal,
        onProgress: ({ completed, total, chapterTitle }) => {
          completedCount.value = completed
          totalCount.value = total
          currentChapterName.value = chapterTitle
          currentStatus.value = `下载到本机中 (${completed}/${total})`
          progress.value = total > 0 ? Math.round((completed / total) * 100) : 100
        },
      })

      if (!cancelSignal.cancelled) {
        progress.value = 100
        if (result.newlyCached === 0) {
          currentStatus.value = '所选章节已全部就绪'
          appStore.showToast('已全部离线，无需重复下载', 'success')
        } else {
          currentStatus.value = `全本离线完成，共 ${result.completed} 章`
          appStore.showToast(`《${params.book.name}》离线下载完成`, 'success')
        }
        appLog('缓存', `全局后台下载成功: 《${params.book.name}》完成 ${result.completed}/${result.total} 章`)
      } else {
        currentStatus.value = '下载已停止'
        appLog('缓存', `全局后台下载已由用户取消: 《${params.book.name}》`)
      }
    } catch (error) {
      currentStatus.value = '下载失败'
      appLog('缓存', `全局后台下载异常: ${(error as Error).message || String(error)}`)
      appStore.showToast((error as Error).message || '下载失败', 'error')
    } finally {
      setTimeout(() => {
        isDownloading.value = false
        activeBookUrl.value = null
        activeBookName.value = ''
      }, 1200)
    }
  }

  function cancelDownload() {
    if (isDownloading.value) {
      cancelSignal.cancelled = true
      isDownloading.value = false
      activeBookUrl.value = null
      activeBookName.value = ''
      currentStatus.value = '已停止下载'
      appStore.showToast('已停止离线下载')
      appLog('缓存', '用户在面板主动触发停止下载')
    }
  }

  return {
    activeBookUrl,
    activeBookName,
    isDownloading,
    progress,
    currentStatus,
    currentChapterName,
    completedCount,
    totalCount,
    isBookDownloading,
    startDownload,
    cancelDownload,
  }
})
