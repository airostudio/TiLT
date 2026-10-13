import { describe, expect, it } from 'vitest'
import { setThemeValue } from './theme'

describe('theme store', () => {
  it('applies and persists the chosen theme', () => {
    setThemeValue('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(localStorage.getItem('tilt.theme')).toBe('"light"')
    setThemeValue('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})
