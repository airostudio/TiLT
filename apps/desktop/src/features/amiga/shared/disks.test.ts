import { describe, expect, it } from 'vitest'
import type { DriveConfig, MediaRecord } from '@/api/types'
import {
  classifyLabel,
  driveHolding,
  effectiveWriteProtect,
  filterDisks,
  moveItem,
  nextInQueue,
  queueDirty,
  suggestWorkbenchDisks,
  withDriveKind,
} from './disks'

function disk(over: Partial<MediaRecord> & { label?: string }): MediaRecord {
  const { label, ...rest } = over
  return {
    id: 'x',
    kind: 'adf',
    name: label ?? 'Disk',
    sha256: 'ab'.repeat(32),
    size: 901120,
    path: '/p',
    parent_id: null,
    source_dms_id: null,
    pristine: true,
    imported_at: 1,
    last_used: null,
    missing: false,
    info: {
      adf: {
        sha256: '',
        size: 901120,
        density: 'double',
        dos_bootblock: true,
        bootblock_checksum_ok: true,
        fs: 'ffs',
        international: false,
        dir_cache: false,
        root_valid: true,
        volume_name: label ?? 'Disk',
        has_boot_code: false,
        non_dos: false,
        all_zero: false,
        summary: 'FFS, not bootable',
        warnings: [],
      },
      dms: null,
      notes: [],
    },
    ...rest,
  }
}

describe('disk filtering', () => {
  const orig = disk({ id: 'a', label: 'Workbench3.1' })
  const copy = disk({ id: 'b', label: 'Work', pristine: false, parent_id: 'a' })
  const dms = disk({ id: 'c', kind: 'dms', label: 'Packed', info: { adf: null, dms: null, notes: [] } })
  const all = [orig, copy, dms]
  it('filters by kind', () => {
    expect(filterDisks(all, '', 'originals').map((d) => d.id)).toEqual(['a'])
    expect(filterDisks(all, '', 'working').map((d) => d.id)).toEqual(['b'])
    expect(filterDisks(all, '', 'archives').map((d) => d.id)).toEqual(['c'])
    expect(filterDisks(all, '', 'all')).toHaveLength(3)
  })
  it('searches name, label and summary, all words must match', () => {
    expect(filterDisks(all, 'workbench', 'all').map((d) => d.id)).toEqual(['a'])
    expect(filterDisks(all, 'ffs bench', 'all').map((d) => d.id)).toEqual(['a'])
    expect(filterDisks(all, 'nothing', 'all')).toHaveLength(0)
  })
})

describe('workbench label suggestions', () => {
  it('classifies labels the way the backend does', () => {
    expect(classifyLabel('Workbench3.1')).toEqual({ role: 'workbench', version: '3.1' })
    expect(classifyLabel('Install 2.1')).toEqual({ role: 'install', version: '2.1' })
    expect(classifyLabel('GameDisk')).toEqual({ role: 'other', version: 'unknown' })
  })
  it('suggests only matching or unversioned Workbench-like disks', () => {
    const list = [disk({ id: '1', label: 'Workbench3.1' }), disk({ id: '2', label: 'Workbench2.1' }), disk({ id: '3', label: 'Fonts' }), disk({ id: '4', label: 'Zool' })]
    expect(suggestWorkbenchDisks(list, '3.1').map((d) => d.id)).toEqual(['1', '3'])
    expect(suggestWorkbenchDisks(list, '2.1').map((d) => d.id)).toEqual(['2', '3'])
  })
})

describe('queue helpers', () => {
  it('moves items and ignores out-of-range moves', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    expect(moveItem(['a', 'b'], 1, 1)).toEqual(['a', 'b'])
  })
  it('cycles through the queue', () => {
    const q = ['a', 'b', 'c']
    expect(nextInQueue(q, null)).toBe('a')
    expect(nextInQueue(q, 'a')).toBe('b')
    expect(nextInQueue(q, 'c')).toBe('a')
    expect(nextInQueue(q, 'zzz')).toBe('a')
    expect(nextInQueue([], null)).toBeNull()
    expect(nextInQueue(['a'], 'a')).toBeNull()
  })
  it('skips unusable disks', () => {
    expect(nextInQueue(['a', 'b', 'c'], 'a', (id) => id !== 'b')).toBe('c')
    expect(nextInQueue(['a', 'b'], 'a', () => false)).toBeNull()
  })
  it('detects unsaved queue changes', () => {
    const saved = { id: 'q', name: 'Game', media_ids: ['a', 'b'] }
    expect(queueDirty(saved, 'Game', ['a', 'b'])).toBe(false)
    expect(queueDirty(saved, 'Game', ['b', 'a'])).toBe(true)
    expect(queueDirty(saved, 'Game 2', ['a', 'b'])).toBe(true)
    expect(queueDirty(null, '', [])).toBe(false)
    expect(queueDirty(null, 'New', [])).toBe(true)
  })
})

describe('drive helpers', () => {
  const dd = (media_id: string | null): DriveConfig => ({ kind: 'dd35', media_id, write_protect: false })
  const off: DriveConfig = { kind: 'disabled', media_id: null, write_protect: false }
  it('finds the drive already holding a disk', () => {
    const drives = [dd('a'), dd('b'), off, off]
    expect(driveHolding(drives, 'b')).toBe(1)
    expect(driveHolding(drives, 'b', 1)).toBe(-1)
    expect(driveHolding(drives, 'zzz')).toBe(-1)
  })
  it('disabling a drive removes its disk', () => {
    expect(withDriveKind(dd('a'), 'disabled')).toEqual(off)
    expect(withDriveKind(dd('a'), 'hd35')).toEqual({ kind: 'hd35', media_id: 'a', write_protect: false })
  })
  it('originals are always write-protected', () => {
    expect(effectiveWriteProtect(disk({ pristine: true }), false)).toBe(true)
    expect(effectiveWriteProtect(disk({ pristine: false }), false)).toBe(false)
    expect(effectiveWriteProtect(disk({ pristine: false }), true)).toBe(true)
  })
})
