import type { RoomView, SystemView } from '@/api/types'

// What the Rooms look like when no TiLT backend can be reached (a static web page). It exists so the
// front end still shows the real Rooms instead of nothing; nothing in it can be launched. A browser test
// (`e2e/rooms.spec.mjs`) compares these ids with what the real backend reports, so they cannot drift.

export const OFFLINE_ROOMS: RoomView[] = [
  { id: 'home', name: 'Home Arcade', tagline: 'Your favourite home computers and consoles' },
  { id: 'pinball', name: 'Pinball Arcade', tagline: 'Pinball tables and arcade cabinets' },
]

const ext = (id: string, room: 'home' | 'pinball', name: string, description: string): SystemView => ({
  id,
  room,
  name,
  description,
  kind: 'external',
  exe: null,
  args: [],
  game_dir: null,
  extensions: [],
  setup_hint: '',
  custom: false,
  configured: false,
  running: false,
  game_count: null,
})

export const OFFLINE_SYSTEMS: SystemView[] = [
  { ...ext('amiga', 'home', 'Amiga Studio', 'A500 to A4000: Kickstart, Workbench, floppies, hard disks. Built in.'), kind: 'amiga', configured: true },
  ext('ps2', 'home', 'PlayStation 2', 'Launches your installed PS2 emulator (for example PCSX2) with a game from your folder.'),
  ext('intellivision', 'home', 'Intellivision', 'Launches your installed Intellivision emulator (for example jzIntv) with a game from your folder.'),
  ext('tilt-pinball', 'pinball', 'TiLT Pinball', 'The TiLT engine in this repository is still a prototype and cannot play tables yet; use Visual Pinball or MAME.'),
  ext('vpx', 'pinball', 'Visual Pinball X', 'Launches Visual Pinball X (standalone) with a table from your tables folder.'),
  ext('pinmame', 'pinball', 'PinMAME', 'Launches a command-line PinMAME with a ROM set from your ROM folder.'),
  ext('mame', 'pinball', 'MAME Arcade', 'Launches MAME for arcade and pinball ROM sets from your ROM folder.'),
]
