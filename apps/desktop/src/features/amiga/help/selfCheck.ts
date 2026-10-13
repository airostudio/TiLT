// Self-check: every row is produced from a real backend call, never from assumptions.
import { call, errorMessage } from '@/api/client'
import type { AppInfo, EngineInfo, HdfRecord, MachineProfile, MediaRecord, RomRecord, SessionRecord, StorageReport, Validation } from '@/api/types'
import { formatBytes, formatDate, formatDuration } from '@/lib/format'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  id: string
  title: string
  status: CheckStatus
  detail: string
}

type Attempt<T> = { ok: T; err?: undefined } | { ok?: undefined; err: { code: string; message: string } }

async function attempt<T>(cmd: string, args: Record<string, unknown> = {}): Promise<Attempt<T>> {
  try {
    return { ok: await call<T>(cmd, args) }
  } catch (e) {
    return { err: { code: (e as { code?: string }).code ?? 'internal', message: errorMessage(e) } }
  }
}

const names = (xs: string[], max = 4): string => (xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} and ${xs.length - max} more`)
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`

/** Oldest Amiberry TiLT's generated configuration has been validated against. */
export const MIN_TESTED: [number, number, number] = [8, 4, 0]
export const olderThan = (v: [number, number, number] | null, min: [number, number, number]): boolean => {
  if (!v) return false
  for (let i = 0; i < 3; i++) {
    if (v[i] !== min[i]) return v[i] < min[i]
  }
  return false
}

export async function runSelfCheck(): Promise<CheckResult[]> {
  const out: CheckResult[] = []
  const add = (id: string, title: string, status: CheckStatus, detail: string) => out.push({ id, title, status, detail })

  // --- emulator engine ---
  const eng = await attempt<EngineInfo>('engine_info')
  if (eng.err) {
    add('engine', 'Emulator engine', 'fail', `The emulator engine could not be used. ${eng.err.message}`)
    add('control', 'Live control of the emulator', 'warn', 'Unknown, because the emulator engine was not found.')
  } else {
    const e = eng.ok
    add(
      'engine',
      'Emulator engine',
      olderThan(e.version, MIN_TESTED) ? 'warn' : 'pass',
      `${e.banner} at ${e.path}.${olderThan(e.version, MIN_TESTED) ? ` This is older than ${MIN_TESTED.join('.')}, the oldest version TiLT was tested with.` : ' It started and identified itself correctly.'}`,
    )
    add(
      'control',
      'Live control of the emulator',
      e.runtime_control ? 'pass' : 'warn',
      e.runtime_control ? 'Pause, disk changes, previews and saved states are available while a machine runs.' : (e.runtime_control_note ?? 'This build has no control channel; use the emulator menu (F12) for live changes.'),
    )
  }

  // --- library ---
  const rep = await attempt<StorageReport>('storage_report')
  if (rep.err) add('library', 'Library is readable', 'fail', `The library could not be read: ${rep.err.message}`)
  else add('library', 'Library is readable', 'pass', `Library at ${rep.ok.root} holds ${formatBytes(rep.ok.total_managed)}; ${formatBytes(rep.ok.free_host)} is free on that drive.`)

  const rec = await attempt<{ partial_files_removed: number; operations_rolled_forward: number; operations_rolled_back: number }>('recover')
  if (rec.err) add('recover', 'Interrupted operations', 'fail', `Recovery check failed: ${rec.err.message}`)
  else {
    const r = rec.ok
    const total = r.partial_files_removed + r.operations_rolled_forward + r.operations_rolled_back
    add(
      'recover',
      'Interrupted operations',
      total === 0 ? 'pass' : 'warn',
      total === 0
        ? 'Nothing was left half-finished by an earlier crash or power cut.'
        : `Cleaned up after an interrupted operation: ${plural(r.partial_files_removed, 'partial file')} removed, ${plural(r.operations_rolled_forward, 'operation')} finished, ${plural(r.operations_rolled_back, 'operation')} undone. Nothing of yours was deleted.`,
    )
  }

  const orph = await attempt<string[]>('orphans')
  if (orph.err) add('orphans', 'Stray files', 'fail', `Could not look for stray files: ${orph.err.message}`)
  else
    add(
      'orphans',
      'Stray files',
      orph.ok.length === 0 ? 'pass' : 'warn',
      orph.ok.length === 0 ? 'Every file in the library folders belongs to something in the library.' : `${plural(orph.ok.length, 'file')} in the library folders are not known to the library (for example ${names(orph.ok.slice(0, 3))}). They are never deleted automatically.`,
    )

  // --- ROMs ---
  const roms = await attempt<RomRecord[]>('rom_list')
  if (roms.err) add('roms', 'Kickstart ROMs', 'fail', `Could not read the ROM library: ${roms.err.message}`)
  else {
    const missing = roms.ok.filter((r) => r.missing)
    if (roms.ok.length === 0) add('roms', 'Kickstart ROMs', 'warn', 'No Kickstart ROM has been imported. A machine cannot start without one. Import one in the ROM Library.')
    else if (missing.length) add('roms', 'Kickstart ROMs', 'fail', `${plural(missing.length, 'ROM file')} missing from disk: ${names(missing.map((r) => r.name))}. Relink them in the ROM Library.`)
    else add('roms', 'Kickstart ROMs', 'pass', `${plural(roms.ok.length, 'ROM')} imported: ${names(roms.ok.map((r) => r.info.label))}.`)
  }

  // --- floppies ---
  const media = await attempt<MediaRecord[]>('media_list')
  if (media.err) add('media', 'Disk images', 'fail', `Could not read the disk library: ${media.err.message}`)
  else {
    const missing = media.ok.filter((m) => m.missing)
    add(
      'media',
      'Disk images',
      missing.length ? 'fail' : 'pass',
      missing.length ? `${plural(missing.length, 'disk image')} referenced by the library ${missing.length === 1 ? 'is' : 'are'} missing from disk: ${names(missing.map((m) => m.name))}.` : `${plural(media.ok.length, 'disk image')} in the library, all present.`,
    )
  }

  // --- hard disks ---
  const hdfs = await attempt<HdfRecord[]>('hdf_list')
  if (hdfs.err) add('hdf', 'Hard disk images', 'fail', `Could not read the hard disk library: ${hdfs.err.message}`)
  else {
    const missing = hdfs.ok.filter((h) => h.working_missing)
    const unclean = hdfs.ok.filter((h) => h.unclean_shutdown)
    if (missing.length) add('hdf', 'Hard disk images', 'fail', `The working file of ${names(missing.map((h) => h.name))} is missing from disk. Restore it from a backup in Hard Drives.`)
    else if (unclean.length) add('hdf', 'Hard disk images', 'warn', `${names(unclean.map((h) => h.name))} was in use when the emulator last stopped without exiting cleanly. AmigaDOS may validate it on the next boot; restore a backup if you see errors.`)
    else add('hdf', 'Hard disk images', 'pass', hdfs.ok.length ? `${plural(hdfs.ok.length, 'hard disk')} present and last shut down cleanly.` : 'No hard disks imported yet.')
  }

  // --- free space vs HDF sizes ---
  if (!rep.err && !hdfs.err) {
    const sizes = hdfs.ok.map((h) => h.size)
    const biggest = Math.max(0, ...sizes)
    const total = sizes.reduce((a, b) => a + b, 0)
    const free = rep.ok.free_host
    if (sizes.length === 0) add('space', 'Free disk space', 'pass', `${formatBytes(free)} free. No hard disks to back up.`)
    else if (free < biggest) add('space', 'Free disk space', 'fail', `Only ${formatBytes(free)} is free, less than your largest hard disk (${formatBytes(biggest)}). TiLT makes a safety backup before each start, which will not fit. Free some space.`)
    else if (free < total) add('space', 'Free disk space', 'warn', `${formatBytes(free)} is free, enough for one more copy of your largest hard disk (${formatBytes(biggest)}) but not for backups of all of them (${formatBytes(total)}).`)
    else add('space', 'Free disk space', 'pass', `${formatBytes(free)} is free, comfortably more than your hard disks (${formatBytes(total)} in total).`)
  }

  // --- machines ---
  const profs = await attempt<MachineProfile[]>('profile_list')
  if (profs.err) add('machines', 'Machines', 'fail', `Could not read your machines: ${profs.err.message}`)
  else {
    const bad: string[] = []
    for (const p of profs.ok) {
      const v = await attempt<Validation>('profile_validate', { profile: p })
      if (v.err || v.ok.issues.some((i) => i.severity === 'error')) bad.push(p.name)
    }
    add('machines', 'Machines', bad.length ? 'warn' : 'pass', bad.length ? `${plural(bad.length, 'machine')} cannot start until fixed: ${names(bad)}.` : `${plural(profs.ok.length, 'machine')} checked; none has a configuration error.`)
  }

  return out
}

export function summarise(rows: CheckResult[]): { pass: number; warn: number; fail: number } {
  return { pass: rows.filter((r) => r.status === 'pass').length, warn: rows.filter((r) => r.status === 'warn').length, fail: rows.filter((r) => r.status === 'fail').length }
}

const LABEL: Record<CheckStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }

/** Plain-text report for support. Only contains what the screens already show (including file locations). */
export function buildReport(info: AppInfo | null, engine: EngineInfo | null, checks: CheckResult[] | null, sessions: SessionRecord[]): string {
  const lines: string[] = ['Amiga Studio diagnostics', `Created: ${new Date().toISOString()}`, '']
  lines.push('System')
  lines.push(`  App version: ${info?.version ?? 'unknown'}`)
  lines.push(`  Platform: ${info ? `${info.platform} / ${info.arch}` : 'unknown'}`)
  lines.push(`  Library location: ${info?.storage_root ?? 'unknown'}`)
  lines.push(`  Emulator engine: ${engine ? `${engine.banner} (${engine.path})` : 'not found'}`)
  lines.push(`  Live control of the emulator: ${(engine?.runtime_control ?? info?.runtime_control) ? 'available' : 'not available'}`)
  if (engine?.runtime_control_note) lines.push(`    ${engine.runtime_control_note}`)
  lines.push('')
  lines.push('Self-check')
  if (!checks) lines.push('  (not run)')
  else for (const c of checks) lines.push(`  [${LABEL[c.status]}] ${c.title}: ${c.detail}`)
  lines.push('')
  lines.push('Recent sessions')
  if (sessions.length === 0) lines.push('  (none)')
  for (const s of sessions) {
    const dur = s.ended_at ? formatDuration(Math.max(0, s.ended_at - s.started_at)) : 'did not finish'
    lines.push(`  ${formatDate(s.started_at)}  ${s.profile_name}  ${dur}  ${s.outcome ?? 'no outcome recorded'}`)
  }
  return lines.join('\n')
}
