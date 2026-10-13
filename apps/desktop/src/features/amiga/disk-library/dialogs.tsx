import { useId, useState, type FormEvent } from 'react'
import { call, errorMessage } from '@/api/client'
import type { Density, FsKind, MediaRecord } from '@/api/types'
import { Banner, Button, Field, Modal, Select, TextInput, Toggle, useUi } from '@/components/ui'
import { canBrowse, pickSavePath } from '@/lib/files'

/** Copy a disk out of the library to a place of the user's choosing. Never overwrites silently. */
export function ExportDialog({ disk, onClose }: { disk: MediaRecord; onClose: () => void }) {
  const { toast, confirm } = useUi()
  const [dest, setDest] = useState('')
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const ext = disk.kind === 'dms' ? 'dms' : 'adf'

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!dest.trim() || busy) return
    if (overwrite) {
      const ok = await confirm({
        title: 'Replace the existing file?',
        body: (
          <>
            If a file already exists at <code>{dest.trim()}</code> it will be replaced by this disk. The old file cannot be recovered.
          </>
        ),
        confirmLabel: 'Replace file',
        danger: true,
      })
      if (!ok) return
    }
    setBusy(true)
    setError(null)
    try {
      await call('media_export', { id: disk.id, dest: dest.trim(), overwrite })
      toast(`Saved a copy of “${disk.name}” to ${dest.trim()}`, 'success')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={`Export “${disk.name}”`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon="download" disabled={!dest.trim() || busy} onClick={() => void submit()}>
            Export
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted small">
          Saves a copy of this {disk.kind === 'dms' ? 'DMS archive' : 'disk image'} as a normal file. The library keeps its own copy too. Existing files are never replaced unless you tick the box below.
        </p>
        <Field label="Save to (full path including the file name)" htmlFor={id} hint={`For example …/${disk.name.replace(/[^\w.-]+/g, '_')}.${ext}`}>
          <div className="row-nowrap">
            <input
              id={id}
              className="input"
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder={`Absolute path ending in .${ext}`}
              spellCheck={false}
              autoFocus
            />
            {canBrowse() && (
              <Button
                icon="folder"
                onClick={async () => {
                  const p = await pickSavePath({ title: 'Save disk image', defaultName: `${disk.name}.${ext}`, extensions: [ext] })
                  if (p) setDest(p)
                }}
              >
                Choose…
              </Button>
            )}
          </div>
        </Field>
        <Toggle label="Replace the file if it already exists" checked={overwrite} onChange={setOverwrite} />
        {error && <Banner tone="error">{error}</Banner>}
      </form>
    </Modal>
  )
}

/** A new, formatted, empty disk you can write to. */
export function CreateBlankDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (m: MediaRecord) => void }) {
  const { toast } = useUi()
  const [name, setName] = useState('Blank')
  const [fs, setFs] = useState<FsKind>('ffs')
  const [density, setDensity] = useState<Density>('double')
  const [intl, setIntl] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const m = await call<MediaRecord>('media_create_blank', { name: name.trim(), fs, density, international: intl })
      toast(`Created blank disk “${m.name}”`, 'success')
      onCreated(m)
      onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Create a blank disk"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void submit()}>
            Create disk
          </Button>
        </>
      }
    >
      <form className="stack" onSubmit={(e) => void submit(e)}>
        <p className="muted small">A new, empty, formatted floppy you can write to. It is stored in your library as a disk you can change.</p>
        <TextInput label="Disk name" hint="This is the name the Amiga shows on the Workbench screen (up to 30 characters, no “:” or “/”)." value={name} onChange={(e) => setName(e.target.value)} maxLength={30} autoFocus />
        <div className="grid grid-2">
          <Select label="Type of disk" value={density} onChange={(e) => setDensity(e.target.value as Density)} hint="Standard Amiga floppies are double density. High density needs an HD floppy drive.">
            <option value="double">Standard (double density, 880 KB)</option>
            <option value="high">High density (1.76 MB)</option>
          </Select>
          <Select label="File system" value={fs} onChange={(e) => setFs(e.target.value as FsKind)} hint="FFS is faster and fine for Kickstart 2.0 and newer. OFS works everywhere, including Kickstart 1.x.">
            <option value="ffs">FFS (Fast File System, recommended)</option>
            <option value="ofs">OFS (Original File System)</option>
          </Select>
        </div>
        <details>
          <summary className="small muted" style={{ cursor: 'pointer' }}>
            Advanced options
          </summary>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Toggle label="International mode (accented letters in file names)" checked={intl} onChange={setIntl} />
          </div>
        </details>
        {error && <Banner tone="error">{error}</Banner>}
      </form>
    </Modal>
  )
}
