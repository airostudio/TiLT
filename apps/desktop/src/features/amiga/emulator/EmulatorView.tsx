import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { call, errorMessage } from '@/api/client'
import type { Issue, MachineProfile, RomRecord } from '@/api/types'
import { Badge, Banner, Button, Card, Icon, Loading, Page, PageHeader, Select, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useLoad, useLocalStorage } from '@/lib/hooks'
import { StartError, type StartFailure } from '../machines/StartError'
import { useValidation } from '../machines/useValidation'
import { MODEL_LABEL, cpuText, errorsOf, memoryText, warningsOf } from '../machines/profileUtils'
import { RunningView, ShortcutsCard, type StopResult } from './RunningView'
import { useEngine, type EngineState } from './useEngine'
import './emulator.css'

type CheckState = 'ok' | 'warn' | 'fail' | 'info'
const STATE_LABEL: Record<CheckState, string> = { ok: 'Ready', warn: 'Check', fail: 'Problem', info: 'Note' }
const STATE_ICON = { ok: 'check', warn: 'warn', fail: 'x', info: 'info' } as const

function CheckRow({ state, children, testid }: { state: CheckState; children: ReactNode; testid?: string }) {
  return (
    <li className={`check-row ${state}`} data-testid={testid}>
      <Icon name={STATE_ICON[state]} size={16} className="check-ico" />
      <div>
        <span className="check-state">{STATE_LABEL[state]}:</span>
        {children}
      </div>
    </li>
  )
}

/** Amiberry 8.4.0 is the oldest build the generated configuration was validated against. */
const olderThanTested = (v: [number, number, number] | null): boolean => !!v && (v[0] < 8 || (v[0] === 8 && v[1] < 4))

function Readiness({ profile, roms, engine, issues, checked }: { profile: MachineProfile; roms: RomRecord[]; engine: EngineState; issues: Issue[]; checked: boolean }) {
  const rom = roms.find((r) => r.id === profile.rom_id)
  const errors = errorsOf(issues)
  const warnings = warningsOf(issues).filter((i) => i.field !== 'rom_id')
  return (
    <ul className="check-list" aria-label="Readiness checks" data-testid="readiness">
      {engine.loading ? (
        <CheckRow state="info">Looking for the emulator engine…</CheckRow>
      ) : engine.info ? (
        <CheckRow state={olderThanTested(engine.info.version) ? 'warn' : 'ok'} testid="check-engine">
          Emulator engine found: {engine.info.banner}.
          {olderThanTested(engine.info.version) && <> This is older than version 8.4.0, which TiLT was tested with.</>}
          <div className="small muted" style={{ overflowWrap: 'anywhere' }}>
            {engine.info.path}
          </div>
        </CheckRow>
      ) : (
        <CheckRow state="fail" testid="check-engine">
          The emulator engine (Amiberry) was not found. <a href="#/amiga/settings">Open Settings</a> to set its location.
        </CheckRow>
      )}
      {!profile.rom_id ? (
        <CheckRow state="fail" testid="check-rom">
          No Kickstart ROM is selected for this machine. <a href={`#/amiga/machines/${profile.id}`}>Choose one in the machine editor</a>
          {roms.length === 0 && (
            <>
              {' '}
              (you have not imported any yet: <a href="#/amiga/roms">open the ROM Library</a>)
            </>
          )}
          .
        </CheckRow>
      ) : !rom ? (
        <CheckRow state="fail" testid="check-rom">
          The Kickstart ROM chosen for this machine is no longer in the library. <a href={`#/amiga/machines/${profile.id}`}>Choose another</a> or <a href="#/amiga/roms">open the ROM Library</a>.
        </CheckRow>
      ) : rom.missing ? (
        <CheckRow state="fail" testid="check-rom">
          {rom.info.label} is chosen, but its file is missing from disk. <a href="#/amiga/roms">Relink it in the ROM Library</a>.
        </CheckRow>
      ) : (
        <CheckRow state="ok" testid="check-rom">
          Kickstart: {rom.info.label}
        </CheckRow>
      )}
      {!checked ? (
        <CheckRow state="info">Checking the configuration…</CheckRow>
      ) : errors.length > 0 ? (
        errors.map((e, i) => (
          <CheckRow key={i} state="fail" testid="check-config">
            {e.message} <a href={`#/amiga/machines/${profile.id}`}>Fix in the machine editor</a>
          </CheckRow>
        ))
      ) : (
        <CheckRow state="ok" testid="check-config">
          The hardware configuration is valid.
        </CheckRow>
      )}
      {warnings.map((w, i) => (
        <CheckRow key={`w${i}`} state="warn">
          {w.message}
        </CheckRow>
      ))}
      {profile.hard_disks.length > 0 && (
        <CheckRow state="info">
          {profile.hard_disks.length} hard disk{profile.hard_disks.length === 1 ? '' : 's'} attached. A safety backup is made before starting.
        </CheckRow>
      )}
    </ul>
  )
}

function StopNotice({ stop, onDismiss }: { stop: StopResult; onDismiss: () => void }) {
  const tone = stop.outcome === 'clean' ? 'success' : stop.outcome === 'forced' ? 'warning' : 'info'
  const dismiss = (
    <Button size="sm" variant="ghost" onClick={onDismiss}>
      Dismiss
    </Button>
  )
  return (
    <Banner tone={tone} title={stop.outcome === 'clean' ? `${stop.machine} powered off cleanly` : stop.outcome === 'forced' ? `${stop.machine} was stopped by force` : `${stop.machine} had already exited`} actions={dismiss}>
      <span data-testid="stop-outcome" data-outcome={stop.outcome}>
        {stop.outcome === 'clean' && 'The emulator quit by itself and finished writing to its disks.'}
        {stop.outcome === 'forced' && 'The emulator did not exit cleanly, so it was terminated. AmigaDOS may validate your disks the next time you start; that is normal, but check your hard disk and restore a backup from Hard Drives if you see errors.'}
        {stop.outcome === 'already_exited' && 'The emulator window had been closed before Power off.'}
      </span>
    </Banner>
  )
}

function NotRunning({ engine, lastStop, onDismissStop }: { engine: EngineState; lastStop: StopResult | null; onDismissStop: () => void }) {
  const { refreshSession } = useBackend()
  const { toast } = useUi()
  const profiles = useLoad(() => call<MachineProfile[]>('profile_list'), [])
  const roms = useLoad(() => call<RomRecord[]>('rom_list'), [])
  const [chosen, setChosen] = useLocalStorage('amiga.emulator.machine', '')
  const [starting, setStarting] = useState(false)
  const [failure, setFailure] = useState<StartFailure | null>(null)
  const list = useMemo(() => profiles.data ?? [], [profiles.data])
  const profile = list.find((p) => p.id === chosen) ?? list[0] ?? null
  const { issues, current } = useValidation(profile)
  const blocked = errorsOf(issues).length > 0

  useEffect(() => {
    setFailure(null)
  }, [profile?.id])

  const start = async () => {
    if (!profile) return
    setStarting(true)
    setFailure(null)
    try {
      const r = await call<{ started: boolean; warnings: string[] }>('session_start', { profile_id: profile.id })
      if (r.warnings.length) toast(`${profile.name} started with ${r.warnings.length} notice${r.warnings.length === 1 ? '' : 's'}.`, 'info')
      await refreshSession()
    } catch (e) {
      setFailure({ code: (e as { code?: string }).code ?? 'internal', message: errorMessage(e) })
    } finally {
      setStarting(false)
    }
  }

  return (
    <Page>
      <PageHeader title="Emulator" subtitle="Start one of your machines. The emulator opens in its own window next to TiLT; this screen starts it, shows what it is doing and lets you control it." />
      {lastStop && <StopNotice stop={lastStop} onDismiss={onDismissStop} />}
      {failure && <StartError failure={failure} onDismiss={() => setFailure(null)} />}
      {!engine.loading && engine.error && (
        <Banner
          tone="warning"
          title="The emulator engine is not set up"
          actions={
            <Button size="sm" onClick={() => (window.location.hash = '#/amiga/settings')}>
              Open Settings
            </Button>
          }
        >
          <span data-testid="engine-missing">{engine.error.message}</span>
          <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            <li>Install Amiberry (the emulator engine TiLT drives), or find the Amiberry program you already have.</li>
            <li>
              In <a href="#/amiga/settings">Settings</a>, point TiLT at it.
            </li>
            <li>Come back here and press “Check again”.</li>
          </ol>
          <div style={{ marginTop: 6 }}>
            <Button size="sm" onClick={() => void engine.reload()}>
              Check again
            </Button>
          </div>
        </Banner>
      )}
      <div className="emu-grid">
        <div className="emu-col">
          <Card title="Start a machine">
            {profiles.loading ? (
              <Loading label="Loading machines…" />
            ) : !profile ? (
              <p className="muted">
                You have no machines yet. <a href="#/amiga/machines">Create one in My Amigas</a>.
              </p>
            ) : (
              <div className="stack">
                <Select label="Machine" value={profile.id} onChange={(e) => setChosen(e.target.value)} data-testid="machine-select">
                  {list.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <div className="small muted">
                  {MODEL_LABEL[profile.model]} · {cpuText(profile)} · {memoryText(profile)} ·{' '}
                  <a href={`#/amiga/machines/${profile.id}`}>Edit this machine</a>
                </div>
                <Readiness profile={profile} roms={roms.data ?? []} engine={engine} issues={issues} checked={current} />
                <div className="row">
                  <Button variant="primary" icon="play" disabled={starting || blocked || !current} onClick={() => void start()} data-testid="start-machine">
                    {starting ? 'Starting…' : `Start ${profile.name}`}
                  </Button>
                  {profile.performance === 'performance' ? <Badge tone="warning">Performance mode: not cycle-exact</Badge> : <Badge>Compatibility mode</Badge>}
                </div>
                {blocked && (
                  <p className="small" style={{ color: 'var(--danger)' }}>
                    This machine cannot start until the problems above are fixed.
                  </p>
                )}
              </div>
            )}
            {profiles.error && <Banner tone="error">{profiles.error}</Banner>}
          </Card>
        </div>
        <div className="emu-col">
          <ShortcutsCard />
        </div>
      </div>
    </Page>
  )
}

export default function EmulatorView() {
  const { session } = useBackend()
  const engine = useEngine()
  const [lastStop, setLastStop] = useState<StopResult | null>(null)
  if (!session) return <Loading label="Checking the emulator…" />
  if (session.running) return <RunningView session={session} engine={engine} onStopped={setLastStop} />
  return <NotRunning engine={engine} lastStop={lastStop} onDismissStop={() => setLastStop(null)} />
}
