import { describe, expect, it } from 'vitest'
import { formatDateTime, formatNumber } from '../../src/renderer/src/format'

describe('Intl formatting', () => {
  it('formats dates differently for Chinese and English', () => {
    const date = '2026-11-04T08:30:00.000Z'
    expect(formatDateTime(date, 'zh-CN')).not.toBe(formatDateTime(date, 'en'))
  })

  it('formats numbers with the selected locale', () => {
    expect(formatNumber(1234567.89, 'en')).toBe('1,234,567.89')
    expect(formatNumber(1234567.89, 'zh-CN')).toBe('1,234,567.89')
  })
})
