import { useMemo, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { MediaRecord, Queue } from '@/api/types'
import { Badge, Banner, Button, Card, Empty, ErrorNote, Loading, TextInput, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { DiskBadges } from '../shared/DiskBadges'
import { DiskPickerModal } from '../shared/DiskPicker'
import { formatSummary, isAdf, moveItem, queueDirty } from '../shared/disks'

type Sel = { kind: 'none' } | { kind: 'new' } | { kind: 'saved'; id: string }

/** Named, ordered lists of disks for multi-disk software ("insert disk 2…"). */
export function QueuesTab({ media }: { media: MediaRecord[] }) {
  const { toast, confirm } = useUi()
  const queues = useLoad(() => call<Queue[]>('queue_list'))
  const [sel, setSel] = useState<Sel>({ kind: 'none' })
  const [name, setName] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media])
  const list = queues.data ?? []
  const saved = sel.kind === 'saved' ? (list.find((q) => q.id === sel.id) ?? null) : null
  const editing = sel.kind !== 'none'
  const dirty = editing && queueDirty(saved, name, ids)

  const select = async (next: Sel, q?: Queue) => {
    if (dirty && !(await confirm({ title: 'Discard unsaved changes?', body: <p>The queue you are editing has changes that have not been saved.</p>, confirmLabel: 'Discard changes', danger: true }))) return
    setSel(next)
    setName(q?.name ?? '')
    setIds(q?.media_ids ?? [])
  }

  const save = async () => {
    if (!name.trim()) {
      toast('Give the queue a name first.', 'error')
      return
    }
    setBusy(true)
    try {
      const q = await call<Queue>('queue_save', { id: saved?.id, name: name.trim(), media_ids: ids })
      await queues.reload()
      setSel({ kind: 'saved', id: q.id })
      setName(q.name)
      setIds(q.media_ids)
      toast(`Queue “${q.name}” saved`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!saved) return
    const ok = await confirm({
      title: `Delete the queue “${saved.name}”?`,
      body: <p>Only the list is deleted. The disks stay in your library.</p>,
      confirmLabel: 'Delete queue',
      danger: true,
    })
    if (!ok) return
    try {
      await call('queue_delete', { id: saved.id })
      toast(`Queue “${saved.name}” deleted`, 'success')
      setSel({ kind: 'none' })
      setName('')
      setIds([])
      await queues.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const adfs = media.filter(isAdf)
  const inQueue = Object.fromEntries(ids.map((i) => [i, 'Already in this queue']))

  if (queues.loading) return <Loading />
  return (
    <div className="stack">
      <ErrorNote error={queues.error} />
      <Banner tone="info">
        A <strong>disk queue</strong> is an ordered list of disks for software that asks you to swap floppies (“Insert disk 2”). On the Floppy Drives screen, <em>Insert next disk</em> steps through the queue in this order.
      </Banner>
      <div className="dl-queues">
        <Card
          title="Your queues"
          actions={
            <Button size="sm" icon="plus" onClick={() => void select({ kind: 'new' })}>
              New queue
            </Button>
          }
        >
          {list.length === 0 && sel.kind !== 'new' ? (
            <p className="muted small">No queues yet. Create one for a game that comes on several disks.</p>
          ) : (
            <ul className="dl-qlist" aria-label="Disk queues">
              {list.map((q) => (
                <li key={q.id}>
                  <button type="button" className="dl-qitem" aria-current={sel.kind === 'saved' && sel.id === q.id ? 'true' : undefined} onClick={() => void select({ kind: 'saved', id: q.id }, q)}>
                    <span className="truncate">{q.name}</span>
                    <span className="muted xs">{q.media_ids.length} disk{q.media_ids.length === 1 ? '' : 's'}</span>
                  </button>
                </li>
              ))}
              {sel.kind === 'new' && (
                <li>
                  <span className="dl-qitem" aria-current="true">
                    <span className="truncate">{name.trim() || 'New queue'}</span>
                    <span className="muted xs">not saved</span>
                  </span>
                </li>
              )}
            </ul>
          )}
        </Card>

        {!editing ? (
          <Empty icon="list" title="Choose or create a queue">
            Select a queue on the left to change its disks and order, or create a new one.
          </Empty>
        ) : (
          <Card
            title={saved ? 'Edit queue' : 'New queue'}
            actions={dirty ? <Badge tone="warning">Unsaved changes</Badge> : saved ? <Badge tone="success">Saved</Badge> : undefined}
          >
            <div className="stack">
              <TextInput label="Queue name" placeholder="For example: Monkey Island" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
              <div className="stack-sm">
                <div className="row">
                  <strong>Disks, in the order they are inserted</strong>
                  <span className="spacer" />
                  <Button size="sm" icon="plus" onClick={() => setAdding(true)} disabled={adfs.length === 0}>
                    Add disks…
                  </Button>
                </div>
                {ids.length === 0 ? (
                  <p className="muted small dl-qempty">This queue is empty. Use “Add disks” to choose from your library.</p>
                ) : (
                  <ol className="dl-qdisks" data-testid="queue-disks">
                    {ids.map((id, i) => {
                      const d = byId.get(id)
                      return (
                        <li key={id} data-testid="queue-disk">
                          <span className="dl-qnum" aria-hidden="true">
                            {i + 1}
                          </span>
                          <span style={{ minWidth: 0 }}>
                            <span className="dl-qname truncate">{d?.name ?? 'Unknown disk'}</span>
                            <span className="muted xs truncate" style={{ display: 'block' }}>
                              {d ? formatSummary(d) : 'This disk is no longer in the library'}
                            </span>
                          </span>
                          {d && <DiskBadges disk={d} />}
                          <span className="row-nowrap" style={{ gap: 2 }}>
                            <Button size="sm" variant="ghost" iconOnly icon="chevron" className="dl-up" aria-label={`Move ${d?.name ?? 'disk'} up`} title="Move up" disabled={i === 0} onClick={() => setIds(moveItem(ids, i, -1))} />
                            <Button size="sm" variant="ghost" iconOnly icon="chevron" className="dl-down" aria-label={`Move ${d?.name ?? 'disk'} down`} title="Move down" disabled={i === ids.length - 1} onClick={() => setIds(moveItem(ids, i, 1))} />
                            <Button size="sm" variant="ghost" iconOnly icon="x" aria-label={`Remove ${d?.name ?? 'disk'} from the queue`} title="Remove from queue" onClick={() => setIds(ids.filter((x) => x !== id))} />
                          </span>
                        </li>
                      )
                    })}
                  </ol>
                )}
              </div>
              <div className="row">
                <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>
                  Save queue
                </Button>
                {saved && (
                  <Button variant="danger" icon="trash" onClick={() => void remove()}>
                    Delete queue…
                  </Button>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>
      {adding && (
        <DiskPickerModal
          multiple
          title="Add disks to the queue"
          disks={adfs}
          unavailable={inQueue}
          confirmLabel="Add to queue"
          intro="Pick the disks in the order you want them. You can reorder them afterwards."
          onClose={() => setAdding(false)}
          onConfirm={(picked) => {
            setIds((cur) => [...cur, ...picked.filter((p) => !cur.includes(p))])
            setAdding(false)
          }}
        />
      )}
    </div>
  )
}
