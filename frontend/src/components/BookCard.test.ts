import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import BookCard from './BookCard.vue'
import type { Book } from '../types'

describe('BookCard selection and click handling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const dummyBook: Book = {
    bookUrl: 'test://book-1',
    name: '测试书籍',
    author: '测试作者',
    coverUrl: '',
    customCoverUrl: '',
    origin: 'test',
    type: 0,
    totalChapterNum: 10,
    durChapterIndex: 1,
    durChapterTitle: '第一章',
    latestChapterTitle: '第十章',
  }

  it('emits click when card clicked outside edit mode', async () => {
    const wrapper = mount(BookCard, {
      props: {
        book: dummyBook,
        editMode: false,
      },
    })

    await wrapper.find('.book-card').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('emits info when cover clicked outside edit mode', async () => {
    const wrapper = mount(BookCard, {
      props: {
        book: dummyBook,
        editMode: false,
      },
    })

    await wrapper.find('.card-cover').trigger('click')
    expect(wrapper.emitted('info')).toHaveLength(1)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('emits select when card or cover clicked in edit mode', async () => {
    const wrapper = mount(BookCard, {
      props: {
        book: dummyBook,
        editMode: true,
        selected: false,
      },
    })

    // 点击整张卡片（文字信息区）
    await wrapper.find('.book-card').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('select')![0][0]).toEqual(dummyBook)
    expect(wrapper.emitted('click')).toBeUndefined()

    // 点击封面（包括 selection-overlay 和 checkbox）
    await wrapper.find('.card-cover').trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(2)
    expect(wrapper.emitted('info')).toBeUndefined()
  })

  it('keeps coverSrc stable without mutating to dataUrl on cover load to prevent flicker', async () => {
    const bookWithCover: Book = {
      ...dummyBook,
      coverUrl: 'https://example.com/cover.jpg',
    }

    const wrapper = mount(BookCard, {
      props: {
        book: bookWithCover,
      },
    })

    const img = wrapper.find('img.cover-img')
    expect(img.exists()).toBe(true)
    const initialSrc = img.attributes('src')
    expect(initialSrc).toContain('/reader3/cover?path=')

    // 触发图片加载事件
    await img.trigger('load')

    // 验证 src 保持原样稳定，没有发生二次强制突变换源，杜绝白屏闪烁
    expect(img.attributes('src')).toBe(initialSrc)
  })

  it('maintains absolute stability after mount without asynchronous cover mutation', async () => {
    const bookWithCover: Book = {
      ...dummyBook,
      coverUrl: 'https://example.com/cover-mount.jpg',
    }

    const wrapper = mount(BookCard, {
      props: {
        book: bookWithCover,
      },
    })

    const img = wrapper.find('img.cover-img')
    expect(img.exists()).toBe(true)
    const initialSrc = img.attributes('src')

    // 等待异步微任务与宏任务
    await new Promise((resolve) => setTimeout(resolve, 50))

    // 验证无论后台状态如何，当前展示完全保持绝对静止
    expect(img.attributes('src')).toBe(initialSrc)
  })
})
