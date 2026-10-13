// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { EngineInfo, MachineProfile, SessionStatus } from '@/api/types'

const calls: string[] = []
let handlers: Record<string, (args: Record<string, unknown>) => unknown> = {}

vi.mock('@/api/client', async (orig) => {
  const real = await orig<typeof import('@/api/client')>()
  return {
    ...real,
    call: async (cmd: string, args: Record<string, unknown> = {}) => {
      calls.push(cmd)
      const h = handlers[cmd]
      if (!h) throw new real.ApiError({ code: 'internal', message: `unexpected call ${cmd}` })
      return h(args)
    },
  }
})

import { ApiError } from '@/api/client'
import { UiProvider } from '@/components/ui'
import { BackendProvider } from '@/app/backend'
import EmulatorView from './EmulatorView'

const profile: MachineProfile = {
  schema_version: 1,
  id: 'p1',
  name: 'Test Machine',
  model: 'a500',
  chipset: 'ocs',
  cpu: { model: '68000', fpu: 'none', mmu: false, speed: 'original', address_24bit: true, data_cache: false },
  memory: { chip_kb: 512, slow_kb: 512, fast_mb: 0, accel_mb: 0, z3_mb: 0 },
  performance: 'compatibility',
  rom_id: null,
  ext_rom_id: null,
  drives: [
    { kind: 'dd35', media_id: null, write_protect: false },
    { kind: 'disabled', media_id: null, write_protect: false },
    { kind: 'disabled', media_id: null, write_protect: false },
    { kind: 'disabled', media_id: null, write_protect: false },
  ],
  hard_disks: [],
  audio: { volume: 80, muted: false, stereo_separation: 7, sample_rate: 44100, buffer_ms: 40 },
  display: { standard: 'pal', fullscreen: false, keep_aspect: true, window_width: 960, window_height: 720 },
  input: { port0: 'mouse', port1: 'keyboard_joystick', mouse_speed: 100 },
  notes: '',
}

const status = (over: Partial<SessionStatus>): SessionStatus => ({
  running: false,
  profile_id: null,
  profile_name: null,
  pid: null,
  uptime_s: 0,
  runtime_control: true,
  mode: null,
  paused: null,
  warnings: [],
  log_path: null,
  hard_disks: [],
  ...over,
})

let root: Root
let host: HTMLDivElement

async function mount() {
  await act(async () => {
    root.render(
      <UiProvider>
        <BackendProvider pollSession>
          <EmulatorView />
        </BackendProvider>
      </UiProvider>,
    )
  })
  await act(async () => {
    await new Promise((r) => setTimeout(r, 50))
  })
}

beforeEach(() => {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  calls.length = 0
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})

const baseHandlers = (st: SessionStatus, engine: EngineInfo | ApiError) => ({
  app_info: () => ({ version: '0', platform: 'linux', arch: 'x', storage_root: '/x', engine: null, runtime_control: st.runtime_control }),
  session_status: () => st,
  engine_info: () => {
    if (engine instanceof ApiError) throw engine
    return engine
  },
  profile_list: () => [profile],
  profile_get: () => profile,
  rom_list: () => [],
  profile_validate: () => ({ issues: [] }),
})

describe('Emulator screen', () => {
  it('not running: explains a missing engine and a missing Kickstart, offers Start', async () => {
    handlers = baseHandlers(status({}), new ApiError({ code: 'not_found', message: 'The Amiga emulator engine (Amiberry) was not found.' }))
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('The emulator engine is not set up')
    expect(text).toContain('Amiberry')
    expect(text).toContain('No Kickstart ROM is selected')
    expect(host.querySelector('[data-testid=start-machine]')).not.toBeNull()
    expect(host.querySelector('a[href="#/amiga/settings"]')).not.toBeNull()
    expect(calls).not.toContain('session_screenshot')
  })

  it('running without a control channel: banner uses the engine note, runtime controls are absent, only a forced stop remains', async () => {
    const engine: EngineInfo = { path: '/x/amiberry.exe', banner: 'Amiberry v8.4.0', version: [8, 4, 0], runtime_control: false, runtime_control_note: 'NOTE: no control channel on this platform.' }
    handlers = baseHandlers(status({ running: true, profile_id: 'p1', profile_name: 'Test Machine', pid: 42, uptime_s: 5, runtime_control: false, warnings: ['A safety backup of the hard disk was made before starting.'] }), engine)
    await mount()
    const text = host.textContent ?? ''
    expect(text).toContain('TiLT cannot control the emulator while it runs')
    expect(text).toContain('NOTE: no control channel on this platform.')
    expect(text).toContain('A safety backup of the hard disk was made before starting.')
    expect(host.querySelector('[data-testid=pause]')).toBeNull()
    expect(host.querySelector('[data-testid=reset-soft]')).toBeNull()
    expect(host.querySelector('[data-testid=reset-hard]')).toBeNull()
    expect(host.querySelector('[data-testid=fullscreen]')).toBeNull()
    expect(host.querySelector('[data-testid=mouse-grab]')).toBeNull()
    expect(host.querySelector('[data-testid=preview-frame]')).toBeNull()
    expect(host.querySelector('[data-testid=power-off]')?.textContent).toBe('Force stop')
    // never talks to the control channel
    for (const c of ['session_screenshot', 'session_drives', 'session_perf', 'session_control']) expect(calls).not.toContain(c)
    // the Ctrl+Alt way of releasing the mouse is still explained
    expect(text).toContain('Ctrl')
  })

  it('running with a control channel shows the live controls', async () => {
    const engine: EngineInfo = { path: '/x/amiberry', banner: 'Amiberry v8.4.0', version: [8, 4, 0], runtime_control: true, runtime_control_note: null }
    handlers = {
      ...baseHandlers(status({ running: true, profile_id: 'p1', profile_name: 'Test Machine', pid: 42, uptime_s: 5, paused: false }), engine),
      session_screenshot: () => new Promise(() => undefined),
      session_drives: () => [],
      session_perf: () => ({ fps: {}, leds: {}, uptime_s: 5 }),
      media_list: () => [],
    }
    await mount()
    expect(host.querySelector('[data-testid=pause]')).not.toBeNull()
    expect(host.querySelector('[data-testid=reset-hard]')).not.toBeNull()
    expect(host.querySelector('[data-testid=power-off]')?.textContent).toBe('Power off')
    expect(host.textContent).toContain('Getting the mouse back')
    expect(calls).toContain('session_screenshot')
  })
})

