import { defineStore } from 'pinia'
import { ref, watch, computed } from 'vue'
import { getUserInfo } from '../api/user'
import { dismissVersionUpdate, getVersionUpdate } from '../api/update'
import type { UserInfo, VersionUpdateInfo } from '../types'
import { applySystemTheme } from '../utils/systemUi'
import { computeNeedSecureKey, readStoredSecureKey, SECURE_KEY_STORAGE_KEY } from '../utils/secureAccess'
import { appLog } from '../utils/appLogger'

const USER_INFO_CACHE_KEY = 'reader_user_info_cache'

/** 从 localStorage 读取缓存的 userInfo（用于启动时秒级恢复登录态） */
function loadCachedUserInfo(): UserInfo | null {
  try {
    const raw = localStorage.getItem(USER_INFO_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<UserInfo>
    return {
      username: parsed.username ?? '',
      accessToken: '',
      isAdmin: parsed.isAdmin ?? false,
    } as UserInfo
  } catch {
    return null
  }
}

/** 仅持久化纯展示字段（username / isAdmin），不写敏感 token */
function persistUserInfo(user: UserInfo | null) {
  if (!user) {
    localStorage.removeItem(USER_INFO_CACHE_KEY)
    return
  }
  const safePayload = {
    username: user.username,
    isAdmin: user.isAdmin,
  }
  try {
    localStorage.setItem(USER_INFO_CACHE_KEY, JSON.stringify(safePayload))
  } catch (e) {
    console.warn('persistUserInfo 失败', e)
  }
}

export const useAppStore = defineStore('app', () => {
  const STATS_KEY = 'reader-stats'
  // ─── Theme ───
  const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null
  const legacyReaderNight = localStorage.getItem('reader-isNight') === 'true'
  const theme = ref<'light' | 'dark'>(
    savedTheme || (legacyReaderNight ? 'dark' : 'light')
  )
  const enabledUnreadBadgeBooks = ref<string[]>(JSON.parse(localStorage.getItem('enabledUnreadBadgeBooks') || '[]'))
  const enabledAiPanelBooks = ref<string[]>(JSON.parse(localStorage.getItem('enabledAiPanelBooks') || '[]'))

  function toggleUnreadBadge(bookUrl: string, enabled: boolean) {
    if (!enabled) {
      enabledUnreadBadgeBooks.value = enabledUnreadBadgeBooks.value.filter(u => u !== bookUrl)
    } else {
      if (!enabledUnreadBadgeBooks.value.includes(bookUrl)) {
        enabledUnreadBadgeBooks.value.push(bookUrl)
      }
    }
    localStorage.setItem('enabledUnreadBadgeBooks', JSON.stringify(enabledUnreadBadgeBooks.value))
  }

  function toggleAiPanel(bookUrl: string, enabled: boolean) {
    if (!enabled) {
      enabledAiPanelBooks.value = enabledAiPanelBooks.value.filter(u => u !== bookUrl)
    } else {
      if (!enabledAiPanelBooks.value.includes(bookUrl)) {
        enabledAiPanelBooks.value.push(bookUrl)
      }
    }
    localStorage.setItem('enabledAiPanelBooks', JSON.stringify(enabledAiPanelBooks.value))
  }

  function setTheme(value: 'light' | 'dark') {
    theme.value = value
    localStorage.setItem('theme', value)
    applySystemTheme(value)
  }

  function toggleTheme() {
    setTheme(theme.value === 'light' ? 'dark' : 'light')
  }

  watch(theme, (val) => {
    localStorage.setItem('theme', val)
    applySystemTheme(val)
  }, { immediate: true })

  // ─── User ───
  // 启动时从本地缓存恢复 userInfo（不等待网络请求）
  const userInfo = ref<UserInfo | null>(loadCachedUserInfo())
  const isSecureMode = ref(false)
  const needSecureKey = ref(false)
  const secureKeyRequired = ref(false)
  const adminAuthorized = ref(false)
  // isLoggedIn 初始化：只要本地有 accessToken 与 userInfo，立即视为已登录
  const isLoggedIn = ref(!!localStorage.getItem('accessToken') && !!userInfo.value)
  const secureKey = ref(readStoredSecureKey())
  const versionUpdate = ref<VersionUpdateInfo | null>(null)
  const versionUpdateLoading = ref(false)
  const versionUpdateChecked = ref(false)
  let versionUpdateToastVersion = ''
  const canCheckVersionUpdate = computed(() => !isSecureMode.value || adminAuthorized.value)
  const hasVersionUpdateReminder = computed(() => !!versionUpdate.value?.shouldRemind)

  async function fetchUserInfo() {
    try {
      const data = await getUserInfo()
      userInfo.value = data.userInfo
      isSecureMode.value = data.secure
      secureKeyRequired.value = data.secureKeyRequired
      adminAuthorized.value = data.adminAuthorized
      needSecureKey.value = computeNeedSecureKey({
        secure: data.secure,
        secureKeyRequired: data.secureKeyRequired,
        adminAuthorized: data.adminAuthorized,
      })
      isLoggedIn.value = !!data.userInfo?.username
      // 成功时刷新本地 userInfo 缓存
      persistUserInfo(data.userInfo ?? null)
      if (canCheckVersionUpdate.value) {
        void checkVersionUpdate()
      }
    } catch {
      // 关键：网络错误不重置 isLoggedIn（离线/超时不应触发未登录态）
      // 仅当确认为 401 / NEED_LOGIN 时才清理凭证，由 http.ts 拦截器统一处理
    }
  }

  function setUser(user: UserInfo) {
    userInfo.value = user
    isLoggedIn.value = true
    adminAuthorized.value = adminAuthorized.value || !!user.isAdmin
    needSecureKey.value = computeNeedSecureKey({
      secure: isSecureMode.value,
      secureKeyRequired: secureKeyRequired.value,
      adminAuthorized: adminAuthorized.value,
    })
    localStorage.setItem('accessToken', user.accessToken)
    // 同步持久化 userInfo 纯展示字段
    persistUserInfo(user)
    if (canCheckVersionUpdate.value) {
      void checkVersionUpdate()
    }
  }

  function clearUser() {
    userInfo.value = null
    isLoggedIn.value = false
    localStorage.removeItem('accessToken')
    // 一并清理 userInfo 缓存，防止残留
    persistUserInfo(null)
  }

  function setSecureKey(value: string) {
    const next = value.trim()
    secureKey.value = next
    if (next) {
      localStorage.setItem(SECURE_KEY_STORAGE_KEY, next)
    } else {
      localStorage.removeItem(SECURE_KEY_STORAGE_KEY)
    }
  }

  function updateUserInfo(next: UserInfo | null) {
    userInfo.value = next
    isLoggedIn.value = !!next?.username
    persistUserInfo(next)
  }

  async function checkVersionUpdate(force = false) {
    if (versionUpdateLoading.value) return versionUpdate.value
    versionUpdateLoading.value = true
    try {
      const info = await getVersionUpdate(force)
      versionUpdate.value = info
      versionUpdateChecked.value = true
      if (info.shouldRemind && info.latestVersion && versionUpdateToastVersion !== info.latestVersion) {
        versionUpdateToastVersion = info.latestVersion
        showToast(`发现服务端新版本 ${info.latestVersion}`, 'warning')
      }
      return info
    } catch (error) {
      if (force) {
        showToast((error as Error).message || '检查更新失败', 'error')
      }
      return null
    } finally {
      versionUpdateLoading.value = false
    }
  }

  async function dismissVersionUpdateReminder(version = versionUpdate.value?.latestVersion || '') {
    if (!version) {
      showToast('当前没有可忽略的版本', 'warning')
      return null
    }
    versionUpdateLoading.value = true
    try {
      const info = await dismissVersionUpdate(version)
      versionUpdate.value = info
      versionUpdateToastVersion = version
      showToast('已忽略当前版本更新提醒', 'success')
      return info
    } catch (error) {
      showToast((error as Error).message || '忽略版本失败', 'error')
      return null
    } finally {
      versionUpdateLoading.value = false
    }
  }

  // ─── UI State ───
  // 废弃 ServerConfigModal：移除 showServerConfigModal，统一由 LoginModal 承载
  const showLoginModal = ref(false)
  const showSettingsDrawer = ref(false)
  const showSourceManager = ref(false)
  const showUserManager = ref(false)
  const showWebdavManager = ref(false)
  const isOnline = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
  // ─── PWA（保留字段，纯 Web 浏览器端向后兼容） ───
  // 设计文档 8.4 节明确 PWA 死代码清理为后续规划，当前保留以避免 SettingsDrawer.vue / pwa.ts 引用断裂
  const pwaReady = ref(false)
  const pwaUpdateAvailable = ref(false)
  const deferredInstallPrompt = ref<any>(null)
  const waitingServiceWorker = ref<ServiceWorker | null>(null)

  // 监听 online/offline 事件，断网/恢复时更新 isOnline
  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => {
      isOnline.value = true
      appLog('网络', '状态变更: 检测到【网络已连通 (在线)】')
      // 网络恢复：派发事件，触发 reader store 的 Outbox flush
      // （app.ts 不直接 import reader store 以避免循环依赖）
      window.dispatchEvent(new CustomEvent('reader-flush-outbox'))
    })
    window.addEventListener('offline', () => {
      isOnline.value = false
      appLog('网络', '状态变更: 检测到【处于离线模式 (断网/飞行模式)】')
    })
  }

  const initialReadingStats = (() => {
    try {
      return JSON.parse(localStorage.getItem(STATS_KEY) || '{"totalSeconds":0,"openedBooks":[],"readChapters":[],"completedBooks":[]}')
    } catch {
      return { totalSeconds: 0, openedBooks: [], readChapters: [], completedBooks: [] }
    }
  })()

  const readingStats = ref<{
    totalSeconds: number
    openedBooks: string[]
    readChapters: string[]
    completedBooks: string[]
  }>(initialReadingStats)
  let readingSessionStartedAt = 0

  function persistStats() {
    localStorage.setItem(STATS_KEY, JSON.stringify(readingStats.value))
  }

  function startReadingSession() {
    if (!readingSessionStartedAt) readingSessionStartedAt = Date.now()
  }

  function stopReadingSession() {
    if (!readingSessionStartedAt) return
    const delta = Math.max(0, Math.round((Date.now() - readingSessionStartedAt) / 1000))
    readingStats.value.totalSeconds += delta
    readingSessionStartedAt = 0
    persistStats()
  }

  function markBookOpened(bookUrl: string) {
    if (!readingStats.value.openedBooks.includes(bookUrl)) {
      readingStats.value.openedBooks.push(bookUrl)
      persistStats()
    }
  }

  function markChapterRead(bookUrl: string, index: number, totalChapters: number) {
    const key = `${bookUrl}#${index}`
    if (!readingStats.value.readChapters.includes(key)) {
      readingStats.value.readChapters.push(key)
    }
    if (totalChapters > 0 && index >= totalChapters - 1 && !readingStats.value.completedBooks.includes(bookUrl)) {
      readingStats.value.completedBooks.push(bookUrl)
    }
    persistStats()
  }

  const readingStatsSummary = computed(() => {
    const totalMinutes = Math.floor(readingStats.value.totalSeconds / 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return {
      totalSeconds: readingStats.value.totalSeconds,
      totalTimeText: hours ? `${hours}小时${minutes}分钟` : `${Math.max(1, totalMinutes)}分钟`,
      openedBooks: readingStats.value.openedBooks.length,
      readChapters: readingStats.value.readChapters.length,
      completedBooks: readingStats.value.completedBooks.length,
    }
  })

  // ─── Toast ───
  const toasts = ref<Array<{ id: number; message: string; type: string }>>([])
  let toastId = 0

  function showToast(message: string, type: 'success' | 'error' | 'warning' = 'success') {
    const id = ++toastId
    toasts.value.push({ id, message, type })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 3000)
  }

  function setOnlineStatus(value: boolean) {
    isOnline.value = value
  }

  // ─── PWA setters & actions ───
  function setPwaReady(value: boolean) {
    pwaReady.value = value
  }

  function setPwaUpdateAvailable(value: boolean) {
    pwaUpdateAvailable.value = value
  }

  function setWaitingServiceWorker(value: ServiceWorker | null) {
    waitingServiceWorker.value = value
  }

  function setDeferredInstallPrompt(value: any) {
    deferredInstallPrompt.value = value
  }

  async function installPwa() {
    if (!deferredInstallPrompt.value) return false
    deferredInstallPrompt.value.prompt()
    const result = await deferredInstallPrompt.value.userChoice.catch(() => null)
    deferredInstallPrompt.value = null
    return result?.outcome === 'accepted'
  }

  function applyPwaUpdate() {
    if (!waitingServiceWorker.value) return false
    waitingServiceWorker.value.postMessage({ type: 'SKIP_WAITING' })
    return true
  }

  return {
    theme, setTheme, toggleTheme,
    userInfo, isSecureMode, needSecureKey, secureKeyRequired, adminAuthorized, secureKey, isLoggedIn,
    versionUpdate, versionUpdateLoading, versionUpdateChecked, canCheckVersionUpdate, hasVersionUpdateReminder,
    fetchUserInfo, setUser, clearUser, setSecureKey, updateUserInfo, checkVersionUpdate, dismissVersionUpdateReminder,
    showLoginModal, showSettingsDrawer, showSourceManager, showUserManager, showWebdavManager,
    isOnline, setOnlineStatus,
    // PWA 相关字段（保留以避免 SettingsDrawer.vue / pwa.ts 引用断裂）
    pwaReady, pwaUpdateAvailable, deferredInstallPrompt, waitingServiceWorker,
    setPwaReady, setPwaUpdateAvailable, setDeferredInstallPrompt, setWaitingServiceWorker, installPwa, applyPwaUpdate,
    readingStats, readingStatsSummary, startReadingSession, stopReadingSession, markBookOpened, markChapterRead,
    toasts, showToast,
    enabledUnreadBadgeBooks, toggleUnreadBadge,
    enabledAiPanelBooks, toggleAiPanel,
  }
})
