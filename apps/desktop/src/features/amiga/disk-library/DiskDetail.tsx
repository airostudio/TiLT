import { useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { MediaRecord } from '@/api/types'
import { Banner, Button, KV, Modal, useUi } from '@/components/ui'
import { formatBytes, formatDate } from '@/lib/format'
import { DiskBadges } from '../shared/DiskBadges'
import { adfWarnings, bootStatus, formatSummary, originLabel } from '../shared/disks'

type Check = { state: 'ok' } | { state: 'bad' } | { state: 'error'; message: string } | null

/** Everything the backend knows about one library item, plus the actions on it. */
export function DiskDetail({
  disk,
  all,
  onClose,
  onWorkingCopy,
  onExport,
  onDelete,
}: {
  disk: MediaRecord
  all: MediaRecord[]
  onClose: () => void
  onWorkingCopy: (d: MediaRecord) => void
  onExport: (d: MediaRecord) => void
  onDelete: (d: MediaRecord) => void
}) {
  const { toast } = useUi()
  const [check, setCheck] = useState<Check>(null)
  const [checking, setChecking] = useState(false)
  const byId = (id: string | null) => (id ? all.find((m) => m.id === id) : undefined)
  const parent = byId(disk.parent_id)
  const dmsSource = byId(disk.source_dms_id)
  const adf = disk.info.adf
  const dms = disk.info.dms
  const warnings = adfWarnings(disk)

  const verify = async () => {
    setChecking(true)
    setCheck(null)
    try {
      const ok = await call<boolean>('media_verify', { id: disk.id })
      setCheck({ state: ok ? 'ok' : 'bad' })
    } catch (e) {
      setCheck({ state: 'error', message: errorMessage(e) })
      toast(errorMessage(e), 'error')
    } finally {
      setChecking(false)
    }
  }

  const rows: [string, React.ReactNode][] = [
    ['What it is', originLabel(disk)],
    ['Format', formatSummary(disk)],
    ['Size', `${formatBytes(disk.size)} (${disk.size.toLocaleString()} bytes)`],
  ]
  if (adf) {
    rows.push(
      ['Disk name (volume label)', adf.volume_name ?? <span className="muted">none</span>],
      ['Type', adf.density === 'high' ? 'High density (1.76 MB)' : 'Standard (double density, 880 KB)'],
      ['File system', adf.fs ? `${adf.fs.toUpperCase()}${adf.international ? ', international' : ''}${adf.dir_cache ? ', directory cache' : ''}` : 'Not an AmigaDOS disk'],
      ['Starts the Amiga?', bootStatus(disk)],
    )
  }
  if (dms) {
    rows.push(
      ['Archive type', dms.disk_type || 'unknown'],
      ['Tracks', `${dms.first_track} to ${dms.last_track}`],
      ['Packed / unpacked', `${formatBytes(dms.packed_size)} / ${formatBytes(dms.unpacked_size)}`],
      ['Protected with a password', dms.encrypted ? 'Yes' : 'No'],
      ['Description', dms.description || <span className="muted">none</span>],
    )
  }
  if (parent) rows.push(['Copied from', parent.name])
  if (dmsSource) rows.push(['Converted from archive', dmsSource.name])
  const derived = all.filter((m) => m.source_dms_id === disk.id)
  if (disk.kind === 'dms' && derived.length) rows.push(['Disk made from it', derived.map((d) => d.name).join(', ')])
  rows.push(
    ['Fingerprint (SHA-256)', <code key="h" data-testid="detail-hash">{disk.sha256}</code>],
    ['Stored at', <code key="p">{disk.path}</code>],
    ['Added', formatDate(disk.imported_at)],
    ['Last used', disk.last_used ? formatDate(disk.last_used) : 'Never'],
  )

  return (
    <Modal
      wide
      title={disk.name}
      onClose={onClose}
      actions={
        <>
          <Button icon="copy" disabled={disk.kind !== 'adf' || disk.missing} title={disk.kind === 'dms' ? 'Make a working copy from the ADF disk that was converted from this archive.' : 'Make a copy you can write to'} onClick={() => onWorkingCopy(disk)}>
            Make working copy
          </Button>
          <Button icon="download" onClick={() => onExport(disk)}>
            Export…
          </Button>
          <Button variant="danger" icon="trash" onClick={() => onDelete(disk)}>
            Delete…
          </Button>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <DiskBadges disk={disk} />
      {disk.missing && (
        <Banner tone="error" title="The library file is missing">
          Amiga Studio cannot find this disk’s file any more, so it cannot be used in a drive. If you still have your original file, delete this entry and import the file again.
        </Banner>
      )}
      {warnings.length > 0 && (
        <Banner tone="warning" title="Things to know about this disk">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}
      <KV rows={rows} />
      <div className="row">
        <Button icon="check" onClick={() => void verify()} disabled={checking || disk.missing} title="Re-reads the stored file and compares its fingerprint with the one recorded when it was imported">
          {checking ? 'Checking…' : 'Check integrity'}
        </Button>
        <span className="faint xs">Confirms the stored file has not changed since it was added.</span>
      </div>
      {check?.state === 'ok' && (
        <Banner tone="success">
          {disk.pristine || disk.kind === 'dms' ? 'The stored file matches its fingerprint exactly.' : 'The stored file matches the fingerprint recorded when it was created.'}
        </Banner>
      )}
      {check?.state === 'bad' && (
        <Banner tone="error" title="The file has changed">
          {disk.pristine || disk.kind === 'dms'
            ? 'This untouched original no longer matches what was imported, so it may be damaged. Delete it and import your original file again.'
            : 'This writable disk differs from when it was created. That is expected if an Amiga program has written to it since.'}
        </Banner>
      )}
      {check?.state === 'error' && <Banner tone="error">{check.message}</Banner>}
      <p className="faint xs">
        ADF is a plain copy of a disk’s data. It cannot keep copy protection or unusual disk layouts, so a few protected games may not load from an ADF.
      </p>
    </Modal>
  )
}
