import { useState } from 'react'
import { call } from '@/api/client'
import type { StorageReport } from '@/api/types'
import { Badge, Banner, Button, Card, Empty, ErrorNote, Icon, Loading, PathInput, ProgressBar, Table, useUi } from '@/components/ui'
import { basename, formatBytes } from '@/lib/format'
import { useLoad } from '@/lib/hooks'
import { friendly, isAbsolutePath } from '../hard-drives/helpers'
import './settings.css'

export interface StorageLocation {
  current: string
  default: string
  pointer: string | null
  can_change: boolean
  restart_required: boolean
}

const AREAS: { key: keyof Omit<StorageReport, 'total_managed' | 'free_host' | 'root'>; label: string; desc: string }[] = [
  { key: 'roms', label: 'ROMs', desc: 'Kickstart files copied into the library' },
  { key: 'workbench', label: 'Workbench disks', desc: 'Workbench install and boot disks' },
  { key: 'floppies', label: 'Floppy library', desc: 'Disk images (ADF), including working copies' },
  { key: 'dms', label: 'DMS archives', desc: 'The original compressed archives you imported' },
  { key: 'hard_drives', label: 'Hard drives', desc: 'Working copies and untouched copies of your hard disks' },
  { key: 'backups', label: 'Backups', desc: 'Automatic and manual backups' },
  { key: 'snapshots', label: 'Snapshots', desc: 'Named restore points and “Before restore” copies' },
  { key: 'logs', label: 'Logs', desc: 'Emulator and diagnostics logs' },
]

/** How much space Amiga Studio uses, where it lives, and what is left over. */
export function StorageManager() {
  const { confirm, toast } = useUi()
  const report = useLoad(() => call<StorageReport>('storage_report'))
  const loc = useLoad(() => call<StorageLocation>('storage_location'))
  const orphans = useLoad(() => call<string[]>('orphans'))
  const [newPath, setNewPath] = useState('')
  const [pathError, setPathError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const r = report.data
  const l = loc.data
  const total = Math.max(r?.total_managed ?? 0, 1)

  const setLocation = async (path: string) => {
    setPathError(null)
    if (!isAbsolutePath(path)) {
      setPathError('Type the full path of a folder, for example /home/you/AmigaStudio or D:\\AmigaStudio.')
      return
    }
    if (path.includes(',')) {
      setPathError('Choose a folder whose path has no commas. The emulator cannot handle commas in the path of a hard disk.')
      return
    }
    setSaving(true)
    try {
      const next = await call<StorageLocation>('storage_set_location', { path: path.trim() })
      loc.set(next)
      setNewPath('')
      toast('New storage location saved. It takes effect after you restart.', 'success')
    } catch (e) {
      setPathError(friendly(e))
    } finally {
      setSaving(false)
    }
  }

  const removeOrphan = async (p: string) => {
    const ok = await confirm({
      title: 'Delete this leftover file?',
      confirmLabel: 'Delete file',
      danger: true,
      body: (
        <div className="stack-sm">
          <p>
            <span className="st-mono">{p}</span>
          </p>
          <p>No disk, ROM or machine in your library uses this file; it was probably left behind by an interrupted import. Deleting it only frees space. Your own original files are never listed here and are never touched.</p>
        </div>
      ),
    })
    if (!ok) return
    setDeleting(p)
    try {
      await call('orphan_delete', { path: p })
      toast('Leftover file deleted', 'success')
    } catch (e) {
      toast(friendly(e), 'error')
    } finally {
      setDeleting(null)
      void orphans.reload()
      void report.reload()
    }
  }

  const nextFolder = l?.pointer && l.pointer !== l.current ? l.pointer : null

  return (
    <div className="stack">
      <Card
        title="Storage Manager"
        actions={
          <Button size="sm" icon="reset" onClick={() => void Promise.all([report.reload(), orphans.reload(), loc.reload()])}>
            Refresh
          </Button>
        }
      >
        <div className="stack">
          <p className="st-note">Everything Amiga Studio keeps for you lives in one folder: ROMs, disk images, hard disk copies, backups and logs. Files you imported from elsewhere stay where they are; only the managed copies are counted here.</p>
          <ErrorNote error={report.error} />
          {report.loading || !r ? (
            <Loading />
          ) : (
            <>
              <div className="st-stats">
                <div className="stat">
                  <span className="stat-value" data-testid="total-managed">
                    {formatBytes(r.total_managed)}
                  </span>
                  <span className="stat-label">Used by Amiga Studio</span>
                </div>
                <div className="stat">
                  <span className="stat-value" data-testid="free-host">
                    {formatBytes(r.free_host)}
                  </span>
                  <span className="stat-label">Free on this drive</span>
                </div>
                <div className="stat">
                  <span className="stat-value st-mono" style={{ fontSize: 'var(--fs-sm)' }} data-testid="storage-root">
                    {r.root}
                  </span>
                  <span className="stat-label">Storage folder</span>
                </div>
              </div>
              <Table head={['Area', 'Used', 'Share of what Amiga Studio uses']} caption="Space used per area">
                {AREAS.map((a) => {
                  const v = r[a.key]
                  const pct = (v / total) * 100
                  return (
                    <tr key={a.key} data-testid={`area-${a.key}`}>
                      <td>
                        <strong>{a.label}</strong>
                        <div className="st-area-desc">{a.desc}</div>
                      </td>
                      <td className="st-num">{formatBytes(v)}</td>
                      <td className="st-bar-cell">
                        <div className="st-bar">
                          <ProgressBar done={v} total={total} label={`${a.label}: ${formatBytes(v)}`} />
                          <span className="st-pct">{v === 0 ? '0%' : pct < 1 ? '<1%' : `${Math.round(pct)}%`}</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                <tr className="st-total">
                  <td>Total managed</td>
                  <td className="st-num">{formatBytes(r.total_managed)}</td>
                  <td />
                </tr>
              </Table>
            </>
          )}
        </div>
      </Card>

      <Card title="Storage location">
        <div className="stack">
          <ErrorNote error={loc.error} />
          {l && (
            <>
              {l.restart_required && nextFolder && (
                <Banner tone="warning" title="Restart Amiga Studio to use the new folder" >
                  <p>
                    The next time it starts, Amiga Studio will use <span className="st-mono">{nextFolder}</span>. Until you restart it keeps using the current folder.
                  </p>
                  <p style={{ marginTop: 6 }}>
                    <strong>Nothing was moved or deleted.</strong> If you want your disks, ROMs and backups in the new place, copy the contents of the current folder there yourself before restarting.
                  </p>
                </Banner>
              )}
              <dl className="kv">
                <dt>In use now</dt>
                <dd className="st-mono" data-testid="loc-current">{l.current}</dd>
                <dt>Default folder</dt>
                <dd className="st-mono">{l.default}</dd>
                {nextFolder && (
                  <>
                    <dt>Next start</dt>
                    <dd className="st-mono" data-testid="loc-pointer">{nextFolder}</dd>
                  </>
                )}
              </dl>
              {l.can_change ? (
                <form
                  className="stack-sm"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void setLocation(newPath)
                  }}
                >
                  <PathInput label="Change storage location" hint="An empty folder you can write to, with no commas in its path. It takes effect after you restart Amiga Studio, and your existing data is not moved or deleted." value={newPath} onChange={(v) => { setNewPath(v); setPathError(null) }} directory placeholder="/path/to/new/folder" />
                  {pathError && <Banner tone="error">{pathError}</Banner>}
                  <div className="row">
                    <Button type="submit" variant="primary" icon="folder" disabled={!newPath.trim() || saving}>
                      Use this folder
                    </Button>
                    {nextFolder && (
                      <Button disabled={saving} onClick={() => void setLocation(l.current)}>
                        Keep using the current folder
                      </Button>
                    )}
                    {(l.pointer ?? l.current) !== l.default && (
                      <Button disabled={saving} onClick={() => void setLocation(l.default)}>
                        Go back to the default folder
                      </Button>
                    )}
                  </div>
                </form>
              ) : (
                <Banner tone="info">This build of Amiga Studio always uses the folder shown above; the location cannot be changed here.</Banner>
              )}
            </>
          )}
        </div>
      </Card>

      <Card
        title="Unreferenced files"
        actions={
          <Button size="sm" icon="search" onClick={() => void orphans.reload()}>
            Look again
          </Button>
        }
      >
        <div className="stack">
          <p className="st-note">
            Files in the floppy and DMS folders that no disk in your library uses. They are normally leftovers from an interrupted import. Amiga Studio never deletes them by itself, and you can delete each one below. <strong>Your own original files are never listed and never deleted.</strong>
          </p>
          <ErrorNote error={orphans.error} />
          {orphans.loading ? (
            <Loading />
          ) : (orphans.data ?? []).length === 0 ? (
            <Empty icon="check" title="No leftover files">
              Everything in the managed folders belongs to something in your library.
            </Empty>
          ) : (
            <Table head={['File', 'Folder', '']} caption="Unreferenced files">
              {(orphans.data ?? []).map((p) => (
                <tr key={p} data-testid="orphan-row">
                  <td>
                    <strong>{basename(p)}</strong>
                  </td>
                  <td className="st-mono" title={p}>
                    {p.slice(0, p.length - basename(p).length)}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" variant="danger" icon="trash" disabled={deleting === p} onClick={() => void removeOrphan(p)} aria-label={`Delete leftover file ${basename(p)}`}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {(orphans.data ?? []).length > 0 && (
            <Badge tone="warning">
              <Icon name="warn" size={12} /> {(orphans.data ?? []).length} leftover file{(orphans.data ?? []).length === 1 ? '' : 's'}
            </Badge>
          )}
        </div>
      </Card>
    </div>
  )
}
