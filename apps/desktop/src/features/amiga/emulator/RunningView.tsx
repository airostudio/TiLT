import { useCallback, useEffect, useRef, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { DriveView, MachineProfile, MediaRecord, SessionStatus } from '@/api/types'
import { Badge, Banner, Button, Card, Page, PageHeader, Select, Table, TextInput, Toggle, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useInterval, useLoad } from '@/lib/hooks'
import { formatDuration } from '@/lib/format'
import { CONFIRMED_SHORTCUTS } from './shortcuts'
import { LiveScreen } from './LiveScreen'
import { NO_CONTROL_FALLBACK, type EngineState } from './useEngine'
import './emulator.css'

export interface StopResult {
  outcome: string
  machine: string
}

// ---------- live preview ----------
function usePreview(active: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (dead) return
      // only ask the emulator for a picture while this tab is on screen
      if (document.visibilityState === 'visible') {
        try {
          const r = await call<{ png_base64: string }>('session_screenshot')
          if (!dead) {
            setSrc(`data:image/png;base64,${r.png_base64}`)
            setError(null)
          }
        } catch (e) {
          if (!dead) setError(errorMessage(e))
        }
      }
      if (!dead) timer = setTimeout(() => void tick(), 1500)
    }
    void tick()
    return () => {
      dead = true
      if (timer) clearTimeout(timer)
    }
  }, [active])
  return { src, error }
}

function PreviewCard({ active }: { active: boolean }) {
  const { src, error } = usePreview(active)
  return (
    <Card title="Preview" className="preview-wrap">
      <div className="screen-frame" data-testid="preview-frame">
        {src ? <img src={src} alt="Preview of the Amiga screen, refreshed about every 1.5 seconds" data-testid="preview-img" /> : <span>{error ? 'No preview available right now.' : 'Waiting for the first preview…'}</span>}
      </div>
      <p className="preview-caption">
        This is a preview picture, refreshed about every 1.5 seconds, and it is not live video. The real, authentic Amiga display, with sound and input, is in the emulator's own window.
      </p>
      {error && (
        <p className="small" style={{ color: 'var(--warning)' }} role="status">
          Preview paused: {error}
        </p>
      )}
    </Card>
  )
}

// ---------- floppies ----------
function FloppyCard({ active, embedded }: { active: boolean; embedded: boolean }) {
  const { toast } = useUi()
  const drives = useLoad(() => call<DriveView[]>('session_drives'), [])
  const media = useLoad(() => call<MediaRecord[]>('media_list'), [])
  const [pick, setPick] = useState<Record<number, string>>({})
  const [protect, setProtect] = useState<Record<number, boolean>>({})
  useInterval(() => void drives.reload(), 2000, active)
  const library = (media.data ?? []).filter((m) => m.kind === 'adf' && !m.missing)
  const inserted = new Set((drives.data ?? []).map((d) => d.media_id).filter(Boolean))

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      toast(ok, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
    await drives.reload()
  }

  return (
    <Card title="Floppy drives">
      {drives.error && <Banner tone="warning">{drives.error}</Banner>}
      {drives.loading && !drives.data && <p className="muted small">Reading the drives…</p>}
      <ul className="df-list" aria-label="Floppy drives">
        {(drives.data ?? []).map((d) => {
          const free = library.filter((m) => !inserted.has(m.id))
          return (
            <li key={d.unit} className="df-row" data-testid={`df-${d.unit}`}>
              <span className="df-name">DF{d.unit}:</span>
              <div>
                {!d.enabled ? (
                  <span className="muted small">Not fitted in this machine</span>
                ) : d.path ? (
                  <>
                    <strong>{d.media_name ?? 'A disk that is not in your library'}</strong>
                    <div className="small muted">
                      {d.write_protected ? 'Write protected' : 'Writable'}
                      {d.live_state && <> · {d.writing ? `writing, track ${d.track ?? '?'}` : d.motor ? `motor on, track ${d.track ?? '?'}` : 'idle'}</>}
                    </div>
                  </>
                ) : (
                  <span className="muted small">Empty{d.live_state && <> · {d.motor ? 'motor on' : 'idle'}</>}</span>
                )}
              </div>
              {d.enabled && !d.swappable && <span className="small muted">Fixed while running</span>}
              {d.enabled && d.swappable && d.path && (
                <Button size="sm" icon="eject" onClick={() => void act(() => call('session_eject', { unit: d.unit }), `Ejected DF${d.unit}:`)} aria-label={`Eject DF${d.unit}`}>
                  Eject
                </Button>
              )}
              {d.enabled && d.swappable && !d.path && (
                <div className="df-insert">
                  <Select aria-label={`Insert a disk into DF${d.unit}`} value={pick[d.unit] ?? ''} onChange={(e) => setPick({ ...pick, [d.unit]: e.target.value })}>
                    <option value="">Insert…</option>
                    {free.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.pristine ? ' (original)' : ''}
                      </option>
                    ))}
                  </Select>
                  <Toggle label="Write protect" checked={protect[d.unit] ?? false} onChange={(v) => setProtect({ ...protect, [d.unit]: v })} />
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={!pick[d.unit]}
                    onClick={() =>
                      void act(async () => {
                        await call('session_insert', { unit: d.unit, media_id: pick[d.unit], write_protect: protect[d.unit] ?? false })
                        setPick({ ...pick, [d.unit]: '' })
                      }, `Inserted a disk into DF${d.unit}:`)
                    }
                  >
                    Insert
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {library.length === 0 && !media.loading && (
        <p className="small muted" style={{ marginTop: 8 }}>
          There are no disk images in your library to insert. <a href="#/amiga/disks">Import some in the Disk Library</a>.
        </p>
      )}
      {embedded && (
        <p className="small muted" style={{ marginTop: 8 }} data-testid="embedded-df-note">
          Running inside TiLT, only DF0: can be swapped while the machine runs (a limit of the emulator core). Disks in the other drives were chosen when the machine started. Because this mode cannot write protect a disk, only working copies can be inserted here, not untouched originals.
        </p>
      )}
      <p className="small muted" style={{ marginTop: 8 }}>
        {embedded ? 'Make a working copy in the Disk Library if you want to save to a disk.' : 'Untouched original disks are always inserted write protected. Make a working copy in the Disk Library if you want to save to a disk.'}{' '}
        <a href="#/amiga/floppies">More in Floppy Drives</a>.
      </p>
    </Card>
  )
}

// ---------- performance ----------
function PerfCard({ active }: { active: boolean }) {
  const perf = useLoad(() => call<{ fps: Record<string, string>; leds: Record<string, string>; uptime_s: number }>('session_perf'), [])
  useInterval(() => void perf.reload(), 2000, active)
  const list = (m: Record<string, string> | undefined) => Object.entries(m ?? {})
  const pretty = (k: string) => k.replace(/_/g, ' ')
  return (
    <Card title="Performance">
      {perf.error && <Banner tone="warning">{perf.error}</Banner>}
      {perf.data && (
        <div className="perf-grid" data-testid="perf">
          <div>
            <h3>Frame rate</h3>
            {list(perf.data.fps).length === 0 ? (
              <p className="muted small">The emulator has not reported a frame rate yet.</p>
            ) : (
              <dl className="kv">
                {list(perf.data.fps).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{pretty(k)}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          <div>
            <h3>Drive and disk activity</h3>
            {list(perf.data.leds).length === 0 ? (
              <p className="muted small">No activity reported.</p>
            ) : (
              <dl className="kv">
                {list(perf.data.leds).map(([k, v]) => (
                  <div key={k} style={{ display: 'contents' }}>
                    <dt>{pretty(k)}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------- sound ----------
function SoundCard({ profileId, onError }: { profileId: string | null; onError: (m: string) => void }) {
  const [volume, setVolume] = useState(80)
  const [muted, setMuted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>()
  useEffect(() => {
    if (!profileId) return
    let dead = false
    call<MachineProfile>('profile_get', { id: profileId })
      .then((p) => !dead && setVolume(p.audio.volume))
      .catch(() => undefined)
    return () => {
      dead = true
      if (timer.current) clearTimeout(timer.current)
    }
  }, [profileId])
  const send = (v: number) => {
    setVolume(v)
    setMuted(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      call('session_control', { action: 'volume', value: v }).catch((e) => onError(errorMessage(e)))
    }, 150)
  }
  return (
    <Card title="Sound">
      <div className="stack-sm">
        <div className="field">
          <label htmlFor="emu-volume">Volume: {muted ? 'muted' : `${volume}%`}</label>
          <input id="emu-volume" type="range" min={0} max={100} value={volume} onChange={(e) => send(Number(e.target.value))} />
        </div>
        <div className="row">
          <Button
            icon="mute"
            size="sm"
            onClick={async () => {
              try {
                await call('session_control', { action: 'mute' })
                setMuted(true)
              } catch (e) {
                onError(errorMessage(e))
              }
            }}
          >
            Mute
          </Button>
          {muted && <Badge tone="warning">Muted from here</Badge>}
        </div>
        <p className="ctl-help">Mute cannot be undone with a button. Move the volume slider to bring the sound back.</p>
      </div>
    </Card>
  )
}

// ---------- saved states ----------
function StatesCard({ onError, blockedReason }: { onError: (m: string) => void; blockedReason?: string }) {
  const { confirm } = useUi()
  const [name, setName] = useState('quicksave')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ what: string; path: string; note: string } | null>(null)
  const run = async (kind: 'save' | 'load') => {
    if (!name.trim()) return
    if (kind === 'load') {
      const ok = await confirm({
        title: `Load saved state “${name.trim()}”?`,
        body: 'The running machine is replaced by the saved memory snapshot. Disk contents are NOT rolled back, so a state taken before disk changes can corrupt that disk.',
        confirmLabel: 'Load state',
        danger: true,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const r = await call<{ path: string; note: string }>(kind === 'save' ? 'session_save_state' : 'session_load_state', { name: name.trim() })
      setLast({ what: kind === 'save' ? 'Saved' : 'Loaded', ...r })
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Saved states">
      <div className="stack-sm">
        <TextInput label="State name" hint="Letters, numbers, spaces, - and _." value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        <div className="ctl-group">
          <Button size="sm" icon="snapshot" disabled={busy || !name.trim() || !!blockedReason} onClick={() => void run('save')}>
            Save state
          </Button>
          <Button size="sm" disabled={busy || !name.trim() || !!blockedReason} onClick={() => void run('load')}>
            Load state
          </Button>
        </div>
        {blockedReason && (
          <p className="ctl-help" data-testid="states-blocked">
            {blockedReason}
          </p>
        )}
        <p className="ctl-help">A saved state records the emulator's memory only, never the contents of floppy or hard disks.</p>
        {last && (
          <Banner tone="warning" title={`${last.what} “${name.trim()}”`}>
            <span data-testid="state-note">{last.note}</span>
            <div className="small muted" style={{ overflowWrap: 'anywhere' }}>
              {last.path}
            </div>
          </Banner>
        )}
      </div>
    </Card>
  )
}

// ---------- shortcuts ----------
export function ShortcutsCard() {
  return (
    <Card title="Shortcuts and getting around">
      <div className="stack">
        <div className="guarantee">
          <strong>The buttons on this screen always work.</strong> If the mouse is captured or the emulator is full screen and you cannot find your way back, switch to this window with your system's window switcher (for example Alt+Tab), then use <em>Toggle mouse capture</em> or <em>Toggle full screen</em>.
        </div>
        <Table head={['Keys', 'What it does']} caption="Keyboard shortcuts confirmed in the Amiberry emulator">
          {CONFIRMED_SHORTCUTS.map((s) => (
            <tr key={s.action} className="shortcut-table">
              <td>
                {s.keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && <span className="shortcut-plus">+</span>}
                    <span className="kbd">{k}</span>
                  </span>
                ))}
              </td>
              <td>
                <strong>{s.action}</strong>
                <div className="small muted">{s.note}</div>
              </td>
            </tr>
          ))}
        </Table>
        <p className="small muted">
          Only shortcuts confirmed in the emulator's own source code are listed. The emulator has no default key for full screen or quit, so use the buttons here (or Power off) for those.
        </p>
      </div>
    </Card>
  )
}

// ---------- the running view ----------
export function RunningView({ session, engine, onStopped }: { session: SessionStatus; engine: EngineState; onStopped: (r: StopResult) => void }) {
  const { confirm, toast } = useUi()
  const { refreshSession } = useBackend()
  const [busy, setBusy] = useState<string | null>(null)
  const control = session.runtime_control
  const embedded = session.mode === 'embedded'
  const name = session.profile_name ?? 'The machine'

  const ctl = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      setBusy(action)
      try {
        await call('session_control', { action, ...extra })
        await refreshSession()
        return true
      } catch (e) {
        toast(errorMessage(e), 'error')
        return false
      } finally {
        setBusy(null)
      }
    },
    [refreshSession, toast],
  )

  const hardReset = async () => {
    const ok = await confirm({
      title: 'Hard reset the Amiga?',
      body: (
        <>
          A hard reset is like switching the machine off and on again. Anything unsaved inside the Amiga is lost, and disks that were being written to can be left needing validation by AmigaDOS at the next boot.
        </>
      ),
      confirmLabel: 'Hard reset',
      danger: true,
    })
    if (ok) await ctl('reset_hard')
  }

  const powerOff = async () => {
    const ok = await confirm({
      title: `Power off ${name}?`,
      body: embedded ? (
        <>
          This is like switching the machine off at the wall: anything the Amiga had not yet written to its disks is lost, and AmigaDOS may validate a hard disk the next time you start. Anything unsaved inside the Amiga is lost.
        </>
      ) : control ? (
        <>
          TiLT asks the emulator to quit so it can finish writing to your disks. If it has not exited after about 15 seconds it is stopped by force. A forced stop means the emulator did not exit cleanly, and AmigaDOS may validate your disks the next time you start. Anything unsaved inside the Amiga is lost.
        </>
      ) : (
        <>
          This emulator build cannot be asked to quit politely, so TiLT will stop it by force. A forced stop means the emulator did not exit cleanly, and AmigaDOS may validate your disks the next time you start. Anything unsaved inside the Amiga is lost. For a clean exit, quit from inside the emulator (F12 menu) instead.
        </>
      ),
      confirmLabel: control ? 'Power off' : 'Force stop',
      danger: true,
    })
    if (!ok) return
    setBusy('stop')
    try {
      const r = await call<{ outcome: string }>('session_stop')
      onStopped({ outcome: r.outcome, machine: name })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(null)
      await refreshSession()
    }
  }

  const note = engine.info?.runtime_control_note ?? NO_CONTROL_FALLBACK

  return (
    <Page>
      <PageHeader
        title={name}
        subtitle={
          <span className="emu-status">
            <Badge tone={session.paused ? 'warning' : 'success'}>{session.paused ? 'Paused' : 'Running'}</Badge>
            <span className="emu-meta" data-testid="emu-meta">
              Up {formatDuration(session.uptime_s)} · {embedded ? 'running inside TiLT' : `process ${session.pid ?? '?'}`}
            </span>
          </span>
        }
        actions={
          <Button variant="danger" icon="power" disabled={busy === 'stop'} onClick={() => void powerOff()} data-testid="power-off">
            {busy === 'stop' ? 'Powering off…' : control ? 'Power off' : 'Force stop'}
          </Button>
        }
      />

      {session.warnings.length > 0 && (
        <Banner tone="warning" title="Notes from starting this machine">
          <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="start-notes">
            {session.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Banner>
      )}

      {!control && (
        <Banner tone="warning" title="TiLT cannot control the emulator while it runs">
          <span data-testid="no-control-note">{note}</span>
          <div className="small" style={{ marginTop: 4 }}>
            You can still start and stop machines here. Stopping is forced, because the emulator cannot be asked to quit politely.
          </div>
        </Banner>
      )}

      <div className="emu-grid">
        <div className="emu-col">
          {control && (embedded ? <LiveScreen paused={!!session.paused} /> : <PreviewCard active />)}
          {control && <FloppyCard active embedded={embedded} />}
          {control && <PerfCard active />}
          {!control && <ShortcutsCard />}
        </div>
        <div className="emu-col">
          {control && (
            <Card title="Controls">
              <div className="stack">
                <div className="ctl-group" role="group" aria-label="Machine controls">
                  {session.paused ? (
                    <Button icon="play" disabled={!!busy} onClick={() => void ctl('resume')} data-testid="resume">
                      Resume
                    </Button>
                  ) : (
                    <Button icon="pause" disabled={!!busy} onClick={() => void ctl('pause')} data-testid="pause">
                      Pause
                    </Button>
                  )}
                  {embedded ? (
                    <Button icon="reset" variant="danger" disabled={!!busy} onClick={() => void hardReset()} data-testid="reset-hard">
                      Reset
                    </Button>
                  ) : (
                    <>
                      <Button icon="reset" disabled={!!busy} onClick={() => void ctl('reset_soft')} data-testid="reset-soft">
                        Reset
                      </Button>
                      <Button icon="reset" variant="danger" disabled={!!busy} onClick={() => void hardReset()} data-testid="reset-hard">
                        Hard reset
                      </Button>
                    </>
                  )}
                </div>
                {embedded ? (
                  <p className="ctl-help" data-testid="embedded-help">
                    Running inside TiLT: the machine is drawn in the Screen panel. Full screen and mouse capture belong to the emulator's own window, so they are not offered here. Reset is a hard reset.
                  </p>
                ) : (
                <>
                <div className="ctl-group" role="group" aria-label="Window controls">
                  <Button icon="fullscreen" disabled={!!busy} onClick={() => void ctl('toggle_fullscreen')} data-testid="fullscreen">
                    Toggle full screen
                  </Button>
                  <Button icon="mouse" disabled={!!busy} onClick={() => void ctl('toggle_mouse_grab')} data-testid="mouse-grab">
                    Toggle mouse capture
                  </Button>
                </div>
                <p className="ctl-help" data-testid="mouse-help">
                  <strong>Getting the mouse back:</strong> press <span className="kbd">Ctrl</span> + <span className="kbd">Alt</span> together in the emulator window, or use <em>Toggle mouse capture</em> here. To leave full screen, use <em>Toggle full screen</em> here. TiLT cannot read the current state, so these buttons switch it each time you press them.
                </p>
                </>
                )}
              </div>
            </Card>
          )}
          {control && !embedded && <SoundCard profileId={session.profile_id} onError={(m) => toast(m, 'error')} />}
          {control && embedded && (
            <Banner tone="info" title="No sound in this mode yet">
              <span data-testid="embedded-no-sound">Running inside TiLT does not play the Amiga's sound yet. For sound, run the machine in the emulator's own window (Settings, Emulator engine).</span>
            </Banner>
          )}
          {control && (
            <StatesCard
              onError={(m) => toast(m, 'error')}
              blockedReason={embedded && session.hard_disks.length > 0 ? 'Saved states are not available for machines with hard disks when running inside TiLT: the emulator core crashes when it restores them. Use the emulator\'s own window, or a floppy-only machine.' : undefined}
            />
          )}
          {control && !embedded && <ShortcutsCard />}
          {!control && (
            <Card title="While it runs">
              <p className="small">
                The emulator has its own window. Click inside it to capture the mouse, and press <span className="kbd">Ctrl</span> + <span className="kbd">Alt</span> together to release it. Pause, disk changes, previews and saved states need the emulator's control channel, which this build does not have.
              </p>
            </Card>
          )}
        </div>
      </div>
    </Page>
  )
}
