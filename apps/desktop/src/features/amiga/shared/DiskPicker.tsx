import { useId, useMemo, useState, type ReactNode } from 'react'
import { call } from '@/api/client'
import type { MediaRecord } from '@/api/types'
import { Button, Modal, TextInput, Toggle } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { formatBytes } from '@/lib/format'
import { DiskBadges } from './DiskBadges'
import { filterDisks, formatSummary, sortDisks } from './disks'
import './shared.css'

export interface PickOptions {
  writeProtect: boolean
}

interface Props {
  title: string
  /** Candidate disks (the caller decides what is allowed, e.g. ADF only). */
  disks: MediaRecord[]
  multiple?: boolean
  /** id -> reason the disk cannot be chosen right now. */
  unavailable?: Record<string, string>
  /** Show a "Recently used" section first. */
  recent?: boolean
  /** Offer the "write-protect" checkbox (floppy drives). */
  protectOption?: boolean
  intro?: ReactNode
  confirmLabel: string
  onClose: () => void
  onConfirm: (ids: string[], opts: PickOptions) => Promise<void> | void
}

/** Searchable disk chooser used for inserting into a drive, building queues and Workbench sets. */
export function DiskPickerModal({ title, disks, multiple, unavailable = {}, recent, protectOption, intro, confirmLabel, onClose, onConfirm }: Props) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [protect, setProtect] = useState(false)
  const [busy, setBusy] = useState(false)
  const listId = useId()
  const recents = useLoad(() => (recent ? call<MediaRecord[]>('media_recent') : Promise.resolve([])), [recent])

  const allowed = useMemo(() => new Set(disks.map((d) => d.id)), [disks])
  const visible = useMemo(() => sortDisks(filterDisks(disks, query, 'all')), [disks, query])
  const recentRows = useMemo(() => {
    if (!recent || query.trim()) return []
    const vis = new Set(visible.map((d) => d.id))
    return (recents.data ?? []).filter((d) => allowed.has(d.id) && vis.has(d.id))
  }, [recent, query, recents.data, allowed, visible])
  const recentIds = new Set(recentRows.map((d) => d.id))
  const rest = visible.filter((d) => !recentIds.has(d.id))

  const toggle = (id: string) => {
    if (unavailable[id]) return
    setPicked((p) => (multiple ? (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]) : [id]))
  }
  const pickedDisk = !multiple && picked[0] ? disks.find((d) => d.id === picked[0]) : undefined
  const locked = !!pickedDisk?.pristine

  const confirm = async (ids = picked) => {
    if (!ids.length || busy) return
    setBusy(true)
    try {
      await onConfirm(ids, { writeProtect: locked || protect })
    } finally {
      setBusy(false)
    }
  }

  const row = (d: MediaRecord) => {
    const why = unavailable[d.id]
    const inputId = `${listId}-${d.id}`
    const selected = picked.includes(d.id)
    return (
      <label key={d.id} htmlFor={inputId} className={`dk-row ${selected ? 'selected' : ''} ${why ? 'disabled' : ''}`} onDoubleClick={() => !multiple && !why && void confirm([d.id])}>
        <input
          id={inputId}
          type={multiple ? 'checkbox' : 'radio'}
          name={`${listId}-pick`}
          checked={selected}
          disabled={!!why}
          onChange={() => toggle(d.id)}
        />
        <span style={{ minWidth: 0 }}>
          <span className="dk-name">{d.name}</span>
          <span className="dk-sub" style={{ display: 'block' }}>
            {formatSummary(d)} · {formatBytes(d.size)}
          </span>
          {why && <span className="dk-why">{why}</span>}
        </span>
        <DiskBadges disk={d} />
      </label>
    )
  }

  return (
    <Modal
      wide
      title={title}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!picked.length || busy} onClick={() => void confirm()}>
            {confirmLabel}
            {multiple && picked.length > 0 ? ` (${picked.length})` : ''}
          </Button>
        </>
      }
    >
      {intro && <div className="muted small">{intro}</div>}
      <TextInput label="Search your disks" placeholder="Type part of a disk name…" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="dk-list" role="group" aria-label="Disks" data-testid="disk-picker-list">
        {disks.length === 0 ? (
          <div className="dk-empty">There are no disks in your library yet. Add some in the Disk Library.</div>
        ) : visible.length === 0 ? (
          <div className="dk-empty">No disks match “{query}”.</div>
        ) : (
          <>
            {recentRows.length > 0 && <div className="dk-group">Recently used</div>}
            {recentRows.map(row)}
            {recentRows.length > 0 && rest.length > 0 && <div className="dk-group">All disks</div>}
            {rest.map(row)}
          </>
        )}
      </div>
      {protectOption && (
        <div className="stack-sm">
          <Toggle
            label="Write-protect this disk (the Amiga can read it but not change it)"
            checked={locked || protect}
            disabled={locked}
            onChange={setProtect}
          />
          {locked && <span className="faint xs">Untouched originals are always inserted write-protected. To save changes, make a working copy first.</span>}
        </div>
      )}
    </Modal>
  )
}
