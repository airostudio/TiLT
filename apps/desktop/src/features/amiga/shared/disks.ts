// Pure helpers shared by the Disk Library and Floppy Drives screens (no React, easy to unit test).
import type { DiskRole, DriveConfig, MediaRecord, Queue, WbVersion } from '@/api/types'

export type DiskFilter = 'all' | 'originals' | 'working' | 'archives'

export const FILTER_LABELS: Record<DiskFilter, string> = {
  all: 'All',
  originals: 'Untouched originals',
  working: 'Working copies',
  archives: 'DMS archives',
}

export const isAdf = (m: MediaRecord): boolean => m.kind === 'adf'

/** An ADF that can be changed (blank disk or working copy). */
export const isWritable = (m: MediaRecord): boolean => m.kind === 'adf' && !m.pristine

export function adfWarnings(m: MediaRecord): string[] {
  return m.info.adf?.warnings ?? []
}

/** Anything the backend flagged about the image itself (not just a missing file). */
export const needsAttention = (m: MediaRecord): boolean => adfWarnings(m).length > 0

export function matchesFilter(m: MediaRecord, f: DiskFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'originals':
      return m.kind === 'adf' && m.pristine
    case 'working':
      return m.kind === 'adf' && !m.pristine
    case 'archives':
      return m.kind === 'dms'
  }
}

export function matchesQuery(m: MediaRecord, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return true
  const hay = [m.name, m.info.adf?.volume_name ?? '', m.info.adf?.summary ?? '', m.sha256, m.kind].join('\n').toLowerCase()
  return needle.split(/\s+/).every((w) => hay.includes(w))
}

export function filterDisks(list: MediaRecord[], query: string, filter: DiskFilter): MediaRecord[] {
  return list.filter((m) => matchesFilter(m, filter) && matchesQuery(m, query))
}

/** Newest import first, ties broken by name. */
export function sortDisks(list: MediaRecord[]): MediaRecord[] {
  return [...list].sort((a, b) => b.imported_at - a.imported_at || a.name.localeCompare(b.name))
}

export function formatSummary(m: MediaRecord): string {
  if (m.info.adf) return m.info.adf.summary
  if (m.info.dms) return `DMS archive, ${m.info.dms.disk_type || 'disk'}${m.info.dms.high_density ? ' (high density)' : ''}`
  return m.kind.toUpperCase()
}

/** What the disk is, in a few plain words. */
export function originLabel(m: MediaRecord): string {
  if (m.kind === 'dms') return 'DMS archive (kept as imported)'
  if (m.pristine) return 'Untouched original (read-only)'
  return m.parent_id ? 'Working copy (you can write to it)' : 'Writable disk (you can write to it)'
}

export function bootStatus(m: MediaRecord): string {
  const a = m.info.adf
  if (!a) return 'Not applicable'
  if (a.all_zero) return 'Blank, unformatted disk'
  if (!a.bootblock_checksum_ok) return 'Not bootable (the boot block is not valid)'
  if (a.has_boot_code) return 'Bootable (contains start-up code)'
  return 'Not bootable (no start-up code; it can still be used as a data disk)'
}

export const bootable = (m: MediaRecord): boolean => !!m.info.adf && m.info.adf.bootblock_checksum_ok && m.info.adf.has_boot_code

// ---------- Workbench label classification (mirrors the backend's label rules) ----------
const ROLE_KEYS: [string, DiskRole][] = [
  ['workbench', 'workbench'],
  ['install', 'install'],
  ['extras', 'extras'],
  ['fonts', 'fonts'],
  ['storage', 'storage'],
  ['locale', 'locale'],
]

export function classifyLabel(label: string): { role: DiskRole; version: WbVersion } {
  const l = label.toLowerCase().replace(/ /g, '')
  const version: WbVersion = l.includes('3.1') ? '3.1' : l.includes('2.1') ? '2.1' : 'unknown'
  const role = ROLE_KEYS.find(([k]) => l.startsWith(k))?.[1] ?? 'other'
  return { role, version }
}

export const ROLE_NAMES: Record<DiskRole, string> = {
  workbench: 'Workbench',
  install: 'Install',
  extras: 'Extras',
  fonts: 'Fonts',
  storage: 'Storage',
  locale: 'Locale',
  other: 'Other',
}

/** Library ADFs whose volume label looks like a disk of this Workbench release. */
export function suggestWorkbenchDisks(list: MediaRecord[], version: '2.1' | '3.1'): MediaRecord[] {
  return list.filter((m) => {
    if (m.kind !== 'adf') return false
    const label = m.info.adf?.volume_name || m.name
    const c = classifyLabel(label)
    return c.role !== 'other' && (c.version === version || c.version === 'unknown')
  })
}

/** The Workbench and Install disks need strict version matches when the label states one. */
export function labelMatchesVersion(m: MediaRecord, version: '2.1' | '3.1'): boolean {
  const c = classifyLabel(m.info.adf?.volume_name || m.name)
  return c.role !== 'other' && c.version === version
}

// ---------- queues ----------
export function moveItem<T>(arr: T[], index: number, delta: -1 | 1): T[] {
  const to = index + delta
  if (index < 0 || index >= arr.length || to < 0 || to >= arr.length) return arr
  const out = [...arr]
  const [x] = out.splice(index, 1)
  out.splice(to, 0, x)
  return out
}

/**
 * The next disk to insert from an ordered queue. `current` is what is in the drive now:
 * if it is in the queue we continue after it (wrapping round); otherwise we start at the top.
 * Entries for which `usable` is false are skipped. Returns null if nothing is usable.
 */
export function nextInQueue(ids: string[], current: string | null, usable: (id: string) => boolean = () => true): string | null {
  if (!ids.length) return null
  const at = current ? ids.indexOf(current) : -1
  for (let step = 1; step <= ids.length; step++) {
    const id = ids[(at + step + ids.length) % ids.length]
    if (id !== current && usable(id)) return id
    if (id === current && ids.length === 1) return null
  }
  return null
}

export const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

export function queueDirty(saved: Queue | null, name: string, ids: string[]): boolean {
  return !saved ? name.trim() !== '' || ids.length > 0 : saved.name !== name || !sameIds(saved.media_ids, ids)
}

// ---------- floppy drives ----------
export const DRIVE_NAMES = ['DF0:', 'DF1:', 'DF2:', 'DF3:']

/** Drive in which `mediaId` already sits (other than `except`), if any. */
export function driveHolding(drives: DriveConfig[], mediaId: string, except = -1): number {
  return drives.findIndex((d, i) => i !== except && d.kind !== 'disabled' && d.media_id === mediaId)
}

/** Apply a new drive type; a drive that is not fitted cannot hold a disk. */
export function withDriveKind(d: DriveConfig, kind: DriveConfig['kind']): DriveConfig {
  return kind === 'disabled' ? { kind, media_id: null, write_protect: false } : { ...d, kind }
}

/** Originals are always write-protected; other disks follow the user's choice. */
export function effectiveWriteProtect(m: MediaRecord | null | undefined, wanted: boolean): boolean {
  return !!m?.pristine || wanted
}
