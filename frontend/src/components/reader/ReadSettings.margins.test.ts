import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import ReadSettings from './ReadSettings.vue'
import { useReaderStore } from '../../stores/reader'

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

describe('ReadSettings margin controls', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('renders top and bottom margin controls in 左右翻页 mode', async () => {
    const readerStore = useReaderStore()
    readerStore.updateConfig('readMethod', '左右翻页')
    readerStore.updateConfig('marginTop', 24)
    readerStore.updateConfig('marginBottom', 24)
    readerStore.updateConfig('marginLeft', 24)
    readerStore.updateConfig('marginRight', 24)

    const wrapper = mount(ReadSettings)

    const labels = wrapper.findAll('.setting-row label').map(el => el.text())
    expect(labels).toContain('页面上边距')
    expect(labels).toContain('页面下边距')
    expect(labels).toContain('页面左边距')
    expect(labels).toContain('页面右边距')
  })

  it('hides top and bottom margin controls in vertical modes but keeps left and right', async () => {
    const readerStore = useReaderStore()
    readerStore.updateConfig('readMethod', '上下滚动')

    const wrapper = mount(ReadSettings)

    const labels = wrapper.findAll('.setting-row label').map(el => el.text())
    expect(labels).not.toContain('页面上边距')
    expect(labels).not.toContain('页面下边距')
    expect(labels).toContain('页面左边距')
    expect(labels).toContain('页面右边距')
  })

  it('adjusts margins independently when buttons are clicked', async () => {
    const readerStore = useReaderStore()
    readerStore.updateConfig('readMethod', '左右翻页')
    readerStore.updateConfig('marginTop', 24)
    readerStore.updateConfig('marginBottom', 24)
    readerStore.updateConfig('marginLeft', 24)
    readerStore.updateConfig('marginRight', 24)

    const wrapper = mount(ReadSettings)

    const rows = wrapper.findAll('.setting-row')
    const topRow = rows.find(r => r.find('label').text() === '页面上边距')!
    const bottomRow = rows.find(r => r.find('label').text() === '页面下边距')!
    const leftRow = rows.find(r => r.find('label').text() === '页面左边距')!
    const rightRow = rows.find(r => r.find('label').text() === '页面右边距')!

    // Step top margin up
    const topPlusBtn = topRow.findAll('.step-btn')[1]
    await topPlusBtn.trigger('click')
    expect(readerStore.config.marginTop).toBe(26)
    expect(readerStore.config.marginBottom).toBe(24)

    // Step bottom margin down
    const bottomMinusBtn = bottomRow.findAll('.step-btn')[0]
    await bottomMinusBtn.trigger('click')
    expect(readerStore.config.marginTop).toBe(26)
    expect(readerStore.config.marginBottom).toBe(22)

    // Step left margin up
    const leftPlusBtn = leftRow.findAll('.step-btn')[1]
    await leftPlusBtn.trigger('click')
    expect(readerStore.config.marginLeft).toBe(26)
    expect(readerStore.config.marginRight).toBe(24)

    // Step right margin down
    const rightMinusBtn = rightRow.findAll('.step-btn')[0]
    await rightMinusBtn.trigger('click')
    expect(readerStore.config.marginLeft).toBe(26)
    expect(readerStore.config.marginRight).toBe(22)
  })
})
