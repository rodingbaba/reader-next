<template>
  <div class="reader-source" :style="{ background: theme.popup, color: theme.fontColor }">
    <div class="source-header">
      <div class="header-left">
        <h3>切换书源</h3>
        <span class="source-count" v-if="preparedResults.length">{{ preparedResults.length }} 个可用源</span>
      </div>
      <div class="header-right">
        <button
          class="refresh-btn"
          :class="{ spin: searching }"
          :disabled="searching"
          title="重新检索全网书源"
          @click="handleForceRefresh"
        >
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          <span>重新检索</span>
        </button>
        <button class="close-btn" @click="store.closePanel()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
    
    <div class="source-list" ref="listRef">
      <!-- 紧凑当前书源状态条 -->
      <div v-if="store.book" class="current-summary-card">
        <div class="current-label-row">
          <span class="current-badge">当前在读书源</span>
          <span class="current-source-name">{{ currentSourceName }}</span>
        </div>
        <div class="current-progress" v-if="store.currentChapter?.title">
          当前进度：{{ store.currentChapter.title }}
        </div>
      </div>

      <div class="section-label">其他可用源</div>
      
      <div v-if="searching && !preparedResults.length" class="loading">
        <div class="spinner"></div>
        正在全网搜索同名书籍...
      </div>
      
      <div v-else-if="!preparedResults.length" class="empty">未找到其他书源</div>
      
      <!-- 极简书源列表项：只展示书源中文名称、最新章节、同步状态与一键切换 -->
      <div
        v-else
        v-for="item in preparedResults"
        :key="item.book.bookUrl + item.book.origin"
        class="source-row"
        @click="handleSwitch(item.book)"
      >
        <div class="source-main-info">
          <div class="source-name-line">
            <span class="source-title">{{ getSourceName(item.book.origin) }}</span>
            <span v-if="item.sameLatest" class="status-tag sync">最新章节一致</span>
            <span v-else-if="item.book.lastChapter" class="status-tag diff">有更新</span>
          </div>
          <div class="source-chapter-line">
            <span class="chapter-text" v-if="item.book.lastChapter">最新：{{ item.book.lastChapter }}</span>
            <span class="chapter-text muted" v-else>暂无章节更新信息</span>
            <span class="update-time" v-if="item.book.updateTime">{{ item.book.updateTime }}</span>
          </div>
        </div>
        <button class="switch-action-btn" :disabled="store.loading" @click.stop="handleSwitch(item.book)">
          切换
        </button>
      </div>

      <div v-if="searching && preparedResults.length" class="inline-loading">
        <div class="spinner small"></div>
        继续检索其他书源...
      </div>

      <div v-if="hasMoreSources && !searching" class="load-more-wrap">
        <button class="load-more-btn" :disabled="loadingMore" @click="loadMoreSources">
          {{ loadingMore ? '加载中...' : '加载更多' }}
        </button>
      </div>
    </div>

    <!-- Switching Overlay -->
    <Transition name="fade">
      <div v-if="store.loading" class="switch-overlay" :style="{ background: theme.popup }">
        <div class="spinner"></div>
        <p>正在切换书源，请稍候...</p>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useReaderStore } from '../../stores/reader'
import { useAppStore } from '../../stores/app'
import { useSourceStore } from '../../stores/source'
import { getAvailableBookSourceSSE } from '../../api/search'
import type { SearchBook } from '../../types'

type CandidateItem = {
  book: SearchBook
  sameName: boolean
  sameAuthor: boolean
  sameLatest: boolean
  chapterHint: string
  score: number
}

const store = useReaderStore()
const appStore = useAppStore()
const sourceStore = useSourceStore()

const theme = computed(() => store.currentTheme)
const searching = ref(false)
const loadingMore = ref(false)
const results = ref<SearchBook[]>([])
const lastIndex = ref(-1)
const hasMoreSources = ref(true)
const AVAILABLE_CONCURRENT_COUNT = 16
let availableSourceSSE: EventSource | null = null

const sourceMap = computed(() => {
  return new Map(sourceStore.sources.map((s) => [s.bookSourceUrl, s]))
})

function getSourceName(origin?: string): string {
  if (!origin) return '未知书源'
  const matched = sourceMap.value.get(origin)
  if (matched?.bookSourceName) return matched.bookSourceName
  try {
    const u = new URL(origin)
    return u.hostname
  } catch {
    return origin
  }
}

const currentSourceName = computed(() => {
  if (!store.book) return ''
  return store.book.originName || getSourceName(store.book.origin)
})

function normalizeText(value?: string) {
  return (value || '')
    .replace(/(?:\[全本\]|（全本）|\(全本\)|【全本】|\[精校\]|（精校）|\(精校\)|【精校】|精校版|txt下载|全文阅读|最新章节|实体书版|完整版|校对版|无删减|无删节|未删节|第1部|第一部|第1卷|第一卷)/gi, '')
    .replace(/\s+/g, '')
    .replace(/[：:,.，。！？!?\-—_()（）【】\[\]<>《》'"“”‘’]/g, '')
    .toLowerCase()
}

function normalizeAuthorText(value?: string) {
  return normalizeText(value)
    .replace(/^(作者|原著|文)/, '')
    .replace(/(著|编著|写|整理|录)$/, '')
}

function isAuthorMatch(candidateAuthor?: string, currentAuthor?: string) {
  const a1 = normalizeAuthorText(candidateAuthor)
  const a2 = normalizeAuthorText(currentAuthor)
  if (!a1 || !a2) return true
  return a1 === a2 || a1.includes(a2) || a2.includes(a1)
}

const preparedResults = computed<CandidateItem[]>(() => {
  if (!store.book) return []
  const currentName = normalizeText(store.book.name)
  const currentAuthor = normalizeAuthorText(store.book.author)
  const currentLatest = normalizeText(store.book.latestChapterTitle || store.currentChapter?.title)

  return results.value
    .map((book) => {
      const n1 = normalizeText(book.name)
      const sameName = n1 === currentName || (n1.replace(/[1iⅰ一]$/, '') === currentName)
      const sameAuthor = isAuthorMatch(book.author, currentAuthor)
      const sameLatest = !!currentLatest && normalizeText(book.lastChapter) === currentLatest
      const chapterHint = sameLatest
        ? '可无缝续读'
        : (book.lastChapter ? `目标源最新：${book.lastChapter}` : '')
      const score = (sameName ? 3 : 0) + (sameAuthor ? 3 : 0) + (sameLatest ? 4 : 0)
      return { book, sameName, sameAuthor, sameLatest, chapterHint, score }
    })
    .sort((a, b) => b.score - a.score)
})

onMounted(() => {
  if (!sourceStore.sources.length) {
    sourceStore.fetchSources()
  }
  const cached = store.getCachedAvailableSources()
  if (cached && cached.length > 0) {
    results.value = [...cached]
    searching.value = false
  } else {
    startSearch()
  }
})

onUnmounted(() => {
  closeAvailableSourceSSE()
})

function handleForceRefresh() {
  store.clearCachedAvailableSources()
  startSearch()
}

function startSearch() {
  if (!store.book) return
  closeAvailableSourceSSE()
  searching.value = true
  loadingMore.value = false
  results.value = []
  lastIndex.value = -1
  hasMoreSources.value = true

  openAvailableSourceSSE('initial')
}

function mergeCandidates(candidates: SearchBook[]) {
  if (!store.book || !candidates.length) return
  const currentBook = store.book
  const currentAuthor = currentBook.author
  candidates.forEach((item) => {
    if (item.origin === currentBook.origin) return
    if (!isAuthorMatch(item.author, currentAuthor)) return
    const existed = results.value.some((candidate) =>
      candidate.origin === item.origin || (candidate.bookUrl === item.bookUrl && candidate.origin === item.origin),
    )
    if (!existed) {
      results.value.push(item)
    }
  })
  if (results.value.length > 0) {
    store.setCachedAvailableSources(results.value)
  }
}

type AvailableSourceMode = 'initial' | 'loadMore'
type AvailableSourceSSEPayload = {
  data?: SearchBook[]
  books?: SearchBook[]
  lastIndex?: number
  hasMore?: boolean
}

function closeAvailableSourceSSE() {
  if (!availableSourceSSE) return
  availableSourceSSE.close()
  availableSourceSSE = null
}

function parseAvailableSourcePayload(event: MessageEvent): AvailableSourceSSEPayload | null {
  try {
    return JSON.parse(event.data) as AvailableSourceSSEPayload
  } catch (error) {
    console.error('parse getAvailableBookSourceSSE payload failed', error)
    return null
  }
}

function applyAvailableSourcePayload(payload: AvailableSourceSSEPayload | null) {
  if (!payload) return
  const incoming = Array.isArray(payload.data)
    ? payload.data
    : (Array.isArray(payload.books) ? payload.books : [])

  if (typeof payload.lastIndex === 'number') {
    lastIndex.value = payload.lastIndex
  }
  if (typeof payload.hasMore === 'boolean') {
    hasMoreSources.value = payload.hasMore
  }
  mergeCandidates(incoming)
}

function openAvailableSourceSSE(mode: AvailableSourceMode) {
  if (!store.book) return

  const beforeCount = results.value.length
  const stream = getAvailableBookSourceSSE({
    url: store.book.bookUrl,
    name: store.book.name,
    author: store.book.author,
    origin: store.book.origin,
    lastIndex: mode === 'loadMore' ? lastIndex.value : -1,
    concurrentCount: AVAILABLE_CONCURRENT_COUNT,
  })
  availableSourceSSE = stream

  stream.onmessage = (event) => {
    if (availableSourceSSE !== stream) return
    applyAvailableSourcePayload(parseAvailableSourcePayload(event))
  }

  stream.addEventListener('end', (event) => {
    if (availableSourceSSE !== stream) return
    applyAvailableSourcePayload(parseAvailableSourcePayload(event as MessageEvent))
    finishAvailableSourceSSE(stream, mode, beforeCount)
  })

  stream.onerror = (event) => {
    if (availableSourceSSE !== stream) return
    console.error('getAvailableBookSourceSSE failed', event)
    finishAvailableSourceSSE(stream, mode, beforeCount, true)
  }
}

function finishAvailableSourceSSE(
  stream: EventSource,
  mode: AvailableSourceMode,
  beforeCount: number,
  failed = false,
) {
  if (availableSourceSSE !== stream) return
  stream.close()
  availableSourceSSE = null

  if (mode === 'initial') {
    searching.value = false
  } else {
    loadingMore.value = false
  }

  if (failed) {
    if (mode === 'loadMore') {
      appStore.showToast('加载更多书源失败', 'error')
    }
    return
  }

  if (mode === 'loadMore') {
    const addedCount = results.value.length - beforeCount
    if (addedCount > 0) {
      appStore.showToast(`已新增 ${addedCount} 个书源`, 'success')
    } else if (!hasMoreSources.value) {
      appStore.showToast('没有更多书源了', 'warning')
    } else {
      appStore.showToast('本批次未找到更多匹配书源', 'warning')
    }
  }
}

function loadMoreSources() {
  if (!store.book || loadingMore.value || !hasMoreSources.value) return

  closeAvailableSourceSSE()
  loadingMore.value = true
  openAvailableSourceSSE('loadMore')
}

async function handleSwitch(res: SearchBook) {
  if (store.loading) return
  const targetName = getSourceName(res.origin)
  try {
    const nextBook = await store.switchSource(res.bookUrl, res.origin)
    store.closePanel()
    appStore.showToast(`已成功切换到 ${nextBook?.originName || targetName}`, 'success')
  } catch (e: any) {
    appStore.showToast(`切换失败: ${e?.message || '未知错误'}`, 'error')
  }
}
</script>

<style scoped>
.reader-source {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

.source-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.source-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.source-count {
  font-size: 12px;
  opacity: 0.55;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.03);
  color: inherit;
  cursor: pointer;
  opacity: 0.8;
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  opacity: 1;
  background: rgba(0, 0, 0, 0.06);
}

.refresh-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.refresh-btn.spin svg {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.close-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: inherit;
  opacity: 0.6;
  background: transparent;
  border: none;
  cursor: pointer;
}

.close-btn:hover {
  opacity: 1;
}

.source-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px 24px;
}

/* 紧凑当前书源状态条 */
.current-summary-card {
  padding: 10px 14px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: rgba(201, 127, 58, 0.08);
  border: 1px solid rgba(201, 127, 58, 0.16);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.current-label-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.current-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--color-primary, #c97f3a);
  color: #fff;
}

.current-source-name {
  font-size: 13px;
  font-weight: 600;
}

.current-progress {
  font-size: 12px;
  opacity: 0.7;
}

.section-label {
  padding: 4px 4px 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.5;
  font-weight: 600;
}

/* 极简书源列表行 */
.source-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.02);
  border: 1px solid rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: all 0.2s ease;
}

.source-row:hover {
  background: rgba(201, 127, 58, 0.06);
  border-color: rgba(201, 127, 58, 0.2);
}

.source-main-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.source-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.source-title {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.status-tag {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
  flex-shrink: 0;
}

.status-tag.sync {
  background: rgba(82, 196, 26, 0.14);
  color: #3f8f16;
  font-weight: 500;
}

.status-tag.diff {
  background: rgba(201, 127, 58, 0.12);
  color: var(--color-primary, #c97f3a);
}

.source-chapter-line {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  opacity: 0.72;
}

.chapter-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.chapter-text.muted {
  opacity: 0.5;
}

.update-time {
  font-size: 11px;
  opacity: 0.45;
  flex-shrink: 0;
}

.switch-action-btn {
  padding: 6px 14px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 16px;
  border: 1px solid var(--color-primary, #c97f3a);
  background: var(--color-primary, #c97f3a);
  color: #fff;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.2s;
}

.switch-action-btn:hover {
  opacity: 0.9;
}

.switch-action-btn:active {
  transform: scale(0.96);
}

.loading, .empty {
  padding: 40px 20px;
  text-align: center;
  font-size: 13px;
  opacity: 0.6;
}

.inline-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px;
  font-size: 12px;
  opacity: 0.6;
}

.load-more-wrap {
  padding: 12px 0 8px;
  text-align: center;
}

.load-more-btn {
  padding: 8px 24px;
  font-size: 12px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: rgba(0, 0, 0, 0.03);
  color: inherit;
  cursor: pointer;
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid rgba(0, 0, 0, 0.1);
  border-top-color: var(--color-primary, #c97f3a);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}

.spinner.small {
  width: 14px;
  height: 14px;
  border-width: 2px;
  margin: 0;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.switch-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  z-index: 10;
  backdrop-filter: blur(2px);
}

.switch-overlay p {
  margin-top: 12px;
  font-size: 13px;
  opacity: 0.8;
}

.fade-enter-active, .fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from, .fade-leave-to {
  opacity: 0;
}
</style>
