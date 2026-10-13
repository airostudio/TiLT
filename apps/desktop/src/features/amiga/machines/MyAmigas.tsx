import { useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { HdfRecord, Issue, MachineProfile, RomRecord, Validation } from '@/api/types'
import { Badge, Banner, Button, Empty, ErrorNote, KV, Loading, Modal, Page, PageHeader, TextInput, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useRoute } from '@/app/router'
import { useLoad } from '@/lib/hooks'
import { MachineEditor } from './MachineEditor'
import { NewMachineModal } from './NewMachineModal'
import { StartError, type StartFailure } from './StartError'
import { CHIPSET_LABEL, MODEL_LABEL, cpuText, drivesText, errorsOf, hdNames, memoryText, readiness, warningsOf } from './profileUtils'
import './machines.css'

interface ListData {
  profiles: MachineProfile[]
  roms: RomRecord[]
  hdfs: HdfRecord[]
  issues: Record<string, Issue[] | undefined>
}

async function loadAll(): Promise<ListData> {
  const [profiles, roms, hdfs] = await Promise.all([call<MachineProfile[]>('profile_list'), call<RomRecord[]>('rom_list'), call<HdfRecord[]>('hdf_list')])
  const entries = await Promise.all(
    profiles.map(async (p) => {
      try {
        return [p.id, (await call<Validation>('profile_validate', { profile: p })).issues] as const
      } catch {
        return [p.id, undefined] as const
      }
    }),
  )
  return { profiles, roms, hdfs, issues: Object.fromEntries(entries) }
}

function CloneModal({ source, onClose, onDone }: { source: MachineProfile; onClose: () => void; onDone: () => void }) {
  const { toast } = useUi()
  const [name, setName] = useState(`${source.name} copy`)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!name.trim()) return
    setBusy(true)
    try {
      await call('profile_clone', { id: source.id, name: name.trim() })
      toast(`Created “${name.trim()}”`, 'success')
      onDone()
    } catch (e) {
      toast(errorMessage(e), 'error')
      setBusy(false)
    }
  }
  return (
    <Modal
      title={`Clone “${source.name}”`}
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim() || busy} onClick={() => void go()} data-testid="clone-confirm">
            Clone
          </Button>
        </>
      }
    >
      <p className="muted small">The copy has the same hardware, Kickstart, drives and hard disk attachments. Disk images and hard disk files are shared, not duplicated.</p>
      <TextInput label="Name of the copy" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} />
    </Modal>
  )
}

function MachineList({ onNew, onEdit }: { onNew: (p: MachineProfile) => void; onEdit: (id: string) => void }) {
  const { confirm, toast } = useUi()
  const { session, refreshSession } = useBackend()
  const data = useLoad(loadAll, [])
  const [creating, setCreating] = useState(false)
  const [cloning, setCloning] = useState<MachineProfile | null>(null)
  const [starting, setStarting] = useState<string | null>(null)
  const [failure, setFailure] = useState<StartFailure | null>(null)
  const d = data.data

  const start = async (p: MachineProfile) => {
    setStarting(p.id)
    setFailure(null)
    try {
      const r = await call<{ started: boolean; warnings: string[] }>('session_start', { profile_id: p.id })
      await refreshSession()
      if (r.warnings.length) toast(`${p.name} started with ${r.warnings.length} notice${r.warnings.length === 1 ? '' : 's'}. They are listed on the Emulator screen.`, 'info')
      window.location.hash = '#/amiga/emulator'
    } catch (e) {
      setFailure({ code: (e as { code?: string }).code ?? 'internal', message: errorMessage(e) })
    } finally {
      setStarting(null)
    }
  }

  const remove = async (p: MachineProfile) => {
    const ok = await confirm({
      title: `Delete “${p.name}”?`,
      body: 'This removes the machine configuration only. Your Kickstart ROMs, floppy disks and hard disk images are not deleted.',
      confirmLabel: 'Delete machine',
      danger: true,
    })
    if (!ok) return
    try {
      await call('profile_delete', { id: p.id })
      toast(`Deleted “${p.name}”`, 'success')
      await data.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Page>
      <PageHeader
        title="My Amigas"
        subtitle="Each machine is an emulated Amiga configuration: processor, memory, chipset, Kickstart, drives and hard disks. The presets are generic emulated configurations, not copies of particular physical products or expansion boards."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setCreating(true)} data-testid="new-machine">
            New machine
          </Button>
        }
      />
      {session?.running && (
        <Banner
          tone="info"
          title={`${session.profile_name} is running`}
          actions={
            <Button size="sm" onClick={() => (window.location.hash = '#/amiga/emulator')}>
              Open Emulator
            </Button>
          }
        >
          Only one machine can run at a time. Power it off before starting another.
        </Banner>
      )}
      {failure && <StartError failure={failure} onDismiss={() => setFailure(null)} />}
      <ErrorNote error={data.error} />
      {data.loading && <Loading label="Loading machines…" />}
      {d && d.profiles.length === 0 && (
        <Empty icon="amiga" title="No machines yet" action={<Button variant="primary" onClick={() => setCreating(true)}>New machine</Button>}>
          Create one from a preset such as the Classic Amiga 500 or Amiga 1200.
        </Empty>
      )}
      {d && d.profiles.length > 0 && (
        <ul className="machine-grid" aria-label="Machines">
          {d.profiles.map((p) => {
            const issues = d.issues[p.id]
            const state = readiness(issues)
            const rom = d.roms.find((r) => r.id === p.rom_id)
            const running = session?.running && session.profile_id === p.id
            const nErr = issues ? errorsOf(issues).length : 0
            const nWarn = issues ? warningsOf(issues).length : 0
            const firstErr = issues ? errorsOf(issues)[0]?.message : undefined
            const reason = session?.running && !running ? `${session.profile_name} is running. Power it off first.` : state === 'errors' ? `Fix first: ${firstErr}` : null
            const hds = hdNames(p, d.hdfs)
            return (
              <li key={p.id} className={`card machine-card ${running ? 'running' : ''}`} data-testid={`machine-${p.id}`} aria-label={p.name}>
                <div className="mc-head">
                  <h2>{p.name}</h2>
                  {running ? (
                    <Badge tone="success">Running</Badge>
                  ) : state === 'checking' ? (
                    <Badge>Checking…</Badge>
                  ) : state === 'errors' ? (
                    <Badge tone="danger" title={firstErr}>
                      {nErr} {nErr === 1 ? 'problem' : 'problems'}
                    </Badge>
                  ) : state === 'warnings' ? (
                    <Badge tone="warning" title={warningsOf(issues ?? [])[0]?.message}>
                      {nWarn} {nWarn === 1 ? 'warning' : 'warnings'}
                    </Badge>
                  ) : (
                    <Badge tone="success">Ready</Badge>
                  )}
                </div>
                <div className="mc-sub">
                  {MODEL_LABEL[p.model]} · {CHIPSET_LABEL[p.chipset]} · {p.display.standard.toUpperCase()}
                </div>
                <KV
                  rows={[
                    ['Processor', cpuText(p)],
                    ['Memory', memoryText(p)],
                    ['Kickstart', rom ? (rom.missing ? `${rom.info.label} (file missing)` : rom.info.label) : p.rom_id ? 'Missing from the library' : 'None selected'],
                    ['Floppies', drivesText(p)],
                    ['Hard disks', hds.length ? hds.join(', ') : 'None'],
                    ['Mode', p.performance === 'compatibility' ? 'Compatibility (cycle-exact)' : 'Performance (not cycle-exact)'],
                  ]}
                />
                {p.notes && <div className="mc-notes">{p.notes}</div>}
                {state === 'warnings' && issues && (
                  <div className="mc-reason">{warningsOf(issues)[0].message}</div>
                )}
                <div className="mc-actions">
                  <Button variant="primary" size="sm" icon="play" disabled={!!reason || starting === p.id || !!running} title={reason ?? undefined} onClick={() => void start(p)} data-testid={`start-${p.id}`}>
                    {starting === p.id ? 'Starting…' : 'Start'}
                  </Button>
                  <Button size="sm" onClick={() => onEdit(p.id)} data-testid={`edit-${p.id}`}>
                    Edit
                  </Button>
                  <Button size="sm" icon="copy" onClick={() => setCloning(p)} data-testid={`clone-${p.id}`}>
                    Clone
                  </Button>
                  <Button size="sm" variant="danger" icon="trash" disabled={!!running} title={running ? 'Power the machine off before deleting it.' : undefined} onClick={() => void remove(p)} data-testid={`delete-${p.id}`}>
                    Delete
                  </Button>
                </div>
                {reason && <div className="mc-reason">{reason}</div>}
              </li>
            )
          })}
        </ul>
      )}
      {creating && (
        <NewMachineModal
          onClose={() => setCreating(false)}
          onCreated={(p) => {
            setCreating(false)
            onNew(p)
          }}
        />
      )}
      {cloning && (
        <CloneModal
          source={cloning}
          onClose={() => setCloning(null)}
          onDone={() => {
            setCloning(null)
            void data.reload()
          }}
        />
      )}
    </Page>
  )
}

function EditorRoute({ id, fresh, onClose }: { id: string; fresh: MachineProfile | null; onClose: () => void }) {
  const loaded = useLoad(() => (fresh?.id === id ? Promise.resolve(fresh) : call<MachineProfile>('profile_get', { id })), [id])
  if (fresh?.id === id) return <MachineEditor key={id} initial={fresh} isNew onClose={onClose} />
  if (loaded.loading) return <Loading label="Opening machine…" />
  if (!loaded.data)
    return (
      <Page>
        <ErrorNote error={loaded.error ?? 'This machine no longer exists.'} />
        <div>
          <Button icon="back" onClick={onClose}>
            Back to My Amigas
          </Button>
        </div>
      </Page>
    )
  return <MachineEditor key={id} initial={loaded.data} isNew={false} onClose={onClose} />
}

export default function MyAmigas() {
  const [route, go] = useRoute()
  const id = route[2]
  const [fresh, setFresh] = useState<MachineProfile | null>(null)
  const close = () => {
    setFresh(null)
    go('/amiga/machines')
  }
  if (id) return <EditorRoute id={id} fresh={fresh} onClose={close} />
  return (
    <MachineList
      onNew={(p) => {
        setFresh(p)
        go(`/amiga/machines/${p.id}`)
      }}
      onEdit={(pid) => go(`/amiga/machines/${pid}`)}
    />
  )
}
