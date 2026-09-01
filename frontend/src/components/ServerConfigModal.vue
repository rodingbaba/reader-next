<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="modelValue" class="modal-overlay" @click="close"></div>
    </Transition>
    <Transition name="scale">
      <div v-if="modelValue" class="modal-container">
        <div class="login-modal">
          <div class="modal-header">
            <div class="modal-logo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
            </div>
            <h2>连接服务端</h2>
            <p class="modal-desc">首次启动需要绑定您的专属阅读服务器</p>
          </div>

          <form class="login-form" @submit.prevent="handleSubmit">
            <div class="form-field">
              <label for="server-url">服务器地址</label>
              <input
                id="server-url"
                v-model="form.serverUrl"
                type="url"
                placeholder="例如: http://192.168.1.100:18080"
                required
              />
            </div>
            <div class="form-field">
              <label for="admin-username">登录账号</label>
              <input
                id="admin-username"
                v-model="form.username"
                type="text"
                placeholder="默认管理员账号"
                required
              />
            </div>
            <div class="form-field">
              <label for="admin-password">登录密码</label>
              <input
                id="admin-password"
                v-model="form.password"
                type="password"
                placeholder="密码"
                required
              />
            </div>

            <button type="submit" class="submit-btn" :disabled="submitting">
              <span v-if="submitting" class="btn-spinner"></span>
              连接并自动登录
            </button>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useAppStore } from '../stores/app'
import { useBookshelfStore } from '../stores/bookshelf'
import { useReaderStore } from '../stores/reader'
import { login } from '../api/user'
import http from '../api/http'

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const appStore = useAppStore()
const shelfStore = useBookshelfStore()
const readerStore = useReaderStore()

const submitting = ref(false)

// 如果之前存了包含 /reader3 的路径，回显时去掉它
let initialUrl = localStorage.getItem('server_base_url') || ''
if (initialUrl.endsWith('/reader3')) {
  initialUrl = initialUrl.slice(0, -8)
}

// 针对单用户默认部署预填 admin/123456
const form = reactive({
  serverUrl: initialUrl,
  username: 'admin',
  password: '123456',
})

function close() {
  // If no URL is saved yet, don't allow closing
  if (!localStorage.getItem('server_base_url')) {
    appStore.showToast('必须先配置服务端地址', 'warning')
    return
  }
  emit('update:modelValue', false)
}

async function handleSubmit() {
  if (!form.serverUrl) return
  submitting.value = true
  
  // 处理结尾的反斜杠并自动补全 /reader3
  let url = form.serverUrl.trim()
  if (url.endsWith('/')) {
    url = url.slice(0, -1)
  }
  if (!url.endsWith('/reader3')) {
    url += '/reader3'
  }
  
  try {
    // 保存地址并强制更新 Axios
    localStorage.setItem('server_base_url', url)
    http.defaults.baseURL = url
    
    // 静默尝试登录
    const user = await login(form.username, form.password)
    appStore.setUser(user)
    appStore.showToast('连接并登录成功！', 'success')
    
    emit('update:modelValue', false)
    
    shelfStore.fetchBooks()
    shelfStore.fetchGroups()
    readerStore.initSpeechConfig()
  } catch (e: unknown) {
    appStore.showToast('服务器连接失败或账号错误：' + ((e as Error).message || '未知错误'), 'error')
    // 如果登录失败，回退到只保存地址并关闭，唤起正常登录框
    emit('update:modelValue', false)
    window.dispatchEvent(new CustomEvent('need-login'))
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
/* 同 LoginModal.vue 样式以保持一致 */
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
}
.login-modal {
  width: 100%;
  max-width: 400px;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-xl);
  padding: var(--space-8);
  position: relative;
  box-shadow: var(--shadow-xl);
  max-height: min(720px, calc(100dvh - var(--safe-area-top) - var(--safe-area-bottom) - 32px));
  overflow-y: auto;
}
.modal-header {
  text-align: center;
  margin-bottom: var(--space-8);
}
.modal-logo {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--color-primary-bg);
  color: var(--color-primary);
  margin-bottom: var(--space-4);
}
.modal-header h2 {
  font-size: var(--text-2xl);
  font-weight: 700;
  margin-bottom: var(--space-2);
}
.modal-desc {
  color: var(--color-text-tertiary);
  font-size: var(--text-sm);
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.form-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.form-field label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--color-text-secondary);
}
.form-field input {
  padding: var(--space-3) var(--space-4);
  border: 1.5px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  outline: none;
  font-size: var(--text-base);
}
.form-field input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 3px var(--color-primary-bg);
}
.submit-btn {
  padding: var(--space-3) var(--space-6);
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  font-size: var(--text-base);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  border: none;
  cursor: pointer;
}
.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
