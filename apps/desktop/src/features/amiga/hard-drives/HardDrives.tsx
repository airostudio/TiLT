import { useCallback, useState } from 'react'
import { call } from '@/api/client'
import type { HdfRecord, MachineProfile, SnapshotRecord } from '@/api/types'
import { Banner, Button, Empty, ErrorNote, JobProgress, Loading, Page, PageHeader, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useLoad } from '@/lib/hooks'
import { DiskCard, type DiskActions } from './DiskCard'
import { friendly } from './helpers'
import { ImportWizard } from './ImportWizard'
import { ExportModal, SnapshotNameModal } from './modals'
import { isCancelled, useJob } from './useJob'
import './hard-drives.css'

/** One disk plus its own list of backups. Reloads the list whenever `rev` changes. */
function DiskItem({ hdf, rev, ...rest }: { hdf: HdfRecord; rev: number } & Omit<Parameters<typeof DiskCard>[0], 'snapshots'>) {
  const snaps = useLoad(() => call<SnapshotRecord[]>('hdf_snapshots', { id: hdf.id }), [hdf.id, rev])
  return <DiskCard hdf={hdf} snapshots={snaps.data ?? []} {...rest} />
}

export default function HardDrives() {
  const { toast, confirm } = useUi()
  const { session } = useBackend()
  const hdfs = useLoad(() => call<HdfRecord[]>('hdf_list'))
  const profiles = useLoad(() => call<MachineProfile[]>('profile_list'))
  const runner = useJob()
  const [rev, setRev] = useState(0)
  const [wizard, setWizard] = useState(false)
  const [exporting, setExporting] = useState<HdfRecord | null>(null)
  const [naming, setNaming] = useState<HdfRecord | null>(null)
  const [working, setWorking] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const { reload: reloadHdfs } = hdfs
  const { reload: reloadProfiles } = profiles
  const refresh = useCallback(async () => {
    await Promise.all([reloadHdfs(), reloadProfiles()])
    setRev((r) => r + 1)
  }, [reloadHdfs, reloadProfiles])

  const lockedIds = session?.hard_disks ?? []

  /** Run a background job for a disk and report the outcome in plain words. */
  const op = async (label: string, cmd: string, args: Record<string, unknown>, okText: string, failureHint = ''): Promise<boolean> => {
    setFailure(null)
    setWorking(label)
    try {
      await runner.run(cmd, args)
      toast(okText, 'success')
      return true
    } catch (e) {
      if (isCancelled(e)) toast('Cancelled. Nothing was changed.', 'info')
      else {
        setFailure(friendly(e) + failureHint)
        toast(friendly(e), 'error')
      }
      return false
    } finally {
      setWorking('')
      await refresh()
    }
  }

  const actions: DiskActions = {
    backup: (h) => void op(`Backing up “${h.name}”…`, 'hdf_backup', { id: h.id, kind: 'backup' }, `Backup of “${h.name}” saved`),
    snapshot: (h) => setNaming(h),
    exportDisk: (h) => setExporting(h),
    restore: async (h, s) => {
      await op(
        `Restoring “${h.name}”…`,
        'hdf_restore',
        { id: h.id, snapshot_id: s.id },
        `“${h.name}” restored. The state before is kept as a “Before restore” backup.`,
        h.working_missing ? ' The disk’s working file is missing, and a restore cannot replace a file that is not there. Remove the disk from the library and import your original file again.' : '',
      )
    },
    remove: async (h) => {
      const ok = await confirm({
        title: `Remove “${h.name}” from your library?`,
        confirmLabel: 'Remove from library',
        danger: true,
        body: (
          <div className="stack-sm">
            <p>
              Amiga Studio's working copy of this disk, its untouched copy and <strong>all of its backups and snapshots</strong> will be deleted to free space. Anything the Amiga saved on the disk since you imported it will be gone unless you export it first.
            </p>
            <p>
              <strong>Your original file{h.original_path ? ` (${h.original_path})` : ''} is never deleted or changed.</strong> You can import it again later.
            </p>
          </div>
        ),
      })
      if (!ok) return
      setFailure(null)
      try {
        await call('hdf_delete', { id: h.id })
        toast(`“${h.name}” removed from the library. Your original file was not touched.`, 'success')
      } catch (e) {
        setFailure(friendly(e))
        toast(friendly(e), 'error')
      }
      await refresh()
    },
    refresh: () => void refresh(),
  }

  const runningName = session?.running ? session.profile_name : null
  const list = hdfs.data ?? []
  const busy = runner.running

  return (
    <Page>
      <PageHeader
        title="Hard Drives"
        subtitle="Hard disks for your Amigas. Amiga Studio keeps its own working copy of each disk, so the file you imported is never at risk."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setWizard(true)} disabled={busy}>
            Import hard disk…
          </Button>
        }
      />

      <Banner tone="info" title="How your data stays safe">
        Importing makes a managed copy; your original .hdf is only read. Before a machine writes to a disk, Amiga Studio takes an automatic backup, and you can add your own backups and snapshots at any time. Free space <em>inside</em> an Amiga disk is not measured, because only the Amiga knows what is on its filesystem.
      </Banner>

      {runningName && (
        <Banner tone="warning" title={`${runningName} is running`}>
          Disks that machine uses are locked: they cannot be backed up, restored, exported or removed until you shut the machine down.
        </Banner>
      )}
      {failure && (
        <Banner
          tone="error"
          title="That did not work"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setFailure(null)}>
              Dismiss
            </Button>
          }
        >
          {failure}
        </Banner>
      )}
      <ErrorNote error={hdfs.error} />

      {busy && !wizard && !exporting && (
        <div className="card">
          <JobProgress job={runner.job} jobId={runner.jobId} label={working || 'Working…'} />
        </div>
      )}

      {hdfs.loading ? (
        <Loading />
      ) : list.length === 0 ? (
        <Empty
          icon="hdd"
          title="No hard disks yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => setWizard(true)}>
              Import hard disk…
            </Button>
          }
        >
          Import an existing .hdf file to use it in an Amiga. Amiga Studio never changes the file you choose; it works on its own copy.
        </Empty>
      ) : (
        <div className="hdd-list" data-testid="hdf-list">
          {list.map((h) => (
            <DiskItem key={h.id} hdf={h} rev={rev} profiles={profiles.data ?? []} locked={lockedIds.includes(h.id)} busy={busy} runningProfileId={session?.running ? session.profile_id : null} actions={actions} />
          ))}
        </div>
      )}

      {wizard && (
        <ImportWizard
          runner={runner}
          onClose={() => setWizard(false)}
          onDone={(rec) => {
            setWizard(false)
            toast(`“${rec.name}” imported. Your original file was not changed.`, 'success')
            void refresh()
          }}
        />
      )}
      {naming && (
        <SnapshotNameModal
          hdf={naming}
          onClose={() => setNaming(null)}
          onCreate={(name) => {
            const h = naming
            setNaming(null)
            void op(`Creating snapshot “${name}”…`, 'hdf_backup', { id: h.id, kind: 'snapshot', note: name }, `Snapshot “${name}” saved`)
          }}
        />
      )}
      {exporting && (
        <ExportModal
          hdf={exporting}
          runner={runner}
          onClose={() => setExporting(null)}
          onExport={async (dest, overwrite) => {
            await runner.run('hdf_export', { id: exporting.id, dest, overwrite })
            toast(`Exported to ${dest}`, 'success')
          }}
        />
      )}
    </Page>
  )
}
