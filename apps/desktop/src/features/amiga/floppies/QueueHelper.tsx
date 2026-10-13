import { useEffect, useMemo, useState } from 'react'
import type { MediaRecord, Queue } from '@/api/types'
import { Badge, Button, Card, Select } from '@/components/ui'
import { useLocalStorage } from '@/lib/hooks'
import { DRIVE_NAMES, nextInQueue } from '../shared/disks'
import type { SlotModel } from './model'

/** "Insert next disk": steps through a saved queue, wrapping round, into one drive. */
export function QueueHelper({
  queues,
  media,
  slots,
  busy,
  mode,
  onInsertNext,
}: {
  queues: Queue[]
  media: MediaRecord[]
  slots: SlotModel[]
  busy: boolean
  mode: 'live' | 'profile'
  onInsertNext: (unit: number, mediaId: string) => void
}) {
  const [queueId, setQueueId] = useLocalStorage('fd.queue', '')
  const [unitText, setUnitText] = useState('0')
  const unit = Number(unitText)
  const queue = queues.find((q) => q.id === queueId) ?? null
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media])
  const fitted = slots.filter((s) => s.enabled)

  // keep the chosen drive valid when drives are switched off
  useEffect(() => {
    if (fitted.length && !fitted.some((s) => s.unit === unit)) setUnitText(String(fitted[0].unit))
  }, [fitted, unit])

  const target = slots[unit]
  const heldElsewhere = (id: string) => slots.some((s) => s.unit !== unit && s.enabled && s.mediaId === id)
  const usable = (id: string) => {
    const m = byId.get(id)
    return !!m && !m.missing && m.kind === 'adf' && !heldElsewhere(id)
  }
  const next = queue ? nextInQueue(queue.media_ids, target?.mediaId ?? null, usable) : null
  const nextDisk = next ? byId.get(next) : undefined
  const pos = queue && next ? queue.media_ids.indexOf(next) + 1 : 0

  return (
    <Card title="Disk queue" className="fd-queue" data-testid="queue-helper">
      <div className="stack">
        <p className="muted small">For games on several disks: choose a queue, then press <em>Insert next disk</em> each time the game asks for the next one.</p>
        {queues.length === 0 ? (
          <p className="small">
            You have no queues yet. <a href="#/amiga/disks">Create one in the Disk Library</a> (Queues tab).
          </p>
        ) : (
          <>
            <div className="grid grid-2">
              <Select label="Queue" value={queueId} onChange={(e) => setQueueId(e.target.value)}>
                <option value="">Choose a queue…</option>
                {queues.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name} ({q.media_ids.length} disks)
                  </option>
                ))}
              </Select>
              <Select label="Into drive" value={unitText} onChange={(e) => setUnitText(e.target.value)} disabled={fitted.length === 0}>
                {fitted.map((s) => (
                  <option key={s.unit} value={s.unit}>
                    {DRIVE_NAMES[s.unit]}
                  </option>
                ))}
              </Select>
            </div>
            {queue && (
              <ol className="fd-qsteps" aria-label={`Disks in ${queue.name}`}>
                {queue.media_ids.map((id, i) => {
                  const here = target?.mediaId === id
                  const isNext = id === next
                  return (
                    <li key={id} aria-current={here ? 'true' : undefined} className={isNext ? 'next' : ''}>
                      <span className="fd-qnum">{i + 1}</span>
                      <span className="truncate">{byId.get(id)?.name ?? 'Unknown disk'}</span>
                      {here && <Badge tone="accent">In {DRIVE_NAMES[unit]}</Badge>}
                      {isNext && <Badge>Next</Badge>}
                    </li>
                  )
                })}
              </ol>
            )}
            <div className="row">
              <Button variant="primary" icon="chevron" disabled={busy || !queue || !nextDisk || !target?.enabled} onClick={() => next && onInsertNext(unit, next)}>
                Insert next disk
              </Button>
              <span className="muted small" aria-live="polite" data-testid="queue-next">
                {!queue ? 'Choose a queue first.' : nextDisk ? `Next: ${nextDisk.name} (disk ${pos} of ${queue.media_ids.length})` : queue.media_ids.length === 0 ? 'This queue is empty.' : 'No other disk in this queue can be inserted right now.'}
              </span>
            </div>
            {mode === 'profile' && <p className="faint xs">Changes are made to the machine’s drives. Remember to save them.</p>}
          </>
        )}
      </div>
    </Card>
  )
}
