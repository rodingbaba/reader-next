<template>
  <div class="reader-bookshelf" :style="{ background: theme.popup, color: theme.fontColor }">
    <div class="shelf-header">
      <h3>书架 ({{ store.books.length }})</h3>
      <button class="close-btn" @click="readerStore.closePanel()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12" /></svg>
      </button>
    </div>
    
    <div class="shelf-list">
      <div
        v-for="book in store.books"
        :key="book.bookUrl"
        class="shelf-item"
        :class="{ current: book.bookUrl === readerStore.book?.bookUrl }"
        @click="openBook(book)"
      >
        <img
          v-if="coverMap[book.bookUrl] && !coverFailedMap[book.bookUrl]"
          :src="coverMap[book.bookUrl]"
          :alt="book.name"
          class="book-cover"
          loading="lazy"
          @load="onCoverImgLoad(book)"
          @error="onCoverImgError(book)"
        />
        <div v-else class="book-cover placeholder">
          {{ getBookInitial(book.name) }}
        </div>
        
        <div class="book-info">
          <div class="book-title">{{ book.name }}</div>
          <div class="book-author">{{ book.author }}</div>
          <div class="book-progress">
            {{ book.durChapterTitle || '未读' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useBookshelfStore } from '../../stores/bookshelf'
import { useReaderStore } from '../../stores/reader'
import { getCoverUrl } from '../../api/bookshelf'
import { getCoverCache, cacheCoverFromUrl, getCoverMemoryCache } from '../../utils/browserCache'
import { getBookInitial } from '../../utils/bookCoverFallback'
import type { Book } from '../../types'

const store = useBookshelfStore()
const readerStore = useReaderStore()
const theme = computed(() => readerStore.currentTheme)

const coverMap = ref<Record<string, string>>({})
const coverFailedMap = ref<Record<string, boolean>>({})

async function resolveBookCover(book: Book) {
  const url = book.customCoverUrl || book.coverUrl
  if (!url) {
    coverMap.value[book.bookUrl] = ''
    return
  }
  // 1. 同步内存直出（命中快照时 0ms）
  const mem = getCoverMemoryCache(book.bookUrl, url)
  if (mem) {
    coverMap.value[book.bookUrl] = mem
    coverFailedMap.value[book.bookUrl] = false
    return
  }
  // 2. 首帧优先赋远程代理 URL，消除白屏占位
  if (!coverMap.value[book.bookUrl]) {
    coverMap.value[book.bookUrl] = getCoverUrl(url)
  }
  // 3. 异步读取本地离线封面池并校验版本
  const local = await getCoverCache(book.bookUrl, url)
  if (local) {
    coverMap.value[book.bookUrl] = local
    coverFailedMap.value[book.bookUrl] = false
    return
  }
  coverMap.value[book.bookUrl] = getCoverUrl(url)
  coverFailedMap.value[book.bookUrl] = false
}

function onCoverImgLoad(book: Book) {
  coverFailedMap.value[book.bookUrl] = false
  const current = coverMap.value[book.bookUrl]
  const url = book.customCoverUrl || book.coverUrl
  if (url && current && !current.startsWith('data:')) {
    void cacheCoverFromUrl(book.bookUrl, current, url)
  }
}

function onCoverImgError(book: Book) {
  const url = book.customCoverUrl || book.coverUrl
  const current = coverMap.value[book.bookUrl]
  if (url && current && !current.startsWith('data:')) {
    getCoverCache(book.bookUrl, url)
      .then((local) => {
        if (local) {
          coverMap.value[book.bookUrl] = local
          coverFailedMap.value[book.bookUrl] = false
        } else {
          coverFailedMap.value[book.bookUrl] = true
        }
      })
      .catch(() => {
        coverFailedMap.value[book.bookUrl] = true
      })
    return
  }
  coverFailedMap.value[book.bookUrl] = true
}

function handleCoverUpdated(e: Event) {
  const detail = (e as CustomEvent).detail
  if (!detail || !detail.bookUrl) return
  if (detail.coverData) {
    coverMap.value[detail.bookUrl] = detail.coverData
    coverFailedMap.value[detail.bookUrl] = false
  } else {
    const b = store.books.find((item) => item.bookUrl === detail.bookUrl)
    if (b) void resolveBookCover(b)
  }
}

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('reader-cover-updated', handleCoverUpdated)
  }
})

onUnmounted(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('reader-cover-updated', handleCoverUpdated)
  }
})

watch(
  () => store.books.map((b) => `${b.bookUrl}:${b.customCoverUrl || ''}:${b.coverUrl || ''}`),
  () => {
    store.books.forEach((b) => void resolveBookCover(b))
  },
  { immediate: true },
)

if (!store.books.length) {
  store.fetchBooks()
}

async function openBook(book: Book) {
  if (book.bookUrl !== readerStore.book?.bookUrl) {
    readerStore.clear()
    await readerStore.loadBook(book)
    await readerStore.loadChapter(readerStore.currentIndex)
  }
  readerStore.closePanel()
}
</script>

<style scoped>
.reader-bookshelf {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.shelf-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0,0,0,0.06);
  flex-shrink: 0;
}

.shelf-header h3 {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
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
  background: rgba(0,0,0,0.05);
}

.close-btn svg {
  width: 18px;
  height: 18px;
}

.shelf-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

.shelf-item {
  display: flex;
  gap: 12px;
  padding: 10px 20px;
  cursor: pointer;
  transition: background 0.2s;
}

.shelf-item:hover {
  background: rgba(0,0,0,0.03);
}

.shelf-item.current {
  background: rgba(201, 127, 58, 0.08); /* primary slight tint */
}

.book-cover {
  width: 48px;
  height: 64px;
  object-fit: cover;
  border-radius: 4px;
  flex-shrink: 0;
  box-shadow: 0 2px 6px rgba(0,0,0,0.1);
}

.book-cover.placeholder {
  background: rgba(201, 127, 58, 0.12);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-primary, #c97f3a);
  user-select: none;
}

.book-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 2px 0;
}

.book-title {
  font-size: 15px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.book-author {
  font-size: 12px;
  opacity: 0.6;
}

.book-progress {
  font-size: 11px;
  opacity: 0.8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--color-primary, #c97f3a);
}
</style>
