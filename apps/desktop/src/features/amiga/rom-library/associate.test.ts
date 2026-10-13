import { describe, expect, it } from 'vitest'
import type { MachineProfile, RomRecord } from '@/api/types'
import { bestRomFor, generationOf, proposeAssociations } from './associate'

const rom = (id: string, v: number, rev: number, extra: Partial<RomRecord['info']> = {}): RomRecord => ({
  id, name: id, storage: 'managed', path: '/x', imported_at: 0, missing: false,
  info: { sha256: id, size: 0, kind: 'kickstart', exec_version: v, exec_revision: rev, family: null, label: id, checksum_ok: true,
    footer_size_ok: true, mirrored_256k: false, is_aros: false, aga_capable: v >= 39 || (v === 40 && rev >= 68), likely_machines: [], version_string: null, warnings: [], ...extra },
})
const prof = (id: string, model: MachineProfile['model'], chipset: MachineProfile['chipset'], rom_id: string | null = null) => ({ id, model, chipset, rom_id }) as MachineProfile

describe('ROM association', () => {
  const k13 = rom('k13', 34, 5)
  const k204 = rom('k204', 37, 175)
  const k31 = rom('k31', 40, 68)
  const k3140_63 = rom('k40_63', 40, 63, { aga_capable: false })
  const aros = rom('aros', 46, 12, { is_aros: true })

  it('classifies generations from detected versions', () => {
    expect([k13, k204, k31].map(generationOf)).toEqual(['1.3', '2.x', '3.1'])
    expect(generationOf(rom('enc', 0, 0, { kind: 'encrypted_cloanto', exec_version: null }))).toBe('other')
  })

  it('picks the authentic generation for each machine', () => {
    const all = [k13, k204, k31]
    expect(bestRomFor(prof('a', 'a500', 'ocs'), all)?.id).toBe('k13')
    expect(bestRomFor(prof('b', 'a500_plus', 'ecs'), all)?.id).toBe('k204')
    expect(bestRomFor(prof('c', 'a1200', 'aga'), all)?.id).toBe('k31')
  })

  it('never proposes a non-AGA ROM for an AGA machine', () => {
    expect(bestRomFor(prof('c', 'a1200', 'aga'), [k13, k3140_63])).toBeNull()
  })

  it('A3000 needs Kickstart 2.0 or newer', () => {
    expect(bestRomFor(prof('d', 'a3000', 'ecs'), [k13])).toBeNull()
    expect(bestRomFor(prof('d', 'a3000', 'ecs'), [k13, k204])?.id).toBe('k204')
  })

  it('AROS is only a last resort', () => {
    expect(bestRomFor(prof('c', 'a1200', 'aga'), [aros, k31])?.id).toBe('k31')
    expect(bestRomFor(prof('c', 'a1200', 'aga'), [aros])?.id).toBe('aros')
  })

  it('only proposes for machines without a working ROM and skips custom', () => {
    const profiles = [prof('a', 'a500', 'ocs'), prof('b', 'a1200', 'aga', 'k31'), prof('c', 'custom', 'ecs')]
    const props = proposeAssociations(profiles, [k13, k31])
    expect(props.map((p) => p.profile.id)).toEqual(['a'])
  })
})
