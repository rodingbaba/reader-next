<template>
  <div class="cache-manager" :style="{ background: theme.popup, color: theme.fontColor }">
    <div class="cache-header">
      <div>
        <h3>离线缓存</h3>
        <p v-if="store.book" class="cache-subtitle">{{ store.book.name }}</p>
      </div>
      <button class="close-btn" @click="store.backPanel()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m15 18-6-6 6-6" />
        </svg>
      </button>
    </div>

    <div class="cache-body">
      <!-- 统一摘要：本机已离线 X 章，辅助显示云端就绪 Y 章（本地书不显示云端） -->
      <div class="summary-grid">
        <div class="summary-card primary-card">
          <span class="summary-label">本机已离线</span>
          <strong>{{ browserCachedCount }}</strong>
          <small>离线可读章节</small>
        </div>
        <div v-if="!isLocalTxt" class="summary-card">
          <span class="summary-label">云端就绪</span>
          <strong>{{ serverCachedCount }}</strong>
          <small>服务端已缓存</small>
        </div>
      </div>

      <div v-if="working" class="caching-status">
        <div class="progress-circle">
          <svg viewBox="0 0 36 36">
            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="circle" :stroke-dasharray="`${progress}, 100`" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <div class="percentage">{{ progress }}%</div>
        </div>
        <div class="status-text">
          <p class="main-status">{{ currentStatus }}</p>
          <p class="sub-status">{{ currentChapterName || '正在准备...' }}</p>
        </div>
        <button class="stop-btn" @click="stopWorking">停止</button>
      </div>

      <div v-else class="cache-sections">
        <div class="info-card">
          <p>下载到本机后，断网仍可流畅阅读。本机离线数据保存在当前设备本地，可随时清除。</p>
        </div>

        <!-- 统一“离线到本机”面板（含本地书，不再禁用） -->
        <section class="cache-section">
          <div class="section-head">
            <h4>下载到本机</h4>
            <button class="link-btn" @click="refreshStats">刷新</button>
          </div>
          <div class="option-list">
            <button class="cache-opt" @click="startBrowserCaching(50)">
              <span class="label">下载后续 50 章</span>
              <span class="sub">适合当前追更</span>
            </button>
            <button class="cache-opt" @click="startBrowserCaching(100)">
              <span class="label">下载后续 100 章</span>
              <span class="sub">中度离线阅读</span>
            </button>
            <button class="cache-opt" @click="startBrowserCaching(0)">
              <span class="label">全本离线下载</span>
              <span class="sub">离线整本书籍到本地</span>
            </button>
            <button class="cache-opt danger" @click="clearBrowserCache">
              <span class="label">清除本机离线数据</span>
              <span class="sub">删除当前设备离线缓存</span>
            </button>
          </div>
        </section>

        <!-- 云端预缓存：仅网络书显示，本地书无云端缓存语义 -->
        <section v-if="!isLocalTxt" class="cache-section">
          <div class="section-head">
            <h4>云端预缓存（可选）</h4>
            <button class="link-btn" @click="refreshStats">刷新</button>
          </div>
          <div class="option-list">
            <button class="cache-opt" @click="startServerCaching(50)">
              <span class="label">预缓存后续 50 章</span>
              <span class="sub">加速后续下载</span>
            </button>
            <button class="cache-opt" @click="startServerCaching(100)">
              <span class="label">预缓存后续 100 章</span>
              <span class="sub">服务端提前抓取</span>
            </button>
            <button class="cache-opt primary" @click="startServerCaching(0)">
              <span class="label">全本预缓存到云端</span>
              <span class="sub">保存到服务器磁盘</span>
            </button>
            <button class="cache-opt danger" @click="clearServerCache">
              <span class="label">清除云端缓存</span>
              <span class="sub">删除服务端缓存</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useReaderStore } from '../../stores/reader'
import { useAppStore } from '../../stores/app'
import { useOfflineDownloadStore } from '../../stores/offlineDownload'
import { cacheBookSSE } from '../../api/cache'
import { getBookshelfWithCacheInfo, deleteBookCache } from '../../api/bookshelf'
import { countBrowserBookCache, deleteBrowserBookCache } from '../../utils/browserCache'
import { resolveBookChapters } from '../../utils/bookCache'
import { isLocalTxtBook } from '../../utils/localBook'

const store = useReaderStore()
const appStore = useAppStore()
const offlineStore = useOfflineDownloadStore()
const theme = computed(() => store.currentTheme)

// 云端预缓存独立状态
const isServerCaching = ref(false)
const serverProgress = ref(0)
const serverStatus = ref('准备中...')
let sse: EventSource | null = null

// 本机离线下载状态（优先绑定全局后台下载任务）
const isBrowserDownloading = computed(() => offlineStore.isBookDownloading(store.book?.bookUrl))

// 统一状态控制
const working = computed(() => isServerCaching.value || isBrowserDownloading.value)

const progress = computed(() => {
  if (isBrowserDownloading.value) return offlineStore.progress
  return serverProgress.value
})

const currentStatus = computed(() => {
  if (isBrowserDownloading.value) return offlineStore.currentStatus
  return serverStatus.value
})

const currentChapterName = computed(() => {
  if (isBrowserDownloading.value) return offlineStore.currentChapterName
  return ''
})

const serverCachedCount = ref(0)
const browserCachedCount = ref(0)
// 本地书无云端缓存语义，serverCachedCount 在 isLocalTxt 时返回 0
const isLocalTxt = computed(() => isLocalTxtBook(store.book))

onMounted(() => {
  refreshStats()
})

onUnmounted(() => {
  // 核心改动：抽屉收起仅关闭云端 SSE，绝对不中断本机后台下载！
  closeSSE()
  isServerCaching.value = false
})

// 当后台下载结束时，自动刷新统计数字
watch(isBrowserDownloading, (downloading, wasDownloading) => {
  if (!downloading && wasDownloading) {
    refreshStats()
  }
})

async function refreshStats() {
  if (!store.book) return
  // 本地书：只统计本机离线数，不查服务端
  if (isLocalTxt.value) {
    serverCachedCount.value = 0
    browserCachedCount.value = await countBrowserBookCache(store.book.bookUrl).catch(() => 0)
    return
  }
  const [serverList, browserCount] = await Promise.all([
    getBookshelfWithCacheInfo().catch(() => []),
    countBrowserBookCache(store.book.bookUrl).catch(() => 0),
  ])
  const matched = serverList.find((book) => book.bookUrl === store.book?.bookUrl)
  serverCachedCount.value = matched?.cachedChapterCount || 0
  browserCachedCount.value = browserCount
}

function startServerCaching(count: number) {
  if (!store.book || isLocalTxt.value) return
  stopWorking()
  isServerCaching.value = true
  serverProgress.value = 0
  serverStatus.value = '连接云端预缓存任务...'

  const total = count === 0
    ? Math.max(0, store.chapters.length - store.currentIndex)
    : Math.min(count, Math.max(0, store.chapters.length - store.currentIndex))

  sse = cacheBookSSE({
    bookUrl: store.book.bookUrl,
    tocUrl: store.currentChapter?.url,
    count,
    concurrentCount: 8,
  })

  sse.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data)
      const completed = (data.successCount || 0) + (data.cachedCount || 0) - (data.failedCount || 0)
      if (total > 0) {
        serverProgress.value = Math.min(100, Math.round((Math.max(0, completed) / total) * 100))
      }
      serverStatus.value = `云端预缓存中 (${data.cachedCount || 0} 已缓存 / ${data.successCount || 0} 新增)`
    } catch {
      serverStatus.value = '云端预缓存处理中...'
    }
  }

  sse.addEventListener('end', async (event) => {
    try {
      const data = JSON.parse((event as MessageEvent).data)
      serverStatus.value = `云端预缓存完成，累计 ${data.cachedCount || 0} 章`
      serverProgress.value = 100
    } finally {
      closeSSE()
      await refreshStats()
      window.setTimeout(() => {
        isServerCaching.value = false
      }, 800)
    }
  })

  sse.onerror = async () => {
    serverStatus.value = '云端预缓存已中断'
    closeSSE()
    await refreshStats()
    window.setTimeout(() => {
      isServerCaching.value = false
    }, 1200)
  }
}

async function startBrowserCaching(count: number) {
  if (!store.book) return
  const chapters = store.chapters.length ? store.chapters : await resolveBookChapters(store.book)
  const startIndex = count === 0 ? 0 : store.currentIndex

  // 移交全局单例下载 Store，后台静默下载，不绑定当前侧边栏 UI 生命周期
  void offlineStore.startDownload({
    book: store.book,
    chapters,
    count,
    startIndex,
  }).then(() => {
    refreshStats()
  })

  appStore.showToast('已转入后台静默下载，可收起面板继续阅读')
}

async function clearServerCache() {
  if (!store.book || isLocalTxt.value) return
  await deleteBookCache(store.book.bookUrl)
  appStore.showToast('云端缓存已清除', 'success')
  await refreshStats()
}

async function clearBrowserCache() {
  if (!store.book) return
  await deleteBrowserBookCache(store.book.bookUrl)
  appStore.showToast('本机离线数据已清除', 'success')
  await refreshStats()
}

function closeSSE() {
  if (sse) {
    sse.close()
    sse = null
  }
}

function stopWorking() {
  if (isBrowserDownloading.value) {
    offlineStore.cancelDownload()
  }
  if (isServerCaching.value) {
    closeSSE()
    isServerCaching.value = false
  }
}
</script>

<style scoped>
.cache-manager {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.cache-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(16px + var(--safe-area-top, 0px)) calc(20px + var(--safe-area-right, 0px)) 16px calc(20px + var(--safe-area-left, 0px));
  border-bottom: 1px solid rgba(0,0,0,0.06);
}

.cache-header h3 { margin: 0; font-size: 16px; }
.cache-subtitle { margin: 4px 0 0; font-size: 12px; opacity: 0.55; }

.close-btn {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 8px; color: inherit; opacity: 0.6;
  background: transparent; border: none; cursor: pointer;
}

.cache-body {
  flex: 1;
  padding: 24px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 20px;
}

.summary-card {
  border-radius: 16px;
  padding: 16px;
  background: rgba(201, 127, 58, 0.08);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-card.primary-card {
  background: rgba(201, 127, 58, 0.16);
}

.summary-label { font-size: 12px; opacity: 0.65; }
.summary-card strong { font-size: 28px; line-height: 1; }
.summary-card small { font-size: 12px; opacity: 0.5; }

.cache-sections {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.cache-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.section-head h4 {
  margin: 0;
  font-size: 15px;
}

.link-btn {
  background: transparent;
  border: none;
  color: var(--color-primary, #c97f3a);
  cursor: pointer;
}

.info-card {
  background: rgba(201, 127, 58, 0.08);
  padding: 16px;
  border-radius: 12px;
  border-left: 4px solid var(--color-primary, #c97f3a);
}

.info-card p { margin: 0; font-size: 13px; line-height: 1.6; opacity: 0.8; }

.option-list { display: flex; flex-direction: column; gap: 12px; }

.cache-opt {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: calc(16px + var(--safe-area-top, 0px)) calc(20px + var(--safe-area-right, 0px)) 16px calc(20px + var(--safe-area-left, 0px));
  border-radius: 16px;
  border: 1px solid rgba(0,0,0,0.1);
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: all 0.2s;
}

.cache-opt:hover {
  border-color: var(--color-primary, #c97f3a);
  background: rgba(201, 127, 58, 0.04);
}

.cache-opt.primary {
  background: var(--color-primary, #c97f3a);
  border-color: var(--color-primary, #c97f3a);
  color: white;
}

.cache-opt.danger {
  border-color: rgba(239, 68, 68, 0.2);
  color: #dc2626;
}

.cache-opt .label { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.cache-opt .sub { font-size: 11px; opacity: 0.6; }

.caching-status {
  min-height: 360px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-bottom: 40px;
}

.progress-circle {
  position: relative;
  width: 150px;
  height: 150px;
  margin-bottom: 24px;
}

.progress-circle svg { transform: rotate(-90deg); width: 100%; height: 100%; }
.circle-bg { fill: none; stroke: rgba(0,0,0,0.05); stroke-width: 2.8; }
.circle { fill: none; stroke: var(--color-primary, #c97f3a); stroke-width: 2.8; stroke-linecap: round; transition: stroke-dasharray 0.3s; }

.percentage {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 24px; font-weight: 700;
}

.status-text { text-align: center; margin-bottom: 32px; }
.main-status { font-weight: 600; font-size: 16px; margin: 0 0 8px 0; }
.sub-status { font-size: 13px; opacity: 0.5; margin: 0; }

.stop-btn {
  padding: 8px 24px;
  border-radius: 20px;
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.2);
  cursor: pointer;
  font-size: 14px;
}
</style>
