import type { ComputedRef, Ref } from 'vue'
import type { useReaderStore } from '../stores/reader'

type ReaderStore = ReturnType<typeof useReaderStore>
const OPENAI_SPEECH_CHUNK_CHAR_LIMIT = 70
const OPENAI_PRELOAD_CHUNK_LIMIT = 5
const OPENAI_MERGED_SEGMENT_CHAR_LIMIT = 260

interface AutoPlaybackConfig {
  autoPageMode: string
  clickAction: string
  scrollPixel: number
  pageSpeed: number
  fontSize: number
  lineHeight: number
}

export function useReaderAutoPlayback(
  store: ReaderStore,
  config: ComputedRef<AutoPlaybackConfig>,
  isContinuousMode: ComputedRef<boolean>,
  isHorizontalPageMode: ComputedRef<boolean>,
  horizontalPageIndex: Ref<number>,
  setHorizontalPageIndex: (index: number) => void,
  scrollContainerRef: Ref<HTMLElement | undefined>,
  chapterTextRef: Ref<HTMLElement | undefined>,
  nextChapter: () => void | Promise<void>,
  prevChapter: () => void | Promise<void>,
) {
  let autoScrollId: number | null = null
  let autoParagraphTimer: number | null = null
  let autoReadingParagraphIndex = -1
  let autoReadingProcessing = false
  let speechRestartTimer: number | null = null

  let currentSpeechParagraph: HTMLElement | null = null
  let currentSpeechSegments: { text: string; nextParagraph: HTMLElement | null }[] = []
  let currentSpeechSegmentIndex = 0

  function isSafariSpeechDelayBrowser() {
    if (typeof navigator === 'undefined') return false
    const ua = navigator.userAgent || ''
    return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|EdgiOS|Android/i.test(ua)
  }

  function paragraphPreview(paragraph: HTMLElement | null) {
    return paragraph?.innerText.trim().slice(0, 40) || ''
  }

  function logSpeech(message: string, payload?: unknown) {
    void message
    void payload
  }

  /** Returns true when the text contains only punctuation, symbols, and whitespace (not speakable) */
  function isPureSymbolText(text: string) {
    return /^[\s\p{P}\p{S}]+$/u.test(text)
  }

  function getAllParagraphs() {
    const roots = isContinuousMode.value
      ? Array.from(scrollContainerRef.value?.querySelectorAll('.chapter-text[data-role="continuous"]') || []) as HTMLElement[]
      : (chapterTextRef.value ? [chapterTextRef.value] : [])
    if (!roots.length) return [] as HTMLElement[]
    const allElements = roots.flatMap((root) => Array.from(root.querySelectorAll('p')) as HTMLElement[])
    const list: HTMLElement[] = []
    let lastText = ''
    allElements.forEach((el) => {
      const text = el.innerText.trim()
      if (text && text !== lastText) {
        list.push(el)
        lastText = text
      }
    })
    return list
  }

  function getFilteredParagraphs() {
    let roots: HTMLElement[] = []
    if (isContinuousMode.value) {
      roots = Array.from(scrollContainerRef.value?.querySelectorAll('.chapter-text[data-role="continuous"]') || []) as HTMLElement[]
    } else if (isHorizontalPageMode.value && chapterTextRef.value) {
      const pages = Array.from(chapterTextRef.value.querySelectorAll('.horizontal-page')) as HTMLElement[]
      const currentPage = pages[horizontalPageIndex.value]
      if (currentPage) roots = [currentPage]
    } else if (chapterTextRef.value) {
      roots = [chapterTextRef.value]
    }

    if (!roots.length) return [] as HTMLElement[]
    const allElements = roots.flatMap((root) => Array.from(root.querySelectorAll('p')) as HTMLElement[])
    const list: HTMLElement[] = []
    let lastText = ''
    allElements.forEach((el) => {
      const text = el.innerText.trim()
      if (text && text !== lastText) {
        list.push(el)
        lastText = text
      }
    })
    return list
  }

  
  interface TTSCursor {
    bookUrl: string
    chapterIndex: number
    originalIndex: number
    sliceIndex: number
    timestamp: number
  }

  function getStoredTTSCursor(): TTSCursor | null {
    if (!store.book) return null
    try {
      const raw = localStorage.getItem(`tts_cursor_${store.book.bookUrl}`)
      if (raw) return JSON.parse(raw) as TTSCursor
    } catch {}
    return null
  }

  function saveTTSCursor(paragraph?: HTMLElement | null) {
    if (!store.book) return
    const current = paragraph || chapterTextRef.value?.querySelector('.reading') as HTMLElement || resolvePlaybackTarget()
    if (!current) return
    const originalIndex = current.getAttribute('data-original-index')
    if (originalIndex === null) return
    const cursor: TTSCursor = {
      bookUrl: store.book.bookUrl,
      chapterIndex: store.currentIndex,
      originalIndex: parseInt(originalIndex, 10),
      sliceIndex: parseInt(current.getAttribute('data-slice-index') || '0', 10),
      timestamp: Date.now()
    }
    localStorage.setItem(`tts_cursor_${store.book.bookUrl}`, JSON.stringify(cursor))
  }
  
  ;(window as any).saveTTSCursor = () => saveTTSCursor()

  function resolvePlaybackTarget(): HTMLElement | null {
    const reading = chapterTextRef.value?.querySelector('.reading') as HTMLElement | null
    if (reading) return reading

    const container = scrollContainerRef.value
    if (!container) return null

    const list = isHorizontalPageMode.value ? getFilteredParagraphs() : getAllParagraphs()

    const cursor = getStoredTTSCursor()
    if (cursor && cursor.chapterIndex === store.currentIndex) {
      const targetInCursor = list.find(el => {
        const oIdx = el.getAttribute('data-original-index')
        const sIdx = el.getAttribute('data-slice-index') || '0'
        return oIdx === String(cursor.originalIndex) && sIdx === String(cursor.sliceIndex)
      }) || list.find(el => el.getAttribute('data-original-index') === String(cursor.originalIndex))
      
      if (targetInCursor) {
        if (isHorizontalPageMode.value) {
          return targetInCursor
        } else {
          const top = targetInCursor.offsetTop - container.scrollTop
          const bottom = top + targetInCursor.offsetHeight
          if (bottom > -container.clientHeight && top < container.clientHeight * 2) {
            return targetInCursor
          }
        }
      }
    }

    for (const paragraph of list) {
      const top = paragraph.offsetTop - container.scrollTop
      const bottom = top + paragraph.offsetHeight
      if (bottom > 40) {
        return paragraph
      }
    }

    return list[0] || null
  }


  function getNextLogicalParagraphFrom(current: HTMLElement | null) {
    const list = getAllParagraphs()
    const index = current ? list.indexOf(current) : -1
    if (index >= 0) {
      const currentOriginalIndex = current?.getAttribute('data-original-index')
      if (currentOriginalIndex !== null && currentOriginalIndex !== '') {
        for (let i = index + 1; i < list.length; i++) {
          if (list[i].getAttribute('data-original-index') !== currentOriginalIndex) {
            return list[i]
          }
        }
      }
      return list[index + 1] || null
    }
    return list[0] || null
  }

  function getPrevLogicalParagraphFrom(current: HTMLElement | null) {
    const list = getAllParagraphs()
    const index = current ? list.indexOf(current) : -1
    if (index > 0) {
      const currentOriginalIndex = current?.getAttribute('data-original-index')
      if (currentOriginalIndex !== null && currentOriginalIndex !== '') {
        for (let i = index - 1; i >= 0; i--) {
          if (list[i].getAttribute('data-original-index') !== currentOriginalIndex) {
            const prevOriginalIndex = list[i].getAttribute('data-original-index')
            for (let j = i; j >= 0; j--) {
              if (list[j].getAttribute('data-original-index') !== prevOriginalIndex) {
                return list[j + 1]
              }
            }
            return list[0]
          }
        }
      }
      return list[index - 1]
    }
    return null
  }

  function getNextParagraph() {
    const current = resolvePlaybackTarget()
    return getNextParagraphFrom(current)
  }

  function getNextParagraphFrom(current: HTMLElement | null) {
    const list = getAllParagraphs()
    const index = current ? list.indexOf(current) : -1
    if (index >= 0 && index < list.length - 1) return list[index + 1]
    return null
  }

  function splitLongSentence(sentence: string) {
    const chunks: string[] = []
    let remaining = sentence.trim()
    while (remaining.length > OPENAI_SPEECH_CHUNK_CHAR_LIMIT) {
      let splitIndex = Math.max(
        remaining.lastIndexOf('，', OPENAI_SPEECH_CHUNK_CHAR_LIMIT),
        remaining.lastIndexOf('、', OPENAI_SPEECH_CHUNK_CHAR_LIMIT),
        remaining.lastIndexOf(',', OPENAI_SPEECH_CHUNK_CHAR_LIMIT),
        remaining.lastIndexOf(' ', OPENAI_SPEECH_CHUNK_CHAR_LIMIT),
      )
      if (splitIndex <= 0) {
        splitIndex = OPENAI_SPEECH_CHUNK_CHAR_LIMIT
      }
      chunks.push(remaining.slice(0, splitIndex).trim())
      remaining = remaining.slice(splitIndex).trim()
    }
    if (remaining) chunks.push(remaining)
    return chunks
  }

  function buildParagraphSpeechChunks(paragraph: HTMLElement | null) {
    const rawText = paragraph?.innerText.trim() || ''
    if (!rawText) return [] as string[]

    const sentences = rawText
      .replace(/\n+/g, '\n')
      .split(/(?<=[。！？!?；;])/)
      .map((item) => item.trim())
      .filter(Boolean)

    const chunks: string[] = []
    let current = ''

    const pushCurrent = () => {
      const normalized = current.trim()
      if (normalized) chunks.push(normalized)
      current = ''
    }

    for (const sentence of (sentences.length ? sentences : [rawText])) {
      if (sentence.length > OPENAI_SPEECH_CHUNK_CHAR_LIMIT) {
        pushCurrent()
        chunks.push(...splitLongSentence(sentence))
        continue
      }
      const next = current ? `${current}${sentence}` : sentence
      if (next.length > OPENAI_SPEECH_CHUNK_CHAR_LIMIT) {
        pushCurrent()
        current = sentence
      } else {
        current = next
      }
    }

    pushCurrent()
    return chunks.length ? chunks : [rawText]
  }

  function buildMergedSpeechSegment(paragraph: HTMLElement | null) {
    const currentText = paragraph?.innerText.trim() || ''
    if (!currentText) {
      return {
        text: '',
        nextParagraph: getNextParagraph(),
      }
    }

    const list = getAllParagraphs()
    const startIndex = paragraph ? list.indexOf(paragraph) : -1
    if (startIndex < 0) {
      return {
        text: currentText,
        nextParagraph: getNextParagraph(),
      }
    }

    const mergedTexts: string[] = [currentText]
    let mergedLength = currentText.length
    let cursorIndex = startIndex + 1

    while (cursorIndex < list.length && mergedLength < OPENAI_MERGED_SEGMENT_CHAR_LIMIT) {
      const nextText = list[cursorIndex]?.innerText.trim() || ''
      if (!nextText) {
        cursorIndex += 1
        continue
      }
      if (mergedLength + nextText.length > OPENAI_MERGED_SEGMENT_CHAR_LIMIT) {
        break
      }
      mergedTexts.push(nextText)
      mergedLength += nextText.length
      cursorIndex += 1
    }

    return {
      text: mergedTexts.join('\n'),
      nextParagraph: list[cursorIndex] || null,
    }
  }

  function resetSpeechChunkState() {
    currentSpeechParagraph = null
    currentSpeechSegments = []
    currentSpeechSegmentIndex = 0
  }

  function buildOpenAISpeechSegments(paragraph: HTMLElement) {
    if (store.speechConfig.openaiRequestMode === 'merged') {
      const merged = buildMergedSpeechSegment(paragraph)
      return merged.text ? [merged] : []
    }

    const paragraphChunks = buildParagraphSpeechChunks(paragraph)
    const nextParagraph = getNextParagraph()
    return paragraphChunks.map((text, index) => ({
      text,
      nextParagraph: index < paragraphChunks.length - 1 ? paragraph : nextParagraph,
    }))
  }

  function ensureSpeechChunkState(paragraph: HTMLElement) {
    if (store.speechConfig.provider !== 'openai' && store.speechConfig.provider !== 'http') {
      return {
        text: paragraph.innerText.trim(),
        nextParagraph: getNextParagraphFrom(paragraph),
      }
    }

    if (currentSpeechParagraph !== paragraph) {
      currentSpeechParagraph = paragraph
      currentSpeechSegments = buildOpenAISpeechSegments(paragraph)
      currentSpeechSegmentIndex = 0
    }

    return currentSpeechSegments[currentSpeechSegmentIndex] || {
      text: '',
      nextParagraph: getNextParagraphFrom(paragraph),
    }
  }

  function getUpcomingSpeechChunks(startParagraph: HTMLElement | null) {
    const chunks: string[] = []

    if (store.speechConfig.provider !== 'openai' && store.speechConfig.provider !== 'http') {
      return chunks
    }

    if (store.speechConfig.openaiRequestMode === 'merged') {
      const merged = buildMergedSpeechSegment(startParagraph)
      return merged.text ? [merged.text] : []
    }

    if (currentSpeechParagraph && currentSpeechSegments.length) {
      for (let i = currentSpeechSegmentIndex + 1; i < currentSpeechSegments.length && chunks.length < OPENAI_PRELOAD_CHUNK_LIMIT; i += 1) {
        if (currentSpeechSegments[i]?.text) {
          chunks.push(currentSpeechSegments[i].text)
        }
      }
    }

    let cursor = startParagraph
    while (cursor && chunks.length < OPENAI_PRELOAD_CHUNK_LIMIT) {
      const paragraphChunks = buildParagraphSpeechChunks(cursor)
      for (const chunk of paragraphChunks) {
        if (chunks.length >= OPENAI_PRELOAD_CHUNK_LIMIT) break
        chunks.push(chunk)
      }
      const list = getAllParagraphs()
      const index = list.indexOf(cursor)
      cursor = index >= 0 ? (list[index + 1] || null) : null
    }

    return chunks
  }

  function clearReadingClass() {
    scrollContainerRef.value?.querySelectorAll('.reading').forEach((el) => el.classList.remove('reading'))
  }

  function showParagraph(paragraph: HTMLElement | null, smooth = true) {
    const container = scrollContainerRef.value
    if (!container || !paragraph) return

    if (isHorizontalPageMode.value && chapterTextRef.value) {
      const pageEl = paragraph.closest('.horizontal-page')
      if (pageEl) {
        const pages = Array.from(chapterTextRef.value.querySelectorAll('.horizontal-page'))
        const index = pages.indexOf(pageEl)
        if (index >= 0 && index !== horizontalPageIndex.value) {
          setHorizontalPageIndex(index)
        }
      }
      return
    }

    const targetTop = Math.max(0, paragraph.offsetTop - 24)
    container.scrollTo({
      top: targetTop,
      behavior: smooth ? 'smooth' : 'auto',
    })
  }

  function markReadingParagraph(paragraph: HTMLElement | null) {
    clearReadingClass()
    if (paragraph) {
      paragraph.classList.add('reading')
    }
  }

  function runAutoScroll() {
    if (!store.isAutoScrolling || !scrollContainerRef.value) return

    const container = scrollContainerRef.value
    const speed = Math.max(1, config.value.scrollPixel) * (config.value.pageSpeed / 1000) * 0.5

    container.scrollTop += speed

    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
      if (config.value.clickAction === 'auto' && store.hasNext) {
        void nextChapter()
      } else {
        stopAutoScroll()
      }
    } else {
      autoScrollId = requestAnimationFrame(runAutoScroll)
    }
  }

  function runAutoParagraph() {
    if (!store.isAutoScrolling) return
    if (autoReadingProcessing) return

    const list = getAllParagraphs()
    if (!list.length) return

    autoReadingProcessing = true

    if (autoReadingParagraphIndex < 0) {
      const current = resolvePlaybackTarget()
      autoReadingParagraphIndex = current ? Math.max(0, list.indexOf(current)) : 0
    }

    if (autoReadingParagraphIndex >= list.length) {
      autoReadingParagraphIndex = -1
      autoReadingProcessing = false
      if (store.hasNext) {
        Promise.resolve(nextChapter()).then(() => {
          window.setTimeout(() => {
            if (store.isAutoScrolling && config.value.autoPageMode === 'paragraph') {
              runAutoParagraph()
            }
          }, 300)
        })
      } else {
        stopAutoScroll()
      }
      return
    }

    const current = list[autoReadingParagraphIndex]
    markReadingParagraph(current)
    showParagraph(current)

    const estimatedLineCount = Math.max(1, Math.ceil(current.offsetHeight / (config.value.fontSize * config.value.lineHeight)))
    const delayTime = Math.max(300, config.value.pageSpeed * estimatedLineCount)

    autoReadingProcessing = false
    autoParagraphTimer = window.setTimeout(() => {
      autoReadingParagraphIndex += 1
      runAutoParagraph()
    }, delayTime)
  }

  function startAutoScroll() {
    if (config.value.autoPageMode === 'paragraph') {
      if (autoParagraphTimer) return
      runAutoParagraph()
      return
    }
    if (autoScrollId) return
    runAutoScroll()
  }

  function stopAutoScroll() {
    store.isAutoScrolling = false
    autoReadingParagraphIndex = -1
    autoReadingProcessing = false
    if (autoScrollId) {
      cancelAnimationFrame(autoScrollId)
      autoScrollId = null
    }
    if (autoParagraphTimer) {
      clearTimeout(autoParagraphTimer)
      autoParagraphTimer = null
    }
    if (!store.isSpeaking && !store.isSpeechTransitioning) {
      clearReadingClass()
    }
  }

  function restartSpeechTarget(paragraph: HTMLElement | null, interruptCurrent = true) {
    logSpeech('restartSpeechTarget', {
      interruptCurrent,
      paragraph: paragraphPreview(paragraph),
      isSpeechTransitioning: store.isSpeechTransitioning,
    })
    if (!paragraph) {
      store.stopTTS()
      resetSpeechChunkState()
      return
    }
    if (store.isSpeechTransitioning) return
    store.isSpeechTransitioning = true
    resetSpeechChunkState()
    if (interruptCurrent) {
      store.stopTTS(false)
    }
    if (speechRestartTimer) {
      clearTimeout(speechRestartTimer)
    }
    const restartDelay = !interruptCurrent && store.speechConfig.provider === 'system'
      ? ((isSafariSpeechDelayBrowser() && !store.systemTtsNativeEventsReliable) ? 160 : 40)
      : 150
    speechRestartTimer = window.setTimeout(() => {
      if (store.isPaused) {

        return
      }

      startSpeech(paragraph, interruptCurrent)
    }, restartDelay)
  }

  function continueSpeechTarget(paragraph: HTMLElement | null, resetChunks = true) {
    logSpeech('continueSpeechTarget', {
      resetChunks,
      paragraph: paragraphPreview(paragraph),
      hasNextChapter: store.hasNext,
    })
    if (speechRestartTimer) {
      clearTimeout(speechRestartTimer)
    }

    const continueDelay = store.speechConfig.provider === 'system'
      ? ((isSafariSpeechDelayBrowser() && !store.systemTtsNativeEventsReliable) ? 160 : 40)
      : 0

    if (paragraph) {
      store.isSpeechTransitioning = true
      if (resetChunks) {
        resetSpeechChunkState()
      }
      if (continueDelay <= 0) {
        if (!store.isPaused) {
          startSpeech(paragraph, false)
        }
      } else {
        speechRestartTimer = window.setTimeout(() => {
          if (!store.isPaused) {
            startSpeech(paragraph, false)
          }
        }, continueDelay)
      }
      return
    }

    if (!store.hasNext) {
      store.stopTTS()
      clearReadingClass()
      return
    }

    store.isSpeechTransitioning = true
    if (resetChunks) {
      resetSpeechChunkState()
    }
    Promise.resolve(nextChapter())
      .then(() => {
        if (continueDelay <= 0) {
          if (!store.isPaused) {
            startSpeech(getFilteredParagraphs()[0] || null, false)
          }
        } else {
          speechRestartTimer = window.setTimeout(() => {
            if (store.isPaused) {
              return
            }
            startSpeech(getFilteredParagraphs()[0] || null, false)
          }, continueDelay)
        }
      })
      .catch(() => {

      })
  }

  function startSpeech(paragraph?: HTMLElement | null, interruptCurrent = true) {
    const current = paragraph || resolvePlaybackTarget()
    logSpeech('startSpeech', {
      interruptCurrent,
      paragraph: paragraphPreview(current),
      currentIndex: store.currentIndex,
    })
    const currentText = current?.innerText.trim() || ''
    if (!current || !currentText || isPureSymbolText(currentText)) {
      if (interruptCurrent) {
        speechNext()
      } else {
        continueSpeechTarget(getNextParagraphFrom(current ?? null))
      }
      return
    }

    markReadingParagraph(current)
    showParagraph(current)
    const chunk = ensureSpeechChunkState(current)
    if (!chunk.text.trim() || isPureSymbolText(chunk.text.trim())) {
      if (interruptCurrent) {
        speechNext(chunk.nextParagraph)
      } else {
        continueSpeechTarget(chunk.nextParagraph)
      }
      return
    }
    const nextParagraph = chunk.nextParagraph
    logSpeech('speak chunk', {
      interruptCurrent,
      provider: store.speechConfig.provider,
      text: chunk.text.slice(0, 60),
      nextParagraph: paragraphPreview(nextParagraph),
      chunkIndex: currentSpeechSegmentIndex,
      chunkCount: currentSpeechSegments.length,
    })
    let startIndex = 0
    if (current) {
      const idxAttr = current.getAttribute('data-original-index')
      if (idxAttr !== null && idxAttr !== '') {
        startIndex = parseInt(idxAttr, 10)
      } else {
        const list = getAllParagraphs()
        startIndex = Math.max(0, list.indexOf(current))
      }
    }

    store.startTTS(chunk.text, {
      startIndex: startIndex >= 0 ? startIndex : 0,
      onEnd: () => {
        logSpeech('chunk onEnd', {
          provider: store.speechConfig.provider,
          currentParagraph: paragraphPreview(current),
          nextParagraph: paragraphPreview(nextParagraph),
          chunkIndex: currentSpeechSegmentIndex,
          chunkCount: currentSpeechSegments.length,
        })
        if ((store.speechConfig.provider === 'openai' || store.speechConfig.provider === 'http') && currentSpeechParagraph === current && currentSpeechSegmentIndex < currentSpeechSegments.length - 1) {
          currentSpeechSegmentIndex += 1
          continueSpeechTarget(current, false)
          return
        }
        continueSpeechTarget(nextParagraph)
      },
      onError: () => {
        logSpeech('chunk onError', {
          currentParagraph: paragraphPreview(current),
          nextParagraph: paragraphPreview(nextParagraph),
        })
        resetSpeechChunkState()
        clearReadingClass()
      },
    }, interruptCurrent)
    const preloadTexts = getUpcomingSpeechChunks(nextParagraph)
    if (preloadTexts.length) {
      void store.preloadOpenAITTS(preloadTexts)
    }
  }

  function speechPrev() {
    logSpeech('speechPrev', {
      currentParagraph: paragraphPreview(resolvePlaybackTarget()),
      hasPrevChapter: store.hasPrev,
    })
    resetSpeechChunkState()
    const prev = getPrevLogicalParagraphFrom(resolvePlaybackTarget())
    if (prev) {
      restartSpeechTarget(prev)
      return
    }
    if (!store.hasPrev) {
      store.stopTTS()
      return
    }
    store.stopTTS(false)
    Promise.resolve(prevChapter()).then(() => {
      window.setTimeout(() => {
        const list = getAllParagraphs()
        restartSpeechTarget(list[list.length - 1] || null)
      }, 120)
    })
  }

  function speechNext(forcedNext?: HTMLElement | null, interruptCurrent = true) {
    logSpeech('speechNext', {
      interruptCurrent,
      forcedNext: paragraphPreview(forcedNext || null),
      currentParagraph: paragraphPreview(resolvePlaybackTarget()),
      hasNextChapter: store.hasNext,
    })
    resetSpeechChunkState()
    const next = forcedNext ?? getNextLogicalParagraphFrom(resolvePlaybackTarget())
    if (next) {
      restartSpeechTarget(next, interruptCurrent)
      return
    }
    if (!store.hasNext) {
      store.stopTTS()
      clearReadingClass()
      return
    }
    if (interruptCurrent) {
      store.stopTTS(false)
    }
    Promise.resolve(nextChapter()).then(() => {
      window.setTimeout(() => {
        restartSpeechTarget(getFilteredParagraphs()[0] || null)
      }, 120)
    })
  }

  function restartSpeechFromCurrentParagraph() {
    const lockedTarget = currentSpeechParagraph || resolvePlaybackTarget()
    logSpeech('restartSpeechFromCurrentParagraph', {
      currentParagraph: paragraphPreview(lockedTarget),
      isSpeechTransitioning: store.isSpeechTransitioning,
    })
    if (store.isSpeechTransitioning) return
    store.isSpeechTransitioning = true
    resetSpeechChunkState()
    store.stopTTS(false)
    if (speechRestartTimer) {
      clearTimeout(speechRestartTimer)
    }
    speechRestartTimer = window.setTimeout(() => {
      if (store.isPaused) {

        return
      }

      startSpeech(lockedTarget)
    }, 150)
  }

  function cancelSpeechTransition() {
    if (speechRestartTimer) {
      clearTimeout(speechRestartTimer)
      speechRestartTimer = null
      store.isSpeechTransitioning = false
    }

  }

  function resetAutoParagraphIndex() {
    autoReadingParagraphIndex = -1
  }

  let lastNativeTTSIndex = -1

  function syncNativeTTSProgress(index: number) {
    lastNativeTTSIndex = index
    let roots: HTMLElement[] = []
    if (isContinuousMode.value) {
      roots = Array.from(scrollContainerRef.value?.querySelectorAll(`.continuous-chapter[data-chapter-index="${store.currentIndex}"] .chapter-text[data-role="continuous"]`) || []) as HTMLElement[]
    } else if (chapterTextRef.value) {
      roots = [chapterTextRef.value]
    }

    if (!roots.length) return

    const els = roots.flatMap((root) => Array.from(root.querySelectorAll(`p[data-original-index="${index}"]`)) as HTMLElement[])
    if (els.length > 0) {
      clearReadingClass()
      els.forEach(el => el.classList.add('reading'))
      
      let targetEl = els[0]
      if (isHorizontalPageMode.value && chapterTextRef.value) {
        const pages = Array.from(chapterTextRef.value.querySelectorAll('.horizontal-page'))
        const currentPageEl = pages[horizontalPageIndex.value]
        if (currentPageEl) {
          const elOnCurrentPage = els.find(el => currentPageEl.contains(el))
          if (elOnCurrentPage) {
            targetEl = elOnCurrentPage
          }
        }
      }
      
      showParagraph(targetEl)
    }
  }

  function handleContentChanged() {
    autoReadingParagraphIndex = -1

    if (store.isSpeaking && lastNativeTTSIndex >= 0) {
      window.setTimeout(() => {
        if (store.isSpeaking && lastNativeTTSIndex >= 0) {
          syncNativeTTSProgress(lastNativeTTSIndex)
        }
      }, 200)
    }

    if (store.isAutoScrolling && config.value.autoPageMode === 'paragraph') {
      if (autoParagraphTimer) {
        clearTimeout(autoParagraphTimer)
        autoParagraphTimer = null
      }
      window.setTimeout(() => {
        if (store.isAutoScrolling && config.value.autoPageMode === 'paragraph') {
          runAutoParagraph()
        }
      }, 100)
    }
  }

  function disposeAutoPlayback() {
    cancelSpeechTransition()
    stopAutoScroll()
  }

  return {
    resolvePlaybackTarget,
    getStoredTTSCursor,
    saveTTSCursor,
    clearReadingClass,
    syncNativeTTSProgress,
    startAutoScroll,
    stopAutoScroll,
    startSpeech,
    speechPrev,
    speechNext,
    restartSpeechFromCurrentParagraph,
    cancelSpeechTransition,
    resetAutoParagraphIndex,
    handleContentChanged,
    disposeAutoPlayback,
  }
}
