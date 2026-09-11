<template>
  <div class="stats-view">
    <div class="stats-content">
      <!-- Header -->
      <div class="stats-header">
        <div class="header-left">
          <h1 class="stats-title">
            阅读统计
            <span class="stats-subtitle">足迹与习惯</span>
          </h1>
        </div>
        <div class="stats-actions">
          <button class="stats-refresh-btn" :disabled="statsStore.loading" @click="handleRefresh">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              class="refresh-icon"
              :class="{ spinning: statsStore.loading }"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
            刷新数据
          </button>
        </div>
      </div>

      <div class="stats-scroll-area" ref="scrollAreaRef">
        <!-- 0. 单书聚焦提示条 -->
        <div v-if="focusedBookInfo" class="focus-book-banner">
          <div class="focus-banner-left">
            <span class="focus-badge">单书聚焦</span>
            <span class="focus-title">《{{ focusedBookInfo.bookName }}》</span>
          </div>
          <button class="focus-reset-btn" @click="handleClearFocus">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            返回全库统计
          </button>
        </div>

        <!-- 1. 核心指标卡片 -->
        <div class="kpi-grid">
          <div class="kpi-card highlight">
            <div class="kpi-top">
              <span class="kpi-label">{{ focusedBookInfo ? '该书累计总时长' : '累计阅读总时长' }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="kpi-icon">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <div class="kpi-value-row">
              <span class="kpi-val">{{ formatHoursMinutes(statsStore.totalDurationMinutes) }}</span>
            </div>
            <div class="kpi-subtext">
              其中听书 {{ formatHoursMinutes(statsStore.totalListenMinutes) }} · 看书 {{ formatHoursMinutes(Math.max(0, statsStore.totalDurationMinutes - statsStore.totalListenMinutes)) }}
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-top">
              <span class="kpi-label">{{ focusedBookInfo ? '该书今日阅读' : '今日阅读' }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="kpi-icon">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <div class="kpi-value-row">
              <span class="kpi-val">{{ formatHoursMinutes(statsStore.todayDurationMinutes) }}</span>
            </div>
            <div class="kpi-subtext">
              今日听书 {{ formatHoursMinutes(statsStore.todayListenMinutes) }}
            </div>
          </div>

          <div class="kpi-card">
            <div class="kpi-top">
              <span class="kpi-label">{{ focusedBookInfo ? '该书坚持打卡' : '连续阅读打卡' }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="kpi-icon accent-fire">
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
            </div>
            <div class="kpi-value-row">
              <span class="kpi-val">{{ statsStore.streakDays }}</span>
              <span class="kpi-unit">天</span>
            </div>
            <div class="kpi-subtext">
              {{ focusedBookInfo ? `该书累计打卡 ${statsStore.totalDays} 天` : `累计阅读已达 ${statsStore.totalDays} 天` }}
            </div>
          </div>

          <div class="kpi-card" :class="{ 'focus-active-card': !!focusedBookInfo }">
            <div class="kpi-top">
              <span class="kpi-label">{{ focusedBookInfo ? '当前阅读进度' : '阅读书籍' }}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="kpi-icon">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div class="kpi-value-row">
              <template v-if="focusedBookInfo">
                <span class="kpi-val kpi-chapter-val" :title="focusedBookChapterText">{{ focusedBookChapterText }}</span>
              </template>
              <template v-else>
                <span class="kpi-val">{{ statsStore.totalBooks }}</span>
                <span class="kpi-unit">本</span>
              </template>
            </div>
            <div class="kpi-subtext">
              {{ focusedBookInfo ? (focusedBookInfo.author ? `作者: ${focusedBookInfo.author}` : '书架足迹') : '书架足迹档案' }}
            </div>
          </div>
        </div>

        <!-- 2. 阅读足迹热力图 -->
        <div class="section-card heatmap-section">
          <div class="section-title-row">
            <div class="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              阅读足迹热力图
            </div>
            <div class="heatmap-header-stats">
              <span v-if="activeDaysCount > 0" class="active-summary">
                过去一年累计打卡 <strong>{{ activeDaysCount }}</strong> 天
              </span>
              <div class="heatmap-legend">
                <span class="legend-text">少</span>
                <span class="legend-cell level-0"></span>
                <span class="legend-cell level-1"></span>
                <span class="legend-cell level-2"></span>
                <span class="legend-cell level-3"></span>
                <span class="legend-cell level-4"></span>
                <span class="legend-text">多</span>
              </div>
            </div>
          </div>

          <div class="heatmap-container" ref="heatmapContainerRef">
            <div class="heatmap-main-wrapper">
              <!-- 星期提示列（一、三、五） -->
              <div class="heatmap-weekdays" v-if="weeksCount >= 28">
                <span class="weekday-item"></span>
                <span class="weekday-item">一</span>
                <span class="weekday-item"></span>
                <span class="weekday-item">三</span>
                <span class="weekday-item"></span>
                <span class="weekday-item">五</span>
                <span class="weekday-item"></span>
              </div>

              <div class="heatmap-content-col">
                <!-- 顶部月份指示 -->
                <div class="heatmap-months-row">
                  <div
                    v-for="col in heatmapColumns"
                    :key="'m-' + col.weekIndex"
                    class="heatmap-month-cell"
                  >
                    <span v-if="col.monthLabel" class="month-label-text">{{ col.monthLabel }}</span>
                  </div>
                </div>

                <!-- 热力表格主体 -->
                <div class="heatmap-grid">
                  <div
                    v-for="col in heatmapColumns"
                    :key="col.weekIndex"
                    class="heatmap-column"
                  >
                    <div
                      v-for="cell in col.days"
                      :key="cell.date"
                      class="heatmap-cell"
                      :class="[`level-${cell.level}`, { today: cell.isToday }]"
                      :title="cell.tooltip"
                      @click="selectedDateDetail = cell"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="selectedDateDetail" class="selected-date-banner">
            <span class="banner-date">{{ selectedDateDetail.date }}</span>
            <span class="banner-stat">
              阅读 {{ formatHoursMinutes(Math.round(selectedDateDetail.durationSecs / 60)) }}
              <template v-if="selectedDateDetail.listenSecs > 0">
                （含听书 {{ formatHoursMinutes(Math.round(selectedDateDetail.listenSecs / 60)) }}）
              </template>
            </span>
            <button class="banner-close" @click="selectedDateDetail = null">×</button>
          </div>
        </div>

        <!-- 3. 近7天阅读走势柱状图 -->
        <div class="section-card trend-section">
          <div class="section-title-row">
            <div class="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              最近 7 天阅读时长走势
            </div>
            <div class="trend-legend">
              <span class="legend-item">
                <span class="legend-dot read-dot"></span>
                看书
              </span>
              <span class="legend-item">
                <span class="legend-dot listen-dot"></span>
                听书
              </span>
            </div>
          </div>
          <div class="chart-container">
            <div
              v-for="item in last7DaysTrend"
              :key="item.date"
              class="chart-bar-col"
            >
              <div class="bar-value">{{ item.minutes > 0 ? `${item.minutes}m` : '' }}</div>
              <div class="bar-track">
                <div
                  class="bar-fill listen-fill"
                  :style="{ height: `${item.listenPercent}%` }"
                  :title="`听书: ${item.listenMinutes}分钟`"
                />
                <div
                  class="bar-fill read-fill"
                  :style="{ height: `${item.readPercent}%` }"
                  :title="`看书: ${item.readMinutes}分钟`"
                />
              </div>
              <div class="bar-label" :class="{ today: item.isToday }">{{ item.label }}</div>
            </div>
          </div>
        </div>

        <!-- 4. 单书阅读档案与原最近足迹融合 -->
        <div class="section-card books-section">
          <div class="books-section-header">
            <div class="section-title">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
              书籍阅读时长档案
              <span class="books-count">({{ filteredBookList.length }})</span>
            </div>

            <div class="books-filter-bar">
              <div class="sort-select-wrapper">
                <CustomSelect
                  v-model="sortBy"
                  :options="[
                    { label: '按阅读时长', value: 'duration' },
                    { label: '按最近阅读', value: 'recent' },
                  ]"
                  class="sort-custom-select"
                />
              </div>
            </div>
          </div>

          <div class="book-search-box">
            <input
              v-model.trim="searchKeyword"
              class="book-search-input"
              placeholder="搜索书籍、作者..."
            />
          </div>

          <div v-if="filteredBookList.length > 0" class="book-stats-list">
            <div
              v-for="item in filteredBookList"
              :key="item.bookUrl"
              class="book-stat-item"
              :class="{ 'active-focus': statsStore.focusedBookUrl === item.bookUrl }"
            >
              <!-- 左侧主内容区：点击切换单书聚焦（与右侧继续阅读按钮为平级兄弟节点） -->
              <div
                class="item-main"
                :title="statsStore.focusedBookUrl === item.bookUrl ? '点击取消聚焦' : '点击聚焦此书统计'"
                @click="handleToggleFocus(item.bookUrl)"
              >
                <div class="item-cover">
                  <img
                    v-if="item.coverUrl && !failedCovers[item.bookUrl]"
                    :src="getCoverUrl(item.coverUrl)"
                    :alt="item.bookName"
                    loading="lazy"
                    @error="handleCoverError(item.bookUrl)"
                  />
                  <div v-else class="item-cover-fallback">
                    {{ item.bookName ? item.bookName.slice(0, 1) : '书' }}
                  </div>
                </div>

                <div class="item-info">
                  <div class="item-name-row">
                    <span class="item-name">{{ item.bookName }}</span>
                    <span v-if="statsStore.focusedBookUrl === item.bookUrl" class="focused-pill">
                      已聚焦
                    </span>
                    <span v-if="item.shelfBook?.durChapterTitle" class="item-progress-badge">
                      {{ item.shelfBook.durChapterTitle }}
                    </span>
                  </div>
                  <div class="item-author">{{ item.author || '未知作者' }}</div>
                  <div class="item-meta">
                    <span class="meta-tag duration">
                      总计 {{ formatHoursMinutes(Math.round(item.totalDurationSecs / 60), item.totalDurationSecs) }}
                    </span>
                    <span v-if="item.totalListenSecs > 0" class="meta-tag listen">
                      听书 {{ formatHoursMinutes(Math.round(item.totalListenSecs / 60), item.totalListenSecs) }}
                    </span>
                    <span class="meta-date">
                      最后阅读: {{ formatLastReadText(item) }}
                    </span>
                  </div>
                </div>
              </div>

              <!-- 右侧独立操作区：完全独立兄弟节点，点击打开阅读器，绝不触发聚焦 -->
              <div class="item-action">
                <button
                  type="button"
                  class="continue-btn"
                  :disabled="openingBookUrl === item.bookUrl"
                  @click="handleContinueRead(item.bookUrl)"
                >
                  {{ openingBookUrl === item.bookUrl ? '打开中...' : '继续阅读' }}
                </button>
              </div>
            </div>
          </div>

          <div v-else class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <path d="M8 12h8" />
            </svg>
            <p>暂无符合条件的阅读记录</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import CustomSelect from '../components/CustomSelect.vue'
import { useReadingStatsStore } from '../stores/readingStats'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderStore } from '../stores/reader'
import { getTodayDateString, loadLocalReadingStats } from '../utils/readingTracker'
import { loadRecentReadBooks } from '../utils/recentBooks'
import { getCoverUrl } from '../api/bookshelf'

const router = useRouter()
const statsStore = useReadingStatsStore()
const shelfStore = useBookshelfStore()
const readerStore = useReaderStore()

const sortBy = ref<'duration' | 'recent'>('duration')
const searchKeyword = ref('')
const selectedDateDetail = ref<any>(null)
const openingBookUrl = ref('')
const failedCovers = ref<Record<string, boolean>>({})
const heatmapContainerRef = ref<HTMLElement | null>(null)
const scrollAreaRef = ref<HTMLElement | null>(null)
const windowWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 1024)

function handleResize() {
  windowWidth.value = window.innerWidth
}

const focusedBookInfo = computed(() => {
  if (!statsStore.focusedBookUrl) return null
  return (
    statsStore.bookStats.find((b) => b.bookUrl === statsStore.focusedBookUrl) || null
  )
})

const focusedBookChapterText = computed(() => {
  if (!focusedBookInfo.value) return ''
  const shelf = shelfStore.books.find((b) => b.bookUrl === focusedBookInfo.value?.bookUrl)
  return shelf?.durChapterTitle || '在读'
})

async function handleToggleFocus(bookUrl: string) {
  if (statsStore.focusedBookUrl === bookUrl) {
    await statsStore.setFocusedBook(null)
  } else {
    await statsStore.setFocusedBook(bookUrl)
    // 聚焦后平滑滚动回顶部看板
    setTimeout(() => {
      if (scrollAreaRef.value) {
        scrollAreaRef.value.scrollTo({ top: 0, behavior: 'smooth' })
      }
    }, 50)
  }
}

async function handleClearFocus() {
  await statsStore.setFocusedBook(null)
}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  await Promise.all([
    statsStore.fetchStats(),
    shelfStore.fetchBooks().catch(() => undefined),
  ])
  scrollToHeatmapEnd()
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

function handleRefresh() {
  void statsStore.fetchStats()
}

function scrollToHeatmapEnd() {
  setTimeout(() => {
    if (heatmapContainerRef.value && windowWidth.value > 640) {
      heatmapContainerRef.value.scrollLeft = heatmapContainerRef.value.scrollWidth
    }
  }, 100)
}

function formatHoursMinutes(totalMinutes: number, totalSeconds?: number): string {
  if (totalSeconds !== undefined && totalSeconds > 0 && totalSeconds < 60) {
    return '< 1 分钟'
  }
  if (totalMinutes <= 0) return '0 分钟'
  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (hours > 0 && mins > 0) return `${hours} 小时 ${mins} 分钟`
  if (hours > 0) return `${hours} 小时`
  return `${mins} 分钟`
}

function handleCoverError(bookUrl: string) {
  if (bookUrl) {
    failedCovers.value[bookUrl] = true
  }
}

const weeksCount = computed(() => {
  const w = windowWidth.value
  if (w >= 1024) return 52 // 宽屏电脑：整整 1 年 (52 周)
  if (w >= 840) return 40  // 中大桌面：40 周 (~9 个月)
  if (w >= 640) return 30  // 平板端：30 周 (~7 个月)
  if (w >= 430) return 21  // iPhone 16 Pro Max 等超大屏手机 (440px): 21 周
  if (w >= 390) return 19  // iPhone 15/16 等主流手机 (393px): 19 周
  return 18                // 紧凑小屏手机 (375px): 18 周
})

const activeDaysCount = computed(() => {
  return (statsStore.summary?.dailyStats || []).filter(
    (d) => d.durationSecs > 0,
  ).length
})

// ─── 热力图数据构建 ───
interface HeatmapDay {
  date: string
  durationSecs: number
  listenSecs: number
  level: number
  isToday: boolean
  tooltip: string
}

interface HeatmapCol {
  weekIndex: number
  monthLabel?: string
  days: HeatmapDay[]
}

const heatmapColumns = computed<HeatmapCol[]>(() => {
  const dailyMap: Record<string, { durationSecs: number; listenSecs: number }> = {}
  for (const item of statsStore.summary?.dailyStats || []) {
    dailyMap[item.readDate] = {
      durationSecs: item.durationSecs,
      listenSecs: item.listenSecs,
    }
  }

  const todayStr = getTodayDateString()
  const today = new Date()
  const totalWeeks = weeksCount.value
  const totalDays = totalWeeks * 7

  // 从 totalWeeks 周前周日开始
  const startDate = new Date(today)
  startDate.setDate(today.getDate() - totalDays + (7 - today.getDay()))

  const cols: HeatmapCol[] = []
  let currentDays: HeatmapDay[] = []
  let lastLabeledMonth = -1
  let lastLabeledColIndex = -99

  for (let i = 0; i < totalDays; i++) {
    const cur = new Date(startDate)
    cur.setDate(startDate.getDate() + i)
    if (cur > today) break

    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${d}`

    const stat = dailyMap[dateStr] || { durationSecs: 0, listenSecs: 0 }
    const durationMinutes = Math.round(stat.durationSecs / 60)

    let level = 0
    if (durationMinutes > 0 && durationMinutes <= 15) level = 1
    else if (durationMinutes > 15 && durationMinutes <= 30) level = 2
    else if (durationMinutes > 30 && durationMinutes <= 60) level = 3
    else if (durationMinutes > 60) level = 4

    const tooltip = `${dateStr}: 阅读 ${durationMinutes} 分钟${
      stat.listenSecs > 0 ? ` (含听书 ${Math.round(stat.listenSecs / 60)} 分钟)` : ''
    }`

    currentDays.push({
      date: dateStr,
      durationSecs: stat.durationSecs,
      listenSecs: stat.listenSecs,
      level,
      isToday: dateStr === todayStr,
      tooltip,
    })

    if (currentDays.length === 7) {
      const colIndex = cols.length
      let monthLabel: string | undefined = undefined
      for (const day of currentDays) {
        const dayDate = new Date(day.date)
        const dayMonth = dayDate.getMonth() + 1
        const dayNum = dayDate.getDate()
        if (dayNum <= 7 && dayMonth !== lastLabeledMonth && colIndex - lastLabeledColIndex >= 3) {
          monthLabel = `${dayMonth}月`
          lastLabeledMonth = dayMonth
          lastLabeledColIndex = colIndex
          break
        }
      }

      cols.push({ weekIndex: colIndex, monthLabel, days: currentDays })
      currentDays = []
    }
  }

  if (currentDays.length > 0) {
    cols.push({ weekIndex: cols.length, days: currentDays })
  }

  return cols
})

// ─── 近7天趋势柱状图 ───
const last7DaysTrend = computed(() => {
  const dailyMap: Record<string, { durationSecs: number; listenSecs: number }> = {}
  for (const item of statsStore.summary?.dailyStats || []) {
    dailyMap[item.readDate] = {
      durationSecs: item.durationSecs,
      listenSecs: item.listenSecs,
    }
  }

  const todayStr = getTodayDateString()
  const today = new Date()
  const result = []

  let maxMinutes = 1
  for (let i = 6; i >= 0; i--) {
    const cur = new Date(today)
    cur.setDate(today.getDate() - i)
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${d}`
    const stat = dailyMap[dateStr] || { durationSecs: 0, listenSecs: 0 }
    const minutes = Math.round(stat.durationSecs / 60)
    if (minutes > maxMinutes) maxMinutes = minutes
  }

  for (let i = 6; i >= 0; i--) {
    const cur = new Date(today)
    cur.setDate(today.getDate() - i)
    const y = cur.getFullYear()
    const m = String(cur.getMonth() + 1).padStart(2, '0')
    const d = String(cur.getDate()).padStart(2, '0')
    const dateStr = `${y}-${m}-${d}`

    const stat = dailyMap[dateStr] || { durationSecs: 0, listenSecs: 0 }
    const minutes = Math.round(stat.durationSecs / 60)
    const listenMinutes = Math.round(stat.listenSecs / 60)
    const readMinutes = Math.max(0, minutes - listenMinutes)

    const listenPercent = Math.min(100, Math.round((listenMinutes / maxMinutes) * 100))
    const readPercent = Math.min(100, Math.round((readMinutes / maxMinutes) * 100))

    result.push({
      date: dateStr,
      label: i === 0 ? '今天' : `${m}/${d}`,
      minutes,
      listenMinutes,
      readMinutes,
      listenPercent,
      readPercent,
      isToday: dateStr === todayStr,
    })
  }

  return result
})

function parseRecentTimestamp(val: number | string | undefined): number {
  if (!val) return 0
  if (typeof val === 'number') {
    return val > 1e11 ? val : val * 1000
  }
  const num = Number(val)
  if (!isNaN(num) && num > 0) {
    return num > 1e11 ? num : num * 1000
  }
  const parsed = new Date(val).getTime()
  return isNaN(parsed) ? 0 : parsed
}

// ─── 格式化最后阅读时间 ───
function formatLastReadText(item: { recentTimestamp?: number; lastReadDate?: string }): string {
  const ts = item.recentTimestamp
  if (!ts) return item.lastReadDate || '近期'
  const now = Date.now()
  const diff = now - ts
  if (diff <= 60 * 1000 && diff >= -10000) return '刚刚'
  if (diff < 60 * 60 * 1000 && diff > 0) return `${Math.floor(diff / (60 * 1000))} 分钟前`
  const targetDate = new Date(ts)
  const todayDate = new Date(now)
  if (
    targetDate.getFullYear() === todayDate.getFullYear() &&
    targetDate.getMonth() === todayDate.getMonth() &&
    targetDate.getDate() === todayDate.getDate()
  ) {
    const hh = String(targetDate.getHours()).padStart(2, '0')
    const mm = String(targetDate.getMinutes()).padStart(2, '0')
    return `今天 ${hh}:${mm}`
  }
  return item.lastReadDate || '近期'
}

// ─── 书籍列表与结合书架信息 ───
const filteredBookList = computed(() => {
  const shelfMap = new Map(shelfStore.books.map((b) => [b.bookUrl, b]))
  const shelfOrderMap = new Map(shelfStore.books.map((b, i) => [b.bookUrl, i]))
  const recentList = loadRecentReadBooks()
  const recentMap = new Map(
    recentList.map((b) => [b.bookUrl, b.recentReadAt || b.durChapterTime || 0]),
  )
  const localStats = loadLocalReadingStats()

  // 1. 初始化聚合 Map，优先以服务端实际读过（时长>0）的 bookStats 为基底
  const mergedMap = new Map<string, any>()
  for (const item of statsStore.bookStats) {
    if (item.totalDurationSecs > 0) {
      mergedMap.set(item.bookUrl, { ...item })
    }
  }

  // 2. 本地缓存中若有产生有效阅读时长（>0秒）的书目（如刚短读退出但尚未拉取全量列表），平滑并入
  for (const [url, lb] of Object.entries(localStats.books)) {
    if (lb.totalDurationSecs > 0) {
      const existing = mergedMap.get(url)
      if (existing) {
        if (lb.totalDurationSecs > existing.totalDurationSecs) {
          existing.totalDurationSecs = lb.totalDurationSecs
        }
        if (lb.totalListenSecs > existing.totalListenSecs) {
          existing.totalListenSecs = lb.totalListenSecs
        }
        if (lb.lastReadAt) {
          existing.lastReadTime = Math.max(
            parseRecentTimestamp(existing.lastReadTime),
            lb.lastReadAt,
          )
        }
      } else {
        mergedMap.set(url, {
          bookUrl: lb.bookUrl,
          bookName: lb.bookName,
          author: lb.author || '',
          coverUrl: lb.coverUrl,
          totalDurationSecs: lb.totalDurationSecs,
          totalListenSecs: lb.totalListenSecs,
          firstReadDate: lb.lastReadDate,
          lastReadDate: lb.lastReadDate,
          lastReadTime: lb.lastReadAt,
          totalDays: 1,
          totalChaptersRead: 0,
        })
      }
    }
  }

  // 3. 仲裁每本书的高精度毫秒阅读时间戳
  let list = Array.from(mergedMap.values()).map((item) => {
    const shelfBook = shelfMap.get(item.bookUrl)
    const shelfIndex = shelfOrderMap.get(item.bookUrl)

    // 综合仲裁毫秒级最新阅读时间戳
    let recentTimestamp = 0
    if (shelfBook?.durChapterTime) {
      recentTimestamp = Math.max(recentTimestamp, parseRecentTimestamp(shelfBook.durChapterTime))
    }
    const rTime = recentMap.get(item.bookUrl)
    if (rTime) {
      recentTimestamp = Math.max(recentTimestamp, parseRecentTimestamp(rTime))
    }
    const localBook = localStats.books[item.bookUrl]
    if (localBook?.lastReadAt) {
      recentTimestamp = Math.max(recentTimestamp, parseRecentTimestamp(localBook.lastReadAt))
    }
    if (item.lastReadTime) {
      recentTimestamp = Math.max(recentTimestamp, parseRecentTimestamp(item.lastReadTime))
    }
    if (!recentTimestamp && item.lastReadDate) {
      recentTimestamp = Math.max(recentTimestamp, parseRecentTimestamp(item.lastReadDate))
    }

    return {
      ...item,
      shelfBook,
      shelfIndex,
      recentTimestamp,
    }
  })

  // 4. 核心准则：阅读时长档案必须且仅须保留实际产生过阅读时长（>0秒）的书籍，未读图书坚决不予展示
  list = list.filter((b) => b.totalDurationSecs > 0)

  // 5. 搜索
  const kw = searchKeyword.value.toLowerCase().trim()
  if (kw) {
    list = list.filter(
      (b) =>
        b.bookName.toLowerCase().includes(kw) ||
        (b.author && b.author.toLowerCase().includes(kw)),
    )
  }

  // 6. 排序
  if (sortBy.value === 'duration') {
    list.sort((a, b) => b.totalDurationSecs - a.totalDurationSecs)
  } else {
    list.sort((a, b) => {
      if (b.recentTimestamp !== a.recentTimestamp) {
        return b.recentTimestamp - a.recentTimestamp
      }
      const aIdx = a.shelfIndex ?? 9999
      const bIdx = b.shelfIndex ?? 9999
      return aIdx - bIdx
    })
  }

  return list
})

// ─── 继续阅读操作 ───
async function handleContinueRead(bookUrl: string) {
  if (openingBookUrl.value) return
  openingBookUrl.value = bookUrl

  try {
    let book = shelfStore.books.find((b) => b.bookUrl === bookUrl)
    if (!book) {
      const recent = loadRecentReadBooks().find((b) => b.bookUrl === bookUrl)
      if (recent) {
        book = recent
      }
    }
    if (!book) {
      const rawStat = statsStore.bookStats.find((b) => b.bookUrl === bookUrl)
      if (rawStat) {
        book = {
          name: rawStat.bookName,
          author: rawStat.author,
          bookUrl: rawStat.bookUrl,
          origin: 'local',
          coverUrl: rawStat.coverUrl,
        }
      }
    }
    if (!book) return

    void shelfStore.moveBookToFront(book.bookUrl).catch(() => undefined)
    const loadTask = readerStore.loadBook(book)
    await router.push('/reader')
    await loadTask
    await readerStore.loadChapter(readerStore.currentIndex)
  } catch (err) {
    console.error('[StatsView] Failed to open book:', err)
  } finally {
    openingBookUrl.value = ''
  }
}
</script>

<style scoped>
.stats-view {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.stats-content {
  height: 100%;
  max-width: var(--content-max-width);
  margin: 0 auto;
  padding: 0 var(--space-6);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.stats-header {
  padding: var(--space-6) 0 var(--space-3);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  flex-shrink: 0;
}

.stats-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text);
  display: flex;
  align-items: baseline;
  gap: 10px;
}

.stats-subtitle {
  font-size: var(--text-sm);
  font-weight: 400;
  color: var(--color-text-tertiary);
}

.stats-actions {
  display: flex;
  align-items: center;
}

.stats-refresh-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-border-light);
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  box-shadow: var(--shadow-xs);
}

.stats-refresh-btn:hover:not(:disabled) {
  border-color: var(--color-primary-border);
  color: var(--color-primary);
}

.refresh-icon {
  width: 16px;
  height: 16px;
}

.refresh-icon.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.stats-scroll-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding-top: 8px;
  padding-bottom: 90px;
  display: flex;
  flex-direction: column;
  gap: var(--space-4);
}

/* 0. Focus Banner */
.focus-book-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  border-radius: var(--radius-lg);
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  box-shadow: var(--shadow-xs);
  margin-bottom: 2px;
}

.focus-banner-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.focus-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #fff;
  flex-shrink: 0;
}

.focus-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.focus-reset-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-primary-border);
  background: var(--color-bg-elevated);
  color: var(--color-primary);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--duration-fast) var(--ease-out);
  flex-shrink: 0;
}

.focus-reset-btn:hover {
  background: var(--color-primary);
  color: #fff;
}

.focus-reset-btn svg {
  width: 12px;
  height: 12px;
}

/* 1. KPI Grid */
.kpi-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  padding: 4px;
  margin: -4px 0 0 0;
}

.kpi-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  padding: 16px;
  box-shadow: var(--shadow-sm);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  transition: transform var(--duration-fast) var(--ease-out), box-shadow var(--duration-fast) var(--ease-out);
}

.kpi-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.kpi-card.highlight {
  border-color: var(--color-primary-border);
  background: linear-gradient(180deg, var(--color-primary-bg) 0%, var(--color-bg-elevated) 100%);
}

.kpi-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.kpi-label {
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
  font-weight: 500;
}

.kpi-icon {
  width: 18px;
  height: 18px;
  color: var(--color-primary);
  opacity: 0.85;
}

.kpi-icon.accent-fire {
  color: #ff5722;
}

.kpi-value-row {
  margin: 10px 0 6px;
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.kpi-val {
  font-size: var(--text-xl);
  font-weight: 700;
  color: var(--color-text);
  letter-spacing: -0.02em;
}

.kpi-val.kpi-chapter-val {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-primary);
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.kpi-unit {
  font-size: var(--text-xs);
  color: var(--color-text-tertiary);
}

.kpi-subtext {
  font-size: 11px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Common Section Card */
.section-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  padding: 18px;
  box-shadow: var(--shadow-sm);
}

.section-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--color-text);
}

.section-title svg {
  width: 18px;
  height: 18px;
  color: var(--color-primary);
}

/* 2. Heatmap */
.heatmap-header-stats {
  display: flex;
  align-items: center;
  gap: 16px;
}

.active-summary {
  font-size: 12px;
  color: var(--color-text-secondary);
}

.active-summary strong {
  color: var(--color-primary);
  font-weight: 600;
}

.heatmap-legend {
  display: flex;
  align-items: center;
  gap: 4px;
}

.legend-text {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.legend-cell {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.heatmap-container {
  overflow-x: auto;
  padding: 6px 0;
  -webkit-overflow-scrolling: touch;
}

.heatmap-main-wrapper {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  width: max-content;
  margin: 0 auto;
}

.heatmap-weekdays {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 18px; /* 留出对齐月份文字的高度 */
  user-select: none;
}

.weekday-item {
  height: 13px;
  line-height: 13px;
  font-size: 9px;
  color: var(--color-text-tertiary);
  text-align: right;
  width: 12px;
}

.heatmap-content-col {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.heatmap-months-row {
  display: flex;
  gap: 4px;
  height: 14px;
}

.heatmap-month-cell {
  width: 13px;
  position: relative;
}

.month-label-text {
  position: absolute;
  left: 0;
  top: 0;
  font-size: 10px;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  user-select: none;
}

.heatmap-grid {
  display: flex;
  gap: 4px;
  width: max-content;
}

.heatmap-column {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.heatmap-cell {
  width: 13px;
  height: 13px;
  border-radius: 3px;
  background: var(--color-bg-sunken);
  cursor: pointer;
  transition: transform 120ms ease, opacity 120ms ease;
}

.heatmap-cell:hover {
  transform: scale(1.3);
  z-index: 2;
}

.heatmap-cell.level-0,
.legend-cell.level-0 {
  background: var(--color-bg-sunken);
}

.heatmap-cell.level-1,
.legend-cell.level-1 {
  background: rgba(212, 129, 42, 0.22);
}

.heatmap-cell.level-2,
.legend-cell.level-2 {
  background: rgba(212, 129, 42, 0.48);
}

.heatmap-cell.level-3,
.legend-cell.level-3 {
  background: rgba(212, 129, 42, 0.75);
}

.heatmap-cell.level-4,
.legend-cell.level-4 {
  background: var(--color-primary);
}

.heatmap-cell.today {
  outline: 1.5px solid var(--color-primary);
}

.selected-date-banner {
  margin-top: 12px;
  padding: 8px 14px;
  border-radius: var(--radius-md);
  background: var(--color-primary-bg);
  border: 1px solid var(--color-primary-border);
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--text-xs);
}

.banner-date {
  font-weight: 600;
  color: var(--color-primary);
}

.banner-stat {
  color: var(--color-text);
  flex: 1;
}

.banner-close {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  color: var(--color-text-secondary);
}

/* 3. Trend Chart */
.chart-container {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 12px;
  height: 140px;
  align-items: flex-end;
  padding-top: 24px;
}

.chart-bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  height: 100%;
  justify-content: flex-end;
  gap: 6px;
}

.bar-value {
  font-size: 10px;
  color: var(--color-text-tertiary);
  font-weight: 500;
  height: 14px;
}

.trend-legend {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--color-text-tertiary);
  user-select: none;
}

.trend-legend .legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.trend-legend .legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.trend-legend .legend-dot.read-dot {
  background: var(--color-primary);
}

.trend-legend .legend-dot.listen-dot {
  background: #3b82f6;
}

.bar-track {
  width: 18px;
  flex: 1;
  background: var(--color-bg-sunken);
  border-radius: var(--radius-full);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  overflow: hidden;
}

.bar-fill.read-fill {
  background: var(--color-primary);
  width: 100%;
  transition: height 300ms ease;
}

.bar-fill.listen-fill {
  background: #3b82f6;
  width: 100%;
  transition: height 300ms ease;
}

.bar-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.bar-label.today {
  color: var(--color-primary);
  font-weight: 600;
}

/* 4. Book List */
.books-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.books-count {
  font-size: var(--text-sm);
  color: var(--color-text-tertiary);
  font-weight: 400;
}

.books-filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sort-select-wrapper {
  min-width: 124px;
}

.sort-custom-select :deep(.select-trigger) {
  min-height: 30px;
  height: 30px;
  padding: 3px 10px;
  border-radius: var(--radius-full);
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.sort-custom-select :deep(.selected-label) {
  font-size: var(--text-xs);
}

.sort-custom-select :deep(.select-arrow) {
  width: 14px;
  height: 14px;
  opacity: 0.6;
}

.sort-custom-select :deep(.select-dropdown) {
  border-radius: var(--radius-md);
  font-size: var(--text-xs);
  z-index: 30;
  box-shadow: var(--shadow-md);
}

.sort-custom-select :deep(.select-option) {
  font-size: var(--text-xs);
  padding: 7px 12px;
}

.book-search-box {
  margin-bottom: 14px;
}

.book-search-input {
  width: 100%;
  border: 1px solid var(--color-border-light);
  background: var(--color-bg);
  border-radius: 12px;
  padding: 10px 14px;
  font-size: var(--text-xs);
  color: var(--color-text);
  outline: none;
}

.book-search-input:focus {
  border-color: var(--color-primary-border);
}

.book-stats-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.book-stat-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border-radius: var(--radius-lg);
  background: var(--color-bg);
  border: 1px solid var(--color-border-light);
  transition: all var(--duration-fast) var(--ease-out);
}

.book-stat-item:hover {
  border-color: var(--color-primary-border);
}

.book-stat-item.active-focus {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
  box-shadow: 0 0 0 1px var(--color-primary-border), var(--shadow-sm);
}

/* 左侧主体：点击触发单书聚焦 */
.item-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 14px;
  cursor: pointer;
  border-radius: var(--radius-md);
  padding: 2px 4px;
  margin: -2px -4px;
  transition: opacity var(--duration-fast);
}

.item-main:active {
  opacity: 0.8;
}

.focused-pill {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: var(--radius-full);
  background: var(--color-primary);
  color: #ffffff;
  font-weight: 500;
  flex-shrink: 0;
}

.item-cover {
  width: 44px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  flex-shrink: 0;
  background: var(--color-bg-sunken);
}

.item-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.item-cover-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
  color: var(--color-primary);
  background: var(--color-primary-bg);
}

.item-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item-name-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.item-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-progress-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--color-bg-sunken);
  color: var(--color-text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.item-author {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 2px;
}

.meta-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
}

.meta-tag.duration {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.meta-tag.listen {
  background: rgba(74, 144, 217, 0.1);
  color: #2b7bc4;
}

.meta-date {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

/* 右侧独立操作区 */
.item-action {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding-left: 4px;
}

.continue-btn {
  padding: 7px 16px;
  min-height: 34px;
  border-radius: var(--radius-full);
  border: 1px solid var(--color-primary-border);
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  touch-action: manipulation;
  transition: all var(--duration-fast) var(--ease-out);
}

.continue-btn:hover:not(:disabled) {
  background: var(--color-primary);
  color: #ffffff;
}

.continue-btn:active:not(:disabled) {
  transform: scale(0.96);
}

.continue-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.empty-state {
  padding: 40px 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}

.empty-state svg {
  width: 32px;
  height: 32px;
  opacity: 0.5;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .kpi-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 640px) {
  .stats-content {
    padding: 0 16px;
  }
  .stats-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .stats-actions {
    width: 100%;
    justify-content: flex-end;
  }
  .section-card {
    padding: 14px;
  }
  .active-summary {
    display: none;
  }
  .heatmap-weekdays {
    display: none;
  }
  .heatmap-container {
    display: flex;
    justify-content: center;
    overflow-x: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }
  .heatmap-container::-webkit-scrollbar {
    display: none;
  }
  .heatmap-main-wrapper {
    margin: 0 auto;
  }
  .heatmap-grid {
    margin: 0 auto;
  }
}
</style>

