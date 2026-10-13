import { useState } from 'react'
import type { HdfRecord } from '@/api/types'
import { Banner, Button, JobProgress, Modal, PathInput, TextInput, Toggle } from '@/components/ui'
import { formatBytes } from '@/lib/format'
import { friendly, isAbsolutePath } from './helpers'
import { isCancelled, type JobRunner } from './useJob'
import './hard-drives.css'

/** Ask for a name for a snapshot. */
export function SnapshotNameModal({ hdf, onClose, onCreate }: { hdf: HdfRecord; onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState(() => `Snapshot ${new Date().toLocaleDateString(undefined, { dateStyle: 'medium' })}`)
  return (
    <Modal
      title={`Create a snapshot of “${hdf.name}”`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="snapshot" disabled={!name.trim()} onClick={() => onCreate(name.trim())}>
            Create snapshot
          </Button>
        </>
      }
    >
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) onCreate(name.trim())
        }}
      >
        <p className="hdd-note">
          A snapshot is a named restore point: a complete copy of the disk as it is now ({formatBytes(hdf.size)} of disk space). Make one before installing something risky, then restore it if things go wrong.
        </p>
        <TextInput label="Snapshot name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} hint="For example “Before installing games”." />
      </form>
    </Modal>
  )
}

/** Export the complete current disk to a file outside the library. */
export function ExportModal({ hdf, runner, onClose, onExport }: { hdf: HdfRecord; runner: JobRunner; onClose: () => void; onExport: (dest: string, overwrite: boolean) => Promise<void> }) {
  const [dest, setDest] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const working = runner.running

  const go = async () => {
    if (!isAbsolutePath(dest)) {
      setError('Type the full path of the file to create, for example /home/you/Amiga/' + hdf.name + '.hdf')
      return
    }
    setError(null)
    try {
      await onExport(dest.trim(), overwrite)
      onClose()
    } catch (e) {
      setError(isCancelled(e) ? 'Export cancelled. Nothing was written.' : friendly(e))
    }
  }

  return (
    <Modal
      title={`Export “${hdf.name}”`}
      onClose={() => !working && onClose()}
      actions={
        <>
          <Button onClick={onClose} disabled={working}>
            Close
          </Button>
          <Button variant="primary" icon="download" disabled={!dest.trim() || working} onClick={() => void go()}>
            Export disk
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="hdd-note">
          Saves the <strong>complete disk as it is right now</strong> ({formatBytes(hdf.size)}), including everything the Amiga has written to it, as a single .hdf file you can keep or use in another emulator. Your library copy is not changed.
        </p>
        <PathInput label="Save as (full path of the new file)" value={dest} onChange={setDest} extensions={['hdf']} placeholder={`/path/to/${hdf.name}.hdf`} hint="The file must be outside the Amiga Studio library." />
        <Toggle label="Allow overwriting" checked={overwrite} onChange={setOverwrite} disabled={working} />
        <p className="hdd-note">Off by default. If a file already exists at that path, nothing is touched and you are told. Turn this on only to replace that file.</p>
        {error && <Banner tone="error">{error}</Banner>}
        {working && <JobProgress job={runner.job} jobId={runner.jobId} label="Exporting the disk…" />}
      </div>
    </Modal>
  )
}
