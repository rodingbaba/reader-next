<template>
  <div id="app">
    <AppTopBar v-if="showHeader" />
    <main class="app-main" :class="{ 'with-bottom-nav': showBottomNav, 'without-header': !showHeader }">
      <router-view v-slot="{ Component }">
        <keep-alive :include="['HomeView', 'ExploreView', 'StatsView']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
    <AppBottomNav v-if="showBottomNav" />
    <!-- 废弃 ServerConfigModal：统一由 LoginModal 承载服务器地址 + 登录 -->
    <SettingsDrawer v-model="appStore.showSettingsDrawer" />
    <LoginModal v-model="appStore.showLoginModal" />
    <SourceManager v-model="appStore.showSourceManager" />
    <UserManager v-model="appStore.showUserManager" />
    <WebdavManager v-model="appStore.showWebdavManager" />

    <!-- Toast notifications -->
    <div class="toast-container">
      <TransitionGroup name="slide-up">
        <div
          v-for="toast in appStore.toasts"
          :key="toast.id"
          class="toast"
          :class="toast.type"
        >
          {{ toast.message }}
        </div>
      </TransitionGroup>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAppStore } from './stores/app'
import AppTopBar from './components/AppTopBar.vue'
import AppBottomNav from './components/AppBottomNav.vue'
import SettingsDrawer from './components/SettingsDrawer.vue'
import LoginModal from './components/LoginModal.vue'
import SourceManager from './components/SourceManager.vue'
import UserManager from './components/UserManager.vue'
import WebdavManager from './components/WebdavManager.vue'
import { isNativeApp } from './utils/nativeBridge'
import { flushAllPendingHeartbeats } from './utils/readingTracker'

const route = useRoute()
const appStore = useAppStore()
let heartbeatSyncTimer: number | null = null

function triggerGlobalHeartbeatSync() {
  void flushAllPendingHeartbeats({ timeout: 2500 })
}

const showHeader = computed(() => route.name !== 'reader')
const showBottomNav = computed(() => route.name !== 'reader')

// 启动逻辑：App 首次启动无 server_base_url 时直接弹出一体化 LoginModal；
// 否则后台异步校验登录态（isLoggedIn 已从本地缓存恢复，不等待网络）
onMounted(() => {
  if (isNativeApp() && !localStorage.getItem('server_base_url')) {
    appStore.showLoginModal = true
  } else {
    // 后台静默校验登录态；断网不会重置 isLoggedIn，不阻塞 UI
    void appStore.fetchUserInfo()
  }

  window.addEventListener('need-login', handleNeedLogin)
  window.addEventListener('online', triggerGlobalHeartbeatSync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      triggerGlobalHeartbeatSync()
    }
  })
  // 前台每 45 秒静默触发一次未同步增量心跳排空
  heartbeatSyncTimer = window.setInterval(triggerGlobalHeartbeatSync, 45000)
  triggerGlobalHeartbeatSync()
})

// need-login 事件：仅在服务端明确返回 401/NEED_LOGIN 时由 http.ts 派发
// 网络断开/超时一律不触发，避免离线误跳登录
async function handleNeedLogin() {
  // 凭证失效，先清理本地凭证（含 userInfo 缓存）
  appStore.clearUser()
  // 弹出一体化 LoginModal，让用户重新输入地址 + 账号密码
  appStore.showLoginModal = true
}

onUnmounted(() => {
  window.removeEventListener('need-login', handleNeedLogin)
  window.removeEventListener('online', triggerGlobalHeartbeatSync)
  if (heartbeatSyncTimer) {
    clearInterval(heartbeatSyncTimer)
    heartbeatSyncTimer = null
  }
})
</script>

<style>
html,
body {
  height: var(--app-height, 100dvh);
  overflow: hidden;
}

#app {
  height: var(--app-height, 100dvh);
  overflow: hidden;
}

.app-main {
  height: calc(var(--app-height, 100dvh) - var(--header-height) - var(--safe-area-top));
  min-height: 0;
  overflow: hidden;
}

.app-main.without-header {
  height: var(--app-height, 100dvh);
}

.app-main.with-bottom-nav {
  padding-bottom: 0;
  height: calc(var(--app-height, 100dvh) - var(--header-height) - var(--safe-area-top));
}
</style>
