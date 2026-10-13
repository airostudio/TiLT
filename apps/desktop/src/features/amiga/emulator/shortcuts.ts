// Keyboard shortcuts shown in the Emulator screen.
//
// Only shortcuts that were confirmed in Amiberry's own source code are listed here (checked against
// Amiberry commit 7253db3, src/osdep/amiberry.cpp and keyboard.cpp):
//  - F12: `default_open_gui_key = "F12"` (options.h) and `enter_gui_key` falls back to SDL_SCANCODE_F12;
//         it opens Amiberry's own settings menu.
//  - Ctrl + Alt: `ctrl_alt_release` defaults to true (target_default_options); pressing both while the
//         mouse is captured calls activationtoggle(), which releases the capture.
// Amiberry has NO default key for quitting or toggling full screen (`default_quit_key` and
// `default_fullscreen_toggle_key` are empty), so none is listed: use the buttons on the Emulator screen.

export interface Shortcut {
  keys: string[]
  action: string
  note: string
}

export const CONFIRMED_SHORTCUTS: Shortcut[] = [
  {
    keys: ['Ctrl', 'Alt'],
    action: 'Release the mouse',
    note: 'Press both keys together while the emulator has captured the mouse. This is on by default in Amiberry.',
  },
  {
    keys: ['F12'],
    action: "Open the emulator's own settings menu",
    note: "This is Amiberry's menu, shown inside the emulator window. Changes made there are not saved back to the machine in TiLT.",
  },
]
