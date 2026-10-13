import { describe, expect, it } from 'vitest'
import { basename, formatBytes, formatDuration } from './format'

describe('format', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(901120)).toBe('880 KB')
    expect(formatBytes(500 * 1024 * 1024)).toBe('500 MB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })
  it('formats durations', () => {
    expect(formatDuration(5)).toBe('5s')
    expect(formatDuration(125)).toBe('2m 5s')
    expect(formatDuration(7260)).toBe('2h 1m')
  })
  it('basename works for both separators', () => {
    expect(basename('C:\\a\\b.adf')).toBe('b.adf')
    expect(basename('/a/b.adf')).toBe('b.adf')
  })
})
