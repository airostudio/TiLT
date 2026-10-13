import { useState, type FormEvent } from 'react'
import { call } from '@/api/client'
import type { HdfRecord, ImportEstimate } from '@/api/types'
import { Badge, Banner, Button, Icon, JobProgress, KV, Modal, PathInput, TextInput, Toggle } from '@/components/ui'
import { formatBytes } from '@/lib/format'
import { LAYOUT_HELP, LAYOUT_LABEL, defaultDiskName, friendly, isAbsolutePath } from './helpers'
import { Findings, PartitionTable } from './parts'
import { isCancelled, type JobRunner } from './useJob'
import './hard-drives.css'

/** Import a hard disk image: look at it first, then make a managed working copy. */
export function ImportWizard({ runner, onClose, onDone }: { runner: JobRunner; onClose: () => void; onDone: (rec: HdfRecord) => void }) {
  const [path, setPath] = useState('')
  const [checking, setChecking] = useState(false)
  const [withCopy, setWithCopy] = useState<ImportEstimate | null>(null)
  const [withoutCopy, setWithoutCopy] = useState<ImportEstimate | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [keep, setKeep] = useState(true)
  const [accept, setAccept] = useState(false)
  const importing = runner.running

  const changePath = (v: string) => {
    setPath(v)
    setWithCopy(null)
    setWithoutCopy(null)
    setAccept(false)
    setError(null)
  }

  const check = async (e?: FormEvent) => {
    e?.preventDefault()
    const p = path.trim()
    if (!p) return
    if (!isAbsolutePath(p)) {
      setError('Type the full path of the file, for example /home/you/Amiga/work.hdf or C:\\Amiga\\work.hdf.')
      return
    }
    setChecking(true)
    setError(null)
    try {
      // Ask for both sizes so the user can see what the untouched copy costs.
      const [a, b] = await Promise.all([call<ImportEstimate>('hdf_estimate', { path: p, keep_pristine: true }), call<ImportEstimate>('hdf_estimate', { path: p, keep_pristine: false })])
      setWithCopy(a)
      setWithoutCopy(b)
      setName((n) => n || defaultDiskName(p))
    } catch (err) {
      setWithCopy(null)
      setWithoutCopy(null)
      setError(friendly(err))
    } finally {
      setChecking(false)
    }
  }

  const est = keep ? withCopy : withoutCopy
  const layout = withCopy?.info.layout
  const needsAccept = layout === 'unrecognised'
  const canImport = !!est && est.enough_space && name.trim().length > 0 && (!needsAccept || accept) && !importing

  const doImport = async () => {
    if (!est) return
    setError(null)
    try {
      const rec = await runner.run<HdfRecord>('hdf_import', { path: path.trim(), name: name.trim(), keep_pristine: keep, accept_unrecognised: accept })
      onDone(rec)
    } catch (err) {
      setError(isCancelled(err) ? 'Import cancelled. Nothing was added to your library and your original file was not touched.' : friendly(err))
    }
  }

  return (
    <Modal
      wide
      title="Import a hard disk"
      onClose={() => !importing && onClose()}
      actions={
        <>
          <Button onClick={onClose} disabled={importing}>
            Close
          </Button>
          <Button variant="primary" icon="download" disabled={!canImport} onClick={() => void doImport()}>
            Import disk
          </Button>
        </>
      }
    >
      <Banner tone="info" title="Your original file is only read, never changed">
        Amiga Studio copies the image into its own library and works on that copy. The file you choose stays exactly as it is, so you can always go back to it.
      </Banner>

      <form onSubmit={(e) => void check(e)} className="stack-sm">
        <PathInput label="Hard disk image file (.hdf)" hint="The full path of the file. Amiga Studio looks at the start of the file to see what is on it; nothing is copied yet." value={path} onChange={changePath} extensions={['hdf', 'img', 'dsk']} placeholder="/path/to/disk.hdf" />
        <div className="row">
          <Button type="submit" variant="secondary" icon="search" disabled={!path.trim() || checking || importing}>
            {checking ? 'Looking…' : 'Check this file'}
          </Button>
        </div>
      </form>

      {error && <Banner tone="error">{error}</Banner>}

      {withCopy && est && (
        <div className="stack" data-testid="hdf-estimate">
          <div>
            <div className="hdd-section-title">What is on this disk</div>
            <div className="row" style={{ marginBottom: 8 }}>
              <Badge tone={layout === 'rdb' || layout === 'plain_hardfile' ? 'success' : layout === 'blank' ? 'warning' : 'danger'}>{LAYOUT_LABEL[withCopy.info.layout]}</Badge>
              <span>{withCopy.info.summary}</span>
            </div>
            <p className="hdd-note" style={{ marginBottom: 8 }}>
              {LAYOUT_HELP[withCopy.info.layout]}
            </p>
            <PartitionTable info={withCopy.info} />
          </div>

          <Findings info={withCopy.info} />

          {layout === 'blank' && (
            <Banner tone="warning" title="This disk is empty, so it cannot start by itself yet">
              <ol className="hdd-steps">
                <li>Import it anyway (nothing is lost; it is just empty).</li>
                <li>Attach it to a machine in the “Machines” tab of the disk.</li>
                <li>Start that machine from a Workbench install disk, then use HDToolBox to partition the disk and format the partitions.</li>
              </ol>
              <p style={{ marginTop: 8 }}>Amiga Studio never formats or partitions a disk for you.</p>
            </Banner>
          )}

          {needsAccept && (
            <Banner tone="warning" title="This does not look like an Amiga hard disk">
              <label className="hdd-check" style={{ marginTop: 6 }}>
                <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                <span>I am sure this is an Amiga disk. Import it anyway.</span>
              </label>
            </Banner>
          )}

          <div className="hdd-two">
            <div className="stack-sm">
              <div className="hdd-section-title">Options</div>
              <TextInput label="Name in your library" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
              <Toggle label="Keep an untouched copy as well" checked={keep} onChange={setKeep} disabled={importing} />
              <p className="hdd-note">
                The untouched copy is a read-only picture of the disk exactly as you imported it. It costs <strong>one extra copy of the image</strong> ({formatBytes(withCopy.source_size)}) of disk space. Switch it off if space is tight; you can still make backups and snapshots later.
              </p>
            </div>
            <div className="stack-sm">
              <div className="hdd-section-title">Disk space</div>
              <KV
                rows={[
                  ['Image size', formatBytes(withCopy.source_size)],
                  ['Needed, working copy only', formatBytes(withoutCopy?.required_bytes ?? 0)],
                  ['Needed, with untouched copy', formatBytes(withCopy.required_bytes)],
                  ['Free in your library drive', formatBytes(withCopy.free_bytes)],
                ]}
              />
              <p className="hdd-note">Each figure includes a safety margin of {formatBytes(Math.max(0, (withoutCopy?.required_bytes ?? 0) - withCopy.source_size))} so the drive never fills up completely.</p>
              {est.enough_space ? (
                <Badge tone="success">
                  <Icon name="check" size={12} /> Enough space
                </Badge>
              ) : (
                <Banner tone="error">Not enough free space for this choice. Free up space or switch off the untouched copy.</Banner>
              )}
            </div>
          </div>
        </div>
      )}

      {importing && <JobProgress job={runner.job} jobId={runner.jobId} label="Copying the disk into your library… your original is only being read." />}
    </Modal>
  )
}
