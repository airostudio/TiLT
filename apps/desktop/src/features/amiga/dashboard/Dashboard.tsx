import { useEffect, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { EngineInfo, HdfRecord, MachineProfile, MediaRecord, RomRecord, SessionRecord, StorageReport, Validation, WorkbenchSet } from '@/api/types'
import { useBackend } from '@/app/backend'
import { Badge, Banner, Button, Card, ErrorNote, KV, Loading, Page, PageHeader, ProgressBar, Select, Stat, useUi } from '@/components/ui'
import { useLoad, useLocalStorage } from '@/lib/hooks'
import { formatBytes, formatDate, formatDuration } from '@/lib/format'
import { FirstRunWizard } from '../rom-library/FirstRunWizard'
import './dashboard.css'
import { MODEL_NAMES, acceleratorLabel, cpuLabel, fastRamLabel, ramLabel } from './describe'

interface Data {
  profiles: MachineProfile[]
  roms: RomRecord[]
  media: MediaRecord[]
  hdfs: HdfRecord[]
  sets: WorkbenchSet[]
  sessions: SessionRecord[]
  storage: StorageReport
}

async function loadAll(): Promise<Data> {
  const [profiles, roms, media, hdfs, sets, sessions, storage] = await Promise.all([
    call<MachineProfile[]>('profile_list'),
    call<RomRecord[]>('rom_list'),
    call<MediaRecord[]>('media_list'),
    call<HdfRecord[]>('hdf_list'),
    call<WorkbenchSet[]>('workbench_list'),
    call<SessionRecord[]>('sessions_recent'),
    call<StorageReport>('storage_report'),
  ])
  return { profiles, roms, media, hdfs, sets, sessions, storage }
}

export default function Dashboard() {
  const { toast, confirm } = useUi()
  const { session, refreshSession, info } = useBackend()
  const data = useLoad(loadAll)
  const [wizardDone, setWizardDone] = useLocalStorage('tilt.amiga.firstRunDone', false)
  const [selected, setSelected] = useLocalStorage<string>('tilt.amiga.machine', '')
  const [validation, setValidation] = useState<Validation | null>(null)
  const [engine, setEngine] = useState<EngineInfo | null>(null)
  const [engineError, setEngineError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call<EngineInfo>('engine_info').then(setEngine, (e) => setEngineError(errorMessage(e)))
  }, [])

  const profiles = data.data?.profiles ?? []
  const current = profiles.find((p) => p.id === (session?.running ? session.profile_id : selected)) ?? profiles.find((p) => p.id === 'preset-a1200') ?? profiles[0]

  useEffect(() => {
    if (!current) return
    let alive = true
    call<Validation>('profile_validate', { profile: current }).then((v) => alive && setValidation(v), () => undefined)
    return () => {
      alive = false
    }
  }, [current])

  if (data.loading) return <Loading />
  const d = data.data
  if (!d || !current) return <Page><ErrorNote error={data.error ?? 'Nothing to show yet.'} /></Page>

  if (d.roms.length === 0 && !wizardDone) {
    return (
      <Page>
        <PageHeader title="Set up Amiga Studio" />
        <FirstRunWizard
          onFinished={() => {
            setWizardDone(true)
            void data.reload()
          }}
        />
      </Page>
    )
  }

  const running = !!session?.running
  const runningThis = running && session?.profile_id === current.id
  const rom = d.roms.find((r) => r.id === current.rom_id)
  const mediaName = (id: string | null) => d.media.find((m) => m.id === id)?.name
  const errors = validation?.issues.filter((i) => i.severity === 'error') ?? []
  const warnings = validation?.issues.filter((i) => i.severity === 'warning') ?? []
  const wbSet = d.sets[0]
  const hds = current.hard_disks.map((h) => d.hdfs.find((x) => x.id === h.hdf_id)).filter(Boolean) as HdfRecord[]
  const total = d.storage.total_managed

  const start = async () => {
    setBusy(true)
    try {
      const r = await call<{ warnings: string[] }>('session_start', { profile_id: current.id })
      r.warnings.forEach((w) => toast(w, 'info'))
      await refreshSession()
      window.location.hash = '#/amiga/emulator'
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const stop = async () => {
    if (!(await confirm({ title: 'Power off this Amiga?', body: 'The emulator is asked to shut down and its disks are saved safely. Unsaved work inside the Amiga is lost, so close your programs first.', confirmLabel: 'Power off', danger: true }))) return
    setBusy(true)
    try {
      const r = await call<{ outcome: string }>('session_stop')
      toast(r.outcome === 'clean' ? 'Powered off cleanly' : 'The emulator had to be stopped. AmigaDOS may check the disks next time.', r.outcome === 'clean' ? 'success' : 'info')
      await refreshSession()
      await data.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const reset = async () => {
    try {
      await call('session_control', { action: 'reset_soft' })
      toast('Amiga reset', 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Page>
      <PageHeader title="Dashboard" subtitle="Your machine at a glance." />
      {!engine && engineError && (
        <Banner tone="warning" title="The emulator engine was not found" actions={<Button onClick={() => (window.location.hash = '#/amiga/settings')}>Open settings</Button>}>
          {engineError}
        </Banner>
      )}

      <Card className="hero-card" data-testid="current-machine">
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 260, flex: '1 1 260px' }}>
            <Select label="Current machine" value={current.id} disabled={running} onChange={(e) => setSelected(e.target.value)}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="row">
            {!running && (
              <Button variant="primary" icon="play" disabled={busy || errors.length > 0 || !current.rom_id} onClick={() => void start()} title={!current.rom_id ? 'Choose a Kickstart ROM for this machine first' : errors.length ? 'Fix the problems listed below first' : undefined}>
                Start
              </Button>
            )}
            {runningThis && (
              <>
                <Button icon="reset" disabled={!session?.runtime_control} onClick={() => void reset()} title={session?.runtime_control ? undefined : 'Not available in this build of the emulator'}>
                  Reset
                </Button>
                <Button variant="danger" icon="power" disabled={busy} onClick={() => void stop()}>
                  Stop
                </Button>
                <Button icon="chevron" onClick={() => (window.location.hash = '#/amiga/emulator')}>
                  Open emulator
                </Button>
              </>
            )}
            <Button onClick={() => (window.location.hash = '#/amiga/machines')}>Edit machines</Button>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <Badge tone={running ? 'success' : 'neutral'}>{running ? (session?.paused ? 'Paused' : `Running · ${formatDuration(session?.uptime_s ?? 0)}`) : 'Stopped'}</Badge>
          <Badge>{MODEL_NAMES[current.model] ?? current.model}</Badge>
          <Badge tone="accent">{current.chipset.toUpperCase()}</Badge>
          <Badge>{current.performance === 'compatibility' ? 'Compatibility mode' : 'Performance mode'}</Badge>
          {errors.length > 0 && <Badge tone="danger">{errors.length} problem{errors.length === 1 ? '' : 's'}</Badge>}
          {errors.length === 0 && warnings.length > 0 && <Badge tone="warning">{warnings.length} note{warnings.length === 1 ? '' : 's'}</Badge>}
        </div>
        {(errors.length > 0 || warnings.length > 0) && (
          <ul className="stack-sm" style={{ margin: '12px 0 0', paddingLeft: 18 }} aria-label="Machine checks">
            {[...errors, ...warnings].map((i) => (
              <li key={i.field + i.message} style={{ color: i.severity === 'error' ? 'var(--danger)' : 'var(--warning)' }}>
                <span style={{ color: 'var(--text)' }}>{i.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="dash-grid">
        <Card title="Processor & memory">
          <KV
            rows={[
              ['Processor', cpuLabel(current)],
              ['Accelerator', acceleratorLabel(current)],
              ['Chipset', current.chipset.toUpperCase()],
              ['Chip RAM', ramLabel(current.memory.chip_kb)],
              ['Fast RAM', fastRamLabel(current)],
            ]}
          />
        </Card>
        <Card title="Software">
          <KV
            rows={[
              ['Kickstart', rom ? <span key="k">{rom.info.family ?? rom.info.label} <span className="muted mono">({rom.info.exec_version}.{rom.info.exec_revision})</span></span> : <span key="k" className="muted">None chosen</span>],
              ['Workbench', wbSet ? `${wbSet.name} (${wbSet.version})` : <span key="w" className="muted">No set saved yet</span>],
            ]}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <Button size="sm" onClick={() => (window.location.hash = '#/amiga/roms')}>ROM Library</Button>
            <Button size="sm" onClick={() => (window.location.hash = '#/amiga/disks')}>Workbench setup</Button>
          </div>
        </Card>
        <Card title="Drives">
          <KV
            rows={[
              ...current.drives.map((dr, i): [string, React.ReactNode] => [
                `DF${i}:`,
                dr.kind === 'disabled' ? <span key={i} className="faint">Off</span> : mediaName(dr.media_id) ?? <span key={i} className="muted">Empty</span>,
              ]),
              ['Hard disk', hds.length ? hds.map((h) => h.name).join(', ') : <span key="h" className="muted">None attached</span>],
            ]}
          />
        </Card>
        <Card title="Emulator">
          <KV
            rows={[
              ['Engine', engine ? engine.banner : <span key="e" className="muted">Not found</span>],
              ['Status', running ? `Running ${session?.profile_name}` : 'Not running'],
              ['Live control', (session?.runtime_control ?? info?.runtime_control) ? 'Available on this platform' : 'Not in this build'],
            ]}
          />
        </Card>
        <Card title="Recent sessions">
          {d.sessions.length === 0 ? (
            <p className="muted small">Nothing has been started yet.</p>
          ) : (
            <ul className="stack-sm" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {d.sessions.slice(0, 5).map((s) => (
                <li key={s.id} className="row-nowrap small">
                  <span className="truncate" style={{ flex: 1 }}>{s.profile_name}</span>
                  <span className="muted">{formatDate(s.started_at)}</span>
                  {s.outcome && <Badge tone={s.outcome === 'clean' ? 'success' : 'warning'}>{s.outcome === 'clean' ? 'Clean exit' : 'Stopped'}</Badge>}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Storage">
          <div className="row" style={{ marginBottom: 8 }}>
            <Stat label="Used by Amiga Studio" value={formatBytes(total)} />
            <Stat label="Free on this drive" value={formatBytes(d.storage.free_host)} />
          </div>
          <ProgressBar done={total} total={total + d.storage.free_host} label="Storage used" />
          <Button size="sm" style={{ marginTop: 12 }} onClick={() => (window.location.hash = '#/amiga/settings')}>
            Storage manager
          </Button>
        </Card>
      </div>
    </Page>
  )
}
