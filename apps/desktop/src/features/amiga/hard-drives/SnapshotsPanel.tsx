import { call } from '@/api/client'
import type { HdfRecord, SnapshotRecord } from '@/api/types'
import { Badge, Button, Empty, Table, useUi } from '@/components/ui'
import { formatBytes, formatDate } from '@/lib/format'
import { SNAPSHOT_HELP, SNAPSHOT_LABEL, friendly } from './helpers'
import './hard-drives.css'

/** Backups, snapshots and automatic backups of one disk, with Restore and Delete. */
export function SnapshotsPanel({
  hdf,
  snapshots,
  locked,
  busy,
  onRestore,
  onChanged,
}: {
  hdf: HdfRecord
  snapshots: SnapshotRecord[]
  locked: boolean
  busy: boolean
  onRestore: (snap: SnapshotRecord) => Promise<void>
  onChanged: () => void
}) {
  const { confirm, toast } = useUi()

  const restore = async (s: SnapshotRecord) => {
    const ok = await confirm({
      title: `Restore “${hdf.name}”?`,
      confirmLabel: 'Restore this version',
      danger: true,
      body: (
        <div className="stack-sm">
          <p>
            The disk will go back to how it was in the <strong>{SNAPSHOT_LABEL[s.kind].toLowerCase()}</strong> from {formatDate(s.created_at)}
            {s.note ? ` (“${s.note}”)` : ''}. Anything the Amiga saved on the disk since then will no longer be on it.
          </p>
          <p>
            You can undo this: the disk as it is <strong>right now</strong> is kept first as a “Before restore” backup in this list.
          </p>
        </div>
      ),
    })
    if (ok) await onRestore(s)
  }

  const remove = async (s: SnapshotRecord) => {
    const ok = await confirm({
      title: 'Delete this saved copy?',
      confirmLabel: 'Delete',
      danger: true,
      body: (
        <p>
          The {SNAPSHOT_LABEL[s.kind].toLowerCase()} from {formatDate(s.created_at)} ({formatBytes(s.size)}) will be deleted for good to free its space. The disk itself and your original file are not affected.
        </p>
      ),
    })
    if (!ok) return
    try {
      await call('snapshot_delete', { id: s.id })
      toast('Deleted', 'success')
      onChanged()
    } catch (e) {
      toast(friendly(e), 'error')
    }
  }

  if (snapshots.length === 0) {
    return (
      <div className="hdd-panel">
        <Empty icon="snapshot" title="No backups or snapshots yet">
          Use “Back up now” or “Create snapshot…” above. Each one is a complete, separate copy of the disk that you can restore later.
        </Empty>
      </div>
    )
  }

  return (
    <div className="hdd-panel">
      <p className="hdd-note">
        Each entry is a complete copy of the disk at that moment, so a few of them need real disk space. <strong>Restoring</strong> replaces the disk with that copy; the current state is always kept first as a “Before restore” backup.
      </p>
      <Table head={['Kind', 'Name / note', 'Size', 'Saved', '']} caption={`Backups and snapshots of ${hdf.name}`}>
        {snapshots.map((s) => (
          <tr key={s.id} data-testid={`snap-${s.kind}`}>
            <td>
              <Badge tone={s.kind === 'snapshot' ? 'accent' : s.kind === 'pre_restore' ? 'warning' : 'neutral'} title={SNAPSHOT_HELP[s.kind]}>
                {SNAPSHOT_LABEL[s.kind]}
              </Badge>
            </td>
            <td>{s.note || <span className="faint">-</span>}</td>
            <td className="muted">{formatBytes(s.size)}</td>
            <td className="muted">{formatDate(s.created_at)}</td>
            <td>
              <div className="row" style={{ justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                <Button size="sm" icon="reset" disabled={locked || busy} title={locked ? 'Shut the machine down first' : undefined} onClick={() => void restore(s)} aria-label={`Restore ${SNAPSHOT_LABEL[s.kind]} from ${formatDate(s.created_at)}`}>
                  Restore
                </Button>
                <Button size="sm" variant="ghost" icon="trash" disabled={busy} onClick={() => void remove(s)} aria-label={`Delete ${SNAPSHOT_LABEL[s.kind]} from ${formatDate(s.created_at)}`}>
                  Delete
                </Button>
              </div>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}
