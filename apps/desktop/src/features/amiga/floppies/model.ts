// Turns either the live emulator state or an editable machine profile into the same slot model.
import type { DriveConfig, DriveKind, DriveView, MediaRecord } from '@/api/types'
import { basename } from '@/lib/format'
import { effectiveWriteProtect } from '../shared/disks'

export type Activity = 'reading' | 'writing' | 'idle' | 'off' | 'not-running'

export interface SlotModel {
  unit: number
  enabled: boolean
  kind: DriveKind | null
  media: MediaRecord | null
  mediaId: string | null
  /** What the drive holds, even if the disk is not in the library. */
  label: string | null
  file: string | null
  path: string | null
  writeProtected: boolean
  /** Untouched originals cannot be made writable. */
  protectLocked: boolean
  activity: Activity
  track: number | null
}

export const KIND_LABEL: Record<DriveKind, string> = {
  disabled: 'Not fitted',
  dd35: '3.5″ double density',
  hd35: '3.5″ high density',
}

export function liveSlots(drives: DriveView[], media: MediaRecord[], kinds: (DriveKind | undefined)[] = []): SlotModel[] {
  const byId = new Map(media.map((m) => [m.id, m]))
  return [0, 1, 2, 3].map((unit) => {
    const v = drives.find((d) => d.unit === unit)
    if (!v) return emptySlot(unit)
    const m = v.media_id ? (byId.get(v.media_id) ?? null) : null
    const inserted = !!(v.path || v.media_id)
    return {
      unit,
      enabled: v.enabled,
      kind: kinds[unit] ?? null,
      media: m,
      mediaId: v.media_id,
      label: inserted ? (m?.name ?? v.media_name ?? (v.path ? basename(v.path) : 'Unknown disk')) : null,
      file: v.path ? basename(v.path) : null,
      path: v.path,
      writeProtected: v.write_protected,
      protectLocked: !!m?.pristine,
      activity: !v.enabled ? 'off' : v.writing ? 'writing' : v.motor ? 'reading' : 'idle',
      track: v.track,
    }
  })
}

export function profileSlots(drives: DriveConfig[], media: MediaRecord[]): SlotModel[] {
  const byId = new Map(media.map((m) => [m.id, m]))
  return [0, 1, 2, 3].map((unit) => {
    const d = drives[unit]
    if (!d) return emptySlot(unit)
    const enabled = d.kind !== 'disabled'
    const m = d.media_id ? (byId.get(d.media_id) ?? null) : null
    return {
      unit,
      enabled,
      kind: d.kind,
      media: m,
      mediaId: enabled ? d.media_id : null,
      label: enabled && d.media_id ? (m?.name ?? 'Disk no longer in the library') : null,
      file: m ? basename(m.path) : null,
      path: m?.path ?? null,
      writeProtected: enabled && !!d.media_id && effectiveWriteProtect(m, d.write_protect),
      protectLocked: !!m?.pristine,
      activity: enabled ? 'not-running' : 'off',
      track: null,
    }
  })
}

function emptySlot(unit: number): SlotModel {
  return { unit, enabled: false, kind: null, media: null, mediaId: null, label: null, file: null, path: null, writeProtected: false, protectLocked: false, activity: 'off', track: null }
}

export const ACTIVITY_TEXT: Record<Activity, string> = {
  reading: 'Reading',
  writing: 'Writing',
  idle: 'Idle',
  off: 'Drive off',
  'not-running': 'Not running',
}
