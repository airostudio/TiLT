// Browser `KeyboardEvent.code` -> libretro `RETROK_*` key codes (values from libretro.h).
// Only keys that exist on an Amiga keyboard are mapped; everything else is ignored.

const map: Record<string, number> = {
  Backspace: 8,
  Tab: 9,
  Enter: 13,
  Escape: 27,
  Space: 32,
  Quote: 39,
  Comma: 44,
  Minus: 45,
  Period: 46,
  Slash: 47,
  Semicolon: 59,
  Equal: 61,
  BracketLeft: 91,
  Backslash: 92,
  BracketRight: 93,
  Backquote: 96,
  Delete: 127,
  NumpadDecimal: 266,
  NumpadDivide: 267,
  NumpadMultiply: 268,
  NumpadSubtract: 269,
  NumpadAdd: 270,
  NumpadEnter: 271,
  ArrowUp: 273,
  ArrowDown: 274,
  ArrowRight: 275,
  ArrowLeft: 276,
  Insert: 277,
  Home: 278,
  End: 279,
  PageUp: 280,
  PageDown: 281,
  CapsLock: 301,
  ShiftRight: 303,
  ShiftLeft: 304,
  ControlRight: 305,
  ControlLeft: 306,
  AltRight: 307,
  AltLeft: 308,
  // The Amiga keys: Left Amiga / Right Amiga sit where the Windows/Command keys are.
  MetaLeft: 311,
  MetaRight: 312,
  Help: 315,
}
for (let i = 0; i < 26; i++) map[`Key${String.fromCharCode(65 + i)}`] = 97 + i
for (let i = 0; i < 10; i++) {
  map[`Digit${i}`] = 48 + i
  map[`Numpad${i}`] = 256 + i
}
for (let i = 1; i <= 10; i++) map[`F${i}`] = 281 + i // F1..F10 = 282..291

/** The libretro key code for a keyboard event, or null if the Amiga has no such key. */
export function retroKey(code: string): number | null {
  return map[code] ?? null
}
