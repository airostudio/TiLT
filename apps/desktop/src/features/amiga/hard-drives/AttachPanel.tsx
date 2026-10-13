import { useEffect, useState } from 'react'
import { call } from '@/api/client'
import type { HdController, HdfRecord, Issue, MachineProfile, Validation } from '@/api/types'
import { Badge, Banner, Button, Empty, Select, Toggle, useUi } from '@/components/ui'
import { CONTROLLER_HINT, CONTROLLER_LABEL, friendly } from './helpers'
import { IssueList } from './parts'
import './hard-drives.css'

const defaultController = (m: MachineProfile['model']): HdController => (m === 'a1200' || m === 'a4000' || m === 'custom' ? 'mainboard_ide' : 'uae')

/** Attach this disk to a machine profile, or detach it again. Saves through validation. */
export function AttachPanel({ hdf, profiles, runningProfileId, onChanged }: { hdf: HdfRecord; profiles: MachineProfile[]; runningProfileId: string | null; onChanged: () => void }) {
  const { toast } = useUi()
  const attachedTo = profiles.filter((p) => p.hard_disks.some((h) => h.hdf_id === hdf.id))
  const available = profiles.filter((p) => !p.hard_disks.some((h) => h.hdf_id === hdf.id))
  const [profileId, setProfileId] = useState('')
  const [controller, setController] = useState<HdController>('uae')
  const [readOnly, setReadOnly] = useState(false)
  const [preview, setPreview] = useState<Issue[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNote, setSavedNote] = useState<{ name: string; issues: Issue[] } | null>(null)

  const chosen = available.find((p) => p.id === profileId) ?? null

  // Check the combination as the user changes it, before anything is saved.
  useEffect(() => {
    if (!chosen) {
      setPreview(null)
      return
    }
    let stale = false
    void (async () => {
      try {
        const p = await call<MachineProfile>('profile_get', { id: chosen.id })
        p.hard_disks = [...p.hard_disks, { hdf_id: hdf.id, controller, read_only: readOnly, boot_priority: 0 }]
        const v = await call<Validation>('profile_validate', { profile: p })
        if (!stale) setPreview(v.issues)
      } catch (e) {
        if (!stale) {
          setPreview(null)
          setError(friendly(e))
        }
      }
    })()
    return () => {
      stale = true
    }
  }, [chosen, controller, readOnly, hdf.id])

  const pick = (id: string) => {
    setProfileId(id)
    setSavedNote(null)
    setError(null)
    const p = available.find((x) => x.id === id)
    if (p) setController(defaultController(p.model))
  }

  const hasErrors = !!preview?.some((i) => i.severity === 'error')

  const attach = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    setSavedNote(null)
    try {
      const p = await call<MachineProfile>('profile_get', { id: chosen.id })
      p.hard_disks = [...p.hard_disks.filter((h) => h.hdf_id !== hdf.id), { hdf_id: hdf.id, controller, read_only: readOnly, boot_priority: 0 }]
      const v = await call<Validation>('profile_validate', { profile: p })
      if (v.issues.some((i) => i.severity === 'error')) {
        setPreview(v.issues)
        setError('This machine cannot use the disk that way. Fix the problems listed below, or pick another controller.')
        return
      }
      const saved = await call<Validation>('profile_save', { profile: p })
      setSavedNote({ name: p.name, issues: saved.issues })
      toast(`“${hdf.name}” attached to ${p.name}`, 'success')
      setProfileId('')
      onChanged()
    } catch (e) {
      setError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  const detach = async (profileIdToChange: string) => {
    setBusy(true)
    setError(null)
    setSavedNote(null)
    try {
      const p = await call<MachineProfile>('profile_get', { id: profileIdToChange })
      p.hard_disks = p.hard_disks.filter((h) => h.hdf_id !== hdf.id)
      await call<Validation>('profile_save', { profile: p })
      toast(`“${hdf.name}” detached from ${p.name}`, 'success')
      onChanged()
    } catch (e) {
      setError(`Could not detach the disk: ${friendly(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="hdd-panel" data-testid="attach-panel">
      <div>
        <div className="hdd-section-title">Machines using this disk</div>
        {attachedTo.length === 0 ? (
          <p className="muted small" data-testid="not-attached">
            Not attached to any machine yet. A machine can only use the disk once you attach it below.
          </p>
        ) : (
          <div className="stack-sm">
            {attachedTo.map((p) => {
              const att = p.hard_disks.find((h) => h.hdf_id === hdf.id)!
              return (
                <div key={p.id} className="hdd-attached" data-testid={`attached-${p.id}`}>
                  <div className="grow">
                    <strong>{p.name}</strong>
                    <div className="small muted">
                      {CONTROLLER_LABEL[att.controller]}
                      {att.read_only ? ' · read-only' : ''}
                    </div>
                  </div>
                  {att.read_only && <Badge tone="accent">Read-only</Badge>}
                  {runningProfileId === p.id && <Badge tone="warning">Running now</Badge>}
                  <Button size="sm" disabled={busy} onClick={() => void detach(p.id)} aria-label={`Detach ${hdf.name} from ${p.name}`}>
                    Detach
                  </Button>
                </div>
              )
            })}
            {attachedTo.some((p) => p.id === runningProfileId) && <p className="small muted">That machine is running. Detaching changes its saved settings; it takes effect the next time the machine starts.</p>}
          </div>
        )}
      </div>

      <div className="divider" />

      <div className="stack">
        <div className="hdd-section-title">Attach to a machine</div>
        {profiles.length === 0 ? (
          <Empty icon="amiga" title="You have no machines yet" action={<a className="btn" href="#/amiga/machines">Go to My Amigas</a>}>
            Create a machine first, then come back to attach this disk to it.
          </Empty>
        ) : available.length === 0 ? (
          <p className="muted small">This disk is already attached to all of your machines.</p>
        ) : (
          <>
            <div className="hdd-form-grid">
              <Select label="Machine" value={profileId} onChange={(e) => pick(e.target.value)} hint="The Amiga that should see this hard disk.">
                <option value="">Choose a machine…</option>
                {available.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Select label="Connect it through" value={controller} onChange={(e) => setController(e.target.value as HdController)} disabled={!chosen} hint={CONTROLLER_HINT[controller]}>
                {(Object.keys(CONTROLLER_LABEL) as HdController[]).map((c) => (
                  <option key={c} value={c}>
                    {CONTROLLER_LABEL[c]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="stack-sm">
              <Toggle label="Read-only (the Amiga can look but not change anything)" checked={readOnly} onChange={setReadOnly} disabled={!chosen} />
              <p className="hdd-note">Read-only is useful when you only want to copy files off the disk, or to be sure nothing changes. Note that Kickstart 1.x cannot start from a hard disk by itself; you would start from a floppy and mount the disk. Amiga Studio warns you when that applies.</p>
            </div>
            {error && <Banner tone="error">{error}</Banner>}
            {chosen && preview && preview.length > 0 && (
              <div className="stack-sm">
                <div className="small muted">What the machine check says about this combination:</div>
                <IssueList issues={preview} />
              </div>
            )}
            {chosen && preview && preview.length === 0 && (
              <Badge tone="success" title="The machine accepts this setup.">
                No problems found
              </Badge>
            )}
            <div className="row">
              <Button variant="primary" icon="link" disabled={!chosen || busy || hasErrors} onClick={() => void attach()}>
                Attach disk
              </Button>
              {hasErrors && <span className="small muted">Resolve the problems above first.</span>}
            </div>
          </>
        )}
        {savedNote && (
          <Banner tone="success" title={`Attached to ${savedNote.name}`}>
            The machine's settings are saved. Start it from the Emulator screen.
            {savedNote.issues.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <IssueList issues={savedNote.issues} />
              </div>
            )}
          </Banner>
        )}
      </div>
    </div>
  )
}
