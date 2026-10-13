import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '@/api/types'
import { cpuText, drivesText, kbText, memoryPresets, memoryText, readiness, sectionOf } from './profileUtils'

const base = {
  cpu: { model: '68040', fpu: 'internal', mmu: true, speed: 'original', address_24bit: false, data_cache: false },
  chipset: 'aga',
  memory: { chip_kb: 2048, slow_kb: 0, fast_mb: 0, accel_mb: 32, z3_mb: 0 },
  drives: [{ kind: 'dd35' }, { kind: 'hd35' }, { kind: 'disabled' }, { kind: 'disabled' }],
} as unknown as MachineProfile

describe('profile summaries', () => {
  it('describes CPU, memory and drives in plain words', () => {
    expect(cpuText(base)).toBe('68040 + FPU + MMU')
    expect(memoryText(base)).toBe('2 MB Chip + 32 MB Accelerator RAM')
    expect(drivesText(base)).toBe('DF0, DF1 (HD)')
    expect(kbText(512)).toBe('512 KB')
  })
  it('maps validation fields to editor sections', () => {
    expect(sectionOf('cpu.fpu')).toBe('cpu')
    expect(sectionOf('memory.accel_mb')).toBe('memory')
    expect(sectionOf('rom_id')).toBe('kickstart')
    expect(sectionOf('drives.2')).toBe('floppies')
    expect(sectionOf('performance')).toBe('performance')
  })
  it('readiness distinguishes errors, warnings and unknown', () => {
    expect(readiness(undefined)).toBe('checking')
    expect(readiness([])).toBe('ready')
    expect(readiness([{ severity: 'warning', field: 'x', message: 'm' }])).toBe('warnings')
    expect(readiness([{ severity: 'warning', field: 'x', message: 'm' }, { severity: 'error', field: 'y', message: 'm' }])).toBe('errors')
  })
  it('only offers memory layouts that fit the CPU: no 32-bit RAM on a 24-bit CPU', () => {
    const old = { ...base, chipset: 'ocs', cpu: { ...base.cpu, model: '68000', address_24bit: true, fpu: 'none', mmu: false } } as MachineProfile
    const layouts = memoryPresets(old).map((m) => m.apply(old.memory))
    expect(layouts.every((m) => m.accel_mb === 0)).toBe(true)
    expect(layouts.every((m) => m.chip_kb <= 1024)).toBe(true)
    const wide = memoryPresets(base).map((m) => m.apply(base.memory))
    expect(wide.some((m) => m.accel_mb === 128)).toBe(true)
    expect(wide.every((m) => m.fast_mb === 0)).toBe(true)
  })
})
