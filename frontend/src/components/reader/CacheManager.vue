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
      <!-- 统一摘要卡片：已离线 X 章 -->
      <div class="summary-grid single-col">
        <div class="summary-card primary-card">
          <span class="summary-label">已离线</span>
          <strong>{{ browserCachedCount }}</strong>
          <small>离线可读章节</small>
        </div>
      </div>

      <!-- 下载进行中全景状态 -->
      <div v-if="isDownloading" class="caching-status">
        <div class="progress-circle">
          <svg viewBox="0 0 36 36">
            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
            <path class="circle" :stroke-dasharray="`${offlineStore.progress}, 100`" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
          </svg>
          <div class="percentage">{{ offlineStore.progress }}%</div>
        </div>
        <div class="status-text">
          <p class="main-status">{{ offlineStore.currentStatus }}</p>
          <p class="sub-status">{{ offlineStore.currentChapterName || '正在准备...' }}</p>
        </div>
        <button class="stop-btn" @click="offlineStore.cancelDownload()">停止</button>
      </div>

      <!-- 统一离线下载选项 -->
      <div v-else class="cache-sections">
        <div class="info-card">
          <p>离线数据保存在本机，断网仍可流畅阅读，多端自动同步。</p>
        </div>

        <section class="cache-section">
          <div class="section-head">
            <h4>下载离线数据</h4>
            <button class="link-btn" @click="refreshStats">刷新</button>
          </div>
          <div class="option-list">
            <button class="cache-opt" @click="startDownload(10)">
              <span class="label">下载后续 10 章</span>
              <span class="sub">极速缓存，适合短期追更</span>
            </button>
            <button class="cache-opt" @click="startDownload(50)">
              <span class="label">下载后续 50 章</span>
              <span class="sub">适合当前追更</span>
            </button>
            <button class="cache-opt" @click="startDownload(100)">
              <span class="label">下载后续 100 章</span>
              <span class="sub">中度离线阅读</span>
            </button>
            <button class="cache-opt" @click="startDownload(0)">
              <span class="label">全本离线下载</span>
              <span class="sub">离线整本书籍到本地</span>
            </button>
            <button class="cache-opt danger" @click="handleClearCache">
              <span class="label">清除离线数据</span>
              <span class="sub">删除当前书籍的离线缓存</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useReaderStore } from '../../stores/reader'
import { useAppStore } from '../../stores/app'
import { useOfflineDownloadStore } from '../../stores/offlineDownload'
import { countBrowserBookCache } from '../../utils/browserCache'
import { resolveBookChapters, clearBookOfflineCache } from '../../utils/bookCache'

const store = useReaderStore()
const appStore = useAppStore()
const offlineStore = useOfflineDownloadStore()
const theme = computed(() => store.currentTheme)

const isDownloading = computed(() => offlineStore.isBookDownloading(store.book?.bookUrl))
const browserCachedCount = ref(0)

onMounted(() => {
  refreshStats()
})

// 当后台下载结束时，自动刷新统计数字
watch(isDownloading, (downloading, wasDownloading) => {
  if (!downloading && wasDownloading) {
    refreshStats()
  }
})

async function refreshStats() {
  if (!store.book) return
  browserCachedCount.value = await countBrowserBookCache(store.book.bookUrl).catch(() => 0)
}

async function startDownload(count: number) {
  if (!store.book) return
  const chapters = store.chapters.length ? store.chapters : await resolveBookChapters(store.book)
  const startIndex = count === 0 ? 0 : store.currentIndex

  void offlineStore.startDownload({
    book: store.book,
    chapters,
    count,
    startIndex,
  }).then((started) => {
    if (started) {
      refreshStats()
    }
  })
}

async function handleClearCache() {
  if (!store.book) return
  try {
    await clearBookOfflineCache(store.book)
    appStore.showToast('离线数据已清除', 'success')
    await refreshStats()
  } catch (error) {
    appStore.showToast((error as Error).message || '清除缓存失败', 'error')
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

.summary-grid.single-col {
  grid-template-columns: 1fr;
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
  padding: 16px 20px;
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
