import { describe, expect, it } from 'vitest'
import type { MachineProfile } from '@/api/types'
import { acceleratorLabel, cpuLabel, fastRamLabel, ramLabel } from './describe'

const p = (o: { model?: MachineProfile['model']; cpu?: Partial<MachineProfile['cpu']>; memory?: Partial<MachineProfile['memory']> }): MachineProfile =>
  ({
    model: 'a1200',
    cpu: { model: '68EC020', fpu: 'none', mmu: false, ...o.cpu },
    memory: { chip_kb: 2048, slow_kb: 0, fast_mb: 0, accel_mb: 0, z3_mb: 0, ...o.memory },
    ...(o.model ? { model: o.model } : {}),
  }) as MachineProfile

describe('dashboard descriptions', () => {
  it('labels CPUs with their real capabilities', () => {
    expect(cpuLabel(p({ cpu: { model: '68040', fpu: 'internal', mmu: true } }))).toBe('Motorola 68040 · built-in FPU · MMU')
    expect(cpuLabel(p({ cpu: { model: '68EC040' } }))).toBe('Motorola 68EC040')
    expect(cpuLabel(p({ cpu: { model: '68030', fpu: '68882', mmu: true } }))).toBe('Motorola 68030 · 68882 FPU · MMU')
  })
  it('describes accelerators as emulated configurations, never boards', () => {
    expect(acceleratorLabel(p({}))).toBe('None (standard machine)')
    expect(acceleratorLabel(p({ cpu: { model: '68030' }, memory: { accel_mb: 16 } }))).toBe('Emulated 68030 accelerator + 16 MB 32-bit RAM')
    expect(acceleratorLabel(p({ model: 'a4000', cpu: { model: '68040' }, memory: { accel_mb: 16 } }))).toBe('Motherboard RAM: 16 MB')
  })
  it('formats memory', () => {
    expect(ramLabel(512)).toBe('512 KB')
    expect(ramLabel(2048)).toBe('2 MB')
    expect(fastRamLabel(p({ memory: { fast_mb: 4, accel_mb: 8 } }))).toBe('12 MB')
    expect(fastRamLabel(p({}))).toBe('None')
  })
})
