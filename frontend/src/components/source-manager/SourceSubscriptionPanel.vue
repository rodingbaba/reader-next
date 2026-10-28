<template>
  <Transition name="fade">
    <div v-if="visible" class="subscription-backdrop" @click.self="$emit('close')">
      <section class="subscription-panel">
        <header class="subscription-header">
          <div>
            <h3>远程书源同步</h3>
            <p>保存书源合集链接，后续可以一键同步更新。</p>
          </div>
          <button class="icon-btn" type="button" title="关闭" @click="$emit('close')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="remote-form">
          <input
            :value="remoteUrl"
            type="text"
            class="remote-url-input"
            placeholder="输入远程书源合集链接 (URL)"
            @input="$emit('update:remoteUrl', ($event.target as HTMLInputElement).value)"
          />
          <input
            :value="remoteTitle"
            type="text"
            class="remote-title-input"
            placeholder="合集别名 (可选)"
            @input="$emit('update:remoteTitle', ($event.target as HTMLInputElement).value)"
          />
          <div class="remote-btn-group">
            <button class="action-btn primary" type="button" @click="$emit('sync')">立即同步</button>
            <button class="action-btn" type="button" @click="$emit('save')">保存订阅</button>
          </div>
        </div>

        <div v-if="subscriptions.length" class="subscription-list">
          <article v-for="item in subscriptions" :key="item.url" class="subscription-item">
            <div class="subscription-main">
              <div class="subscription-title-row">
                <span v-if="item.title" class="subscription-title">{{ item.title }}</span>
                <span class="subscription-url" :class="{ 'as-secondary': !!item.title }">{{ item.url }}</span>
                <button
                  class="edit-alias-btn"
                  type="button"
                  :title="item.title ? '修改别名' : '设置别名'"
                  @click="handleEditAlias(item)"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  <span class="btn-text">{{ item.title ? '改名' : '设别名' }}</span>
                </button>
              </div>
              <span v-if="item.lastSyncedAt" class="subscription-time">上次同步 {{ formatTime(item.lastSyncedAt) }}</span>
            </div>
            <div class="subscription-actions">
              <button class="mini-btn" type="button" @click="$emit('sync-subscription', item.url)">同步</button>
              <button class="mini-btn danger" type="button" @click="$emit('remove-subscription', item.url)">删除</button>
            </div>
          </article>
        </div>
        <div v-else class="subscription-empty">还没有保存的远程订阅。</div>
      </section>
    </div>
  </Transition>
</template>

<script setup lang="ts">
export type SourceSubscription = {
  url: string
  title?: string
  lastSyncedAt?: number
}

defineProps<{
  visible: boolean
  remoteUrl: string
  remoteTitle?: string
  subscriptions: SourceSubscription[]
}>()

const emit = defineEmits<{
  'update:remoteUrl': [value: string]
  'update:remoteTitle': [value: string]
  sync: []
  save: []
  'sync-subscription': [url: string]
  'update-subscription-title': [payload: { url: string; title: string }]
  'remove-subscription': [url: string]
  close: []
}>()

function formatTime(ts: number) {
  return new Date(ts).toLocaleString()
}

function handleEditAlias(item: SourceSubscription) {
  const current = item.title || ''
  const input = window.prompt('设置合集别名：', current)
  if (input !== null) {
    emit('update-subscription-title', { url: item.url, title: input.trim() })
  }
}
</script>

<style scoped>
.subscription-backdrop {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z-modal) + 1);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.28);
}

.subscription-panel {
  width: min(760px, 100%);
  max-height: min(78vh, 720px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 20px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-xl);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-xl);
  overflow: auto;
}

.subscription-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.subscription-header h3 {
  margin: 0;
  font-size: 17px;
}

.subscription-header p {
  margin-top: 6px;
  color: var(--color-text-tertiary);
  font-size: 13px;
}

.remote-form {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.remote-url-input {
  flex: 2 1 240px;
  min-width: 0;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  font-size: 13px;
}

.remote-title-input {
  flex: 1 1 150px;
  min-width: 0;
  min-height: 40px;
  padding: 0 12px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-bg);
  font-size: 13px;
}

.remote-btn-group {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.subscription-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.subscription-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-lg);
  background: var(--color-bg);
}

.subscription-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.subscription-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.subscription-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
}

.subscription-url {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subscription-url.as-secondary {
  font-size: 12px;
  color: var(--color-text-tertiary);
}

.edit-alias-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border: 1px solid var(--color-border-light);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: 11px;
  cursor: pointer;
  transition: all var(--duration-fast);
  white-space: nowrap;
}

.edit-alias-btn svg {
  width: 12px;
  height: 12px;
}

.edit-alias-btn:hover {
  color: var(--color-primary);
  border-color: var(--color-primary-border);
  background: var(--color-bg-hover);
}

.subscription-time,
.subscription-empty {
  margin-top: 4px;
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.subscription-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn,
.mini-btn,
.icon-btn {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: transparent;
  transition: all var(--duration-fast);
}

.action-btn {
  min-height: 40px;
  padding: 0 12px;
  font-size: 13px;
  white-space: nowrap;
}

.action-btn.primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.mini-btn {
  min-height: 32px;
  padding: 0 10px;
  font-size: 12px;
}

.mini-btn.danger {
  color: var(--color-danger);
  border-color: rgba(245, 34, 45, 0.2);
}

.icon-btn {
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.action-btn:hover,
.mini-btn:hover,
.icon-btn:hover {
  background: var(--color-bg-hover);
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity var(--duration-normal) var(--ease-out);
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .subscription-backdrop {
    padding: 12px;
  }

  .remote-form,
  .subscription-item {
    flex-direction: column;
    align-items: stretch;
  }

  .remote-btn-group {
    width: 100%;
  }

  .remote-btn-group button {
    flex: 1;
  }
}
</style>
