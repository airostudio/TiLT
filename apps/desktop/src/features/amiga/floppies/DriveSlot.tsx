import { useState, type DragEvent } from 'react'
import type { DriveKind } from '@/api/types'
import { Badge, Button, Icon, Select, Toggle } from '@/components/ui'
import { formatBytes } from '@/lib/format'
import { DiskBadges } from '../shared/DiskBadges'
import { DRIVE_NAMES, formatSummary } from '../shared/disks'
import { ACTIVITY_TEXT, KIND_LABEL, type SlotModel } from './model'

export const DISK_MIME = 'application/x-tilt-disk'

interface Props {
  slot: SlotModel
  /** `live`: a running machine; `profile`: editing a saved machine. */
  mode: 'live' | 'profile'
  busy: boolean
  onInsert: () => void
  onEject: () => void
  onProtect: (v: boolean) => void
  onWorkingCopy: () => void
  onKind: (k: DriveKind) => void
  onDropDisk: (mediaId: string) => void
}

export function DriveSlot({ slot, mode, busy, onInsert, onEject, onProtect, onWorkingCopy, onKind, onDropDisk }: Props) {
  const [over, setOver] = useState(false)
  const name = DRIVE_NAMES[slot.unit]
  const occupied = !!slot.label
  const ledClass = slot.activity === 'reading' ? 'read' : slot.activity === 'writing' ? 'write' : ''

  const accepts = (e: DragEvent) => slot.enabled && e.dataTransfer.types.includes(DISK_MIME)

  return (
    <section
      className={`card drive-slot fd-slot ${over ? 'fd-over' : ''} ${slot.enabled ? '' : 'fd-off'}`}
      aria-label={`Floppy drive ${name}`}
      data-testid={`slot-${slot.unit}`}
      data-state={occupied ? 'disk' : slot.enabled ? 'empty' : 'off'}
      onDragOver={(e) => {
        if (!accepts(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false)
      }}
      onDrop={(e) => {
        setOver(false)
        if (!accepts(e)) return
        e.preventDefault()
        const id = e.dataTransfer.getData(DISK_MIME)
        if (id) onDropDisk(id)
      }}
    >
      <div className="row-nowrap">
        <h2 className="fd-name">{name}</h2>
        <span className="muted xs">{slot.kind ? KIND_LABEL[slot.kind] : slot.enabled ? '3.5″ drive' : 'Not fitted'}</span>
        <span className="spacer" />
        <span className="fd-led" data-testid={`led-${slot.unit}`} data-activity={slot.activity}>
          <span className={`led ${ledClass}`} aria-hidden="true" />
          <span className="xs">{ACTIVITY_TEXT[slot.activity]}</span>
        </span>
      </div>

      {mode === 'profile' && (
        <Select
          aria-label={`${name} drive type`}
          value={slot.kind ?? 'disabled'}
          onChange={(e) => onKind(e.target.value as DriveKind)}
          title="Drives must be switched on in order: DF0:, then DF1:, and so on"
        >
          <option value="disabled">Not fitted (off)</option>
          <option value="dd35">3.5″ double density (standard)</option>
          <option value="hd35">3.5″ high density</option>
        </Select>
      )}

      {!slot.enabled ? (
        <p className="muted small fd-note">
          {mode === 'profile' ? 'This drive is switched off. Choose a drive type above to fit it.' : 'This drive is switched off in the running machine. Change the machine’s drives in My Amigas and restart it to use it.'}
        </p>
      ) : occupied ? (
        <div className="stack-sm fd-disk" data-testid={`disk-${slot.unit}`}>
          <div className="row-nowrap">
            <Icon name="floppy" size={20} />
            <strong className="truncate" title={slot.label ?? undefined}>
              {slot.label}
            </strong>
          </div>
          {slot.media ? <DiskBadges disk={slot.media} /> : <Badge title="This disk is not a disk from your library">Not from the library</Badge>}
          <dl className="fd-facts">
            <dt>File</dt>
            <dd className="truncate mono" title={slot.path ?? undefined}>
              {slot.file ?? 'unknown'}
            </dd>
            <dt>Format</dt>
            <dd title={slot.media ? formatSummary(slot.media) : undefined}>
              {slot.media ? `${formatSummary(slot.media)} · ${formatBytes(slot.media.size)}` : 'unknown'}
            </dd>
            <dt>Protection</dt>
            <dd data-testid={`protect-${slot.unit}`}>
              {slot.writeProtected ? (
                <Badge tone="success" title="The Amiga can read this disk but cannot change it">
                  <Icon name="lock" size={12} /> Write-protected (read-only)
                </Badge>
              ) : (
                <Badge tone="warning" title="Programs on the Amiga can change this disk">
                  Writable
                </Badge>
              )}
            </dd>
            {slot.track != null && slot.activity !== 'idle' && (
              <>
                <dt>Head</dt>
                <dd>Track {slot.track}</dd>
              </>
            )}
          </dl>
          <Toggle
            label="Write-protect this disk"
            checked={slot.writeProtected}
            disabled={busy || slot.protectLocked || (mode === 'live' && slot.activity === 'writing')}
            onChange={onProtect}
          />
          {slot.protectLocked && (
            <p className="faint xs">
              Untouched original: always inserted write-protected. To save changes,{' '}
              <button type="button" className="fd-link" onClick={onWorkingCopy}>
                make a working copy
              </button>
              .
            </p>
          )}
          {mode === 'live' && !slot.protectLocked && <p className="faint xs">Changing protection takes the disk out and puts it back in, as on a real Amiga.</p>}
        </div>
      ) : (
        <div className="fd-empty" data-testid={`empty-${slot.unit}`}>
          <Icon name="floppy" size={26} />
          <span>No disk inserted</span>
          <span className="faint xs">Drop a disk here from the list</span>
        </div>
      )}

      {slot.enabled && (
        <div className="row fd-actions">
          {occupied ? (
            <>
              <Button size="sm" disabled={busy} onClick={onInsert} aria-label={`Replace the disk in ${name}`}>
                Replace…
              </Button>
              <Button size="sm" icon="eject" disabled={busy} onClick={onEject} aria-label={`Eject the disk from ${name}`}>
                Eject
              </Button>
            </>
          ) : (
            <Button size="sm" variant="primary" icon="plus" disabled={busy} onClick={onInsert} aria-label={`Insert a floppy disk into ${name}`}>
              Insert a floppy disk
            </Button>
          )}
          <a className="small" href="#/amiga/disks">
            Browse disk library
          </a>
        </div>
      )}
    </section>
  )
}
