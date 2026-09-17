<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="cropper-modal-overlay" @click="handleClose"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue" class="cropper-modal-container" @click.self="handleClose">
        <div class="cropper-modal-card">
          <!-- Modal Header -->
          <div class="cropper-header">
            <div class="header-left">
              <h3 class="cropper-title">{{ step === 'crop' ? '裁剪书籍封面 (3:4)' : '更换书籍封面' }}</h3>
              <span class="cropper-subtitle">《{{ book.name }}》</span>
            </div>
            <button class="close-btn" @click="handleClose" title="关闭">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <!-- Step 1: Select Tab (Search or Local) -->
          <div v-if="step === 'select'" class="cropper-select-body">
            <!-- Tabs -->
            <div class="tabs-nav">
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'search' }"
                @click="switchTab('search')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon">
                  <circle cx="11" cy="11" r="8" />
                  <path d="m21 21-4.3-4.3" />
                </svg>
                网络搜图 (必应)
              </button>
              <button
                class="tab-btn"
                :class="{ active: activeTab === 'local' }"
                @click="switchTab('local')"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tab-icon">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                本地相册 / 文件
              </button>
            </div>

            <!-- Tab: Search -->
            <div v-if="activeTab === 'search'" class="tab-pane search-pane">
              <div class="search-bar">
                <div class="search-input-wrapper">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="search-icon">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                  <input
                    v-model="searchKeyword"
                    type="text"
                    class="search-input"
                    placeholder="输入书名或关键词检索封面海报"
                    @keyup.enter="handleSearch"
                  />
                  <button v-if="searchKeyword" class="clear-input-btn" @click="searchKeyword = ''">×</button>
                </div>
                <button class="search-btn" :disabled="searching" @click="handleSearch">
                  {{ searching ? '搜索中...' : '搜索' }}
                </button>
              </div>

              <!-- Search Status / Results -->
              <div v-if="searching" class="status-box">
                <div class="spinner"></div>
                <p>正在必应图库搜寻相关高清海报与书封...</p>
              </div>

              <div v-else-if="searchError" class="status-box error">
                <p>{{ searchError }}</p>
                <button class="retry-btn" @click="handleSearch">重新搜索</button>
              </div>

              <div v-else-if="hasSearched && searchResults.length === 0" class="status-box empty">
                <p>未搜索到相关封面图片，请尝试更换或精简关键词</p>
              </div>

              <div v-else-if="searchResults.length > 0" class="results-grid">
                <div
                  v-for="(item, idx) in searchResults"
                  :key="idx"
                  class="cover-card"
                  @click="selectNetworkImage(item)"
                >
                  <div class="cover-thumb-box">
                    <img :src="item.thumbUrl || item.url" :alt="item.title" loading="lazy" />
                    <span v-if="item.width && item.height" class="resolution-badge">
                      {{ item.width }}×{{ item.height }}
                    </span>
                  </div>
                  <p class="cover-card-title" :title="item.title">{{ item.title || '精美封面' }}</p>
                </div>
              </div>
            </div>

            <!-- Tab: Local Upload -->
            <div v-if="activeTab === 'local'" class="tab-pane local-pane">
              <div class="drop-zone" @click="triggerLocalFile">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="upload-big-icon">
                  <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                  <circle cx="9" cy="9" r="2" />
                  <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
                </svg>
                <p class="drop-title">点击选取本地图片</p>
                <p class="drop-sub">支持 JPG、PNG、WEBP，选取后进入 3:4 交互式裁剪</p>
                <input
                  ref="localFileInput"
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style="display: none"
                  @change="handleLocalFileChange"
                />
              </div>
            </div>
          </div>

          <!-- Step 2: Interactive Cropper Body -->
          <div v-else-if="step === 'crop'" class="cropper-crop-body">
            <!-- Loading Original Image -->
            <div v-if="loadingImage" class="crop-loading-overlay">
              <div class="spinner"></div>
              <p>正在防盗链安全代理加载高清原图...</p>
            </div>

            <!-- Gesture / Canvas Workspace -->
            <div
              class="crop-workspace"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointercancel="onPointerUp"
              @wheel.prevent="onWheel"
            >
              <!-- 3:4 Highlighting Box with Mask -->
              <div class="crop-viewport" :style="viewportStyle">
                <!-- Inner 3x3 Grid Lines -->
                <div class="grid-line grid-h1"></div>
                <div class="grid-line grid-h2"></div>
                <div class="grid-line grid-v1"></div>
                <div class="grid-line grid-v2"></div>

                <!-- Preview Image layer -->
                <div class="image-stage" :style="imageStageStyle">
                  <img
                    v-if="activeImgUrl"
                    ref="imageElement"
                    :src="activeImgUrl"
                    class="interactive-img"
                    alt="crop target"
                    crossorigin="anonymous"
                    @load="onImageLoaded"
                    @error="onImageLoadError"
                  />
                </div>
              </div>
            </div>

            <!-- Cropper Controls Bar -->
            <div class="crop-toolbar">
              <div class="tool-group">
                <button class="tool-btn" @click="rotate(-90)" title="逆时针旋转 90°">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                  <span>逆时针</span>
                </button>
                <button class="tool-btn" @click="rotate(90)" title="顺时针旋转 90°">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  <span>顺时针</span>
                </button>
                <button class="tool-btn" @click="fitCover" title="充满视口">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
                  </svg>
                  <span>充满</span>
                </button>
                <button class="tool-btn" @click="fitContain" title="居中完整显示">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                  </svg>
                  <span>居中</span>
                </button>
              </div>

              <div class="crop-actions">
                <button class="cancel-step-btn" :disabled="submitting" @click="step = 'select'">
                  换一张
                </button>
                <button class="confirm-btn" :disabled="submitting || loadingImage" @click="applyCrop">
                  <span v-if="submitting" class="spinner-sm inline-block mr-1"></span>
                  {{ submitting ? '上传保存中...' : '确定并采用' }}
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
import { ref, reactive, computed, watch } from 'vue'
import type { Book } from '../types'
import { searchCoverImages, uploadBookCover, getCoverUrl, type CoverImageItem } from '../api/bookshelf'
import { compressImageToThumbnail } from '../utils/imageCompress'
import { saveCoverCache } from '../utils/browserCache'
import { useBookshelfStore } from '../stores/bookshelf'

const props = defineProps<{
  modelValue: boolean
  book: Book
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  (e: 'success', customCoverUrl: string, base64: string): void
}>()

const shelfStore = useBookshelfStore()

// State
const step = ref<'select' | 'crop'>('select')
const activeTab = ref<'search' | 'local'>('search')
const searchKeyword = ref('')
const searching = ref(false)
const searchError = ref('')
const hasSearched = ref(false)
const searchResults = ref<CoverImageItem[]>([])

const localFileInput = ref<HTMLInputElement | null>(null)
const imageElement = ref<HTMLImageElement | null>(null)

// Crop state
const activeImgUrl = ref('')
const loadingImage = ref(false)
const submitting = ref(false)
const originalImgWidth = ref(0)
const originalImgHeight = ref(0)

// Viewport layout (3:4 ratio)
const VIEWPORT_WIDTH = 270
const VIEWPORT_HEIGHT = 360

const transform = reactive({
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0, // 0, 90, 180, 270
})

// Gestures
let isDragging = false
let startPointerX = 0
let startPointerY = 0
let startTransX = 0
let startTransY = 0

// Pinch state for mobile
let initialPinchDistance = 0
let initialPinchScale = 1

const viewportStyle = computed(() => ({
  width: `${VIEWPORT_WIDTH}px`,
  height: `${VIEWPORT_HEIGHT}px`,
}))

const imageStageStyle = computed(() => {
  return {
    transform: `translate(${transform.x}px, ${transform.y}px) rotate(${transform.rotation}deg) scale(${transform.scale})`,
  }
})

// Watch modelValue open
watch(
  () => props.modelValue,
  (val) => {
    if (val) {
      step.value = 'select'
      activeTab.value = 'search'
      searchKeyword.value = props.book?.name || ''
      if (!hasSearched.value) {
        handleSearch()
      }
    } else {
      activeImgUrl.value = ''
    }
  },
  { immediate: true },
)

function handleClose() {
  if (submitting.value) return
  emit('update:modelValue', false)
}

function switchTab(tab: 'search' | 'local') {
  activeTab.value = tab
}

async function handleSearch() {
  const kw = searchKeyword.value.trim()
  if (!kw) return
  searching.value = true
  searchError.value = ''
  hasSearched.value = true
  try {
    const list = await searchCoverImages(kw)
    searchResults.value = list || []
  } catch (err) {
    searchError.value = (err as Error).message || '搜索封面失败，请重试'
  } finally {
    searching.value = false
  }
}

function triggerLocalFile() {
  localFileInput.value?.click()
}

function handleLocalFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = (event) => {
    const dataUrl = event.target?.result as string
    if (dataUrl) {
      startCropWithUrl(dataUrl)
    }
  }
  reader.readAsDataURL(file)
  input.value = ''
}

function selectNetworkImage(item: CoverImageItem) {
  // 通过项目已有代理加载防跨域防盗链图片
  const proxyUrl = getCoverUrl(item.url)
  startCropWithUrl(proxyUrl)
}

function startCropWithUrl(url: string) {
  activeImgUrl.value = url
  loadingImage.value = true
  step.value = 'crop'
  transform.scale = 1
  transform.x = 0
  transform.y = 0
  transform.rotation = 0
}

function onImageLoaded(e: Event) {
  loadingImage.value = false
  const img = e.target as HTMLImageElement
  originalImgWidth.value = img.naturalWidth || img.width || 400
  originalImgHeight.value = img.naturalHeight || img.height || 600
  fitCover()
}

function onImageLoadError() {
  loadingImage.value = false
  alert('图片加载失败，可能源站已失效或防盗链限制，请选择其他候选图片')
  step.value = 'select'
}

function rotate(delta: number) {
  transform.rotation = (transform.rotation + delta + 360) % 360
  fitCover()
}

function fitCover() {
  const is90or270 = transform.rotation === 90 || transform.rotation === 270
  const curW = is90or270 ? originalImgHeight.value : originalImgWidth.value
  const curH = is90or270 ? originalImgWidth.value : originalImgHeight.value
  if (!curW || !curH) return

  const scaleX = VIEWPORT_WIDTH / curW
  const scaleY = VIEWPORT_HEIGHT / curH
  transform.scale = Math.max(scaleX, scaleY)
  transform.x = 0
  transform.y = 0
}

function fitContain() {
  const is90or270 = transform.rotation === 90 || transform.rotation === 270
  const curW = is90or270 ? originalImgHeight.value : originalImgWidth.value
  const curH = is90or270 ? originalImgWidth.value : originalImgHeight.value
  if (!curW || !curH) return

  const scaleX = VIEWPORT_WIDTH / curW
  const scaleY = VIEWPORT_HEIGHT / curH
  transform.scale = Math.min(scaleX, scaleY)
  transform.x = 0
  transform.y = 0
}

// ─── Gesture Events ───
const activePointers = new Map<number, { x: number; y: number }>()

function onPointerDown(e: PointerEvent) {
  if (loadingImage.value) return
  (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId)
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (activePointers.size === 1) {
    isDragging = true
    startPointerX = e.clientX
    startPointerY = e.clientY
    startTransX = transform.x
    startTransY = transform.y
  } else if (activePointers.size === 2) {
    isDragging = false
    const pts = Array.from(activePointers.values())
    initialPinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    initialPinchScale = transform.scale
  }
}

function onPointerMove(e: PointerEvent) {
  if (!activePointers.has(e.pointerId)) return
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

  if (activePointers.size === 1 && isDragging) {
    const dx = e.clientX - startPointerX
    const dy = e.clientY - startPointerY
    transform.x = startTransX + dx
    transform.y = startTransY + dy
  } else if (activePointers.size === 2) {
    const pts = Array.from(activePointers.values())
    const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)
    if (initialPinchDistance > 0) {
      const factor = curDist / initialPinchDistance
      transform.scale = Math.max(0.2, Math.min(5, initialPinchScale * factor))
    }
  }
}

function onPointerUp(e: PointerEvent) {
  activePointers.delete(e.pointerId)
  if (activePointers.size === 1) {
    const remaining = Array.from(activePointers.values())[0]
    isDragging = true
    startPointerX = remaining.x
    startPointerY = remaining.y
    startTransX = transform.x
    startTransY = transform.y
  } else if (activePointers.size === 0) {
    isDragging = false
  }
}

function onWheel(e: WheelEvent) {
  if (loadingImage.value) return
  const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92
  transform.scale = Math.max(0.2, Math.min(5, transform.scale * zoomFactor))
}

// ─── Export and Upload ───
async function applyCrop() {
  if (!imageElement.value || submitting.value) return
  submitting.value = true

  try {
    const targetW = 360
    const targetH = 480
    const canvas = document.createElement('canvas')
    canvas.width = targetW
    canvas.height = targetH
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas context unavailable')

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    // 将屏幕坐标映射到 360x480 的导出坐标系
    const factor = targetW / VIEWPORT_WIDTH // 360 / 270 = 1.3333

    ctx.translate(targetW / 2, targetH / 2)
    ctx.translate(transform.x * factor, transform.y * factor)
    ctx.rotate((transform.rotation * Math.PI) / 180)
    ctx.scale(transform.scale * factor, transform.scale * factor)

    // 绘制原图中心对齐
    ctx.drawImage(
      imageElement.value,
      -originalImgWidth.value / 2,
      -originalImgHeight.value / 2,
      originalImgWidth.value,
      originalImgHeight.value,
    )

    // 初步生成高清 Blob
    const rawBlob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/jpeg', 0.9)
    })

    // 接入最新自适应阶梯压缩机制（严格约束尺寸与单张Base64容量）
    const comp = await compressImageToThumbnail(rawBlob, 280, 400, 0.82)

    // 调用服务端上传并落盘
    const updatedBook = await uploadBookCover(props.book.bookUrl, comp.file)

    // 写入本地 IndexedDB 离线库及首屏快照池
    await saveCoverCache(props.book.bookUrl, comp.dataUrl, updatedBook.customCoverUrl)

    // 更新 Pinia 书架状态
    shelfStore.updateBookCover(props.book.bookUrl, updatedBook.customCoverUrl)

    // 全局广播通知抽屉书架及听书锁屏等组件
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('reader-cover-updated', {
          detail: {
            bookUrl: props.book.bookUrl,
            coverData: comp.dataUrl,
            customCoverUrl: updatedBook.customCoverUrl,
          },
        }),
      )
    }

    emit('success', updatedBook.customCoverUrl || '', comp.dataUrl)
    emit('update:modelValue', false)
  } catch (err) {
    alert(`更换封面失败: ${(err as Error).message || '未知错误'}`)
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.cropper-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1100;
}

.cropper-modal-container {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 1101;
}

.cropper-modal-card {
  width: 100%;
  max-width: 580px;
  max-height: 90vh;
  background: var(--bg-primary, #ffffff);
  color: var(--text-primary, #1e293b);
  border-radius: 16px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.25), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

@media (prefers-color-scheme: dark) {
  .cropper-modal-card {
    background: #1e2430;
    color: #e2e8f0;
    border: 1px solid rgba(255, 255, 255, 0.08);
  }
}

/* Header */
.cropper-header {
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

@media (prefers-color-scheme: dark) {
  .cropper-header {
    border-bottom-color: rgba(255, 255, 255, 0.08);
  }
}

.header-left {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.cropper-title {
  font-size: 1.1rem;
  font-weight: 600;
  margin: 0;
}

.cropper-subtitle {
  font-size: 0.85rem;
  color: var(--text-secondary, #64748b);
}

.close-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 6px;
  border-radius: 8px;
  color: #94a3b8;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn svg {
  width: 20px;
  height: 20px;
}

.close-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  color: #334155;
}

@media (prefers-color-scheme: dark) {
  .close-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #f8fafc;
  }
}

/* Tabs */
.cropper-select-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.tabs-nav {
  display: flex;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.02);
}

@media (prefers-color-scheme: dark) {
  .tabs-nav {
    border-bottom-color: rgba(255, 255, 255, 0.08);
    background: rgba(0, 0, 0, 0.2);
  }
}

.tab-btn {
  flex: 1;
  padding: 12px 16px;
  border: none;
  background: transparent;
  font-size: 0.95rem;
  font-weight: 500;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: all 0.2s;
  border-bottom: 2px solid transparent;
}

.tab-btn.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
  background: var(--bg-primary, #ffffff);
}

@media (prefers-color-scheme: dark) {
  .tab-btn.active {
    background: #1e2430;
    color: #60a5fa;
    border-bottom-color: #60a5fa;
  }
}

.tab-icon {
  width: 16px;
  height: 16px;
}

/* Tab Pane: Search */
.tab-pane {
  padding: 16px 20px;
  overflow-y: auto;
  flex: 1;
  max-height: 65vh;
}

.search-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 16px;
}

.search-input-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 12px;
  width: 18px;
  height: 18px;
  color: #94a3b8;
}

.search-input {
  width: 100%;
  padding: 10px 36px 10px 38px;
  border-radius: 10px;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: inherit;
  font-size: 0.95rem;
  outline: none;
  transition: border-color 0.2s;
}

@media (prefers-color-scheme: dark) {
  .search-input {
    background: #0f172a;
    border-color: #334155;
  }
}

.search-input:focus {
  border-color: #3b82f6;
}

.clear-input-btn {
  position: absolute;
  right: 12px;
  background: none;
  border: none;
  font-size: 1.2rem;
  color: #94a3b8;
  cursor: pointer;
}

.search-btn {
  padding: 0 18px;
  border-radius: 10px;
  background: #3b82f6;
  color: #fff;
  border: none;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.search-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Status Box */
.status-box {
  padding: 40px 20px;
  text-align: center;
  color: #64748b;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}

.retry-btn {
  padding: 6px 16px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: transparent;
  color: #3b82f6;
  cursor: pointer;
}

/* Grid */
.results-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (min-width: 520px) {
  .results-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.cover-card {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.02);
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  flex-direction: column;
}

@media (prefers-color-scheme: dark) {
  .cover-card {
    border-color: rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.03);
  }
}

.cover-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.15);
  border-color: #3b82f6;
}

.cover-thumb-box {
  position: relative;
  width: 100%;
  aspect-ratio: 3 / 4;
  background: #000;
  overflow: hidden;
}

.cover-thumb-box img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.resolution-badge {
  position: absolute;
  right: 4px;
  bottom: 4px;
  padding: 2px 5px;
  background: rgba(0, 0, 0, 0.7);
  color: #fff;
  font-size: 0.65rem;
  border-radius: 4px;
}

.cover-card-title {
  padding: 6px 8px;
  font-size: 0.75rem;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #64748b;
}

/* Tab Pane: Local */
.drop-zone {
  margin: 20px 0;
  padding: 50px 20px;
  border: 2px dashed #cbd5e1;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(0, 0, 0, 0.01);
}

@media (prefers-color-scheme: dark) {
  .drop-zone {
    border-color: #334155;
    background: rgba(255, 255, 255, 0.02);
  }
}

.drop-zone:hover {
  border-color: #3b82f6;
  background: rgba(59, 130, 246, 0.04);
}

.upload-big-icon {
  width: 48px;
  height: 48px;
  color: #3b82f6;
}

.drop-title {
  font-size: 1.05rem;
  font-weight: 600;
  margin: 0;
}

.drop-sub {
  font-size: 0.85rem;
  color: #94a3b8;
  margin: 0;
}

/* Step 2: Interactive Cropper */
.cropper-crop-body {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.crop-workspace {
  position: relative;
  width: 100%;
  height: 440px;
  background: #0f172a;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  touch-action: none;
  user-select: none;
  cursor: grab;
}

.crop-workspace:active {
  cursor: grabbing;
}

.crop-viewport {
  position: relative;
  box-shadow: 0 0 0 9999px rgba(15, 23, 42, 0.75);
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  overflow: visible;
  pointer-events: none;
  z-index: 2;
}

.grid-line {
  position: absolute;
  border-color: rgba(255, 255, 255, 0.3);
  pointer-events: none;
}

.grid-h1 {
  top: 33.33%;
  left: 0;
  right: 0;
  border-top: 1px dashed;
}

.grid-h2 {
  top: 66.66%;
  left: 0;
  right: 0;
  border-top: 1px dashed;
}

.grid-v1 {
  left: 33.33%;
  top: 0;
  bottom: 0;
  border-left: 1px dashed;
}

.grid-v2 {
  left: 66.66%;
  top: 0;
  bottom: 0;
  border-left: 1px dashed;
}

.image-stage {
  position: absolute;
  top: 50%;
  left: 50%;
  transform-origin: center center;
  z-index: 1;
  pointer-events: none;
}

.interactive-img {
  position: absolute;
  top: 0;
  left: 0;
  transform: translate(-50%, -50%);
  max-width: none;
  max-height: none;
  display: block;
}

.crop-loading-overlay {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.8);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #fff;
  z-index: 10;
}

/* Controls Toolbar */
.crop-toolbar {
  padding: 14px 20px;
  background: var(--bg-primary, #ffffff);
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

@media (prefers-color-scheme: dark) {
  .crop-toolbar {
    background: #1e2430;
    border-top-color: rgba(255, 255, 255, 0.08);
  }
}

.tool-group {
  display: flex;
  gap: 6px;
}

.tool-btn {
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

@media (prefers-color-scheme: dark) {
  .tool-btn {
    border-color: #334155;
  }
}

.tool-btn:hover {
  background: rgba(0, 0, 0, 0.05);
  border-color: #94a3b8;
}

.tool-btn svg {
  width: 14px;
  height: 14px;
}

.crop-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cancel-step-btn {
  padding: 8px 16px;
  border-radius: 8px;
  border: 1px solid #cbd5e1;
  background: transparent;
  color: inherit;
  font-size: 0.9rem;
  cursor: pointer;
}

@media (prefers-color-scheme: dark) {
  .cancel-step-btn {
    border-color: #334155;
  }
}

.confirm-btn {
  padding: 8px 20px;
  border-radius: 8px;
  background: #3b82f6;
  color: #fff;
  border: none;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.confirm-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Spinner */
.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid rgba(59, 130, 246, 0.2);
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner-sm {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

