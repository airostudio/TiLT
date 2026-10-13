import { useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { RomImportResult } from '@/api/types'
import { Badge, Banner, DropZone, Icon } from '@/components/ui'
import { basename, shortHash } from '@/lib/format'

/** Drop zone + copy/reference choice + per-file results. Used by the wizard and the ROM Library. */
export function RomImport({ onDone }: { onDone: (results: RomImportResult[]) => void }) {
  const [copy, setCopy] = useState(true)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<RomImportResult[]>([])
  const [error, setError] = useState<string | null>(null)

  const run = async (paths: string[]) => {
    setBusy(true)
    setError(null)
    try {
      const r = await call<RomImportResult[]>('rom_import', { paths, copy })
      setResults(r)
      onDone(r)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <fieldset className="stack-sm" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="field-label" style={{ marginBottom: 6 }}>
          Where should the ROM live?
        </legend>
        <label className="toggle">
          <input type="radio" name="rom-mode" checked={copy} onChange={() => setCopy(true)} />
          <span>
            <strong>Copy into the Amiga Studio library</strong> <span className="muted small">(recommended: it keeps working if you move the original)</span>
          </span>
        </label>
        <label className="toggle">
          <input type="radio" name="rom-mode" checked={!copy} onChange={() => setCopy(false)} />
          <span>
            <strong>Use the file where it is</strong> <span className="muted small">(saves space; if you move it you can relink it later)</span>
          </span>
        </label>
      </fieldset>
      <DropZone
        title="Drop Kickstart ROM files here"
        hint="Kickstart 1.3, 2.x and 3.1 images (.rom / .bin). You can select several at once."
        extensions={['rom', 'bin', 'a500', 'a1200', 'a4000']}
        onPaths={(p) => void run(p)}
        disabled={busy}
      />
      {error && <Banner tone="error">{error}</Banner>}
      {results.length > 0 && (
        <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label="Import results" data-testid="rom-results">
          {results.map((r) => (
            <li key={r.path} className="banner" style={{ alignItems: 'center' }}>
              <Icon name={r.ok ? 'check' : 'warn'} />
              <div className="banner-body">
                <div className="truncate" title={r.path}>
                  <strong>{basename(r.path)}</strong>
                </div>
                {r.ok && (
                  <div className="muted small">
                    {r.ok.record.info.label} · {shortHash(r.ok.record.info.sha256)}
                  </div>
                )}
                {r.error && <div className="small" style={{ color: 'var(--danger)' }}>{r.error.message}</div>}
              </div>
              {r.ok && (r.ok.duplicate ? <Badge>Already in your library</Badge> : <Badge tone="success">Imported</Badge>)}
              {r.error && <Badge tone="danger">Not imported</Badge>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
