import { useState, type FormEvent } from 'react'
import { call } from '@/api/client'
import type { RunMode } from '@/api/types'
import { useBackend } from '@/app/backend'
import { Badge, Banner, Button, Card, Icon, KV, PathInput, Select, useUi } from '@/components/ui'
import { friendly, isAbsolutePath } from '../hard-drives/helpers'
import './settings.css'

/** Running machines inside Amiga Studio through the Amiberry libretro core (works on Windows too). */
export function EmbeddedCard() {
  const { info, refreshInfo } = useBackend()
  const { toast } = useUi()
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const core = info?.embedded_core ?? null

  const setCore = async (e?: FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!isAbsolutePath(path)) {
      setError('Type the full path of the libretro core file, for example C:\\Amiberry\\amiberry-libretro-win-x86_64.dll or /opt/amiberry/amiberry-libretro-linux-x86_64.so.')
      return
    }
    setBusy(true)
    try {
      await call('embedded_set_core', { path: path.trim() })
      setPath('')
      await refreshInfo()
      toast('Emulator core saved', 'success')
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  const setMode = async (mode: RunMode) => {
    try {
      await call('run_mode_set', { mode })
      await refreshInfo()
    } catch (err) {
      toast(friendly(err), 'error')
    }
  }

  return (
    <Card title="Run machines inside Amiga Studio">
      <div className="stack">
        <p className="st-note">
          Official Windows builds of Amiberry cannot be controlled while they run. The Amiberry <strong>libretro core</strong> can: Amiga Studio loads it itself and shows the machine in its own window, with a screen, keyboard and mouse, pause, reset, floppy swap in DF0, saved states and screenshots, on every system.
        </p>
        <KV
          rows={[
            [
              'Core',
              core ? (
                <span key="c" data-testid="embedded-core">
                  <Badge tone="success">
                    <Icon name="check" size={12} /> Found
                  </Badge>{' '}
                  <span className="st-mono">{core}</span>
                </span>
              ) : (
                <Badge key="c" tone="warning">
                  <Icon name="warn" size={12} /> Not found
                </Badge>
              ),
            ],
          ]}
        />
        <Banner tone="info" title="What to expect in this mode">
          <ul className="st-list">
            <li>Only the floppy in DF0: can be swapped while a machine runs; DF1 to DF3 are fixed when it starts.</li>
            <li>There is no sound output and no joystick yet. The picture refreshes about 14 times a second.</li>
            <li>Saved states are not offered for machines with hard disks: the core crashes restoring them.</li>
            <li>The core runs inside the Amiga Studio process, so a crash in it closes the app. Your disks are safe-guarded by the same backups as always.</li>
          </ul>
        </Banner>
        <form className="stack-sm" onSubmit={(e) => void setCore(e)}>
          <PathInput label="Amiberry libretro core" hint="The amiberry-libretro file that matches your system. Amiga Studio also looks next to the emulator program." value={path} onChange={(v) => { setPath(v); setError(null) }} placeholder="/path/to/amiberry-libretro" />
          {error && <Banner tone="error">{error}</Banner>}
          <div className="row">
            <Button type="submit" variant="primary" disabled={!path.trim() || busy}>
              Use this core
            </Button>
          </div>
        </form>
        <Select label="Start machines" value={info?.run_mode ?? 'process'} onChange={(e) => void setMode(e.target.value as RunMode)} disabled={!core} data-testid="run-mode" hint="This is only the default; you can choose again each time on the Emulator screen.">
          <option value="process">In the emulator's own window</option>
          <option value="embedded">Inside Amiga Studio</option>
        </Select>
      </div>
    </Card>
  )
}
