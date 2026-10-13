import { describe, expect, it } from 'vitest'
import { retroKey } from './retroKeys'

describe('retroKey', () => {
  it('maps letters, digits, arrows and the function keys to libretro codes', () => {
    expect(retroKey('KeyA')).toBe(97)
    expect(retroKey('KeyZ')).toBe(122)
    expect(retroKey('Digit0')).toBe(48)
    expect(retroKey('Digit9')).toBe(57)
    expect(retroKey('ArrowUp')).toBe(273)
    expect(retroKey('ArrowLeft')).toBe(276)
    expect(retroKey('F1')).toBe(282)
    expect(retroKey('F10')).toBe(291)
    expect(retroKey('Numpad0')).toBe(256)
  })
  it('maps the Windows/Command keys to the Amiga keys and ignores keys the Amiga lacks', () => {
    expect(retroKey('MetaLeft')).toBe(311)
    expect(retroKey('MetaRight')).toBe(312)
    expect(retroKey('F11')).toBeNull()
    expect(retroKey('MediaPlayPause')).toBeNull()
  })
})
