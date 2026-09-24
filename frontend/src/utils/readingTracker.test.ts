import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  getTodayDateString,
  loadLocalReadingStats,
  saveLocalReadingStats,
  ReadingTracker,
  type LocalReadingStatsData,
} from './readingTracker'

describe('readingTracker utility', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it('formats current date as YYYY-MM-DD', () => {
    const today = getTodayDateString()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('loads and saves local reading stats properly', () => {
    expect(loadLocalReadingStats()).toEqual({ daily: {}, books: {} })

    const sample: LocalReadingStatsData = {
      daily: {
        '2026-09-11': {
          readDate: '2026-09-11',
          durationSecs: 300,
          listenSecs: 180,
          books: {
            'book://1': { durationSecs: 300, listenSecs: 180 },
          },
        },
      },
      books: {
        'book://1': {
          bookUrl: 'book://1',
          bookName: '乱世书',
          author: '姬叉',
          totalDurationSecs: 300,
          totalListenSecs: 180,
          lastReadDate: '2026-09-11',
          lastReadAt: 1726000000000,
        },
      },
    }

    saveLocalReadingStats(sample)
    const loaded = loadLocalReadingStats()
    expect(loaded.daily['2026-09-11'].durationSecs).toBe(300)
    expect(loaded.daily['2026-09-11'].listenSecs).toBe(180)
    expect(loaded.books['book://1'].bookName).toBe('乱世书')
  })

  it('records external background listening accurately', () => {
    const tracker = new ReadingTracker({
      getBook: () => ({
        name: '江山如此多娇',
        author: '泥人',
        bookUrl: 'book://jiangshan',
        origin: 'local',
      }),
      isSpeaking: () => true,
      isPaused: () => false,
    })

    tracker.recordExternalListening(300, 'book://jiangshan')
    const local = loadLocalReadingStats()
    const today = getTodayDateString()

    expect(local.daily[today].listenSecs).toBe(300)
    expect(local.daily[today].durationSecs).toBe(300)
    expect(local.books['book://jiangshan'].totalDurationSecs).toBe(300)
    expect(local.books['book://jiangshan'].totalListenSecs).toBe(300)

    tracker.destroy()
  })

  it('settles and records short reading sessions (e.g. 10s) upon flush/destroy', () => {
    vi.useFakeTimers()
    const tracker = new ReadingTracker({
      getBook: () => ({
        name: '育种方式公式版',
        author: '张三',
        bookUrl: 'book://breeding-10s',
        origin: 'local',
      }),
      isSpeaking: () => false,
      isPaused: () => false,
    })

    // 推进 10 秒（未达到 15 秒的心跳定时器）
    vi.advanceTimersByTime(10 * 1000)

    // 用户退出，触发 destroy
    tracker.destroy()

    const local = loadLocalReadingStats()
    const today = getTodayDateString()

    expect(local.daily[today]?.durationSecs).toBe(10)
    expect(local.books['book://breeding-10s']).toBeDefined()
    expect(local.books['book://breeding-10s'].totalDurationSecs).toBe(10)
    expect(local.books['book://breeding-10s'].bookName).toBe('育种方式公式版')

    vi.useRealTimers()
  })

  it('silences Web timer when listening in native app environment to prevent double counting', () => {
    vi.useFakeTimers()
      // 模拟 iOS 原生 App WebKit 容器环境
      ; (window as any).webkit = {
        messageHandlers: {
          dataControl: { postMessage: vi.fn() },
          ttsControl: { postMessage: vi.fn() },
        },
      }

    const tracker = new ReadingTracker({
      getBook: () => ({
        name: '许仙志',
        author: '说梦者',
        bookUrl: 'book://xuxian',
        origin: 'local',
      }),
      isSpeaking: () => true,
      isPaused: () => false,
    })

    // 推进 60 秒听书时间
    vi.advanceTimersByTime(60 * 1000)
    tracker.destroy()

    const local = loadLocalReadingStats()
    const today = getTodayDateString()

    // Web 端定时器静默，自身不应自增听书与总时长
    expect(local.daily[today]?.listenSecs || 0).toBe(0)
    expect(local.daily[today]?.durationSecs || 0).toBe(0)

    // 原生端通过 Bridge 上报 60 秒听书时长
    tracker.recordExternalListening(60, 'book://xuxian')
    const updated = loadLocalReadingStats()
    expect(updated.daily[today]?.listenSecs).toBe(60)
    expect(updated.daily[today]?.durationSecs).toBe(60)
    expect(updated.books['book://xuxian'].totalListenSecs).toBe(60)

    delete (window as any).webkit
    vi.useRealTimers()
  })

  it('maintains Web listening timer in pure browser environment', () => {
    vi.useFakeTimers()
    delete (window as any).webkit

    const tracker = new ReadingTracker({
      getBook: () => ({
        name: '六朝清羽记',
        author: '罗森',
        bookUrl: 'book://liuchao',
        origin: 'local',
      }),
      isSpeaking: () => true,
      isPaused: () => false,
    })

    // 纯 Web 环境听书推进 30 秒
    vi.advanceTimersByTime(30 * 1000)
    tracker.destroy()

    const local = loadLocalReadingStats()
    const today = getTodayDateString()

    // 纯 Web 环境下自身定时器正常统计
    expect(local.daily[today]?.listenSecs).toBe(30)
    expect(local.daily[today]?.durationSecs).toBe(30)
    expect(local.books['book://liuchao'].totalListenSecs).toBe(30)

    vi.useRealTimers()
  })

  it('clamps elapsed duration upon long sleep-wake recovery to prevent duration explosion', () => {
    vi.useFakeTimers()
    delete (window as any).webkit

    const baseTime = Date.now()
    vi.setSystemTime(baseTime)

    const tracker = new ReadingTracker({
      getBook: () => ({
        name: '大明文魁',
        author: '幸福来敲门',
        bookUrl: 'book://daming',
        origin: 'local',
      }),
      isSpeaking: () => false,
      isPaused: () => false,
    })

    // 模拟电脑合盖或手机深度休眠 2 小时 (7200 秒)：系统时钟直接跳跃，JS 定时器未触发
    vi.setSystemTime(baseTime + 7200 * 1000)

    // 用户唤醒设备并点击屏幕 (触发活跃状态)
    window.dispatchEvent(new Event('click'))

    // 触发结算
    tracker.destroy()

    const local = loadLocalReadingStats()
    const today = getTodayDateString()

    // 受到 IDLE_TIMEOUT_MS 保护，单次流逝时间最多只计入 120 秒，绝不会暴增 7200 秒
    expect(local.daily[today]?.durationSecs).toBe(120)
    expect(local.books['book://daming']?.totalDurationSecs).toBe(120)

    vi.useRealTimers()
  })
})

