import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import ReadSettings from './ReadSettings.vue'
import { useReaderStore, CUSTOM_THEME_INDEX } from '../../stores/reader'

vi.mock('../../api/bookshelf', () => ({
  getBookContent: vi.fn(),
  getChapterList: vi.fn(),
  getShelfBook: vi.fn(),
  saveBookProgress: vi.fn(),
  setBookSource: vi.fn(),
}))

vi.mock('../../api/bookmark', () => ({
  getBookmarks: vi.fn(),
  saveBookmark: vi.fn(),
  deleteBookmark: vi.fn(),
  deleteBookmarks: vi.fn(),
}))

vi.mock('../../api/replaceRule', () => ({
  getReplaceRules: vi.fn(),
}))

describe('ReadSettings custom theme panel collapse persistence', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('keeps panel collapsed by default when themeIndex is CUSTOM_THEME_INDEX and nothing in localStorage', async () => {
    const store = useReaderStore()
    store.setThemeIndex(CUSTOM_THEME_INDEX)

    const wrapper = mount(ReadSettings)
    expect(wrapper.find('.custom-theme-card').exists()).toBe(false)
  })

  it('expands panel and stores true in localStorage when clicking custom swatch from another theme', async () => {
    const store = useReaderStore()
    store.setThemeIndex(0)

    const wrapper = mount(ReadSettings)
    expect(wrapper.find('.custom-theme-card').exists()).toBe(false)

    const customSwatch = wrapper.find('.custom-swatch')
    await customSwatch.trigger('click')

    expect(store.themeIndex).toBe(CUSTOM_THEME_INDEX)
    expect(wrapper.find('.custom-theme-card').exists()).toBe(true)
    expect(localStorage.getItem('reader_custom_theme_panel_expanded')).toBe('true')
  })

  it('collapses panel and saves false to localStorage when clicking collapse button', async () => {
    const store = useReaderStore()
    store.setThemeIndex(CUSTOM_THEME_INDEX)
    localStorage.setItem('reader_custom_theme_panel_expanded', 'true')

    const wrapper = mount(ReadSettings)
    expect(wrapper.find('.custom-theme-card').exists()).toBe(true)

    const collapseBtn = wrapper.find('.custom-collapse-btn')
    await collapseBtn.trigger('click')

    expect(wrapper.find('.custom-theme-card').exists()).toBe(false)
    expect(localStorage.getItem('reader_custom_theme_panel_expanded')).toBe('false')
  })

  it('remembers collapsed state upon reopening/remounting ReadSettings', async () => {
    const store = useReaderStore()
    store.setThemeIndex(CUSTOM_THEME_INDEX)
    localStorage.setItem('reader_custom_theme_panel_expanded', 'false')

    // Simulate reopening settings drawer
    const wrapper = mount(ReadSettings)
    expect(wrapper.find('.custom-theme-card').exists()).toBe(false)

    // Clicking custom swatch toggles it back to expanded
    const customSwatch = wrapper.find('.custom-swatch')
    await customSwatch.trigger('click')

    expect(wrapper.find('.custom-theme-card').exists()).toBe(true)
    expect(localStorage.getItem('reader_custom_theme_panel_expanded')).toBe('true')
  })
})

