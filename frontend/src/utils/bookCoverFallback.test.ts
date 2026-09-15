import { describe, expect, it } from 'vitest'
import { getBookInitial } from './bookCoverFallback'

describe('getBookInitial', () => {
  it('extracts first non-symbol Chinese character', () => {
    expect(getBookInitial('《诡秘之主》')).toBe('诡')
    expect(getBookInitial('【完结】凡人修仙传')).toBe('完')
    expect(getBookInitial('[精校] 遮天')).toBe('精')
    expect(getBookInitial('“雪中悍刀行”')).toBe('雪')
    expect(getBookInitial('（全本）剑来')).toBe('全')
    expect(getBookInitial('No.1 完美世界')).toBe('完')
  })

  it('falls back to first letter or number when no Chinese character', () => {
    expect(getBookInitial('Harry Potter')).toBe('H')
    expect(getBookInitial('1984')).toBe('1')
    expect(getBookInitial('  --the great gatsby--  ')).toBe('T')
  })

  it('handles empty or pure symbol input', () => {
    expect(getBookInitial('')).toBe('书')
    expect(getBookInitial(null)).toBe('书')
    expect(getBookInitial(undefined)).toBe('书')
    expect(getBookInitial('《》【】“”…')).toBe('书')
    expect(getBookInitial('---***$$$')).toBe('书')
  })
})

