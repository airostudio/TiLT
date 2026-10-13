import { useState } from 'react'
import { call } from '@/api/client'
import type { Issue, MachineProfile, MediaRecord, RomRecord, Validation } from '@/api/types'
import { Banner, Button, Card, Loading, Select, TextInput, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { friendly } from '../hard-drives/helpers'
import { IssueList } from '../hard-drives/parts'
import { StepTitle } from './parts'
import './disk-tools.css'

/** Build a machine that is set up for copying disks with a real Amiga copy program. */
export function RealCopy() {
  const { toast } = useUi()
  const media = useLoad(() => call<MediaRecord[]>('media_list'))
  const roms = useLoad(() => call<RomRecord[]>('rom_list'))
  const profiles = useLoad(() => call<MachineProfile[]>('profile_list'))
  const [name, setName] = useState('Disk copy station')
  const [xcopyId, setXcopyId] = useState('')
  const [romId, setRomId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [saved, setSaved] = useState<{ id: string; name: string } | null>(null)

  const adfs = (media.data ?? []).filter((m) => m.kind === 'adf')
  const usableRoms = (roms.data ?? []).filter((r) => !r.missing && r.info.kind !== 'unrecognised')
  const sameName = (profiles.data ?? []).some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())

  const create = async () => {
    setBusy(true)
    setError(null)
    setIssues(null)
    setSaved(null)
    try {
      const p = await call<MachineProfile>('profile_from_preset', { preset_id: 'a500', name: name.trim() })
      p.rom_id = romId
      p.drives = p.drives.map((d) => ({ ...d, kind: 'dd35' as const })) as MachineProfile['drives']
      if (xcopyId) {
        p.drives[0] = { ...p.drives[0], media_id: xcopyId, write_protect: true }
      }
      const v = await call<Validation>('profile_validate', { profile: p })
      if (v.issues.some((i) => i.severity === 'error')) {
        setIssues(v.issues)
        setError('The machine could not be saved. Fix the problems listed below.')
        return
      }
      const res = await call<Validation>('profile_save', { profile: p })
      setIssues(res.issues)
      setSaved({ id: p.id, name: p.name })
      void profiles.reload()
      toast(`“${p.name}” saved`, 'success')
    } catch (e) {
      setError(friendly(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <Banner tone="info" title="A real disk copy runs inside the emulated Amiga">
        <p>
          The “Copy a disk image” tab copies files on your computer. A <strong>real Amiga disk copy</strong> is different: a copy program such as XCOPY runs inside the emulated Amiga and reads and writes the emulated floppy drives, just like on real hardware. It is slower, but it is the way to experiment with how the Amiga itself copies disks.
        </p>
        <p style={{ marginTop: 8 }}>
          <strong>Amiga Studio does not include XCOPY or any other copy program.</strong> You bring your own copy of the program, on a disk image you have imported into your library.
        </p>
      </Banner>

      <Card>
        <div className="dt-step">
          <StepTitle n={1}>Create a disk-copy machine</StepTitle>
          <p className="dt-note">
            This makes a classic Amiga 500 with all four floppy drives (DF0: to DF3:) switched on, so a copy program has a source and up to three destinations. The disk with your copy program goes into DF0: and is write-protected so it cannot be changed by accident.
          </p>
          <div className="dt-options">
            <TextInput label="Machine name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} hint={sameName ? 'You already have a machine with this name; this will create another one.' : undefined} />
            <Select label="Your copy program disk (goes in DF0:)" value={xcopyId} onChange={(e) => setXcopyId(e.target.value)} hint="Optional: you can also insert disks later from the Emulator screen.">
              <option value="">Choose later</option>
              {adfs.map((m) => (
                <option key={m.id} value={m.id} disabled={m.missing}>
                  {m.name}
                  {m.missing ? ' (file missing)' : ''}
                </option>
              ))}
            </Select>
            <Select label="Kickstart ROM" value={romId} onChange={(e) => setRomId(e.target.value)} hint={usableRoms.length === 0 && !roms.loading ? 'No ROMs imported yet. Import one in the ROM Library first.' : 'Required. The Amiga cannot start without one.'}>
              <option value="">Choose a ROM…</option>
              {usableRoms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({r.info.label})
                </option>
              ))}
            </Select>
          </div>
          {roms.loading && <Loading />}
          {error && <Banner tone="error">{error}</Banner>}
          {issues && issues.length > 0 && <IssueList issues={issues} />}
          <div className="row">
            <Button variant="primary" icon="amiga" disabled={busy || !name.trim() || !romId} onClick={() => void create()}>
              Create the disk-copy machine
            </Button>
            {usableRoms.length === 0 && !roms.loading && (
              <a className="btn" href="#/amiga/roms">
                Open the ROM Library
              </a>
            )}
          </div>
        </div>
      </Card>

      {saved && (
        <Banner
          tone="success"
          title={`“${saved.name}” is ready`}
          actions={
            <a className="btn primary" href="#/amiga/emulator">
              Open the Emulator
            </a>
          }
        >
          Start it from the Emulator screen. Once your copy program is running, insert the disk you want to copy and a blank disk in another drive from the Emulator screen's floppy controls.
        </Banner>
      )}
    </div>
  )
}
