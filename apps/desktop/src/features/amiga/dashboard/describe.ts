import type { MachineProfile } from '@/api/types'

export function ramLabel(kb: number): string {
  return kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`
}

export function cpuLabel(p: MachineProfile): string {
  const parts: string[] = [`Motorola ${p.cpu.model}`]
  if (p.cpu.fpu === 'internal') parts.push('built-in FPU')
  else if (p.cpu.fpu !== 'none') parts.push(`${p.cpu.fpu} FPU`)
  if (p.cpu.mmu) parts.push('MMU')
  return parts.join(' · ')
}

const STOCK_CPU: Record<string, string> = { a500: '68000', a500_plus: '68000', a1200: '68EC020', a3000: '68030', a4000: '68040' }

/** Plain-language description of the emulated accelerator (or "none"). Never names a physical board. */
export function acceleratorLabel(p: MachineProfile): string {
  const stock = STOCK_CPU[p.model]
  const upgraded = stock !== undefined && p.cpu.model !== stock && !(p.model === 'a4000' && p.cpu.model === '68030')
  const ram = p.memory.accel_mb > 0 ? ` + ${p.memory.accel_mb} MB 32-bit RAM` : ''
  if (p.model === 'custom') return p.memory.accel_mb > 0 ? `32-bit RAM: ${p.memory.accel_mb} MB` : 'None'
  if (upgraded) return `Emulated ${p.cpu.model} accelerator${ram}`
  if (p.memory.accel_mb > 0 && (p.model === 'a3000' || p.model === 'a4000')) return `Motherboard RAM: ${p.memory.accel_mb} MB`
  return p.memory.accel_mb > 0 ? `32-bit RAM: ${p.memory.accel_mb} MB` : 'None (standard machine)'
}

export function fastRamLabel(p: MachineProfile): string {
  const total = p.memory.fast_mb + p.memory.accel_mb + p.memory.z3_mb
  return total === 0 ? 'None' : `${total} MB`
}

export const MODEL_NAMES: Record<string, string> = {
  a500: 'Amiga 500',
  a500_plus: 'Amiga 500+',
  a1200: 'Amiga 1200',
  a3000: 'Amiga 3000',
  a4000: 'Amiga 4000',
  custom: 'Custom Amiga',
}
