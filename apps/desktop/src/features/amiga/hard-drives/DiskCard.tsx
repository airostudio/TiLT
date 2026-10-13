import { useState } from 'react'
import type { HdfRecord, MachineProfile, SnapshotRecord } from '@/api/types'
import { Badge, Banner, Button, Card, Icon, KV, Tabs, Toggle } from '@/components/ui'
import { formatBytes, formatDate } from '@/lib/format'
import { AttachPanel } from './AttachPanel'
import { LAYOUT_HELP, LAYOUT_LABEL } from './helpers'
import { Findings, PartitionTable } from './parts'
import { SnapshotsPanel } from './SnapshotsPanel'
import './hard-drives.css'

type Tab = 'overview' | 'backups' | 'machines'

export interface DiskActions {
  backup: (h: HdfRecord) => void
  snapshot: (h: HdfRecord) => void
  exportDisk: (h: HdfRecord) => void
  remove: (h: HdfRecord) => void
  restore: (h: HdfRecord, s: SnapshotRecord) => Promise<void>
  refresh: () => void
}

export function DiskCard({
  hdf,
  snapshots,
  profiles,
  locked,
  busy,
  runningProfileId,
  actions,
}: {
  hdf: HdfRecord
  snapshots: SnapshotRecord[]
  profiles: MachineProfile[]
  locked: boolean
  busy: boolean
  runningProfileId: string | null
  actions: DiskActions
}) {
  const [tab, setTab] = useState<Tab>('overview')
  const [technical, setTechnical] = useState(false)
  const attached = profiles.filter((p) => p.hard_disks.some((h) => h.hdf_id === hdf.id))
  const info = hdf.info
  const lockWhy = 'Shut the machine down first: it is using this disk right now.'
  const gone = hdf.working_missing

  return (
    <Card data-testid={`disk-${hdf.id}`} aria-label={`Hard disk ${hdf.name}`}>
      <div className="hdd-head">
        <div className="hdd-icon">
          <Icon name="hdd" size={24} />
        </div>
        <div className="hdd-title">
          <h2>{hdf.name}</h2>
          <div className="small muted">
            {formatBytes(hdf.size)} · {LAYOUT_LABEL[info.layout]} · {info.summary}
          </div>
          <div className="hdd-badges">
            {gone ? (
              <Badge tone="danger">
                <Icon name="warn" size={12} /> Working copy missing
              </Badge>
            ) : (
              <Badge tone="success">
                <Icon name="check" size={12} /> Ready
              </Badge>
            )}
            {hdf.dirty && (
              <Badge tone="warning" title="The Amiga has written to this disk since the last backup or snapshot.">
                Changed since last backup
              </Badge>
            )}
            {hdf.unclean_shutdown && (
              <Badge tone="warning" title="The emulator was closed or crashed while this disk was in use. The Amiga may need to repair the disk (Workbench does this by itself).">
                Last session didn't shut down cleanly
              </Badge>
            )}
            {locked && (
              <Badge tone="accent">
                <Icon name="lock" size={12} /> In use by the running machine
              </Badge>
            )}
            <Badge tone={hdf.pristine_path ? 'neutral' : 'warning'} title="A read-only copy of the disk exactly as imported.">
              Untouched copy kept: {hdf.pristine_path ? 'Yes' : 'No'}
            </Badge>
            {attached.length > 0 && <Badge tone="accent">Attached to {attached.length === 1 ? attached[0].name : `${attached.length} machines`}</Badge>}
          </div>
        </div>
      </div>

      {gone && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="error" title="The working copy of this disk cannot be found">
            Its file has been moved or deleted outside Amiga Studio. You can try restoring a backup in the “Backups and snapshots” tab; if that is refused, remove this disk from the library and import your original file again. Your original file was never changed.
          </Banner>
        </div>
      )}
      {locked && (
        <div style={{ marginTop: 12 }}>
          <Banner tone="info" title="This disk is in use">
            A running machine has this disk. Backups, restores, exports and removal are switched off until you shut that machine down, so the disk can never be copied while it is changing.
          </Banner>
        </div>
      )}

      <div className="hdd-actions" role="group" aria-label={`Actions for ${hdf.name}`}>
        <Button icon="snapshot" disabled={busy || locked || gone} title={locked ? lockWhy : 'Make a complete backup copy of the disk now'} onClick={() => actions.backup(hdf)}>
          Back up now
        </Button>
        <Button icon="camera" disabled={busy || locked || gone} title={locked ? lockWhy : 'Save a named restore point'} onClick={() => actions.snapshot(hdf)}>
          Create snapshot…
        </Button>
        <Button icon="download" disabled={busy || locked || gone} title={locked ? lockWhy : 'Save the whole disk as a .hdf file'} onClick={() => actions.exportDisk(hdf)}>
          Export complete disk…
        </Button>
        <span className="spacer" />
        <Button
          variant="danger"
          icon="trash"
          disabled={busy || locked || attached.length > 0}
          title={locked ? lockWhy : attached.length > 0 ? 'Detach this disk from its machines first (Machines tab)' : 'Remove this disk from your library'}
          onClick={() => actions.remove(hdf)}
        >
          Remove from library…
        </Button>
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'backups', label: `Backups and snapshots (${snapshots.length})` },
          { id: 'machines', label: `Machines (${attached.length})` },
        ]}
      />

      {tab === 'overview' && (
        <div className="hdd-panel">
          <div className="hdd-two">
            <div className="stack">
              <p className="hdd-note">{LAYOUT_HELP[info.layout]}</p>
              <PartitionTable info={info} />
              <Findings info={info} />
            </div>
            <div className="stack">
              <KV
                rows={[
                  ['Disk size', formatBytes(hdf.size)],
                  [
                    'Free space inside',
                    <span key="f" title="Amiga Studio does not look inside the Amiga's filesystem, so it cannot know how full the disk is. Check it in Workbench (Disk > Information).">
                      Not measured
                    </span>,
                  ],
                  ['Imported', formatDate(hdf.imported_at)],
                  ['Untouched copy kept', hdf.pristine_path ? 'Yes (read-only)' : 'No'],
                  ['Original file', <span key="o" className="hdd-mono">{hdf.original_path ?? 'unknown'}</span>],
                ]}
              />
              <p className="hdd-note">Your original file is only read when importing and is never changed or deleted by Amiga Studio.</p>
              <Toggle label="Show technical details" checked={technical} onChange={setTechnical} />
              {technical && (
                <KV
                  rows={[
                    ['Original SHA-256', <span key="s" className="hdd-mono">{hdf.original_sha256}</span>],
                    ['Working copy', <span key="w" className="hdd-mono">{hdf.working_path}</span>],
                    ['Untouched copy', <span key="p" className="hdd-mono">{hdf.pristine_path ?? 'not kept'}</span>],
                    ['Block size', `${info.block_size} bytes`],
                    ['Geometry', info.rdb_geometry ? `${info.rdb_geometry[0]} cylinders, ${info.rdb_geometry[1]} heads, ${info.rdb_geometry[2]} sectors` : 'not applicable'],
                    ['Unmounted partitions', String(info.partitions.filter((p) => p.no_mount).length)],
                  ]}
                />
              )}
            </div>
          </div>
        </div>
      )}
      {tab === 'backups' && <SnapshotsPanel hdf={hdf} snapshots={snapshots} locked={locked} busy={busy} onRestore={(s) => actions.restore(hdf, s)} onChanged={actions.refresh} />}
      {tab === 'machines' && <AttachPanel hdf={hdf} profiles={profiles} runningProfileId={runningProfileId} onChanged={actions.refresh} />}
    </Card>
  )
}
