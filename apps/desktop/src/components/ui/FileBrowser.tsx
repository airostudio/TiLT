import { useEffect, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import { formatBytes } from '@/lib/format'
import { Button, Icon, Modal, Spinner, TextInput } from './index'

interface Listing {
  path: string
  parent: string | null
  home: string | null
  roots: string[]
  entries: { name: string; is_dir: boolean; size: number }[]
  truncated: boolean
}

const joinPath = (dir: string, name: string): string => {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/**
 * In-app file browser for when the UI runs in a normal web browser (no native dialogs).
 * It lists folders on THIS computer through the local backend; nothing is uploaded.
 */
export function FileBrowser({
  mode,
  multiple,
  extensions,
  start,
  title,
  onPick,
  onClose,
}: {
  mode: 'file' | 'dir'
  multiple?: boolean
  extensions?: string[]
  start?: string
  title: string
  onPick: (paths: string[]) => void
  onClose: () => void
}) {
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [all, setAll] = useState(false)
  const [typed, setTyped] = useState('')

  const go = async (path?: string) => {
    setBusy(true)
    try {
      const l = await call<Listing>('fs_list', path ? { path } : {})
      setListing(l)
      setTyped(l.path)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    void go(start && /^([a-zA-Z]:|\/)/.test(start) ? start.replace(/[\\/][^\\/]*$/, '') || undefined : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const matches = (n: string) => all || !extensions?.length || extensions.some((x) => n.toLowerCase().endsWith(`.${x.toLowerCase()}`))
  const entries = (listing?.entries ?? []).filter((e) => (mode === 'dir' ? e.is_dir : e.is_dir || matches(e.name)))
  const toggle = (p: string) => setPicked((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : multiple ? [...cur, p] : [p]))

  return (
    <Modal
      wide
      title={title}
      onClose={onClose}
      actions={
        <>
          <span className="muted small" style={{ marginRight: 'auto' }}>
            {mode === 'dir' ? (listing ? `Folder: ${listing.path}` : '') : picked.length ? `${picked.length} selected` : 'Select a file'}
          </span>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={mode === 'dir' ? !listing : picked.length === 0}
            onClick={() => {
              onPick(mode === 'dir' ? [listing!.path] : picked)
              onClose()
            }}
          >
            {mode === 'dir' ? 'Use this folder' : 'Choose'}
          </Button>
        </>
      }
    >
      <p className="muted small">This lists folders on this computer. Files are only read when you import them; nothing is uploaded.</p>
      <form
        className="row-nowrap"
        onSubmit={(e) => {
          e.preventDefault()
          void go(typed.trim())
        }}
      >
        <Button type="button" iconOnly icon="back" aria-label="Up one folder" disabled={!listing?.parent} onClick={() => void go(listing!.parent!)} />
        {listing?.home && (
          <Button type="button" icon="home" onClick={() => void go(listing.home!)}>
            Home
          </Button>
        )}
        <TextInput aria-label="Folder path" value={typed} onChange={(e) => setTyped(e.target.value)} spellCheck={false} />
        <Button type="submit">Go</Button>
      </form>
      {listing && listing.roots.length > 1 && (
        <div className="row">
          {listing.roots.map((r) => (
            <Button key={r} size="sm" onClick={() => void go(r)}>
              {r}
            </Button>
          ))}
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          <Icon name="warn" />
          <div className="banner-body">{error}</div>
        </div>
      )}
      <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }} data-testid="file-browser">
        {busy && !listing ? (
          <div className="row muted" style={{ padding: 16 }}>
            <Spinner /> Loading…
          </div>
        ) : (
          <table className="table" style={{ textAlign: 'left' }}>
            <caption className="sr-only">Files and folders</caption>
            <tbody>
              {entries.map((e) => {
                const full = listing ? joinPath(listing.path, e.name) : e.name
                const isPicked = picked.includes(full)
                return (
                  <tr
                    key={e.name}
                    tabIndex={0}
                    aria-selected={!e.is_dir && isPicked}
                    style={{ cursor: 'pointer', background: isPicked ? 'var(--accent-soft)' : undefined }}
                    onClick={() => (e.is_dir ? void go(full) : toggle(full))}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault()
                        if (e.is_dir) void go(full)
                        else toggle(full)
                      }
                    }}
                  >
                    <td style={{ width: 28 }}>
                      <Icon name={e.is_dir ? 'folder' : 'disk'} size={16} />
                    </td>
                    <td>
                      {e.name}
                      {isPicked && <span className="sr-only"> (selected)</span>}
                    </td>
                    <td className="muted" style={{ textAlign: 'right' }}>
                      {e.is_dir ? '' : formatBytes(e.size)}
                    </td>
                  </tr>
                )
              })}
              {entries.length === 0 && !busy && (
                <tr>
                  <td colSpan={3} className="muted">
                    Nothing to show here.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <div className="row">
        {mode === 'file' && extensions?.length ? (
          <label className="toggle">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
            <span>Show all files (not only {extensions.map((x) => `.${x}`).join(' ')})</span>
          </label>
        ) : null}
        {listing?.truncated && <span className="muted small">Only the first entries are shown.</span>}
      </div>
    </Modal>
  )
}
