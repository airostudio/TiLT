import { useMemo, useState } from 'react'
import type { MediaRecord } from '@/api/types'
import { Badge, Card, Icon, TextInput } from '@/components/ui'
import { DRIVE_NAMES, filterDisks, formatSummary, isAdf } from '../shared/disks'
import { DISK_MIME } from './DriveSlot'
import type { SlotModel } from './model'

/** Library list that disks can be dragged from onto a drive. */
export function DiskPanel({ media, slots }: { media: MediaRecord[]; slots: SlotModel[] }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(
    () =>
      filterDisks(media.filter(isAdf), query, 'all').sort(
        (a, b) => (b.last_used ?? 0) - (a.last_used ?? 0) || b.imported_at - a.imported_at || a.name.localeCompare(b.name),
      ),
    [media, query],
  )
  const heldIn = (id: string) => slots.filter((s) => s.enabled && s.mediaId === id).map((s) => DRIVE_NAMES[s.unit])
  return (
    <Card title="Your disks" className="fd-panel" data-testid="disk-panel">
      <div className="stack-sm">
        <TextInput label="Search" type="search" placeholder="Search your disks…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <p className="faint xs">Drag a disk onto a drive, or use a drive’s Insert button.</p>
        {media.filter(isAdf).length === 0 ? (
          <p className="muted small">
            Your library has no floppy disks yet. <a href="#/amiga/disks">Add some in the Disk Library</a>.
          </p>
        ) : rows.length === 0 ? (
          <p className="muted small">No disks match “{query}”.</p>
        ) : (
          <ul className="fd-disks" aria-label="Disks you can drag onto a drive">
            {rows.map((m) => {
              const where = heldIn(m.id)
              return (
                <li
                  key={m.id}
                  className="fd-disk-item"
                  draggable={!m.missing}
                  data-testid="panel-disk"
                  data-name={m.name}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DISK_MIME, m.id)
                    e.dataTransfer.setData('text/plain', m.name)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                >
                  <Icon name="floppy" size={16} />
                  <span style={{ minWidth: 0 }}>
                    <span className="fd-item-name truncate">{m.name}</span>
                    <span className="faint xs truncate" style={{ display: 'block' }}>
                      {formatSummary(m)}
                    </span>
                  </span>
                  <span className="row-nowrap" style={{ gap: 4 }}>
                    {where.length > 0 && <Badge tone="accent">In {where.join(', ')}</Badge>}
                    {m.missing ? (
                      <Badge tone="danger">Missing file</Badge>
                    ) : m.pristine ? (
                      <Badge tone="success" title="Untouched original: always inserted write-protected">
                        Original
                      </Badge>
                    ) : (
                      <Badge tone="accent" title="A disk you can write to">
                        {m.parent_id ? 'Working copy' : 'Writable'}
                      </Badge>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
