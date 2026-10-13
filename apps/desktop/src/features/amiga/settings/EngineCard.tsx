import { useState, type FormEvent } from 'react'
import { ApiError, call } from '@/api/client'
import type { EngineInfo } from '@/api/types'
import { useBackend } from '@/app/backend'
import { Badge, Banner, Button, Card, ErrorNote, Icon, KV, Loading, PathInput, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { friendly, isAbsolutePath } from '../hard-drives/helpers'
import './settings.css'

type EngineState = { info: EngineInfo; missing?: undefined } | { info: null; missing: string }

/** The emulator engine (Amiberry): where it is, what it can do on this computer, and how to point at it. */
export function EngineCard() {
  const { toast } = useUi()
  const { refreshInfo } = useBackend()
  const engine = useLoad<EngineState>(async () => {
    try {
      return { info: await call<EngineInfo>('engine_info') }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'not_found') return { info: null, missing: e.message }
      throw e
    }
  })
  const [path, setPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const setEnginePath = async (e?: FormEvent) => {
    e?.preventDefault()
    setError(null)
    if (!isAbsolutePath(path)) {
      setError('Type the full path of the Amiberry program, for example /usr/local/bin/amiberry or C:\\Amiberry\\amiberry.exe.')
      return
    }
    setBusy(true)
    try {
      const info = await call<EngineInfo>('engine_set_path', { path: path.trim() })
      engine.set({ info })
      setPath('')
      void refreshInfo()
      toast('Emulator engine found and saved', 'success')
    } catch (err) {
      setError(friendly(err))
    } finally {
      setBusy(false)
    }
  }

  const data = engine.data
  const info = data?.info ?? null
  return (
    <div className="stack">
      <Card
        title="Emulator engine"
        actions={
          <Button size="sm" icon="reset" onClick={() => void engine.reload()}>
            Check again
          </Button>
        }
      >
        <div className="stack">
          <p className="st-note">Amiga Studio runs your machines with <strong>Amiberry</strong>, a separate open-source Amiga emulator. Amiga Studio looks for it in the folder you choose below, next to the app, and then on your computer's program path.</p>
          <ErrorNote error={engine.error} />
          {engine.loading ? (
            <Loading />
          ) : info ? (
            <>
              <KV
                rows={[
                  ['Status', <Badge key="s" tone="success"><Icon name="check" size={12} /> Found</Badge>],
                  ['Program', <span key="p" className="st-mono" data-testid="engine-path">{info.path}</span>],
                  ['Version', <span key="v" data-testid="engine-banner">{info.banner}</span>],
                  [
                    'Control while a machine runs',
                    info.runtime_control ? (
                      <Badge key="c" tone="success"><Icon name="check" size={12} /> Available</Badge>
                    ) : (
                      <Badge key="c" tone="warning"><Icon name="warn" size={12} /> Not available</Badge>
                    ),
                  ],
                ]}
              />
              {info.runtime_control_note && (
                <Banner tone="warning" title="Limited control on this build">
                  {info.runtime_control_note}
                </Banner>
              )}
            </>
          ) : (
            <Banner tone="warning" title="The emulator engine was not found" >
              <p data-testid="engine-missing">{data?.missing}</p>
              <ol className="st-steps">
                <li>Install Amiberry for your system (or ask whoever set up Amiga Studio for it).</li>
                <li>Choose the Amiberry program below and press “Use this program”.</li>
              </ol>
              <p style={{ marginTop: 6 }}>Until then you can still manage ROMs, disks and hard drives, but you cannot start a machine.</p>
            </Banner>
          )}
          <form className="stack-sm" onSubmit={(e) => void setEnginePath(e)}>
            <PathInput label="Amiberry program" hint="The amiberry file you installed. Amiga Studio checks that it really is Amiberry before saving." value={path} onChange={(v) => { setPath(v); setError(null) }} placeholder="/path/to/amiberry" />
            {error && <Banner tone="error">{error}</Banner>}
            <div className="row">
              <Button type="submit" variant="primary" disabled={!path.trim() || busy}>
                Use this program
              </Button>
            </div>
          </form>
        </div>
      </Card>

      <Card title="What the engine can do on your computer">
        <div className="stack-sm">
          <p className="st-note">
            <strong>Runtime control</strong> means Amiga Studio can talk to a machine while it runs: swap floppy disks, pause and resume, take screenshots and save or load states, and shut it down politely.
          </p>
          <ul className="st-list st-note">
            <li>
              <strong>Linux and macOS builds</strong> of Amiberry have this control channel, so those features are available.
            </li>
            <li>
              <strong>Official Windows builds</strong> of Amiberry have no control channel. There, disk changes and pauses use the emulator's own menu (press F12 in its window), and changes made in Amiga Studio apply the next time the machine starts. To control a machine from Amiga Studio anyway, use “Run machines inside Amiga Studio” below.
            </li>
          </ul>
          {info && (
            <p className="st-note">
              <strong>Your engine:</strong> {info.runtime_control ? 'runtime control is available.' : 'runtime control is not available on this computer.'}
            </p>
          )}
        </div>
      </Card>
    </div>
  )
}
