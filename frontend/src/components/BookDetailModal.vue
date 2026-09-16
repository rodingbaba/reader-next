<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-overlay" @click="close"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue && book" class="modal-container" @click.self="close">
        <div class="detail-modal">
          <button class="modal-close" @click="close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>

          <!-- Book Header -->
          <div class="book-header">
            <div
              class="book-cover-lg"
              :class="{ uploading: uploadingCover }"
              @click="triggerCoverUpload"
              title="点击更换封面"
            >
              <img
                v-if="coverSrc"
                :src="coverSrc"
                :alt="book.name"
                @error="coverFailed = true"
              />
              <div v-else class="cover-placeholder-lg">
                <span>{{ book.name }}</span>
              </div>
              <div class="cover-upload-overlay">
                <div v-if="uploadingCover" class="spinner-sm"></div>
                <template v-else>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="camera-icon">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span class="upload-tip">更换封面</span>
                </template>
              </div>
            </div>

            <input
              ref="coverFileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style="display: none"
              @change="handleCoverFileChange"
            />
            <div class="book-header-info">
              <div v-if="!isEditingInfo" class="title-row">
                <h2>{{ book.name }}</h2>
                <button class="edit-btn" @click="startEditingInfo">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                </button>
              </div>
              <div v-else class="title-row edit-mode">
                <input v-model="editForm.name" class="edit-input" placeholder="书名" />
              </div>

              <div v-if="!isEditingInfo" class="author-row">
                <p class="author">{{ book.author || '未知作者' }}</p>
              </div>
              <div v-else class="author-row edit-mode">
                <input v-model="editForm.author" class="edit-input" placeholder="作者" />
              </div>
              
              <div v-if="isEditingInfo" class="edit-actions-inline">
                <button @click="saveBookInfo" class="save-btn" :disabled="savingInfo">保存</button>
                <button @click="isEditingInfo = false" class="cancel-btn" :disabled="savingInfo">取消</button>
              </div>

              <div class="book-tags" v-if="!isEditingInfo">
                <span v-if="book.kind" class="tag">{{ book.kind }}</span>
                <span v-if="(book as Book).totalChapterNum" class="tag">共{{ (book as Book).totalChapterNum }}章</span>
                <span v-if="(book as Book).originName" class="tag origin">{{ (book as Book).originName }}</span>
              </div>
              <p v-if="(book as Book).durChapterTitle && !isEditingInfo" class="progress">
                已读至：{{ (book as Book).durChapterTitle }}
              </p>
              <div v-if="(book as Book).customCoverUrl && !isEditingInfo" class="cover-actions-row">
                <button class="reset-cover-btn" @click="handleResetCover" :disabled="uploadingCover" title="恢复为原书自带封面">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  恢复原版封面
                </button>
              </div>
            </div>
          </div>

          <!-- Intro -->
          <div v-if="book.intro" class="book-intro">
            <h3>简介</h3>
            <p>{{ book.intro }}</p>
          </div>

          <!-- Chapters -->
          <div class="chapter-section" v-if="chapters.length > 0">
            <h3>目录 ({{ chapters.length }})</h3>
            <div class="chapter-list">
              <div
                v-for="(chapter, i) in displayChapters"
                :key="chapter.url"
                class="chapter-item"
                :class="{ current: i === (book as Book).durChapterIndex }"
                @click="readChapter(i)"
              >
                <span class="chapter-index">{{ i + 1 }}</span>
                <span class="chapter-title">{{ chapter.title }}</span>
              </div>
            </div>
            <button
              v-if="chapters.length > 50 && !showAllChapters"
              class="show-more-btn"
              @click="showAllChapters = true"
            >
              显示全部 {{ chapters.length }} 章
            </button>
          </div>
          <div v-else-if="chaptersLoading" class="chapter-loading">
            <div class="loading-spinner"></div>
            加载目录中...
          </div>

          <!-- Settings -->
          <div class="book-settings" v-if="book">
            <div class="setting-item">
              <span class="setting-title">显示未读红点</span>
              <label class="switch">
                <input type="checkbox" :checked="appStore.enabledUnreadBadgeBooks.includes((book as Book).bookUrl)" @change="appStore.toggleUnreadBadge((book as Book).bookUrl, ($event.target as HTMLInputElement).checked)">
                <span class="slider"></span>
              </label>
            </div>
            <div class="setting-item">
              <span class="setting-title">启用AI资料</span>
              <label class="switch">
                <input type="checkbox" :checked="appStore.enabledAiPanelBooks.includes((book as Book).bookUrl)" @change="appStore.toggleAiPanel((book as Book).bookUrl, ($event.target as HTMLInputElement).checked)">
                <span class="slider"></span>
              </label>
            </div>
          </div>

          <!-- Actions -->
          <div class="modal-actions">
            <button class="action-btn primary" @click="startReading">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              {{ (book as Book).durChapterIndex ? '继续阅读' : '开始阅读' }}
            </button>
            <button v-if="appStore.enabledAiPanelBooks.includes((book as Book).bookUrl)" class="action-btn" @click="openAiBook">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M12 2v4" />
                <path d="M12 18v4" />
                <path d="M2 12h4" />
                <path d="M18 12h4" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              AI资料
            </button>
            <button class="action-btn" @click="close">关闭</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, computed, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { getCoverUrl, getChapterList, saveBook, uploadBookCover, resetBookCover } from '../api/bookshelf'
import { getBrowserCachedChapterList, getCoverCache, saveCoverCache, removeCoverCache } from '../utils/browserCache'
import { compressImageToThumbnail } from '../utils/imageCompress'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderStore } from '../stores/reader'
import { useAppStore } from '../stores/app'
import type { Book, SearchBook, BookChapter } from '../types'

const appStore = useAppStore()
const shelfStore = useBookshelfStore()

const props = defineProps<{
  modelValue: boolean
  book: Book | SearchBook | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'update:book': [book: Book | SearchBook]
}>()

const router = useRouter()
const readerStore = useReaderStore()

const coverFileInput = ref<HTMLInputElement | null>(null)
const uploadingCover = ref(false)
const localCoverData = ref('')

function triggerCoverUpload() {
  if (uploadingCover.value) return
  coverFileInput.value?.click()
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleCoverFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file || !props.book) return

  uploadingCover.value = true
  try {
    // 客户端智能等比压缩（宽 ≤400px，质量 0.82，体积缩减至 20~40KB，使 Base64 稳稳进入快照池）
    let compressedFile = file
    let base64 = ''
    try {
      const comp = await compressImageToThumbnail(file)
      compressedFile = comp.file
      base64 = comp.dataUrl
    } catch (compErr) {
      console.warn('封面压缩异常，降级原图', compErr)
      base64 = await fileToDataUrl(file)
    }

    const updatedBook = await uploadBookCover(props.book.bookUrl, compressedFile)

    // 1. 先将轻量化图片以 Base64 Data URL 形式写入 IndexedDB 离线封面池，确保本地秒显
    localCoverData.value = base64
    try {
      await saveCoverCache(props.book.bookUrl, base64, updatedBook.customCoverUrl)
    } catch (cacheErr) {
      console.warn('缓存封面至本地 IndexedDB 异常', cacheErr)
    }

    const b = props.book as Book
    b.customCoverUrl = updatedBook.customCoverUrl
    emit('update:book', { ...b })

    // 2. 响应式更新 shelfStore 并同步写回 localStorage 书架缓存
    shelfStore.updateBookCover(b.bookUrl, updatedBook.customCoverUrl)

    // 3. 发出全局封面变更广播，通知所有挂载的卡片组件瞬时更新
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('reader-cover-updated', {
          detail: {
            bookUrl: b.bookUrl,
            coverData: base64,
            customCoverUrl: updatedBook.customCoverUrl,
          },
        }),
      )
    }

    coverFailed.value = false
    appStore.showToast('封面更换成功', 'success')
  } catch (err: any) {
    appStore.showToast(err?.message || '封面上传失败', 'error')
  } finally {
    uploadingCover.value = false
    if (target) target.value = ''
  }
}

async function handleResetCover() {
  if (!props.book || uploadingCover.value) return
  uploadingCover.value = true
  try {
    await resetBookCover(props.book.bookUrl)
    await removeCoverCache(props.book.bookUrl)
    localCoverData.value = ''

    const b = props.book as Book
    b.customCoverUrl = undefined
    emit('update:book', { ...b })

    // 响应式更新 shelfStore 并写回本地持久化
    shelfStore.updateBookCover(b.bookUrl, undefined)

    // 发出全局封面变更广播
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('reader-cover-updated', {
          detail: {
            bookUrl: b.bookUrl,
            coverData: '',
            customCoverUrl: undefined,
          },
        }),
      )
    }

    coverFailed.value = false
    appStore.showToast('已恢复原版封面', 'success')
  } catch (err: any) {
    appStore.showToast(err?.message || '恢复封面失败', 'error')
  } finally {
    uploadingCover.value = false
  }
}

const coverFailed = ref(false)
const chapters = ref<BookChapter[]>([])
const chaptersLoading = ref(false)
const showAllChapters = ref(false)

const isEditingInfo = ref(false)
const savingInfo = ref(false)
const editForm = reactive({
  name: '',
  author: ''
})

function startEditingInfo() {
  if (!props.book) return
  editForm.name = props.book.name
  editForm.author = props.book.author
  isEditingInfo.value = true
}

async function saveBookInfo() {
  if (!props.book) return
  if (!editForm.name.trim()) {
    appStore.showToast('书名不能为空', 'warning')
    return
  }
  savingInfo.value = true
  try {
    const updatedBook = await saveBook({
      ...props.book,
      name: editForm.name.trim(),
      author: editForm.author.trim()
    })
    
    // Mutate the local object directly so the modal UI updates instantly
    const b = props.book as Book;
    b.name = updatedBook.name || editForm.name.trim();
    b.author = updatedBook.author || editForm.author.trim();
    
    // Emit updated book just in case
    emit('update:book', { ...props.book, ...updatedBook })
    // Refresh shelf (this fetches from server in background)
    await shelfStore.fetchBooks()
    isEditingInfo.value = false
    appStore.showToast('书籍信息已保存', 'success')
  } catch (e: any) {
    appStore.showToast(e.message || '保存失败', 'error')
  } finally {
    savingInfo.value = false
  }
}

const coverSrc = computed(() => {
  if (coverFailed.value || !props.book) return ''
  if (localCoverData.value) return localCoverData.value
  const url = (props.book as Book).customCoverUrl || props.book.coverUrl
  return url ? getCoverUrl(url) : ''
})

const displayChapters = computed(() => {
  if (showAllChapters.value) return chapters.value
  return chapters.value.slice(0, 50)
})

watch(() => props.modelValue, async (visible) => {
  if (visible && props.book) {
    coverFailed.value = false
    localCoverData.value = ''
    if (props.book?.bookUrl) {
      getCoverCache(props.book.bookUrl).then((cached) => {
        if (cached) localCoverData.value = cached
      })
    }
    showAllChapters.value = false
    chapters.value = []
    chaptersLoading.value = true
    const b = props.book as Book

    // 优先秒显本地离线目录（如有）
    try {
      const cached = await getBrowserCachedChapterList(b.bookUrl)
      if (cached && cached.chapters.length > 0) {
        chapters.value = cached.chapters
        chaptersLoading.value = false
      }
    } catch {
      // ignore
    }

    // 若当前离线且已有本地目录，不再请求网络
    if (typeof navigator !== 'undefined' && !navigator.onLine && chapters.value.length > 0) {
      chaptersLoading.value = false
      return
    }

    try {
      const serverChapters = await getChapterList({
        bookUrl: b.bookUrl,
        bookSourceUrl: b.origin,
      })
      chapters.value = serverChapters
    } catch {
      // 网络失败时保持本地缓存目录
    } finally {
      chaptersLoading.value = false
    }
  }
})

function close() {
  emit('update:modelValue', false)
}

async function startReading() {
  if (!props.book) return
  const b = props.book as Book
  void shelfStore.moveBookToFront(b.bookUrl).catch(() => undefined)
  const loadBookTask = readerStore.loadBook(b)
  close()
  await router.push('/reader')
  await loadBookTask
  await readerStore.loadChapter(readerStore.currentIndex)
}

async function readChapter(index: number) {
  if (!props.book) return
  const b = props.book as Book
  void shelfStore.moveBookToFront(b.bookUrl).catch(() => undefined)
  const loadBookTask = readerStore.loadBook(b)
  close()
  await router.push('/reader')
  await loadBookTask
  await readerStore.loadChapter(index)
}

function openAiBook() {
  if (!props.book) return
  const b = props.book as Book
  close()
  router.push({
    name: 'ai-book',
    query: { bookUrl: b.bookUrl },
  })
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
  padding:
    calc(var(--space-6) + var(--safe-area-top))
    calc(var(--space-6) + var(--safe-area-right))
    calc(var(--space-6) + var(--safe-area-bottom))
    calc(var(--space-6) + var(--safe-area-left));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}

.detail-modal {
  width: 100%;
  max-width: 600px;
  max-height: min(85vh, calc(100dvh - var(--safe-area-top) - var(--safe-area-bottom) - 32px));
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  position: relative;
  box-shadow: var(--shadow-xl);
}

.modal-close {
  position: absolute;
  top: max(var(--space-4), calc(var(--safe-area-top) * 0.35));
  right: var(--space-4);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  transition: all var(--duration-fast);
  z-index: 1;
}

.modal-close:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.modal-close svg {
  width: 18px;
  height: 18px;
}

.book-header {
  display: flex;
  gap: var(--space-5);
  margin-bottom: var(--space-6);
}

.book-cover-lg {
  position: relative;
  width: 120px;
  height: 160px;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  overflow: hidden;
  background: var(--color-bg-sunken);
  box-shadow: var(--shadow-md);
  cursor: pointer;
}

.cover-upload-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 500;
  opacity: 0;
  transition: opacity 0.2s ease;
  backdrop-filter: blur(2px);
  pointer-events: none;
}

.book-cover-lg:hover .cover-upload-overlay,
.book-cover-lg.uploading .cover-upload-overlay {
  opacity: 1;
}

.camera-icon {
  width: 22px;
  height: 22px;
}

.upload-tip {
  letter-spacing: 0.5px;
}

.cover-actions-row {
  margin-top: var(--space-2);
}

.reset-cover-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: transparent;
  border: 1px dashed var(--color-border);
  color: var(--color-text-secondary);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.2s ease;
}

.reset-cover-btn:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.reset-cover-btn svg {
  width: 12px;
  height: 12px;
}

.spinner-sm {
  width: 20px;
  height: 20px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.book-cover-lg img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder-lg {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, var(--color-primary-bg), var(--color-bg-sunken));
  padding: var(--space-3);
  text-align: center;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-primary);
}

.book-header-info {
  flex: 1;
  min-width: 0;
}

.book-header-info h2 {
  font-size: var(--text-xl);
  font-weight: 700;
  margin-bottom: var(--space-2);
  line-height: var(--leading-tight);
}

.author {
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  margin-bottom: var(--space-3);
}

.book-tags {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.tag {
  padding: 2px var(--space-2);
  background: var(--color-bg-sunken);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.tag.origin {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.progress {
  font-size: var(--text-sm);
  color: var(--color-primary);
}

.book-intro {
  margin-bottom: var(--space-6);
}

.book-intro h3 {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.book-intro p {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  line-height: var(--leading-relaxed);
  white-space: pre-wrap;
}

.chapter-section h3 {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-3);
}

.chapter-list {
  max-height: 300px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
}

@media (max-width: 768px) {
  .detail-modal {
    padding: var(--space-6);
    border-radius: 20px;
  }
}

.chapter-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  cursor: pointer;
  transition: background var(--duration-fast);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--color-divider);
}

.chapter-item:last-child {
  border-bottom: none;
}

.chapter-item:hover {
  background: var(--color-bg-hover);
}

.chapter-item.current {
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.chapter-index {
  color: var(--color-text-tertiary);
  font-size: var(--text-xs);
  min-width: 28px;
}

.chapter-title {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.show-more-btn {
  width: 100%;
  padding: var(--space-3);
  text-align: center;
  color: var(--color-primary);
  font-size: var(--text-sm);
  font-weight: 500;
  margin-top: var(--space-2);
  border-radius: var(--radius-md);
  transition: background var(--duration-fast);
}

.show-more-btn:hover {
  background: var(--color-primary-bg);
}

.chapter-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6);
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}

.loading-spinner {
  width: 18px;
  height: 18px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.modal-actions {
  display: flex;
  gap: var(--space-3);
  margin-top: var(--space-6);
  padding-top: var(--space-5);
  border-top: 1px solid var(--color-divider);
}

.action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  border: 1px solid var(--color-border);
  background: var(--color-bg);
  transition: all var(--duration-fast);
}

.action-btn:hover {
  background: var(--color-bg-hover);
}

.action-btn.primary {
  background: var(--color-primary);
  color: white;
  border-color: var(--color-primary);
}

.action-btn.primary:hover {
  background: var(--color-primary-dark);
}

.book-settings {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  gap: var(--space-6);
  margin-top: var(--space-4);
}

.setting-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
}

.setting-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}

.switch {
  position: relative;
  display: inline-block;
  width: 40px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--color-border);
  transition: .4s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .4s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: var(--color-primary);
}

input:focus + .slider {
  box-shadow: 0 0 1px var(--color-primary);
}

input:checked + .slider:before {
  transform: translateX(16px);
}

.title-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
}

.title-row h2 {
  margin-bottom: 0 !important;
}

.author-row {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.edit-btn {
  background: transparent;
  border: none;
  color: var(--color-text-tertiary);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all var(--duration-fast);
}

.edit-btn:hover {
  background: var(--color-bg-hover);
  color: var(--color-text);
}

.edit-btn svg {
  width: 16px;
  height: 16px;
}

.edit-input {
  width: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  background: var(--color-bg);
  color: var(--color-text);
}

.title-row.edit-mode .edit-input {
  font-size: var(--text-base);
  font-weight: 600;
  margin-bottom: var(--space-2);
}

.author-row.edit-mode .edit-input {
  margin-bottom: var(--space-3);
}

.edit-actions-inline {
  display: flex;
  gap: var(--space-2);
  margin-bottom: var(--space-3);
}

.edit-actions-inline button {
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.edit-actions-inline .save-btn {
  background: var(--color-primary);
  color: white;
}

.edit-actions-inline .cancel-btn {
  background: var(--color-bg-hover);
  color: var(--color-text-secondary);
  border-color: var(--color-border);
}
</style>
