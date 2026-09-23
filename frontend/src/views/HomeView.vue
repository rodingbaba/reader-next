<template>
  <div class="home-view">
    <!-- Search Mode -->
    <SearchResults
      v-if="shelfStore.isSearchMode"
      @back="shelfStore.clearSearch()"
    />

    <!-- Normal Bookshelf View -->
    <div v-else class="shelf-content">
      <!-- Shelf Header -->
      <div class="shelf-header">
        <h1 class="shelf-title">
          书架
          <span class="book-count">({{ shelfStore.filteredBooks.length }})</span>
        </h1>
        <div class="shelf-actions">
          <template v-if="shelfStore.editMode">
            <button class="shelf-btn" type="button" title="全选" aria-label="全选" @click="shelfStore.selectAll()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 11l3 3L22 4" />
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
              </svg>
              <span class="shelf-btn-label">全选</span>
            </button>
            <button class="shelf-btn" type="button" title="取消全选" aria-label="取消全选" @click="shelfStore.clearSelection()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M8 12h8" />
              </svg>
              <span class="shelf-btn-label">取消全选</span>
            </button>
          </template>
          <button class="shelf-btn" type="button" title="上传书籍" aria-label="上传书籍" @click="triggerTxtUpload" :disabled="txtUploading">
            <svg v-if="!txtUploading" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 3v12" />
              <path d="m7 8 5-5 5 5" />
              <path d="M5 21h14" />
            </svg>
            <svg v-else class="spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 0 0-15.55-6.2L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span class="shelf-btn-label">{{ txtUploading ? '上传中' : '上传书籍' }}</span>
          </button>
          <button class="shelf-btn" type="button" title="刷新书架" aria-label="刷新书架" @click="handleRefreshBooks" :disabled="shelfStore.refreshing">
            <svg :class="{ spinning: shelfStore.refreshing }" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 0 0-15.55-6.2L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 15.55 6.2L21 16" />
              <path d="M21 21v-5h-5" />
            </svg>
            <span class="shelf-btn-label">{{ shelfStore.refreshing ? '刷新中' : '刷新书架' }}</span>
          </button>
          <button class="shelf-btn" type="button" title="分组管理" aria-label="分组管理" @click="showGroupManager = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 7h6l2 2h8v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" />
              <path d="M8 13h8" />
            </svg>
            <span class="shelf-btn-label">分组管理</span>
          </button>
          <button class="shelf-btn" type="button" title="缓存管理" aria-label="缓存管理" @click="showCacheManager = true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <ellipse cx="12" cy="5" rx="8" ry="3" />
              <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
              <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
            </svg>
            <span class="shelf-btn-label">缓存管理</span>
          </button>
          <button
            class="shelf-btn"
            type="button"
            :class="{ active: shelfStore.editMode }"
            :title="shelfStore.editMode ? '完成' : '编辑'"
            :aria-label="shelfStore.editMode ? '完成' : '编辑'"
            @click="toggleEditMode"
          >
            <svg v-if="shelfStore.editMode" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span class="shelf-btn-label">{{ shelfStore.editMode ? '完成' : '编辑' }}</span>
          </button>
        </div>
      </div>

      <!-- 上传中进度浮动通知条 -->
      <transition name="fade">
        <div v-if="txtUploading" class="upload-progress-banner">
          <div class="progress-info">
            <span class="progress-title">
              <svg class="spinning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12a9 9 0 0 0-15.55-6.2L3 8" />
                <path d="M3 3v5h5" />
              </svg>
              {{ uploadPhaseText }}
            </span>
            <span class="progress-metric">{{ uploadMetricText }}</span>
          </div>
          <div class="progress-bar-bg">
            <div class="progress-bar-fill" :style="{ width: `${uploadProgress}%` }"></div>
          </div>
        </div>
      </transition>

      <input
        ref="txtFileInputRef"
        type="file"
        accept=".txt,.epub,.pdf,.mobi,text/plain,application/epub+zip,application/pdf,application/x-mobipocket-ebook"
        class="hidden-input"
        @change="handleTxtFileChange"
      />

      <!-- Group Tabs -->
      <div class="group-tabs">
        <div class="tabs-scroll">
          <button
            v-for="group in shelfStore.displayGroups"
            :key="group.groupId"
            class="tab-item"
            :class="{ active: shelfStore.activeGroupId === group.groupId }"
            @click="shelfStore.activeGroupId = group.groupId"
          >
            {{ group.groupName }}
          </button>
        </div>
      </div>

      <!-- Book Grid -->
      <div class="shelf-grid-wrapper">
        <BookGrid
          :books="shelfStore.filteredBooks"
          :edit-mode="shelfStore.editMode"
          :selected-urls="shelfStore.selectedBookUrls"
          :loading="shelfStore.loading"
          :sortable="!shelfStore.editMode && !shelfStore.loading && !shelfStore.sorting && !shelfStore.isSearchMode"
          empty-text="书架空空如也，搜索添加新书吧"
        @click="handleBookClick"
        @info="handleBookInfo"
        @delete="handleDeleteBook"
        @ai="handleBookAi"
        @select="shelfStore.toggleSelection($event.bookUrl)"
        @reorder="handleReorderBooks"
        />
      </div>

      <!-- Batch Toolbar -->
      <Transition name="slide-up">
        <div v-if="shelfStore.editMode && shelfStore.selectedBookUrls.size > 0" class="batch-toolbar">
          <div class="batch-info">
            已选中 <span>{{ shelfStore.selectedBookUrls.size }}</span> 本书
          </div>
          <div class="batch-actions">
            <button class="batch-btn" @click="handleBulkMove">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14" /></svg>
              移动分组
            </button>
            <button class="batch-btn danger" @click="handleBulkDelete">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a3 3 0 0 1-3-3H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              批量删除
            </button>
          </div>
        </div>
      </Transition>
    </div>

    <!-- Book Detail Modal -->
    <BookDetailModal
      v-model="showDetail"
      :book="selectedBook"
    />

    <!-- Group Select Modal -->
    <GroupSelectModal
      v-model="showGroupSelect"
      @select="handleSetGroup"
    />
    <GroupManagerModal v-model="showGroupManager" />

    <CacheLibraryModal v-model="showCacheManager" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderStore } from '../stores/reader'
import { useAppStore } from '../stores/app'
import { uploadTxtBook, uploadEpubBook, uploadPdfBook, uploadMobiBook } from '../api/bookshelf'
import { deleteBrowserBookCache } from '../utils/browserCache'
import BookGrid from '../components/BookGrid.vue'
import BookDetailModal from '../components/BookDetailModal.vue'
import GroupSelectModal from '../components/bookshelf/GroupSelectModal.vue'
import GroupManagerModal from '../components/bookshelf/GroupManagerModal.vue'
import SearchResults from '../components/SearchResults.vue'
import CacheLibraryModal from '../components/CacheLibraryModal.vue'
import type { Book, SearchBook } from '../types'

const router = useRouter()
const shelfStore = useBookshelfStore()
const readerStore = useReaderStore()
const appStore = useAppStore()

const showDetail = ref(false)
const showGroupSelect = ref(false)
const showGroupManager = ref(false)
const showCacheManager = ref(false)
const selectedBook = ref<Book | SearchBook | null>(null)
const openingBookUrl = ref('')
const txtFileInputRef = ref<HTMLInputElement | null>(null)
const txtUploading = ref(false)
const uploadProgress = ref(0)
const uploadPhase = ref<'uploading' | 'processing'>('uploading')
const uploadFileName = ref('')
const uploadUploadedBytes = ref(0)
const uploadTotalBytes = ref(0)

const uploadMetricText = computed(() => {
  if (uploadPhase.value === 'processing') return '正在解析'
  if (!uploadTotalBytes.value) return `${uploadProgress.value}%`
  const loadedMb = (uploadUploadedBytes.value / 1024 / 1024).toFixed(1)
  const totalMb = (uploadTotalBytes.value / 1024 / 1024).toFixed(1)
  return `${loadedMb}MB / ${totalMb}MB (${uploadProgress.value}%)`
})

const uploadPhaseText = computed(() => {
  if (uploadPhase.value === 'processing') {
    return '文件已上传完成，正在服务端极速解析目录与存储...'
  }
  return `正在上传《${uploadFileName.value}》...`
})

onMounted(() => {
  // 后台静默刷新用户信息，不阻塞书架的本地即刻渲染
  void appStore.fetchUserInfo().catch(() => undefined)
  // 书架优先从本地持久化秒出展示，后台静默拉取远端
  void Promise.all([
    shelfStore.fetchBooks().catch(() => undefined),
    shelfStore.fetchGroups().catch(() => undefined),
  ])
})

function triggerTxtUpload() {
  if (txtUploading.value) return
  txtFileInputRef.value?.click()
}

async function handleTxtFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  const name = file.name.toLowerCase()
  let uploadFn: (file: File, onProgress?: (p: number, l: number, t: number) => void) => Promise<Book>
  let formatLabel: string
  if (name.endsWith('.epub')) {
    uploadFn = uploadEpubBook
    formatLabel = 'EPUB'
  } else if (name.endsWith('.pdf')) {
    uploadFn = uploadPdfBook
    formatLabel = 'PDF'
  } else if (name.endsWith('.mobi')) {
    uploadFn = uploadMobiBook
    formatLabel = 'MOBI'
  } else if (name.endsWith('.txt')) {
    uploadFn = uploadTxtBook
    formatLabel = 'TXT'
  } else {
    appStore.showToast('仅支持上传 .txt / .epub / .pdf / .mobi 文件', 'warning')
    return
  }

  txtUploading.value = true
  uploadProgress.value = 0
  uploadPhase.value = 'uploading'
  uploadFileName.value = file.name
  uploadUploadedBytes.value = 0
  uploadTotalBytes.value = file.size

  try {
    const book = await uploadFn(file, (percent, loaded, total) => {
      uploadProgress.value = percent
      uploadUploadedBytes.value = loaded
      uploadTotalBytes.value = total
      if (percent >= 100) {
        uploadPhase.value = 'processing'
      }
    })
    // 重新上传或导入新书时，主动清理该书可能残留的浏览器离线缓存，确保最新章节与分卷目录即时生效
    await deleteBrowserBookCache(book.bookUrl).catch(() => undefined)
    await shelfStore.fetchBooks()
    appStore.showToast(`已导入《${book.name}》`, 'success')
  } catch (e: unknown) {
    appStore.showToast((e as Error).message || `${formatLabel} 上传失败`, 'error')
  } finally {
    txtUploading.value = false
    uploadProgress.value = 0
    uploadPhase.value = 'uploading'
  }
}

async function handleBookClick(book: Book | SearchBook) {
  const b = book as Book
  if (openingBookUrl.value === b.bookUrl) return

  openingBookUrl.value = b.bookUrl

  try {
    void shelfStore.moveBookToFront(b.bookUrl).catch(() => undefined)
    const loadBookTask = readerStore.loadBook(b)
    await router.push('/reader')
    await loadBookTask
    await readerStore.loadChapter(readerStore.currentIndex)
  } finally {
    openingBookUrl.value = ''
  }
}

function handleBookInfo(book: Book | SearchBook) {
  selectedBook.value = book
  showDetail.value = true
}

function handleBookAi(book: Book | SearchBook) {
  const currentBook = book as Book
  router.push({
    name: 'ai-book',
    query: { bookUrl: currentBook.bookUrl },
  })
}

async function handleDeleteBook(book: Book | SearchBook) {
  const b = book as Book
  if (!confirm(`确定从书架删除 "${b.name}"？`)) return
  try {
    await shelfStore.removeBook(b)
    appStore.showToast(`已删除 "${b.name}"`, 'success')
  } catch (e: unknown) {
    appStore.showToast((e as Error).message, 'error')
  }
}

function toggleEditMode() {
  shelfStore.editMode = !shelfStore.editMode
  if (!shelfStore.editMode) {
    shelfStore.clearSelection()
  }
}

async function handleBulkDelete() {
  const count = shelfStore.selectedBookUrls.size
  if (!confirm(`确定删除选中的 ${count} 本书？`)) return
  try {
    await shelfStore.bulkDelete()
    appStore.showToast(`成功删除 ${count} 本书`, 'success')
  } catch (e: any) {
    appStore.showToast(e.message, 'error')
  }
}

async function handleBulkMove() {
  showGroupSelect.value = true
}

async function handleSetGroup(groupId: number) {
  const count = shelfStore.selectedBookUrls.size
  try {
    await shelfStore.bulkSetGroup(groupId)
    appStore.showToast(`成功将 ${count} 本书移至新分组`, 'success')
  } catch (e: any) {
    appStore.showToast(e.message, 'error')
  }
}
async function handleReorderBooks(payload: { draggedUrl: string; targetUrl: string }) {
  try {
    await shelfStore.reorderBooks(payload.draggedUrl, payload.targetUrl)
  } catch (e: any) {
    appStore.showToast(e.message || '排序失败', 'error')
  }
}

async function handleRefreshBooks() {
  try {
    await shelfStore.refreshBooks()
  } catch (e: any) {
    appStore.showToast(e.message || '刷新书架失败', 'error')
  }
}
</script>

<style scoped>
.home-view {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.home-view::-webkit-scrollbar {
  display: none;
}

.shelf-content {
  height: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: 0 var(--space-6);
  display: flex;
  flex-direction: column;
  min-height: 0;
}


.hidden-input {
  display: none;
}

.shelf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-6) 0 var(--space-3);
}

.shelf-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
}

.book-count {
  font-size: var(--text-base);
  font-weight: 400;
  color: var(--color-text-tertiary);
}

.shelf-actions {
  display: flex;
  gap: var(--space-2);
  align-items: center;
}

.shelf-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
  transition: all var(--duration-fast);
  min-height: 38px;
  white-space: nowrap;
}

.shelf-btn:disabled {
  opacity: 0.55;
  cursor: wait;
}

.shelf-btn svg {
  width: 17px;
  height: 17px;
  flex-shrink: 0;
}

.shelf-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.shelf-btn.active {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.shelf-btn .spinning {
  animation: shelf-spin 0.9s linear infinite;
}

@keyframes shelf-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.group-tabs {
  border-bottom: 2px solid var(--color-border-light);
  margin-bottom: var(--space-2);
}

.tabs-scroll {
  display: flex;
  gap: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.tabs-scroll::-webkit-scrollbar {
  display: none;
}

.tab-item {
  padding: var(--space-3) var(--space-5);
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  position: relative;
  transition: color var(--duration-fast);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
}

.tab-item:hover {
  color: var(--color-text-secondary);
}

.tab-item.active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.shelf-grid-wrapper {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: calc(84px + var(--safe-area-bottom) + var(--space-6));
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.shelf-grid-wrapper::-webkit-scrollbar {
  display: none;
}

.batch-toolbar {
  position: fixed;
  bottom: calc(104px + var(--space-4));
  left: 50%;
  transform: translateX(-50%);
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-xl);
  border-radius: var(--radius-2xl);
  padding: var(--space-3) var(--space-6);
  display: flex;
  align-items: center;
  gap: var(--space-8);
  z-index: calc(var(--z-sticky) + 5);
  backdrop-filter: blur(12px);
}

.batch-info {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.batch-info span {
  font-weight: 700;
  color: var(--color-primary);
  margin: 0 4px;
}

/* upload progress banner */
.upload-progress-banner {
  margin-bottom: var(--space-4);
  padding: var(--space-3) var(--space-4);
  background: var(--color-bg-secondary, rgba(0, 0, 0, 0.04));
  border: 1px solid var(--color-border, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}

.upload-progress-banner .progress-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-2);
  font-size: var(--text-sm);
  gap: var(--space-3);
}

.upload-progress-banner .progress-title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-progress-banner .progress-title svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  color: var(--color-primary);
}

.upload-progress-banner .progress-metric {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

.upload-progress-banner .progress-bar-bg {
  width: 100%;
  height: 6px;
  background: var(--color-bg-hover, rgba(0, 0, 0, 0.08));
  border-radius: var(--radius-full);
  overflow: hidden;
}

.upload-progress-banner .progress-bar-fill {
  height: 100%;
  background: var(--color-primary, #3b82f6);
  border-radius: var(--radius-full);
  transition: width 0.2s ease-out;
}

.batch-actions {
  display: flex;
  gap: var(--space-2);
}

.batch-btn {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-lg);
  font-size: var(--text-sm);
  font-weight: 600;
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  transition: all var(--duration-fast);
}

.batch-btn:hover {
  background: var(--color-bg-sunken);
  color: var(--color-text);
}

.batch-btn.danger {
  color: var(--color-danger);
}

.batch-btn svg {
  width: 16px;
  height: 16px;
}

/* slide-up transition */
.slide-up-enter-active,
.slide-up-leave-active {
  transition: all var(--duration-normal) var(--ease-out);
}
.slide-up-enter-from,
.slide-up-leave-to {
  opacity: 0;
  transform: translate(-50%, 20px);
}

@media (max-width: 640px) {
  .shelf-content {
    padding: 0 var(--space-4);
  }

  .shelf-header {
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5) 0 var(--space-3);
  }

  .shelf-title {
    flex: 0 0 auto;
    font-size: var(--text-2xl);
  }

  .shelf-actions {
    flex: 1 1 auto;
    justify-content: flex-end;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .shelf-actions::-webkit-scrollbar {
    display: none;
  }

  .shelf-btn {
    width: 42px;
    min-width: 42px;
    height: 42px;
    min-height: 42px;
    padding: 0;
    border-radius: var(--radius-lg);
  }

  .shelf-btn svg {
    width: 19px;
    height: 19px;
  }

  .shelf-btn-label {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .batch-toolbar {
    width: calc(100% - var(--space-8));
    bottom: calc(104px + var(--space-3));
    gap: var(--space-4);
    justify-content: space-between;
  }
  .batch-info { display: none; }
}
</style>
