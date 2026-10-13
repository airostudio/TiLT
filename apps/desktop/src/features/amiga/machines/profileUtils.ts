// Shared helpers for machine profiles: labels, option lists and one-line summaries.
// Option lists mirror the values the backend validator accepts (crates/amiga-core/src/profiles.rs).

import type { AmigaModel, CpuModel, DriveKind, FpuModel, HdfRecord, Issue, MachineProfile, PortDevice, RomRecord } from '@/api/types'

export const MODEL_LABEL: Record<AmigaModel, string> = {
  a500: 'Amiga 500',
  a500_plus: 'Amiga 500+',
  a1200: 'Amiga 1200',
  a3000: 'Amiga 3000',
  a4000: 'Amiga 4000',
  custom: 'Custom Amiga',
}

export const MODEL_HINT: Record<AmigaModel, string> = {
  a500: 'Original chipset (OCS), 68000, built-in floppy drive.',
  a500_plus: 'Enhanced chipset (ECS), 68000, 1 MB Chip RAM.',
  a1200: 'AGA chipset, 32-bit 68EC020, built-in IDE hard disk support.',
  a3000: 'ECS chipset, 68030, 32-bit motherboard RAM.',
  a4000: 'AGA chipset, 68030 or 68040, 32-bit motherboard RAM.',
  custom: 'You choose every part. Impossible combinations are still flagged.',
}

export const CHIPSET_LABEL = { ocs: 'OCS', ecs: 'ECS', aga: 'AGA' } as const

export const CPU_MODELS: { id: CpuModel; label: string; note: string }[] = [
  { id: '68000', label: '68000', note: 'The original Amiga processor. 24-bit address bus, no FPU, no MMU.' },
  { id: '68010', label: '68010', note: 'A slightly improved 68000. 24-bit address bus.' },
  { id: '68020', label: '68020', note: '32-bit processor. Can be paired with a 68881/68882 FPU.' },
  { id: '68EC020', label: '68EC020', note: 'The cost-reduced 68020 of the Amiga 1200: only a 24-bit address bus.' },
  { id: '68030', label: '68030', note: '32-bit, built-in MMU and data cache. Can be paired with a 68881/68882 FPU.' },
  { id: '68EC030', label: '68EC030', note: 'A 68030 without the MMU. Can be paired with a 68881/68882 FPU.' },
  { id: '68040', label: '68040', note: 'Built-in FPU and MMU. No external FPU is used with it.' },
  { id: '68EC040', label: '68EC040', note: 'A 68040 with no FPU and no MMU.' },
]

export const FPU_OPTIONS: { id: FpuModel; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: '68881', label: '68881 (external)' },
  { id: '68882', label: '68882 (external)' },
  { id: 'internal', label: 'Built into the 68040' },
]

export const DRIVE_KIND_LABEL: Record<DriveKind, string> = { disabled: 'Not fitted', dd35: 'Double density (880 KB)', hd35: 'High density (1.76 MB)' }

export const PORT_LABEL: Record<PortDevice, string> = {
  none: 'Nothing connected',
  mouse: 'Mouse',
  keyboard_joystick: 'Joystick on the keyboard',
  gamepad: 'Gamepad (first connected)',
}

// Accepted memory sizes (KB for chip/slow, MB for the rest).
export const CHIP_KB = [256, 512, 1024, 2048]
export const SLOW_KB = [0, 256, 512, 768, 1024, 1280, 1536, 1792]
export const FAST_MB = [0, 1, 2, 4, 8]
export const ACCEL_MB = [0, 1, 2, 4, 8, 16, 32, 64, 128]
export const Z3_MB = [0, 16, 32, 64, 128, 256, 512, 1024]
export const SAMPLE_RATES = [22050, 44100, 48000]

export const kbText = (kb: number): string => (kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`)
export const mbText = (mb: number): string => `${mb} MB`

export const cpuText = (p: MachineProfile): string => {
  const parts: string[] = [p.cpu.model]
  if (p.cpu.fpu !== 'none') parts.push(p.cpu.fpu === 'internal' ? 'FPU' : `${p.cpu.fpu} FPU`)
  if (p.cpu.mmu) parts.push('MMU')
  return parts.join(' + ')
}

export const memoryText = (p: MachineProfile): string => {
  const m = p.memory
  const parts = [`${kbText(m.chip_kb)} Chip`]
  if (m.slow_kb) parts.push(`${kbText(m.slow_kb)} Slow`)
  if (m.fast_mb) parts.push(`${mbText(m.fast_mb)} Fast (Zorro II)`)
  if (m.accel_mb) parts.push(`${mbText(m.accel_mb)} Accelerator RAM`)
  if (m.z3_mb) parts.push(`${mbText(m.z3_mb)} Zorro III`)
  return parts.join(' + ')
}

export const drivesText = (p: MachineProfile): string => {
  const on = p.drives.map((d, i) => ({ d, i })).filter((x) => x.d.kind !== 'disabled')
  if (!on.length) return 'No floppy drives'
  return on.map(({ d, i }) => `DF${i}${d.kind === 'hd35' ? ' (HD)' : ''}`).join(', ')
}

export const romLabel = (r: RomRecord): string => `${r.info.label}${r.missing ? ' (file missing)' : ''} - ${r.name}`

export function hdNames(p: MachineProfile, hdfs: HdfRecord[]): string[] {
  return p.hard_disks.map((h) => hdfs.find((x) => x.id === h.hdf_id)?.name ?? 'Unknown hard disk')
}

export const errorsOf = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === 'error')
export const warningsOf = (issues: Issue[]): Issue[] => issues.filter((i) => i.severity === 'warning')

export type Readiness = 'ready' | 'warnings' | 'errors'
export function readiness(issues: Issue[] | undefined): Readiness | 'checking' {
  if (!issues) return 'checking'
  if (errorsOf(issues).length) return 'errors'
  if (warningsOf(issues).length) return 'warnings'
  return 'ready'
}

/** Which editor section shows a given validation field. */
export function sectionOf(field: string): string {
  if (field === 'name' || field === 'schema_version') return 'general'
  if (field.startsWith('cpu') || field === 'performance') return field === 'performance' ? 'performance' : 'cpu'
  if (field === 'chipset') return 'chipset'
  if (field.startsWith('memory')) return 'memory'
  if (field === 'rom_id' || field === 'ext_rom_id') return 'kickstart'
  if (field.startsWith('drives')) return 'floppies'
  if (field.startsWith('hard_disks')) return 'harddisks'
  if (field.startsWith('audio')) return 'audio'
  if (field.startsWith('display')) return 'display'
  if (field.startsWith('input')) return 'input'
  return 'general'
}

export const SECTION_TITLE: Record<string, string> = {
  general: 'General',
  cpu: 'Processor',
  chipset: 'Chipset',
  memory: 'Memory',
  kickstart: 'Kickstart',
  floppies: 'Floppy drives',
  harddisks: 'Hard disks',
  audio: 'Audio',
  display: 'Display',
  input: 'Input',
  performance: 'Performance mode',
}

export const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** What the emulator can honestly say about a named memory layout, valid for this CPU + chipset. */
export function memoryPresets(p: MachineProfile): { id: string; label: string; apply: (m: MachineProfile['memory']) => MachineProfile['memory'] }[] {
  const wide = ['68020', '68EC020', '68030', '68EC030', '68040', '68EC040'].includes(p.cpu.model) && !p.cpu.address_24bit
  const base = p.chipset === 'aga' ? 2048 : p.chipset === 'ecs' ? 1024 : 512
  const std = (m: MachineProfile['memory']) => ({ ...m, chip_kb: base, slow_kb: p.chipset === 'ocs' ? 512 : 0, fast_mb: 0, accel_mb: 0, z3_mb: 0 })
  const out = [{ id: 'standard', label: `Standard (${kbText(base)} Chip${p.chipset === 'ocs' ? ' + 512 KB Slow' : ''})`, apply: std }]
  out.push({ id: 'fast4', label: wide ? 'Standard + 8 MB Fast' : 'Standard + 4 MB Fast', apply: (m) => (wide ? { ...std(m), accel_mb: 8 } : { ...std(m), fast_mb: 4 }) })
  if (wide) {
    out.push({ id: 'fast32', label: 'Standard + 32 MB Fast', apply: (m) => ({ ...std(m), accel_mb: 32 }) })
    out.push({ id: 'fast128', label: 'Standard + 128 MB Fast', apply: (m) => ({ ...std(m), accel_mb: 128 }) })
  } else {
    out.push({ id: 'fast8', label: 'Standard + 8 MB Fast', apply: (m) => ({ ...std(m), fast_mb: 8 }) })
  }
  return out
}
