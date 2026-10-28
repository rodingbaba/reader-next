<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-overlay" @click="close"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue" class="modal-container" @click.self="close">
        <div class="cache-modal">
          <!-- 头部：标题与精简副标题，右侧刷新与关闭按钮对齐 -->
          <div class="modal-head">
            <div class="head-title-wrap">
              <h2>离线缓存管理</h2>
              <p class="head-subtitle">断网畅读，离线数据保存在本机</p>
            </div>
            <div class="head-actions">
              <button class="ghost-btn" :disabled="isRefreshing" @click="handleManualRefresh">
                <span v-if="isRefreshing" class="btn-spinner"></span>
                <span>{{ isRefreshing ? '刷新中' : '刷新' }}</span>
              </button>
              <button class="close-btn" aria-label="关闭" @click="close">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- 仅首次没有任何离线书架数据时才显示占位骨架，避免刷新时白屏闪烁 -->
          <div v-if="initialLoading && activeBooks.length === 0" class="loading-state">
            <div class="loading-spinner"></div>
            <p>缓存信息加载中...</p>
          </div>

          <div v-else class="cache-list">
            <!-- 紧凑工具栏 -->
            <div class="cache-toolbar">
              <div class="cache-scope">
                <span class="scope-label">默认范围</span>
                <div class="scope-options">
                  <button class="scope-btn" :class="{ active: cacheCount === 10 }" @click="cacheCount = 10">10章</button>
                  <button class="scope-btn" :class="{ active: cacheCount === 50 }" @click="cacheCount = 50">50章</button>
                  <button class="scope-btn" :class="{ active: cacheCount === 100 }" @click="cacheCount = 100">100章</button>
                  <button class="scope-btn" :class="{ active: cacheCount === 0 }" @click="cacheCount = 0">全本</button>
                </div>
              </div>
              <div class="cache-overview">
                <span>已离线 <strong>{{ offlineReadyCount }}</strong> 本</span>
                <span>共 <strong>{{ totalBrowserCachedCount }}</strong> 章</span>
              </div>
            </div>

            <div v-if="mergedBooks.length === 0" class="empty-books">
              <p>书架上暂无书籍</p>
            </div>

            <!-- 紧凑书籍项 -->
            <div v-for="item in mergedBooks" :key="item.bookUrl" class="cache-item">
              <div class="cache-main">
                <div class="book-title-row">
                  <h3 :title="item.name">{{ item.name }}</h3>
                  <span v-if="item.isLocal" class="local-badge">本地</span>
                </div>
                <div class="book-meta-row">
                  <span class="book-author" :title="item.author">{{ formatAuthor(item.author) }}</span>
                  <span class="stat-highlight">已离线 {{ item.browserCachedCount }} 章</span>
                </div>
              </div>

              <!-- 下载中展示 -->
              <div v-if="offlineStore.isBookDownloading(item.bookUrl)" class="downloading-card">
                <div class="download-info">
                  <div class="download-text">
                    <span class="download-progress">{{ offlineStore.progress }}%</span>
                    <span class="download-detail">{{ offlineStore.currentChapterName || offlineStore.currentStatus }}</span>
                  </div>
                  <button class="mini-stop-btn" @click="offlineStore.cancelDownload()">停止</button>
                </div>
                <div class="progress-track">
                  <div class="progress-bar" :style="{ width: `${offlineStore.progress}%` }"></div>
                </div>
              </div>

              <!-- 常规操作按钮组（紧凑排列） -->
              <div v-else class="cache-actions">
                <button class="action-btn primary" @click="downloadBook(item.book)">
                  {{ cacheActionLabel }}
                </button>
                <button
                  class="action-btn danger"
                  :disabled="item.browserCachedCount === 0 && (!item.isLocal && item.serverCachedCount === 0)"
                  @click="clearBook(item.book)"
                >
                  清除
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useBookshelfStore } from '../stores/bookshelf'
import { useAppStore } from '../stores/app'
import { useOfflineDownloadStore } from '../stores/offlineDownload'
import { getBookshelfWithCacheInfo } from '../api/bookshelf'
import type { Book } from '../types'
import { listBrowserCacheSummary, loadBrowserCacheSummarySnapshot } from '../utils/browserCache'
import { resolveBookChapters, clearBookOfflineCache } from '../utils/bookCache'
import { isLocalBook } from '../utils/localBook'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const shelfStore = useBookshelfStore()
const appStore = useAppStore()
const offlineStore = useOfflineDownloadStore()

/** 从 localStorage 0ms 读取本地持久化的离线书架 */
function getOfflineBookshelf(): Book[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem('reader_bookshelf_cache')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Book[]) : []
  } catch {
    return []
  }
}

// 本地离线书架快照，确保秒开
const localOfflineBooks = ref<Book[]>(getOfflineBookshelf())
const initialLoading = ref(shelfStore.books.length === 0 && localOfflineBooks.value.length === 0)
const isRefreshing = ref(false)
const cacheCount = ref(50)
const serverBooks = ref<Book[]>([])
// 首屏直接从本地离线快照载入缓存摘要，实现 0ms 秒开呈现
const browserSummaries = ref<Array<{ bookUrl: string; cachedChapterCount: number }>>(loadBrowserCacheSummarySnapshot())

// 书籍列表：完全与书架一致（书架已加载则用书架顺序，未加载则优先用本地离线书架）
const activeBooks = computed<Book[]>(() => {
  if (shelfStore.books.length > 0) {
    return shelfStore.books
  }
  if (localOfflineBooks.value.length > 0) {
    return localOfflineBooks.value
  }
  return getOfflineBookshelf()
})

// 包含网络书与本地书的全量书籍合并计算（与书架书籍完全对齐）
const mergedBooks = computed(() => {
  const serverMap = new Map(serverBooks.value.map((book) => [book.bookUrl, book.cachedChapterCount || 0]))
  const browserMap = new Map(browserSummaries.value.map((item) => [item.bookUrl, item.cachedChapterCount]))

  return activeBooks.value.map((book) => {
    const isLocal = isLocalBook(book)
    // 优先取网络更新的服务端数，未返回前优先复用离线书架原本保存的 cachedChapterCount
    const serverCount = isLocal ? 0 : (serverMap.get(book.bookUrl) ?? book.cachedChapterCount ?? 0)
    const browserCount = browserMap.get(book.bookUrl) ?? 0

    return {
      book,
      bookUrl: book.bookUrl,
      name: book.name,
      author: book.author,
      isLocal,
      serverCachedCount: serverCount,
      browserCachedCount: browserCount,
    }
  })
})

const offlineReadyCount = computed(() => mergedBooks.value.filter((item) => item.browserCachedCount > 0).length)
const totalBrowserCachedCount = computed(() => mergedBooks.value.reduce((sum, item) => sum + item.browserCachedCount, 0))

// 紧凑按钮文案
const cacheActionLabel = computed(() => {
  return cacheCount.value === 0 ? '全本离线' : `下载 ${cacheCount.value} 章`
})

watch(() => props.modelValue, (visible) => {
  if (visible) {
    // 0ms 秒开：立即先拉起本地已离线书架和摘要快照
    localOfflineBooks.value = getOfflineBookshelf()
    browserSummaries.value = loadBrowserCacheSummarySnapshot()
    initialLoading.value = activeBooks.value.length === 0

    // 如果书架 store 尚无数据，触发书架静默加载同步
    if (shelfStore.books.length === 0) {
      void shelfStore.fetchBooks().catch(() => undefined)
    }

    // 静默就地刷新最新远端与 IndexedDB 统计数据
    void refreshData(false)
  }
}, { immediate: true })

// 当全局后台下载结束（完成下载或停止下载）时，静默就地刷新统计数字，0 白屏 0 闪烁
watch(
  () => offlineStore.isDownloading,
  (downloading, wasDownloading) => {
    if (!downloading && wasDownloading) {
      void refreshData(false)
    }
  },
)

function close() {
  emit('update:modelValue', false)
}

function formatAuthor(author?: string) {
  if (!author) return '未知作者'
  return author.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

async function awaitSafeBrowserSummary() {
  return listBrowserCacheSummary().catch(() => [])
}

async function refreshData(manual = false) {
  if (manual) {
    if (isRefreshing.value) return
    isRefreshing.value = true
  }
  try {
    const [server, browser] = await Promise.all([
      getBookshelfWithCacheInfo().catch(() => []),
      awaitSafeBrowserSummary(),
    ])
    serverBooks.value = server
    browserSummaries.value = browser
    if (manual) {
      appStore.showToast('缓存数据已刷新', 'success')
    }
  } finally {
    initialLoading.value = false
    if (manual) {
      isRefreshing.value = false
    }
  }
}

function handleManualRefresh() {
  void refreshData(true)
}

async function downloadBook(book: Book) {
  if (offlineStore.isDownloading) {
    appStore.showToast(`正在离线《${offlineStore.activeBookName}》，请等待完成`, 'warning')
    return
  }

  // 计算追更起始点：全本从 0 开始；按章下载则从当前已读进度开始
  const startIndex = cacheCount.value === 0 ? 0 : Math.max(0, book.durChapterIndex || 0)

  try {
    const chapters = await resolveBookChapters(book)
    if (!chapters || !chapters.length) {
      appStore.showToast('未能获取到书籍目录', 'error')
      return
    }

    await offlineStore.startDownload({
      book,
      chapters,
      count: cacheCount.value,
      startIndex,
    })
  } catch (error) {
    appStore.showToast((error as Error).message || '启动离线下载失败', 'error')
  }
}

async function clearBook(book: Book) {
  try {
    // 乐观立即清零前端该书的统计，0ms 丝滑响应
    const target = browserSummaries.value.find((item) => item.bookUrl === book.bookUrl)
    if (target) {
      target.cachedChapterCount = 0
    }
    await clearBookOfflineCache(book)
    appStore.showToast(`《${book.name}》离线数据已清除`, 'success')
    void refreshData(false)
  } catch (error) {
    appStore.showToast((error as Error).message || '清除缓存失败', 'error')
    void refreshData(false)
  }
}
</script>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: var(--z-overlay);
  backdrop-filter: blur(4px);
}

.modal-container {
  position: fixed;
  inset: 0;
  z-index: var(--z-modal);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  box-sizing: border-box;
}

.cache-modal {
  width: min(720px, 100%);
  max-height: 86vh;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-2xl, 24px);
  padding: 22px 20px;
  box-shadow: var(--shadow-xl);
  box-sizing: border-box;
}

/* 头部 */
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}

.head-title-wrap {
  flex: 1;
  min-width: 0;
}

.modal-head h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 700;
  line-height: 1.25;
}

.head-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.head-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.ghost-btn,
.close-btn {
  height: 34px;
  border: 1px solid var(--color-border);
  background: transparent;
  border-radius: var(--radius-md, 10px);
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  white-space: nowrap;
  transition: all var(--duration-fast, 0.15s);
  box-sizing: border-box;
}

.ghost-btn {
  padding: 0 14px;
  font-weight: 500;
}

.close-btn {
  width: 34px;
  padding: 0;
}

.ghost-btn:disabled {
  opacity: 0.7;
  cursor: wait;
}

.btn-spinner {
  width: 12px;
  height: 12px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  margin-right: 6px;
  display: inline-block;
  animation: spin 0.8s linear infinite;
  vertical-align: middle;
}

.ghost-btn:hover:not(:disabled),
.close-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.close-btn svg {
  width: 16px;
  height: 16px;
  display: block;
}

.loading-state {
  min-height: 200px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 12px;
}

.loading-spinner {
  width: 30px;
  height: 30px;
  border: 3px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.cache-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  max-width: 100%;
}

.empty-books {
  text-align: center;
  padding: 36px 0;
  color: var(--color-text-tertiary);
  font-size: 14px;
}

/* 工具栏 */
.cache-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg, 14px);
  background: var(--color-bg-sunken);
  box-sizing: border-box;
}

.cache-scope {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.scope-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary);
}

.scope-options {
  display: flex;
  gap: 6px;
}

.scope-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  border-radius: var(--radius-full, 9999px);
  padding: 4px 12px;
  font-size: 13px;
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all var(--duration-fast, 0.15s);
}

.scope-btn.active {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
  font-weight: 600;
}

.cache-overview {
  display: flex;
  gap: 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  flex-shrink: 0;
}

.cache-overview strong {
  color: var(--color-primary);
  font-weight: 700;
}

/* 书籍卡片 */
.cache-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md, 12px);
  padding: 12px 16px;
  background: var(--color-bg-surface, var(--color-bg-elevated));
  box-sizing: border-box;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  transition: border-color var(--duration-fast, 0.15s);
}

.cache-item:hover {
  border-color: var(--color-border);
}

.cache-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.book-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
}

.book-title-row h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
  line-height: 1.35;
}

.local-badge {
  font-size: 11px;
  line-height: 1.2;
  padding: 1px 7px;
  border-radius: 9999px;
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  font-weight: 600;
  flex-shrink: 0;
}

.book-meta-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}

.book-author {
  color: var(--color-text-tertiary);
  width: 84px;
  min-width: 84px;
  max-width: 84px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
}

.stat-highlight {
  color: var(--color-text-secondary);
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

/* 操作按钮 */
.cache-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
}

.action-btn {
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  border-radius: var(--radius-md, 9px);
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--duration-fast, 0.15s);
  color: var(--color-text);
  box-sizing: border-box;
}

.action-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.action-btn.primary:hover {
  filter: brightness(1.08);
}

.action-btn.danger {
  color: var(--color-danger, #ef4444);
  padding: 6px 12px;
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: var(--color-danger, #ef4444);
}

.action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* 下载卡片 */
.downloading-card {
  width: 200px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 5px 10px;
  background: var(--color-bg-sunken);
  border-radius: var(--radius-md, 9px);
  box-sizing: border-box;
}

.download-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
}

.download-text {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.download-progress {
  font-weight: 700;
  font-size: 13px;
  color: var(--color-primary);
  flex-shrink: 0;
}

.download-detail {
  font-size: 12px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 95px;
}

.mini-stop-btn {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  border: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  cursor: pointer;
  color: var(--color-danger, #ef4444);
  flex-shrink: 0;
}

.progress-track {
  width: 100%;
  height: 5px;
  background: var(--color-border-light);
  border-radius: 9999px;
  overflow: hidden;
}

.progress-bar {
  height: 100%;
  background: var(--color-primary);
  border-radius: 9999px;
  transition: width 0.2s ease-out;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@media (max-width: 480px) {
  .modal-container {
    padding: 14px 10px;
  }

  .cache-modal {
    padding: 18px 14px;
    border-radius: 20px;
  }

  .cache-toolbar {
    padding: 10px 12px;
    gap: 8px;
  }

  .cache-item {
    padding: 11px 13px;
    gap: 10px;
  }

  .action-btn {
    padding: 6px 12px;
    font-size: 12.5px;
  }

  .downloading-card {
    width: 165px;
  }

  .download-detail {
    max-width: 75px;
  }
}
</style>
