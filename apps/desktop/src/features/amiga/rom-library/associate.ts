import type { MachineProfile, RomRecord } from '@/api/types'

/** Kickstart generations the app cares about, derived from the DETECTED exec version. */
export type KsGeneration = '1.3' | '2.x' | '3.1' | 'other'

export function generationOf(r: RomRecord): KsGeneration {
  const v = r.info.exec_version
  if (r.info.kind !== 'kickstart' || v == null) return 'other'
  if (v === 34) return '1.3'
  if (v >= 36 && v <= 38) return '2.x'
  if (v >= 39) return '3.1'
  return 'other'
}

/** Is `rom` a sensible Kickstart for `profile`? Mirrors (a subset of) the backend rules; the backend still validates on save. */
export function fitsProfile(p: MachineProfile, r: RomRecord): boolean {
  if (r.missing || r.info.kind !== 'kickstart' || r.info.exec_version == null) return false
  if (p.chipset === 'aga' && !r.info.aga_capable) return false
  const v = r.info.exec_version
  if (p.model === 'a3000' && v < 36) return false
  return true
}

/** Preference score: authentic generation for the machine first, then newest. Open-source AROS is only a fallback. */
function score(p: MachineProfile, r: RomRecord): number {
  const g = generationOf(r)
  const want: Record<string, KsGeneration> = { a500: '1.3', a500_plus: '2.x', a1200: '3.1', a4000: '3.1', a3000: '2.x' }
  let s = 0
  if (g === want[p.model]) s += 100
  s += r.info.exec_version ?? 0
  if (r.info.is_aros) s -= 1000
  return s
}

export function bestRomFor(p: MachineProfile, roms: RomRecord[]): RomRecord | null {
  const fit = roms.filter((r) => fitsProfile(p, r)).sort((a, b) => score(p, b) - score(p, a))
  return fit[0] ?? null
}

/** Proposed ROM assignments for machines that don't have one yet. */
export function proposeAssociations(profiles: MachineProfile[], roms: RomRecord[]): { profile: MachineProfile; rom: RomRecord }[] {
  const out: { profile: MachineProfile; rom: RomRecord }[] = []
  for (const p of profiles) {
    if (p.rom_id && roms.some((r) => r.id === p.rom_id && !r.missing)) continue
    if (p.model === 'custom') continue
    const rom = bestRomFor(p, roms)
    if (rom) out.push({ profile: p, rom })
  }
  return out
}
