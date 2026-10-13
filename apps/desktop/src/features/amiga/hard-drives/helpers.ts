import { ApiError, errorMessage } from '@/api/client'
import type { HdController, HdfLayout, Issue, SnapshotKind } from '@/api/types'

export const LAYOUT_LABEL: Record<HdfLayout, string> = {
  rdb: 'Partitioned disk (RDB)',
  plain_hardfile: 'Plain hardfile (one volume)',
  blank: 'Blank, not formatted yet',
  unrecognised: 'Unrecognised layout',
}

export const LAYOUT_HELP: Record<HdfLayout, string> = {
  rdb: 'A normal Amiga hard disk: it has a partition table (a Rigid Disk Block, “RDB”) listing its partitions.',
  plain_hardfile: 'A single AmigaDOS volume without a partition table. Amiga Studio mounts it as one drive.',
  blank: 'The start of the file is empty, so nobody has partitioned or formatted this disk yet.',
  unrecognised: 'Amiga Studio could not find an Amiga partition table or filesystem at the start of the file.',
}

export const SNAPSHOT_LABEL: Record<SnapshotKind, string> = {
  auto_backup: 'Automatic backup',
  backup: 'Backup',
  snapshot: 'Snapshot',
  pre_restore: 'Before restore',
}

export const SNAPSHOT_HELP: Record<SnapshotKind, string> = {
  auto_backup: 'Made for you just before a machine started with this disk. Only the two newest are kept.',
  backup: 'A full copy you asked for. It is never deleted automatically.',
  snapshot: 'A named restore point you created. It is never deleted automatically.',
  pre_restore: 'The disk exactly as it was just before a restore replaced it, so a restore can be undone.',
}

export const CONTROLLER_LABEL: Record<HdController, string> = {
  mainboard_ide: 'Built-in IDE (A600 / A1200 / A4000 style)',
  uae: 'Generic controller (works with any model)',
}

export const CONTROLLER_HINT: Record<HdController, string> = {
  mainboard_ide: 'Behaves like the IDE port on the motherboard of an A600, A1200 or A4000. Kickstart 2.04 or newer can start from it.',
  uae: 'An emulated add-on controller that works with every model, including the A500 and A500+.',
}

export const SEVERITY_LABEL: Record<Issue['severity'], string> = { error: 'Problem', warning: 'Warning', info: 'Note' }

/** Absolute path check that works for POSIX, drive-letter and UNC paths. */
export const isAbsolutePath = (p: string): boolean => /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p.trim())

export function defaultDiskName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? ''
  return base.replace(/\.(hdf|img|dsk|vhd)$/i, '').trim() || 'Hard disk'
}

/** Turns a backend refusal into a sentence a beginner can act on. */
export function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return errorMessage(e)
  switch (e.code) {
    case 'locked':
      return `${e.message.replace(/[.]$/, '')}. Shut the machine down first, then try again.`
    case 'already_exists': {
      // tolerate both "already exists: <path>" and "<path> already exists"
      const where = e.message.replace(/^already exists:\s*/i, '').replace(/\s+already exists\.?$/i, '').trim()
      return `Something already exists at ${where || 'that location'}. Choose another location, or tick “Allow overwriting” to replace it.`
    }
    case 'insufficient_space':
      return `${e.message}. Free some space on that drive, or turn off the untouched copy.`
    default:
      return e.message
  }
}
