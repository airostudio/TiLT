import { useEffect, useMemo, useState } from 'react'
import { call } from '@/api/client'
import type { CopyOptions, CopyReport, CopySource, CopyTarget, MediaRecord, OperationRecord } from '@/api/types'
import { Badge, Banner, Button, Card, Icon, JobProgress, PathInput, Select, Table, TextInput, Toggle, useUi } from '@/components/ui'
import { formatDate } from '@/lib/format'
import { useLoad } from '@/lib/hooks'
import { friendly, isAbsolutePath } from '../hard-drives/helpers'
import { isCancelled, useJob } from '../hard-drives/useJob'
import { Choice, ReportCard, STATUS, StepTitle, describeEndpoint, opLabel } from './parts'
import './disk-tools.css'

type SourceMode = 'library' | 'file'
type TargetMode = 'new' | 'library' | 'file'

const NOT_A_PRISTINE = 'untouched original, cannot be overwritten'

/** Host-side sector-for-sector copy of a disk image file. */
export function CopyImage() {
  const { toast } = useUi()
  const media = useLoad(() => call<MediaRecord[]>('media_list'))
  const history = useLoad(() => call<OperationRecord[]>('operations_list'))
  const runner = useJob()
  const adfs = useMemo(() => (media.data ?? []).filter((m) => m.kind === 'adf'), [media.data])

  const [sourceMode, setSourceMode] = useState<SourceMode>('library')
  const [sourceId, setSourceId] = useState('')
  const [sourcePath, setSourcePath] = useState('')
  const [targetMode, setTargetMode] = useState<TargetMode>('new')
  const [newName, setNewName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  const [targetId, setTargetId] = useState('')
  const [targetPath, setTargetPath] = useState('')
  const [verify, setVerify] = useState(true)
  const [backup, setBackup] = useState(true)
  const [overwrite, setOverwrite] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<CopyReport | null>(null)

  const sourceDisk = adfs.find((m) => m.id === sourceId)
  const targetDisk = adfs.find((m) => m.id === targetId)
  const sourceLabel = sourceMode === 'library' ? sourceDisk?.name : sourcePath.trim().split(/[\\/]/).pop()?.replace(/\.(adf|dms)$/i, '')

  // propose a name for a new library disk until the user types their own
  useEffect(() => {
    if (!nameTouched) setNewName(sourceLabel ? `Copy of ${sourceLabel}` : '')
  }, [sourceLabel, nameTouched])

  const sourceOk = sourceMode === 'library' ? !!sourceDisk : isAbsolutePath(sourcePath)
  const targetOk = targetMode === 'new' ? newName.trim().length > 0 : targetMode === 'library' ? !!targetDisk && !targetDisk.pristine && !targetDisk.missing && targetDisk.id !== sourceId : isAbsolutePath(targetPath)
  const needsOverwriteConsent = targetMode === 'library'
  const canCopy = sourceOk && targetOk && (!needsOverwriteConsent || overwrite) && !runner.running

  const copy = async () => {
    setError(null)
    setReport(null)
    const source: CopySource = sourceMode === 'library' ? { type: 'library', media_id: sourceId } : { type: 'file', path: sourcePath.trim() }
    const target: CopyTarget = targetMode === 'new' ? { type: 'new_library_image', name: newName.trim() } : targetMode === 'library' ? { type: 'library', media_id: targetId } : { type: 'file', path: targetPath.trim() }
    const options: CopyOptions = { verify, overwrite: targetMode === 'new' ? false : overwrite, backup_existing: backup }
    try {
      const r = await runner.run<CopyReport>('copy_disk', { source, target, options })
      setReport(r)
      toast('Copy complete', 'success')
    } catch (e) {
      if (isCancelled(e)) setError('Copy cancelled. The destination was not changed.')
      else setError(friendly(e))
    } finally {
      void media.reload()
      void history.reload()
    }
  }

  const busy = runner.running
  const hasLibrary = adfs.length > 0

  return (
    <div className="stack">
      <Banner tone="info" title="What this does, and what it cannot do">
        This copies a disk <strong>image file</strong> sector for sector on your computer. The copy is an exact duplicate of the standard 880 KB data on the disk. It <strong>cannot reproduce copy protection</strong> or other non-standard tracks, because an ADF image does not contain them. The source is only ever read.
      </Banner>

      <Card>
        <div className="dt-step">
          <StepTitle n={1}>Copy from</StepTitle>
          <Choice
            legend="Source"
            name="source-mode"
            value={sourceMode}
            onChange={(v) => setSourceMode(v)}
            disabled={busy}
            options={[
              { id: 'library', label: 'A disk in my library', help: 'Disk images (ADF) you already imported' },
              { id: 'file', label: 'A file on this computer', help: 'An ADF or a DMS archive' },
            ]}
          />
          {sourceMode === 'library' ? (
            <Select label="Source disk" value={sourceId} onChange={(e) => setSourceId(e.target.value)} disabled={busy} hint={hasLibrary ? 'Only disk images can be copied; DMS archives are listed under “A file on this computer”.' : undefined}>
              <option value="">{hasLibrary ? 'Choose a disk…' : 'No disk images in your library yet'}</option>
              {adfs.map((m) => (
                <option key={m.id} value={m.id} disabled={m.missing}>
                  {m.name}
                  {m.pristine ? ' (original)' : ''}
                  {m.missing ? ' (file missing)' : ''}
                </option>
              ))}
            </Select>
          ) : (
            <PathInput label="Disk file" value={sourcePath} onChange={setSourcePath} extensions={['adf', 'dms']} placeholder="/path/to/disk.adf" hint="ADF or DMS. A DMS archive is unpacked first; what is written is a plain ADF image." />
          )}
        </div>
      </Card>

      <Card>
        <div className="dt-step">
          <StepTitle n={2}>Copy to</StepTitle>
          <Choice
            legend="Destination"
            name="target-mode"
            value={targetMode}
            onChange={(v) => setTargetMode(v)}
            disabled={busy}
            options={[
              { id: 'new', label: 'A new disk in my library', help: 'Safest: nothing existing is touched' },
              { id: 'library', label: 'An existing working copy', help: 'Replaces its contents' },
              { id: 'file', label: 'Save as a file', help: 'Export outside the library' },
            ]}
          />
          {targetMode === 'new' && <TextInput label="Name of the new disk" value={newName} onChange={(e) => { setNewName(e.target.value); setNameTouched(true) }} disabled={busy} maxLength={80} />}
          {targetMode === 'library' && (
            <>
              <Select label="Working copy to overwrite" value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={busy} hint="Untouched originals are protected and cannot be chosen. Make a working copy in the Disk Library if you want to write to one.">
                <option value="">Choose a working copy…</option>
                {adfs.map((m) => {
                  const why = m.pristine ? NOT_A_PRISTINE : m.missing ? 'file missing' : m.id === sourceId ? 'this is the source disk' : ''
                  return (
                    <option key={m.id} value={m.id} disabled={!!why}>
                      {m.name}
                      {why ? ` (${why})` : ''}
                    </option>
                  )
                })}
              </Select>
              {targetDisk && (
                <Banner tone="warning" title={`“${targetDisk.name}” will be replaced`}>
                  Everything on this disk is overwritten by the copy. Keep “Back up the destination first” on if you might want the old contents back.
                </Banner>
              )}
            </>
          )}
          {targetMode === 'file' && <PathInput label="Save as" value={targetPath} onChange={setTargetPath} extensions={['adf']} placeholder="/path/to/copy.adf" hint="The full path of the file to create. It must be outside the Amiga Studio library." />}
        </div>
      </Card>

      <Card>
        <div className="dt-step">
          <StepTitle n={3}>Options</StepTitle>
          <div className="dt-options">
            <div className="stack-sm">
              <Toggle label="Verify after copying" checked={verify} onChange={setVerify} disabled={busy} />
              <p className="dt-note">Reads the copy back and compares it with the source. Recommended; it takes a moment longer.</p>
            </div>
            {targetMode !== 'new' && (
              <>
                <div className="stack-sm">
                  <Toggle label="Back up the destination first" checked={backup} onChange={setBackup} disabled={busy} />
                  <p className="dt-note">Keeps the destination's old contents in your backups folder before anything is replaced.</p>
                </div>
                <div className="stack-sm">
                  <Toggle label="Allow overwriting" checked={overwrite} onChange={setOverwrite} disabled={busy} />
                  <p className="dt-note">
                    {targetMode === 'library' ? 'Required: the working copy already exists, and this copy replaces it.' : 'Off by default. If a file already exists at that path, nothing is changed and you are told. Turn on to replace it.'}
                  </p>
                </div>
              </>
            )}
          </div>
          {targetMode === 'library' && !overwrite && <Banner tone="warning">Turn on “Allow overwriting” to confirm you want to replace the contents of the working copy.</Banner>}
          <div className="row">
            <Button variant="primary" icon="copy" disabled={!canCopy} onClick={() => void copy()}>
              Copy disk
            </Button>
            {!sourceOk && sourceMode === 'file' && sourcePath.trim() !== '' && <span className="small muted">Type the full path of the file.</span>}
          </div>
          {busy && <JobProgress job={runner.job} jobId={runner.jobId} label="Copying the disk…" />}
        </div>
      </Card>

      {error && (
        <Banner tone="error" title="The disk was not copied">
          {error}
        </Banner>
      )}
      {report && <ReportCard report={report} media={media.data ?? []} />}

      <Card title="Recent copies" data-testid="history">
        {history.data && history.data.length === 0 ? (
          <p className="muted small">Nothing has been copied yet.</p>
        ) : (
          <Table head={['What', 'From', 'To', 'Result', 'Verified', 'When']} caption="Disk copy history">
            {(history.data ?? []).map((o) => {
              const src = describeEndpoint(o.source, media.data ?? [])
              const dst = describeEndpoint(o.destination, media.data ?? [])
              const st = STATUS[o.status] ?? { label: o.status, tone: 'neutral' as const }
              return (
                <tr key={o.id}>
                  <td>{opLabel(o)}</td>
                  <td title={src.title}>{src.text}</td>
                  <td title={dst.title}>{dst.text}</td>
                  <td>
                    <Badge tone={st.tone}>{st.label}</Badge>
                    {o.status === 'failed' && <div className="dt-hist-detail">{o.detail}</div>}
                  </td>
                  <td>
                    {o.verified ? (
                      <Badge tone="success">
                        <Icon name="check" size={12} /> Yes
                      </Badge>
                    ) : (
                      <span className="muted">No</span>
                    )}
                  </td>
                  <td className="muted">{formatDate(o.created_at)}</td>
                </tr>
              )
            })}
          </Table>
        )}
      </Card>
    </div>
  )
}
