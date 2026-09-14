import { describe, expect, it, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useReaderStore, CUSTOM_THEME_INDEX } from './reader'

describe('reader custom color theme', () => {
  beforeEach(() => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => storage.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => storage.set(key, value)),
      removeItem: vi.fn((key: string) => storage.delete(key)),
      clear: vi.fn(() => storage.clear()),
    })
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('initializes with default custom theme colors', () => {
    const store = useReaderStore()
    expect(store.config.customTheme).toBeDefined()
    expect(store.config.customTheme.body).toBe('#dbcfb6')
    expect(store.config.customTheme.fontColor).toBe('#2c2219')
  })

  it('switches to custom theme and outputs custom colors via currentTheme', () => {
    const store = useReaderStore()
    store.setThemeIndex(CUSTOM_THEME_INDEX)

    expect(store.themeIndex).toBe(CUSTOM_THEME_INDEX)
    expect(store.currentTheme.name).toBe('自定义')
    expect(store.currentTheme.body).toBe('#dbcfb6')
    expect(store.currentTheme.fontColor).toBe('#2c2219')
  })

  it('updates custom theme colors and updates currentTheme reactively', () => {
    const store = useReaderStore()
    store.setThemeIndex(CUSTOM_THEME_INDEX)

    store.updateCustomTheme({
      body: '#e0f0e8',
      fontColor: '#2d4a3e',
    })

    expect(store.config.customTheme.body).toBe('#e0f0e8')
    expect(store.config.customTheme.fontColor).toBe('#2d4a3e')
    expect(store.currentTheme.body).toBe('#e0f0e8')
    expect(store.currentTheme.fontColor).toBe('#2d4a3e')

    const savedRaw = localStorage.getItem('readConfig')
    expect(savedRaw).toBeTruthy()
    const parsed = JSON.parse(savedRaw!)
    expect(parsed.customTheme.body).toBe('#e0f0e8')
    expect(parsed.customTheme.fontColor).toBe('#2d4a3e')
  })

  it('prioritizes night mode even when custom theme is active and restores on exit', () => {
    const store = useReaderStore()
    store.setThemeIndex(CUSTOM_THEME_INDEX)
    store.updateCustomTheme({ body: '#f5e4e8', fontColor: '#4a2d36' })

    // 开启夜间模式
    store.isNight = true
    expect(store.currentTheme.name).toBe('暗夜')
    expect(store.currentTheme.body).toBe('#141414')

    // 关闭夜间模式后还原为自定义配色
    store.isNight = false
    expect(store.currentTheme.name).toBe('自定义')
    expect(store.currentTheme.body).toBe('#f5e4e8')
    expect(store.currentTheme.fontColor).toBe('#4a2d36')
  })

  it('migrates legacy readConfig missing customTheme gracefully', () => {
    localStorage.setItem('readConfig', JSON.stringify({
      fontSize: 20,
      lineHeight: 1.6,
    }))

    const store = useReaderStore()
    expect(store.config.fontSize).toBe(20)
    expect(store.config.customTheme).toBeDefined()
    expect(store.config.customTheme.body).toBe('#dbcfb6')
    expect(store.config.customTheme.fontColor).toBe('#2c2219')
  })
})

