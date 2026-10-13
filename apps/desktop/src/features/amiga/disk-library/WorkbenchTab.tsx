import { useMemo, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { HdfRecord, Issue, MachineProfile, MediaRecord, RomRecord, Validation, WorkbenchSet } from '@/api/types'
import { Badge, Banner, Button, Card, Empty, ErrorNote, Icon, Loading, Select, Table, TextInput, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { formatBytes } from '@/lib/format'
import { DiskBadges } from '../shared/DiskBadges'
import { ROLE_NAMES, classifyLabel, filterDisks, formatSummary, isAdf, matchesQuery, sortDisks, suggestWorkbenchDisks } from '../shared/disks'

const ROLE_ORDER = ['workbench', 'install', 'extras', 'fonts', 'storage', 'locale', 'other']
type Release = '2.1' | '3.1'
const EXPECTED: Record<Release, string> = { '2.1': '38.36', '3.1': '40.42' }
const KICKSTART_NEEDS: Record<Release, string> = {
  '2.1': 'Kickstart 2.04 or 2.05 (exec version 37-38)',
  '3.1': 'Kickstart 3.1 (exec version 40)',
}
const PRESET: Record<Release, { id: string; label: string; controller: 'mainboard_ide' | 'uae' }> = {
  '3.1': { id: 'a1200', label: 'Amiga 1200', controller: 'mainboard_ide' },
  '2.1': { id: 'a500plus', label: 'Amiga 500+', controller: 'uae' },
}

type KsCheck = { state: 'idle' } | { state: 'unknown'; text: string } | { state: 'ok' } | { state: 'warn'; text: string } | { state: 'error'; text: string }

const rev = (r: [number, number] | null): string => (r ? `${r[0]}.${r[1]}` : '')

function guessRom(roms: RomRecord[], release: Release): RomRecord | undefined {
  const [lo, hi] = release === '2.1' ? [37, 38] : [40, 40]
  return roms.find((r) => r.info.kind === 'kickstart' && !r.missing && r.info.exec_version != null && r.info.exec_version >= lo && r.info.exec_version <= hi)
}

export function WorkbenchTab({ media }: { media: MediaRecord[] }) {
  const { toast, confirm } = useUi()
  const savedSets = useLoad(() => call<WorkbenchSet[]>('workbench_list'))
  const roms = useLoad(() => call<RomRecord[]>('rom_list'))
  const hdfs = useLoad(() => call<HdfRecord[]>('hdf_list'))

  const [release, setRelease] = useState<Release>('3.1')
  const [setName, setSetName] = useState('Workbench 3.1')
  const [nameTouched, setNameTouched] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [setId, setSetId] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<WorkbenchSet | null>(null)
  const [analysing, setAnalysing] = useState(false)
  const [romId, setRomId] = useState('')
  const [ks, setKs] = useState<KsCheck>({ state: 'idle' })

  const [hdfId, setHdfId] = useState('')
  const [creating, setCreating] = useState(false)
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)

  const adfs = useMemo(() => media.filter(isAdf), [media])
  const byId = useMemo(() => new Map(media.map((m) => [m.id, m])), [media])
  const suggested = useMemo(() => new Set(suggestWorkbenchDisks(adfs, release).map((m) => m.id)), [adfs, release])
  const candidates = useMemo(() => {
    const rows = sortDisks(filterDisks(adfs, query, 'all'))
    const order = (m: MediaRecord) => ROLE_ORDER.indexOf(classifyLabel(m.info.adf?.volume_name || m.name).role)
    const sug = rows.filter((m) => suggested.has(m.id)).sort((a, b) => order(a) - order(b))
    return [...sug, ...rows.filter((m) => !suggested.has(m.id))]
  }, [adfs, query, suggested])
  const kickstarts = (roms.data ?? []).filter((r) => r.info.kind === 'kickstart')

  const resetResult = () => {
    setAnalysis(null)
    setKs({ state: 'idle' })
    setIssues(null)
    setCreated(null)
  }

  const chooseRelease = (r: Release) => {
    setRelease(r)
    if (!nameTouched) setSetName(`Workbench ${r}`)
    resetResult()
  }
  const toggleDisk = (id: string) => {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    resetResult()
  }
  const startOver = () => {
    setSelected([])
    setSetId(null)
    setNameTouched(false)
    setSetName(`Workbench ${release}`)
    resetResult()
  }

  const checkKickstart = async (set: WorkbenchSet | null, id: string) => {
    if (!set || !id) {
      setKs({ state: 'idle' })
      return
    }
    const rom = roms.data?.find((r) => r.id === id)
    if (set.version === 'unknown') {
      setKs({ state: 'unknown', text: 'The Workbench release could not be worked out from these disks, so the Kickstart cannot be compared.' })
      return
    }
    if (rom && rom.info.exec_version == null) {
      setKs({ state: 'unknown', text: 'This ROM’s version could not be read, so it cannot be compared with the Workbench release.' })
      return
    }
    try {
      const w = await call<string | null>('workbench_kickstart_check', { rom_id: id, version: set.version })
      setKs(w ? { state: 'warn', text: w } : { state: 'ok' })
    } catch (e) {
      setKs({ state: 'error', text: errorMessage(e) })
    }
  }

  const analyse = async () => {
    setAnalysing(true)
    setIssues(null)
    setCreated(null)
    try {
      const res = await call<WorkbenchSet>('workbench_analyse', { name: setName.trim() || `Workbench ${release}`, media_ids: selected })
      const set = setId ? { ...res, id: setId } : res
      setAnalysis(set)
      const pick = romId && roms.data?.some((r) => r.id === romId) ? romId : (guessRom(roms.data ?? [], set.version === 'unknown' ? release : set.version)?.id ?? '')
      setRomId(pick)
      await checkKickstart(set, pick)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setAnalysing(false)
    }
  }

  const save = async () => {
    if (!analysis) return
    try {
      const set = { ...analysis, name: setName.trim() || analysis.name }
      await call('workbench_save', { set })
      setSetId(set.id)
      setAnalysis(set)
      toast(`Workbench set “${set.name}” saved`, 'success')
      await savedSets.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const openSaved = (s: WorkbenchSet) => {
    const ids = s.disks.map((d) => d.media_id)
    setSelected(ids.filter((id) => byId.has(id)))
    if (s.version === '2.1' || s.version === '3.1') setRelease(s.version)
    setSetName(s.name)
    setNameTouched(true)
    setSetId(s.id)
    setAnalysis(s)
    setIssues(null)
    setCreated(null)
    const pick = romId || guessRom(roms.data ?? [], s.version === 'unknown' ? release : s.version)?.id || ''
    setRomId(pick)
    void checkKickstart(s, pick)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const deleteSaved = async (s: WorkbenchSet) => {
    const ok = await confirm({
      title: `Delete the saved set “${s.name}”?`,
      body: <p>Only the saved description of the set is removed. The disks themselves stay in your library.</p>,
      confirmLabel: 'Delete set',
      danger: true,
    })
    if (!ok) return
    try {
      await call('workbench_delete', { id: s.id })
      if (setId === s.id) setSetId(null)
      toast(`Saved set “${s.name}” deleted`, 'success')
      await savedSets.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  // ---------- install machine ----------
  const wbDisk = analysis?.disks.find((d) => d.role === 'workbench')
  const installDisk = analysis?.disks.find((d) => d.role === 'install')
  const releaseMismatch = analysis && analysis.version !== 'unknown' && analysis.version !== release
  const blockers: string[] = []
  if (!analysis) blockers.push('Check your disks first (step 2).')
  else {
    if (!wbDisk) blockers.push('No Workbench disk was found in the set.')
    if (!installDisk) blockers.push('No Install disk was found in the set.')
    if (releaseMismatch) blockers.push(`These disks look like Workbench ${analysis.version}, but Workbench ${release} is selected. Change the release in step 1.`)
  }
  if (!romId) blockers.push('Choose a Kickstart ROM (step 3).')

  const createMachine = async () => {
    if (!wbDisk || !installDisk || !romId) return
    setCreating(true)
    setIssues(null)
    setCreated(null)
    try {
      const cfg = PRESET[release]
      const existing = new Set((await call<MachineProfile[]>('profile_list')).map((p) => p.name))
      let name = 'Workbench install'
      for (let n = 2; existing.has(name); n++) name = `Workbench install ${n}`
      const base = await call<MachineProfile>('profile_from_preset', { preset_id: cfg.id, name })
      const profile: MachineProfile = {
        ...base,
        name,
        rom_id: romId,
        drives: [
          { kind: 'dd35', media_id: wbDisk.media_id, write_protect: true },
          { kind: 'dd35', media_id: installDisk.media_id, write_protect: true },
          base.drives[2],
          base.drives[3],
        ],
        hard_disks: hdfId ? [{ hdf_id: hdfId, controller: cfg.controller, read_only: false, boot_priority: 0 }] : [],
        notes: `Created by the Workbench setup guide for ${setName.trim() || `Workbench ${release}`}. DF0: Workbench disk, DF1: Install disk.`,
      }
      const v = await call<Validation>('profile_validate', { profile })
      setIssues(v.issues)
      if (v.issues.some((i) => i.severity === 'error')) {
        toast('The machine was not saved: please fix the problems listed below.', 'error')
        return
      }
      const saved = await call<Validation>('profile_save', { profile })
      setIssues(saved.issues)
      setCreated({ id: profile.id, name })
      toast(`Machine “${name}” created`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setCreating(false)
    }
  }

  const diskName = (id: string) => byId.get(id)?.name ?? 'Removed from library'
  const bootableWb = wbDisk?.bootable

  if (savedSets.loading || roms.loading) return <Loading />

  return (
    <div className="stack">
      <ErrorNote error={savedSets.error ?? roms.error} />
      <Banner tone="info" title="Workbench setup">
        Workbench is the Amiga’s desktop. This guide helps you check that your own Workbench installation disks are complete, pick the right Kickstart ROM, and prepare a machine that starts the installer. Amiga Studio does not include Workbench or Kickstart: use disks and ROMs you legally own.
      </Banner>

      <Card
        title="Step 1. Choose the release and your disks"
        actions={
          (selected.length > 0 || setId) && (
            <Button size="sm" variant="ghost" onClick={startOver}>
              Start a new set
            </Button>
          )
        }
      >
        <div className="stack">
          <div className="grid grid-2">
            <Select label="Workbench release" value={release} onChange={(e) => chooseRelease(e.target.value as Release)} hint="2.1 pairs with Kickstart 2.04 (Amiga 500+). 3.1 pairs with Kickstart 3.1 (Amiga 1200).">
              <option value="3.1">Workbench 3.1</option>
              <option value="2.1">Workbench 2.1</option>
            </Select>
            <TextInput
              label="Name for this set"
              value={setName}
              onChange={(e) => {
                setSetName(e.target.value)
                setNameTouched(true)
              }}
              maxLength={60}
            />
          </div>

          {adfs.length === 0 ? (
            <Empty icon="disk" title="No disk images yet">
              Add your Workbench ADF files on the Disks tab first, then come back here.
            </Empty>
          ) : (
            <div className="stack-sm">
              <div className="row">
                <div style={{ flex: 1, minWidth: 220 }}>
                  <TextInput label="Find a disk" type="search" placeholder="Search your disks…" value={query} onChange={(e) => setQuery(e.target.value)} />
                </div>
                <Button
                  disabled={suggested.size === 0}
                  onClick={() => {
                    setSelected((s) => [...new Set([...s, ...suggested])])
                    resetResult()
                  }}
                  title="Select every disk whose label looks like part of this Workbench release"
                >
                  Select suggested disks ({suggested.size})
                </Button>
                <Button variant="ghost" disabled={selected.length === 0} onClick={() => { setSelected([]); resetResult() }}>
                  Clear
                </Button>
              </div>
              <div className="dk-list" role="group" aria-label="Choose the Workbench disks" data-testid="wb-disks">
                {candidates.filter((m) => matchesQuery(m, query)).length === 0 && <div className="dk-empty">No disks match “{query}”.</div>}
                {candidates.map((m) => {
                  const isSel = selected.includes(m.id)
                  const sug = suggested.has(m.id)
                  return (
                    <label key={m.id} className={`dk-row ${isSel ? 'selected' : ''}`}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleDisk(m.id)} aria-label={`Use ${m.name}`} />
                      <span style={{ minWidth: 0 }}>
                        <span className="dk-name">{m.name}</span>
                        <span className="dk-sub" style={{ display: 'block' }}>
                          {formatSummary(m)} · {formatBytes(m.size)}
                        </span>
                      </span>
                      <span className="row-nowrap" style={{ gap: 4 }}>
                        {sug && <Badge tone="accent" title={`The disk label looks like part of Workbench ${release}`}>Suggested</Badge>}
                        <DiskBadges disk={m} />
                      </span>
                    </label>
                  )
                })}
              </div>
              <span className="faint xs">
                {selected.length} disk{selected.length === 1 ? '' : 's'} selected. A full set normally has Workbench, Install, Extras, Fonts, Storage and Locale.
              </span>
            </div>
          )}
        </div>
      </Card>

      <Card title="Step 2. Check the disks">
        <div className="stack">
          <div className="row">
            <Button variant="primary" icon="check" disabled={selected.length === 0 || analysing} onClick={() => void analyse()}>
              {analysing ? 'Checking…' : 'Check these disks'}
            </Button>
            {selected.length === 0 && <span className="muted small">Select at least one disk in step 1.</span>}
          </div>

          {analysis && (
            <div className="stack" data-testid="wb-analysis">
              <div className="row">
                <strong>Looks like:</strong>
                <Badge tone={analysis.version === 'unknown' ? 'warning' : 'accent'}>{analysis.version === 'unknown' ? 'Unknown release' : `Workbench ${analysis.version}`}</Badge>
                {analysis.revision_confirmed ? <Badge tone="success">Version confirmed</Badge> : <Badge tone="warning">Version not confirmed</Badge>}
              </div>

              {releaseMismatch && (
                <Banner tone="warning" title="Different release than selected">
                  These disks look like Workbench {analysis.version}, but you selected Workbench {release} in step 1.
                </Banner>
              )}
              {analysis.revision_confirmed ? (
                <Banner tone="success">
                  The Workbench disk contains <code>workbench.library {EXPECTED[analysis.version as Release]}</code>, the version expected for Workbench {analysis.version}.
                </Banner>
              ) : (
                <Banner tone="info">
                  The expected <code>workbench.library</code> version could not be confirmed ({release === '3.1' ? 'Workbench 3.1 should be 40.42' : 'Workbench 2.1 should be 38.36'}). See the warnings below.
                </Banner>
              )}
              <p className="faint xs">
                How this works: Amiga Studio scans the disk image for version text (such as <code>$VER: workbench.library 40.42</code>) and reads each disk’s label. It does not open the Amiga files on the disk, so this is a helpful hint, not proof that a disk is complete or genuine.
              </p>

              <Table head={['Disk', 'Label', 'Role', 'Release', 'workbench.library', 'Starts the Amiga?']} caption="Classification of the chosen disks">
                {analysis.disks.map((d) => {
                  const want = d.version === 'unknown' ? undefined : EXPECTED[d.version as Release]
                  return (
                    <tr key={d.media_id} data-testid="wb-row" data-role={d.role}>
                      <td>{diskName(d.media_id)}</td>
                      <td className="muted">{d.volume_name ?? 'none'}</td>
                      <td>
                        <Badge tone={d.role === 'other' ? 'warning' : 'neutral'}>{ROLE_NAMES[d.role]}</Badge>
                      </td>
                      <td>{d.version === 'unknown' ? <span className="muted">unknown</span> : d.version}</td>
                      <td>
                        {d.detected_revision ? (
                          <>
                            <code>{rev(d.detected_revision)}</code>{' '}
                            {want && <Badge tone={rev(d.detected_revision) === want ? 'success' : 'warning'}>{rev(d.detected_revision) === want ? 'as expected' : `expected ${want}`}</Badge>}
                          </>
                        ) : (
                          <span className="muted">not found</span>
                        )}
                      </td>
                      <td>{d.bootable ? <Badge tone="success">Yes</Badge> : <span className="muted">No</span>}</td>
                    </tr>
                  )
                })}
              </Table>

              {(analysis.missing_roles.length > 0 || analysis.duplicate_roles.length > 0) && (
                <div className="stack-sm">
                  {analysis.missing_roles.length > 0 && (
                    <div className="row" data-testid="wb-missing">
                      <strong>May be missing:</strong>
                      {analysis.missing_roles.map((r) => (
                        <Badge key={r} tone="warning">
                          {ROLE_NAMES[r]}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {analysis.duplicate_roles.length > 0 && (
                    <div className="row" data-testid="wb-duplicates">
                      <strong>More than one disk for:</strong>
                      {analysis.duplicate_roles.map((r) => (
                        <Badge key={r} tone="warning">
                          {ROLE_NAMES[r]}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {analysis.warnings.length > 0 && (
                <Banner tone="warning" title="Warnings">
                  <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="wb-warnings">
                    {analysis.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Banner>
              )}
              {wbDisk && bootableWb === false && analysis.warnings.length === 0 && (
                <Banner tone="warning">The Workbench disk does not look bootable.</Banner>
              )}

              <div className="row">
                <Button icon="check" onClick={() => void save()}>
                  {setId && savedSets.data?.some((s) => s.id === setId) ? 'Update saved set' : 'Save this set'}
                </Button>
                <span className="faint xs">Saves the description of the set (which disks play which role) so you can come back to it.</span>
              </div>
            </div>
          )}
        </div>
      </Card>

      <Card title="Step 3. Choose a Kickstart ROM">
        <div className="stack">
          {kickstarts.length === 0 ? (
            <Banner tone="warning" title="No Kickstart ROM in your library">
              You need a Kickstart ROM to start any Amiga. Add one on the <a href="#/amiga/roms">ROM Library</a> screen.
            </Banner>
          ) : (
            <Select
              label="Kickstart ROM"
              value={romId}
              onChange={(e) => {
                setRomId(e.target.value)
                void checkKickstart(analysis, e.target.value)
              }}
              hint={`Workbench ${release} needs ${KICKSTART_NEEDS[release]}.`}
            >
              <option value="">Choose a ROM…</option>
              {kickstarts.map((r) => (
                <option key={r.id} value={r.id} disabled={r.missing}>
                  {r.info.label}
                  {r.name && r.name !== r.info.label ? ` (${r.name})` : ''}
                  {r.missing ? ' - file missing' : ''}
                </option>
              ))}
            </Select>
          )}
          <div aria-live="polite" data-testid="ks-status">
            {ks.state === 'ok' && <Banner tone="success">This Kickstart suits Workbench {analysis?.version}.</Banner>}
            {ks.state === 'warn' && (
              <Banner tone="warning" title="Kickstart and Workbench may not match">
                {ks.text}
              </Banner>
            )}
            {ks.state === 'unknown' && <Banner tone="info">{ks.text}</Banner>}
            {ks.state === 'error' && <Banner tone="error">{ks.text}</Banner>}
            {ks.state === 'idle' && romId && !analysis && <p className="muted small">Check your disks in step 2 to compare this ROM with the Workbench release.</p>}
          </div>
        </div>
      </Card>

      <Card title="Step 4. Install Workbench on a hard disk">
        <div className="stack">
          <Banner tone="warning" title="The installation itself happens inside the emulated Amiga">
            Amiga Studio cannot install Workbench for you. The button below prepares a machine that starts from your <strong>Workbench disk</strong> (in DF0:) with your <strong>Install disk</strong> in DF1:. You then follow the Installer on the emulated Amiga’s screen to copy Workbench onto the hard disk. Amiga Studio cannot check the result for you.
          </Banner>
          <div className="grid grid-2">
            <Select
              label="Hard disk to install onto (optional)"
              value={hdfId}
              onChange={(e) => setHdfId(e.target.value)}
              hint={
                (hdfs.data ?? []).length === 0 ? (
                  <>
                    You have no hard disk yet. Create or import one on the <a href="#/amiga/harddrives">Hard Drives</a> screen, or continue without one and add it later.
                  </>
                ) : (
                  'A blank hard disk must be partitioned and formatted from inside the Amiga before Workbench can be installed. A safety backup is made when the machine starts.'
                )
              }
            >
              <option value="">None for now</option>
              {(hdfs.data ?? []).map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({formatBytes(h.size)}, {h.info.summary})
                </option>
              ))}
            </Select>
            <div className="stack-sm">
              <span className="field-label">The machine will be</span>
              <span className="small">
                {PRESET[release].label}, Workbench {release}, hard disk {hdfId ? 'attached' : 'not attached'}.
              </span>
              <span className="faint xs">Named “Workbench install” in My Amigas, where you can adjust it.</span>
            </div>
          </div>
          {blockers.length > 0 && (
            <ul className="dl-blockers muted small" data-testid="wb-blockers">
              {blockers.map((b) => (
                <li key={b}>
                  <Icon name="info" size={14} /> {b}
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            <Button variant="primary" icon="amiga" disabled={blockers.length > 0 || creating} onClick={() => void createMachine()}>
              {creating ? 'Creating…' : 'Create a machine for the installation'}
            </Button>
          </div>
          {issues && issues.length > 0 && (
            <div className="stack-sm" data-testid="wb-issues">
              <strong>Checks on the new machine</strong>
              <ul className="dl-issues">
                {issues.map((i, n) => (
                  <li key={n}>
                    <Badge tone={i.severity === 'error' ? 'danger' : i.severity === 'warning' ? 'warning' : 'neutral'}>{i.severity === 'error' ? 'Problem' : i.severity === 'warning' ? 'Warning' : 'Note'}</Badge> <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {created && (
            <Banner
              tone="success"
              title={`“${created.name}” is ready`}
              actions={
                <a className="btn primary" href="#/amiga/emulator" data-testid="open-emulator">
                  Open the Emulator
                </a>
              }
            >
              The machine was saved with the Workbench disk in DF0: and the Install disk in DF1:. Start it from the Emulator screen, then follow the Installer. You can review it any time in <a href="#/amiga/machines">My Amigas</a>.
            </Banner>
          )}
        </div>
      </Card>

      <Card title="Saved Workbench sets">
        {(savedSets.data ?? []).length === 0 ? (
          <p className="muted small">No saved sets yet. Check your disks in step 2, then choose “Save this set”.</p>
        ) : (
          <Table head={['Set', 'Release', 'Disks', 'Status', <span key="a" className="sr-only">Actions</span>]} caption="Saved Workbench sets">
            {(savedSets.data ?? []).map((s) => (
              <tr key={s.id} data-testid="wb-saved" data-name={s.name}>
                <td>
                  <strong>{s.name}</strong>
                </td>
                <td>{s.version === 'unknown' ? 'Unknown' : s.version}</td>
                <td className="muted">
                  {s.disks.length} disk{s.disks.length === 1 ? '' : 's'}
                  {s.disks.some((d) => !byId.has(d.media_id)) && <> (some removed from library)</>}
                </td>
                <td>
                  <span className="dk-badges">
                    {s.revision_confirmed ? <Badge tone="success">Version confirmed</Badge> : <Badge tone="warning">Not confirmed</Badge>}
                    {s.missing_roles.length > 0 && <Badge tone="warning">{s.missing_roles.length} possibly missing</Badge>}
                  </span>
                </td>
                <td>
                  <div className="row-nowrap" style={{ justifyContent: 'flex-end', gap: 4 }}>
                    <Button size="sm" onClick={() => openSaved(s)} aria-label={`Open the set ${s.name}`}>
                      Open
                    </Button>
                    <Button size="sm" variant="ghost" iconOnly icon="trash" aria-label={`Delete the set ${s.name}`} title="Delete saved set" onClick={() => void deleteSaved(s)} />
                  </div>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  )
}
