import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApiError, call, errorMessage } from '@/api/client'
import type { DriveConfig, DriveKind, DriveView, Issue, MachineProfile, MediaRecord, Queue, SessionStatus, Validation } from '@/api/types'
import { Badge, Banner, Button, Card, Empty, ErrorNote, Loading, Page, PageHeader, Select, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useLoad, useLocalStorage } from '@/lib/hooks'
import { DiskPickerModal } from '../shared/DiskPicker'
import { WorkingCopyDialog } from '../shared/WorkingCopyDialog'
import { DRIVE_NAMES, effectiveWriteProtect, isAdf, withDriveKind } from '../shared/disks'
import { DiskPanel } from './DiskPanel'
import { DriveSlot } from './DriveSlot'
import { QueueHelper } from './QueueHelper'
import { liveSlots, profileSlots } from './model'
import './floppies.css'

const POLL_MS = 1000
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export default function FloppyDrives() {
  const { toast, confirm } = useUi()
  const { info } = useBackend()
  const media = useLoad(() => call<MediaRecord[]>('media_list'))
  const profiles = useLoad(() => call<MachineProfile[]>('profile_list'))
  const queues = useLoad(() => call<Queue[]>('queue_list'))

  // ---- live status, polled while this screen is open ----
  const [status, setStatus] = useState<SessionStatus | null>(null)
  const [live, setLive] = useState<DriveView[] | null>(null)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [backendError, setBackendError] = useState<string | null>(null)
  const inflight = useRef(false)
  const refresh = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const s = await call<SessionStatus>('session_status')
      setStatus(s)
      setBackendError(null)
      if (s.running && s.runtime_control) {
        try {
          setLive(await call<DriveView[]>('session_drives'))
          setLiveError(null)
        } catch (e) {
          setLiveError(errorMessage(e))
        }
      } else {
        setLive(null)
        setLiveError(null)
      }
    } catch (e) {
      setBackendError(errorMessage(e))
    } finally {
      inflight.current = false
    }
  }, [])
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const liveMode = !!status?.running && !!status.runtime_control
  const runningNoControl = !!status?.running && !status.runtime_control

  // ---- which machine's drives are edited when nothing can be changed live ----
  const [storedProfile, setStoredProfile] = useLocalStorage('fd.profile', '')
  const profileList = useMemo(() => profiles.data ?? [], [profiles.data])
  const [chosen, setChosen] = useState('')
  const runningId = status?.running && status.profile_id && profileList.some((p) => p.id === status.profile_id) ? status.profile_id : ''
  const profileId = [chosen, runningId, storedProfile].find((id) => id && profileList.some((p) => p.id === id)) ?? profileList[0]?.id ?? ''
  const saved = profileList.find((p) => p.id === profileId) ?? null
  const runningProfile = profileList.find((p) => p.id === status?.profile_id) ?? null

  const [draft, setDraft] = useState<DriveConfig[] | null>(null)
  useEffect(() => {
    setDraft(saved ? (JSON.parse(JSON.stringify(saved.drives)) as DriveConfig[]) : null)
    // reset only when another machine is chosen or the stored copy changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved?.id, profiles.data])
  const dirty = !!saved && !!draft && !same(draft, saved.drives)

  const [issues, setIssues] = useState<Issue[]>([])
  useEffect(() => {
    if (!saved || !draft) {
      setIssues([])
      return
    }
    let dead = false
    const t = setTimeout(() => {
      call<Validation>('profile_validate', { profile: { ...saved, drives: draft } })
        .then((v) => !dead && setIssues(v.issues))
        .catch((e) => !dead && toast(errorMessage(e), 'error'))
    }, 200)
    return () => {
      dead = true
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, draft])
  const relevant = issues.filter((i) => i.severity === 'error' || i.field === 'drives' || i.field.startsWith('drives.'))
  const hasErrors = issues.some((i) => i.severity === 'error')

  // ---- slots ----
  const mediaList = useMemo(() => media.data ?? [], [media.data])
  const slots = useMemo(() => {
    if (liveMode) return live ? liveSlots(live, mediaList, runningProfile?.drives.map((d) => d.kind) ?? []) : null
    return draft ? profileSlots(draft, mediaList) : null
  }, [liveMode, live, mediaList, runningProfile, draft])
  const mode = liveMode ? 'live' : 'profile'

  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<number | null>(null)
  const [copyFor, setCopyFor] = useState<{ unit: number; disk: MediaRecord } | null>(null)

  const editDraft = (unit: number, f: (d: DriveConfig) => DriveConfig) => setDraft((cur) => (cur ? cur.map((d, i) => (i === unit ? f(d) : d)) : cur))

  /** Put a disk in a drive. Live: tell the running emulator. Otherwise: change the machine's settings. */
  const insertDisk = async (unit: number, m: MediaRecord, writeProtect = false) => {
    if (!slots) return
    if (m.kind !== 'adf') return void toast('Only disk images (ADF) can go in a drive. DMS archives are converted when you add them to the library.', 'error')
    if (m.missing) return void toast(`“${m.name}” cannot be used: its file is missing from the library.`, 'error')
    const slot = slots[unit]
    if (!slot.enabled) return void toast(`${DRIVE_NAMES[unit]} is switched off.`, 'error')
    const holder = slots.findIndex((s) => s.unit !== unit && s.enabled && s.mediaId === m.id)
    if (holder >= 0) return void toast(`“${m.name}” is already in ${DRIVE_NAMES[holder]}. A disk can only be in one drive at a time: make a working copy to use it in two.`, 'error')
    const protect = effectiveWriteProtect(m, writeProtect)
    if (!liveMode) {
      editDraft(unit, (d) => ({ ...d, media_id: m.id, write_protect: protect }))
      toast(`“${m.name}” put in ${DRIVE_NAMES[unit]}. Save to keep it.`, 'info')
      return
    }
    setBusy(true)
    try {
      if (slot.label) {
        if (slot.activity === 'writing') throw new ApiError({ code: 'unsafe', message: `${DRIVE_NAMES[unit]} is busy writing to its disk. Wait until the activity light goes off, then try again.` })
        await call('session_eject', { unit })
      }
      await call('session_insert', { unit, media_id: m.id, write_protect: protect })
      toast(`“${m.name}” inserted in ${DRIVE_NAMES[unit]}${m.pristine ? ' (write-protected: untouched original)' : protect ? ' (write-protected)' : ''}`, 'success')
      await Promise.all([refresh(), media.reload()])
    } catch (e) {
      toast(errorMessage(e), 'error')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const eject = async (unit: number) => {
    if (!slots) return
    const slot = slots[unit]
    if (!liveMode) {
      editDraft(unit, (d) => ({ ...d, media_id: null }))
      return
    }
    if (slot.activity === 'writing' && !(await confirm({ title: `${DRIVE_NAMES[unit]} is writing`, body: <p>The Amiga is writing to this disk right now. Taking it out can damage the disk. Wait for the activity light to go off if you can.</p>, confirmLabel: 'Eject anyway', danger: true }))) return
    setBusy(true)
    try {
      await call('session_eject', { unit })
      toast(`Ejected from ${DRIVE_NAMES[unit]}`, 'success')
      await refresh()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const setProtect = async (unit: number, v: boolean) => {
    if (!slots) return
    if (!liveMode) return editDraft(unit, (d) => ({ ...d, write_protect: v }))
    const m = slots[unit].media
    if (!m) return void toast('This disk is not in your library, so its protection cannot be changed from here.', 'error')
    // there is no "set protection" command for a running machine: take the disk out and put it back in
    setBusy(true)
    try {
      if (slots[unit].activity === 'writing') throw new ApiError({ code: 'unsafe', message: `${DRIVE_NAMES[unit]} is busy writing to its disk. Wait until the activity light goes off, then try again.` })
      await call('session_eject', { unit })
      await call('session_insert', { unit, media_id: m.id, write_protect: v })
      toast(`${DRIVE_NAMES[unit]} is now ${v ? 'write-protected' : 'writable'}`, 'success')
      await refresh()
    } catch (e) {
      toast(errorMessage(e), 'error')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const setKind = (unit: number, kind: DriveKind) => {
    const slot = slots?.[unit]
    if (kind === 'disabled' && slot?.label) toast(`${DRIVE_NAMES[unit]} was switched off, so its disk was taken out.`, 'info')
    editDraft(unit, (d) => withDriveKind(d, kind))
  }

  const dropOn = (unit: number, id: string) => {
    const m = mediaList.find((x) => x.id === id)
    if (!m) return void toast('That disk is no longer in the library.', 'error')
    void insertDisk(unit, m)
  }

  const save = async () => {
    if (!saved || !draft) return
    setBusy(true)
    try {
      await call('profile_save', { profile: { ...saved, drives: draft } })
      await profiles.reload()
      toast(`Drive settings saved for “${saved.name}”.${status?.running && status.profile_id === saved.id ? ' They apply the next time the machine starts.' : ''}`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const chooseProfile = async (id: string) => {
    if (dirty && !(await confirm({ title: 'Discard unsaved drive changes?', body: <p>The drives of “{saved?.name}” have changes that are not saved.</p>, confirmLabel: 'Discard changes', danger: true }))) return
    setChosen(id)
    setStoredProfile(id)
  }

  // ---------- render ----------
  if ((status === null && !backendError) || profiles.loading || media.loading) return <Loading />

  const pickerUnavailable: Record<string, string> = {}
  if (picker !== null && slots) {
    slots.forEach((s) => {
      if (s.unit !== picker && s.enabled && s.mediaId) pickerUnavailable[s.mediaId] = `Already in ${DRIVE_NAMES[s.unit]}`
    })
    for (const m of mediaList) if (m.missing) pickerUnavailable[m.id] = 'The file for this disk is missing'
  }

  return (
    <Page>
      <PageHeader
        title="Floppy Drives"
        subtitle="Insert and eject disks in the four floppy drives, DF0: to DF3:. Disks come from your Disk Library."
        actions={
          <Button icon="disk" onClick={() => (window.location.hash = '#/amiga/disks')}>
            Open Disk Library
          </Button>
        }
      />
      <ErrorNote error={backendError ?? media.error ?? profiles.error} />

      {liveMode && (
        <Banner tone="success" title={`${status?.profile_name ?? 'A machine'} is running`}>
          Disk changes happen live, like swapping real floppies. Untouched originals are inserted <strong>write-protected</strong> automatically, so the Amiga cannot change them. If you want to save to a disk, make a working copy.
        </Banner>
      )}
      {runningNoControl && (
        <Banner tone="warning" title={`${status?.profile_name ?? 'A machine'} is running, but disks cannot be changed while it runs`}>
          This build of the emulator cannot be controlled from here while a machine is running. To swap disks right now, use the emulator’s own menu (press <span className="kbd">F12</span>) or stop and restart the machine. Changes you make below are saved to the machine and apply the next time it starts.
          {info?.engine?.runtime_control_note && <div className="faint xs" style={{ marginTop: 4 }}>{info.engine.runtime_control_note}</div>}
        </Banner>
      )}
      {liveMode && liveError && (
        <Banner tone="error" title="Could not read the drives from the emulator">
          {liveError}
        </Banner>
      )}

      {!liveMode && (
        <Card
          title="Machine"
          actions={dirty ? <Badge tone="warning">Unsaved changes</Badge> : saved ? <Badge tone="success">Saved</Badge> : undefined}
        >
          {profileList.length === 0 ? (
            <Empty icon="amiga" title="No machine yet" action={<Button variant="primary" onClick={() => (window.location.hash = '#/amiga/machines')}>Go to My Amigas</Button>}>
              Floppy drives belong to a machine. Create a machine in My Amigas first, then come back to choose its disks.
            </Empty>
          ) : (
            <div className="stack">
              <div className="row" style={{ alignItems: 'flex-end' }}>
                <div style={{ minWidth: 260, flex: '0 1 360px' }}>
                  <Select label="Machine whose drives you are editing" value={profileId} onChange={(e) => void chooseProfile(e.target.value)}>
                    {profileList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <span className="spacer" />
                {dirty && (
                  <>
                    <Button onClick={() => setDraft(saved ? (JSON.parse(JSON.stringify(saved.drives)) as DriveConfig[]) : null)} disabled={busy}>
                      Discard changes
                    </Button>
                    <Button variant="primary" onClick={() => void save()} disabled={busy || hasErrors}>
                      Save drive settings
                    </Button>
                  </>
                )}
              </div>
              <p className="muted small">
                {status?.running ? 'The disks you choose here are inserted into the drives when the machine starts.' : 'No machine is running. The disks you choose here are inserted into the drives when you start this machine.'} Nothing is changed until you save.
              </p>
              {relevant.length > 0 && (
                <ul className="fd-issues" data-testid="drive-issues" aria-label="Checks on these drive settings">
                  {relevant.map((i, n) => (
                    <li key={n}>
                      <Badge tone={i.severity === 'error' ? 'danger' : i.severity === 'warning' ? 'warning' : 'neutral'}>{i.severity === 'error' ? 'Problem' : i.severity === 'warning' ? 'Warning' : 'Note'}</Badge>
                      <span>{i.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {slots && (liveMode || (saved && draft)) ? (
        <div className="fd-layout">
          <div className="fd-slots" data-testid="slots">
            {slots.map((s) => (
              <DriveSlot
                key={s.unit}
                slot={s}
                mode={mode}
                busy={busy}
                onInsert={() => setPicker(s.unit)}
                onEject={() => void eject(s.unit)}
                onProtect={(v) => void setProtect(s.unit, v)}
                onWorkingCopy={() => s.media && setCopyFor({ unit: s.unit, disk: s.media })}
                onKind={(k) => setKind(s.unit, k)}
                onDropDisk={(id) => dropOn(s.unit, id)}
              />
            ))}
          </div>
          <div className="stack fd-side">
            <DiskPanel media={mediaList} slots={slots} />
          </div>
        </div>
      ) : liveMode && !liveError ? (
        <Loading label="Reading the drives…" />
      ) : null}

      {slots && (liveMode || saved) && <QueueHelper queues={queues.data ?? []} media={mediaList} slots={slots} busy={busy} mode={mode} onInsertNext={(unit, id) => void insertDisk(unit, mediaList.find((m) => m.id === id)!)} />}

      {picker !== null && slots && (
        <DiskPickerModal
          title={`Insert a floppy disk into ${DRIVE_NAMES[picker]}`}
          disks={mediaList.filter(isAdf)}
          recent
          protectOption
          unavailable={pickerUnavailable}
          confirmLabel={slots[picker].label ? 'Replace disk' : 'Insert disk'}
          intro={
            <>
              Choose a disk image from your library. Need a new one? <a href="#/amiga/disks">Open the Disk Library</a>.
            </>
          }
          onClose={() => setPicker(null)}
          onConfirm={async ([id], opts) => {
            const m = mediaList.find((x) => x.id === id)
            if (m) await insertDisk(picker, m, opts.writeProtect)
            setPicker(null)
          }}
        />
      )}
      {copyFor && (
        <WorkingCopyDialog
          disk={copyFor.disk}
          offerInsert={DRIVE_NAMES[copyFor.unit]}
          onClose={() => setCopyFor(null)}
          onDone={async (copy, { insertNow }) => {
            await media.reload()
            if (insertNow) {
              // the original must leave the drive first so the copy can take its place
              if (!liveMode) editDraft(copyFor.unit, (d) => ({ ...d, media_id: copy.id, write_protect: false }))
              else await insertDisk(copyFor.unit, copy, false)
            }
          }}
        />
      )}
    </Page>
  )
}
