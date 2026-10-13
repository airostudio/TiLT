import { useMemo, useState } from 'react'
import { ApiError, call, errorMessage, runJob } from '@/api/client'
import type { JobView, MediaImportResult, MediaRecord } from '@/api/types'
import { Badge, Banner, Button, Card, DropZone, Empty, Icon, JobProgress, Table, TextInput, useUi } from '@/components/ui'
import { basename, formatBytes, formatDate, shortHash } from '@/lib/format'
import { DiskBadges } from '../shared/DiskBadges'
import { FILTER_LABELS, filterDisks, formatSummary, sortDisks, type DiskFilter } from '../shared/disks'
import { WorkingCopyDialog } from '../shared/WorkingCopyDialog'
import { DiskDetail } from './DiskDetail'
import { CreateBlankDialog, ExportDialog } from './dialogs'

function resultView(r: MediaImportResult): { tone: 'success' | 'neutral' | 'danger'; label: string; text: string } {
  const file = basename(r.path)
  if (r.error) return { tone: 'danger', label: 'Not imported', text: r.error.message }
  const ok = r.ok!
  const isDms = !!ok.dms_record
  if (ok.duplicate) {
    return {
      tone: 'neutral',
      label: 'Already in library',
      text: isDms ? `“${ok.record.name}” was already in your library. The DMS archive is kept too.` : `“${ok.record.name}” was already in your library, so nothing was added.`,
    }
  }
  return {
    tone: 'success',
    label: 'Imported',
    text: isDms
      ? `Converted to a disk image (ADF) called “${ok.record.name}”. The original DMS archive is kept.`
      : `Added “${ok.record.name}” (${formatSummary(ok.record)}). ${file} on your computer was only read, not changed.`,
  }
}

export function DisksTab({ media, reload }: { media: MediaRecord[]; reload: () => Promise<void> }) {
  const { toast, confirm } = useUi()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DiskFilter>('all')
  const [importing, setImporting] = useState(false)
  const [job, setJob] = useState<JobView | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [results, setResults] = useState<MediaImportResult[] | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [copyOf, setCopyOf] = useState<MediaRecord | null>(null)
  const [exporting, setExporting] = useState<MediaRecord | null>(null)
  const [creating, setCreating] = useState(false)

  const shown = useMemo(() => sortDisks(filterDisks(media, query, filter)), [media, query, filter])
  const detail = detailId ? media.find((m) => m.id === detailId) : undefined

  const doImport = async (paths: string[]) => {
    setImporting(true)
    setResults(null)
    try {
      const res = await runJob<MediaImportResult[]>('media_import', { paths }, { onProgress: setJob, onStart: setJobId })
      setResults(res)
      const added = res.filter((r) => r.ok && !r.ok.duplicate).length
      const failed = res.filter((r) => r.error).length
      toast(`${added} disk${added === 1 ? '' : 's'} added${failed ? `, ${failed} could not be imported` : ''}.`, failed && !added ? 'error' : 'success')
    } catch (e) {
      if (e instanceof ApiError && e.code === 'cancelled') toast('Import cancelled. Disks that were already added stay in your library.', 'info')
      else toast(errorMessage(e), 'error')
    } finally {
      setImporting(false)
      setJob(null)
      setJobId(null)
      await reload()
    }
  }

  const remove = async (d: MediaRecord) => {
    const writable = !d.pristine && d.kind === 'adf'
    const ok = await confirm({
      title: `Delete “${d.name}”?`,
      danger: true,
      confirmLabel: 'Delete disk',
      body: writable ? (
        <p>
          This permanently deletes the disk <strong>and everything saved on it</strong>. This cannot be undone. Any untouched original it was copied from is not affected.
        </p>
      ) : d.kind === 'dms' ? (
        <p>This removes the DMS archive from your library. The file you originally imported on your computer is not touched, so you can add it again later.</p>
      ) : (
        <p>This removes the library’s copy of this untouched original. The file you originally imported on your computer is not touched, so you can add it again later.</p>
      ),
    })
    if (!ok) return
    try {
      await call('media_delete', { id: d.id })
      toast(`Deleted “${d.name}”`, 'success')
      setDetailId(null)
      await reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <div className="stack">
      <Card
        className="dl-add"
        title="Add disks"
        actions={
          <Button icon="plus" onClick={() => setCreating(true)}>
            Create blank disk…
          </Button>
        }
      >
        <div className="stack">
          {importing ? (
            <JobProgress job={job} jobId={jobId} label="Importing disks…" />
          ) : (
            <DropZone
              title="Drop disk images here"
              hint="ADF disk images and DMS archives. The file type is checked from the file’s contents, not its name. Your files are only read, never changed."
              extensions={['adf', 'dms']}
              onPaths={(p) => void doImport(p)}
            />
          )}
          {results && (
            <section aria-label="Import results" className="stack-sm" data-testid="import-results">
              <div className="row">
                <strong>Import results</strong>
                <span className="spacer" />
                <Button size="sm" variant="ghost" onClick={() => setResults(null)}>
                  Dismiss
                </Button>
              </div>
              <ul className="dl-results">
                {results.map((r, i) => {
                  const v = resultView(r)
                  return (
                    <li key={`${r.path}-${i}`} data-testid="import-result">
                      <Badge tone={v.tone}>{v.label}</Badge>
                      <span className="mono truncate" title={r.path}>
                        {basename(r.path)}
                      </span>
                      <span className="muted small dl-result-text">{v.text}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </div>
      </Card>

      <Card
        title="Your disks"
        actions={
          <span className="muted small" aria-live="polite" data-testid="disk-count">
            {shown.length === media.length ? `${media.length} in library` : `${shown.length} of ${media.length} shown`}
          </span>
        }
      >
        <div className="stack">
          <div className="dl-toolbar">
            <div className="dl-search">
              <TextInput label="Search" type="search" placeholder="Search by name, label or format…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="field">
              <span className="field-label" id="dl-filter-label">
                Show
              </span>
              <div className="dl-seg" role="group" aria-labelledby="dl-filter-label">
                {(Object.keys(FILTER_LABELS) as DiskFilter[]).map((f) => (
                  <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {FILTER_LABELS[f]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {media.length === 0 ? (
            <Empty icon="disk" title="Your disk library is empty">
              Add ADF disk images or DMS archives above. They are copied into Amiga Studio’s library and stay safe: originals are kept read-only.
            </Empty>
          ) : shown.length === 0 ? (
            <Empty icon="search" title="No disks match" action={<Button onClick={() => { setQuery(''); setFilter('all') }}>Clear search and filter</Button>}>
              Try a different search word, or show all disks.
            </Empty>
          ) : (
            <Table head={['Disk', 'Size', <span key="h" className="dl-hide-narrow">Fingerprint</span>, 'Status', <span key="u" className="dl-hide-narrow">Last used</span>, <span key="a" className="sr-only">Actions</span>]} caption="Disks in your library">
              {shown.map((d) => (
                <tr key={d.id} data-testid="disk-row" data-name={d.name}>
                  <td>
                    <button type="button" className="dl-name" onClick={() => setDetailId(d.id)} aria-label={`Details for ${d.name}`}>
                      <Icon name={d.kind === 'dms' ? 'box' : 'floppy'} size={16} />
                      <span className="truncate">{d.name}</span>
                    </button>
                    <div className="muted xs dl-summary">{formatSummary(d)}</div>
                  </td>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>
                    {formatBytes(d.size)}
                  </td>
                  <td className="dl-hide-narrow">
                    <code title={d.sha256}>{shortHash(d.sha256)}</code>
                  </td>
                  <td>
                    <DiskBadges disk={d} />
                  </td>
                  <td className="muted dl-hide-narrow" style={{ whiteSpace: 'nowrap' }}>
                    {d.last_used ? formatDate(d.last_used) : 'Never'}
                  </td>
                  <td>
                    <div className="row-nowrap" style={{ justifyContent: 'flex-end', gap: 4 }}>
                      <Button size="sm" onClick={() => setDetailId(d.id)} aria-label={`Show details of ${d.name}`}>
                        Details
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="copy"
                        aria-label={`Make a working copy of ${d.name}`}
                        title={d.kind === 'dms' ? 'DMS archives cannot be copied for writing; use the disk converted from it' : 'Make a working copy'}
                        disabled={d.kind !== 'adf' || d.missing}
                        onClick={() => setCopyOf(d)}
                      />
                      <Button size="sm" variant="ghost" iconOnly icon="download" aria-label={`Export ${d.name}`} title="Export to a file" onClick={() => setExporting(d)} />
                      <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Delete ${d.name}`} title="Delete from library" onClick={() => void remove(d)} />
                    </div>
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <Banner tone="info">
            <strong>Untouched originals</strong> are stored read-only and never change. To save games or install programs, make a <strong>working copy</strong> and use that in a drive.
          </Banner>
        </div>
      </Card>

      {detail && (
        <DiskDetail
          disk={detail}
          all={media}
          onClose={() => setDetailId(null)}
          onWorkingCopy={(d) => {
            setDetailId(null)
            setCopyOf(d)
          }}
          onExport={(d) => {
            setDetailId(null)
            setExporting(d)
          }}
          onDelete={(d) => {
            setDetailId(null)
            void remove(d)
          }}
        />
      )}
      {copyOf && <WorkingCopyDialog disk={copyOf} onClose={() => setCopyOf(null)} onDone={() => reload()} />}
      {exporting && <ExportDialog disk={exporting} onClose={() => setExporting(null)} />}
      {creating && <CreateBlankDialog onClose={() => setCreating(false)} onCreated={() => void reload()} />}
    </div>
  )
}
