import { describe, expect, it } from 'vitest'
import { getCoverUrl } from './bookshelf'

describe('bookshelf cover helper', () => {
  it('returns empty string when path is falsy', () => {
    expect(getCoverUrl('')).toBe('')
  })

  it('keeps data or blob URLs unchanged', () => {
    expect(getCoverUrl('data:image/png;base64,123')).toBe('data:image/png;base64,123')
    expect(getCoverUrl('blob:http://localhost/123')).toBe('blob:http://localhost/123')
  })

  it('handles custom-cover and local-epub-cover protocols', () => {
    expect(getCoverUrl('custom-cover:abcdef')).toBe('/reader3/cover?path=custom-cover%3Aabcdef')
    expect(getCoverUrl('local-epub-cover:123456')).toBe('/reader3/cover?path=local-epub-cover%3A123456')
  })

  it('encodes standard remote cover path', () => {
    expect(getCoverUrl('https://example.com/cover.jpg')).toBe('/reader3/cover?path=https%3A%2F%2Fexample.com%2Fcover.jpg')
  })
})

