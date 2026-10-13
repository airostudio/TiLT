import { useEffect, useRef, type ReactNode } from 'react'
import type { CopyReport, MediaRecord, OperationRecord } from '@/api/types'
import { Badge, Banner, Card, Icon, KV } from '@/components/ui'
import { basename, formatBytes } from '@/lib/format'
import './disk-tools.css'

/** Brings a freshly shown result or error into view. */
export function ScrollTo({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [])
  return <div ref={ref}>{children}</div>
}

export function StepTitle({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div className="dt-step-title">
      <span className="dt-step-num" aria-hidden="true">
        {n}
      </span>
      <h2>{children}</h2>
    </div>
  )
}

/** A group of radio buttons drawn as selectable cards. */
export function Choice<T extends string>({
  legend,
  name,
  value,
  onChange,
  options,
  disabled,
}: {
  legend: string
  name: string
  value: T
  onChange: (v: T) => void
  options: { id: T; label: string; help?: string }[]
  disabled?: boolean
}) {
  return (
    <fieldset className="dt-choice" disabled={disabled}>
      <legend>{legend}</legend>
      <div className="dt-choice-row">
        {options.map((o) => (
          <label key={o.id} className={value === o.id ? 'on' : ''}>
            <input type="radio" name={name} value={o.id} checked={value === o.id} onChange={() => onChange(o.id)} />
            <span>
              <strong>{o.label}</strong>
              {o.help && <small>{o.help}</small>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/** What a finished copy did, with the checksums compared in words as well as an icon. */
export function ReportCard({ report, media }: { report: CopyReport; media: MediaRecord[] }) {
  const same = report.source_sha256 === report.destination_sha256
  const destDisk = report.destination_media_id ? media.find((m) => m.id === report.destination_media_id) : undefined
  return (
    <Card title="Copy complete" data-testid="copy-report">
      <div className="stack">
        <Banner tone="success" title={report.verified ? 'The copy was checked and is exact' : 'The copy was made'}>
          {report.verified ? 'After writing, the new disk was read back and compared with the source: every byte matches.' : 'Verification was switched off, so the new disk was not read back. The checksums below are still computed from what was written.'}
        </Banner>
        <KV
          rows={[
            ['Copied', `${formatBytes(report.bytes)} (${report.bytes.toLocaleString()} bytes)`],
            ['Destination', <span key="d">{destDisk ? <strong>{destDisk.name} </strong> : null}<span className="dt-hash">{report.destination}</span></span>],
            ['Source SHA-256', <span key="s" className="dt-hash">{report.source_sha256}</span>],
            [
              'Copy SHA-256',
              <div key="c">
                <span className="dt-hash">{report.destination_sha256}</span>
                <div className="dt-match">
                  {same ? (
                    <Badge tone="success">
                      <Icon name="check" size={12} /> Identical to the source
                    </Badge>
                  ) : (
                    <Badge tone="danger">
                      <Icon name="warn" size={12} /> Different from the source
                    </Badge>
                  )}
                </div>
              </div>,
            ],
            ['Verified after copying', report.verified ? 'Yes, read back and compared' : 'No (verification was off)'],
            ['Old contents backed up to', report.backup_path ? <span key="b" className="dt-hash">{report.backup_path}</span> : 'Nothing to back up'],
          ]}
        />
        {report.notes.length > 0 && (
          <ul className="dt-list small muted">
            {report.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

// ---------- history in plain words ----------
const unescape = (s: string) => s.replace(/\\(["\\])/g, '$1')

/** The backend stores the endpoints as Rust debug text; turn it into a short phrase. */
export function describeEndpoint(raw: string, media: MediaRecord[]): { text: string; title?: string } {
  const lib = /^Library \{ media_id: "((?:[^"\\]|\\.)*)" \}$/.exec(raw)
  if (lib) {
    const id = unescape(lib[1])
    const m = media.find((x) => x.id === id)
    return { text: m ? `Library disk “${m.name}”` : 'A library disk that has since been removed' }
  }
  const file = /^File \{ path: "((?:[^"\\]|\\.)*)" \}$/.exec(raw)
  if (file) {
    const p = unescape(file[1])
    return { text: `File “${basename(p)}”`, title: p }
  }
  const nl = /^NewLibraryImage \{ name: "((?:[^"\\]|\\.)*)" \}$/.exec(raw)
  if (nl) return { text: `New library disk “${unescape(nl[1])}”` }
  return { text: raw }
}

export const STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }> = {
  done: { label: 'Completed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'warning' },
}

export const KIND: Record<string, string> = { copy: 'Disk copy' }

export const opLabel = (o: OperationRecord): string => KIND[o.kind] ?? o.kind
