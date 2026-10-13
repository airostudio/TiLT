import { useCallback, useEffect, useId, useMemo, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { call, errorMessage } from '@/api/client'
import type { AmigaModel, Chipset, CpuModel, DriveKind, HdfRecord, Issue, MachineProfile, MediaRecord, PortDevice, RomRecord } from '@/api/types'
import { Badge, Banner, Button, Card, Icon, Page, PageHeader, Select, TextArea, TextInput, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useLoad, useLocalStorage } from '@/lib/hooks'
import {
  ACCEL_MB,
  CHIP_KB,
  CPU_MODELS,
  FAST_MB,
  FPU_OPTIONS,
  MODEL_HINT,
  MODEL_LABEL,
  SAMPLE_RATES,
  SECTION_TITLE,
  SLOW_KB,
  Z3_MB,
  PORT_LABEL,
  clone,
  errorsOf,
  kbText,
  mbText,
  memoryPresets,
  romLabel,
  sectionOf,
  warningsOf,
} from './profileUtils'
import { useValidation } from './useValidation'
import { StartError, type StartFailure } from './StartError'
import './machines.css'

const SECTIONS = ['general', 'cpu', 'chipset', 'memory', 'kickstart', 'floppies', 'harddisks', 'audio', 'display', 'input', 'performance'] as const
const ADVANCED_FIELDS = ['cpu.data_cache', 'cpu.address_24bit', 'audio.buffer_ms']
const NARROW_24BIT: CpuModel[] = ['68000', '68010', '68EC020']

interface Props {
  initial: MachineProfile
  /** True for a machine created from a preset that has not been saved yet. */
  isNew: boolean
  onClose: () => void
}

/** A control with its own validation messages directly underneath. */
function F({ field, issues, children }: { field: string; issues: Issue[]; children: ReactNode }) {
  const mine = issues.filter((i) => i.field === field)
  return (
    <div className="fgroup" data-field={field}>
      {children}
      {mine.length > 0 && (
        <ul className="field-issues" id={`iss-${field}`}>
          {mine.map((i, n) => (
            <li key={n} className={`fi ${i.severity}`}>
              <Icon name={i.severity === 'error' ? 'x' : i.severity === 'warning' ? 'warn' : 'info'} size={14} />
              <span>
                <span className="sr-only">{i.severity === 'error' ? 'Problem: ' : i.severity === 'warning' ? 'Warning: ' : 'Note: '}</span>
                {i.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const a11y = (issues: Issue[], field: string) => {
  const mine = issues.filter((i) => i.field === field)
  return {
    'aria-invalid': mine.some((i) => i.severity === 'error') || undefined,
    'aria-describedby': mine.length ? `iss-${field}` : undefined,
  }
}

function Switch({ label, checked, onChange, disabled, ...rest }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'checked' | 'disabled' | 'type'>) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} {...rest} />
      <span>{label}</span>
    </label>
  )
}

/** Whole-number input that only reports values inside its range. */
function NumberField({ label, value, min, max, onChange, hint }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; hint?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  return (
    <TextInput
      label={label}
      hint={hint}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={text}
      onChange={(e) => {
        setText(e.target.value)
        const n = Number(e.target.value)
        if (e.target.value !== '' && Number.isInteger(n) && n >= min && n <= max) onChange(n)
      }}
      onBlur={() => setText(String(value))}
    />
  )
}

function Section({ id, title, intro, children, issues }: { id: string; title: string; intro?: ReactNode; children: ReactNode; issues: Issue[] }) {
  const errs = errorsOf(issues).length
  return (
    <section id={`sec-${id}`} className="editor-section card" aria-labelledby={`h-${id}`} data-section={id} tabIndex={-1}>
      <div className="card-title">
        <h2 id={`h-${id}`}>{title}</h2>
        {errs > 0 && <Badge tone="danger">{errs} {errs === 1 ? 'problem' : 'problems'}</Badge>}
      </div>
      {intro && <p className="muted small section-intro">{intro}</p>}
      <div className="stack">{children}</div>
    </section>
  )
}

function Choice<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; hint?: ReactNode }) {
  const gid = useId()
  return (
    <div className="field">
      <span className="field-label" id={gid}>
        {label}
      </span>
      <div className="segmented" role="radiogroup" aria-labelledby={gid}>
        {options.map((o) => (
          <label key={String(o.id)} className={`seg ${o.id === value ? 'on' : ''}`}>
            <input type="radio" name={gid} checked={o.id === value} onChange={() => onChange(o.id)} />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

/** Options for a numeric select; keeps an unusual current value selectable so nothing is silently changed. */
function numOptions(list: number[], current: number, fmt: (n: number) => string): ReactNode {
  const all = list.includes(current) ? list : [...list, current].sort((a, b) => a - b)
  return all.map((n) => (
    <option key={n} value={n}>
      {fmt(n)}
      {list.includes(n) ? '' : ' (not a standard size)'}
    </option>
  ))
}

export function MachineEditor({ initial, isNew, onClose }: Props) {
  const { confirm, toast } = useUi()
  const { session, refreshSession } = useBackend()
  const [profile, setProfile] = useState<MachineProfile>(() => clone(initial))
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial))
  const [exists, setExists] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [startFailure, setStartFailure] = useState<StartFailure | null>(null)
  const [advancedPref, setAdvanced] = useLocalStorage('amiga.editor.advanced', false)
  const roms = useLoad(() => call<RomRecord[]>('rom_list'), [])
  const media = useLoad(() => call<MediaRecord[]>('media_list'), [])
  const hdfs = useLoad(() => call<HdfRecord[]>('hdf_list'), [])
  const { issues, current, error: validationError } = useValidation(profile)

  const dirty = JSON.stringify(profile) !== baseline || !exists
  const errors = errorsOf(issues)
  const warnings = warningsOf(issues)
  const notes = issues.filter((i) => i.severity === 'info')
  const advancedIssue = issues.some((i) => ADVANCED_FIELDS.includes(i.field) && i.severity !== 'info')
  const advanced = advancedPref || advancedIssue
  const otherRunning = !!session?.running
  const romList = roms.data ?? []
  const mediaList = media.data ?? []
  const hdfList = hdfs.data ?? []

  const set = useCallback((fn: (p: MachineProfile) => void) => {
    setProfile((prev) => {
      const next = clone(prev)
      fn(next)
      return next
    })
    setSaveError(null)
  }, [])

  const section = (id: string) => issues.filter((i) => sectionOf(i.field) === id)

  const goTo = (id: string) => {
    const el = document.getElementById(`sec-${id}`)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    el?.focus({ preventScroll: true })
  }

  const back = async () => {
    if (dirty) {
      const ok = await confirm({
        title: 'Leave without saving?',
        body: exists ? 'Your changes to this machine have not been saved and will be lost.' : 'This new machine has not been saved yet and will be lost.',
        confirmLabel: 'Discard changes',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }

  const save = async (): Promise<boolean> => {
    setSaving(true)
    setSaveError(null)
    try {
      await call('profile_save', { profile })
      setBaseline(JSON.stringify(profile))
      setExists(true)
      toast(`Saved “${profile.name}”`, 'success')
      return true
    } catch (e) {
      setSaveError(errorMessage(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  const saveAndStart = async () => {
    if (!(await save())) return
    try {
      await call('session_start', { profile_id: profile.id })
      await refreshSession()
      window.location.hash = '#/amiga/emulator'
    } catch (e) {
      setStartFailure({ code: (e as { code?: string }).code ?? 'internal', message: errorMessage(e) })
    }
  }

  const revert = async () => {
    const ok = await confirm({ title: 'Revert changes?', body: 'Every setting goes back to how it was when you opened this editor or last saved.', confirmLabel: 'Revert' })
    if (!ok) return
    setProfile(JSON.parse(baseline) as MachineProfile)
    setSaveError(null)
  }

  const setCpuModel = (m: CpuModel) =>
    set((p) => {
      const was = p.cpu.model
      p.cpu.model = m
      if (NARROW_24BIT.includes(m)) p.cpu.address_24bit = true
      else if (NARROW_24BIT.includes(was)) p.cpu.address_24bit = false
    })

  const rom = romList.find((r) => r.id === profile.rom_id)
  const extRom = romList.find((r) => r.id === profile.ext_rom_id)
  const mem = profile.memory
  const memPresets = useMemo(() => memoryPresets(profile), [profile])
  const attached = new Set(profile.hard_disks.map((h) => h.hdf_id))
  const attachable = hdfList.filter((h) => !attached.has(h.id))

  const setDrive = (i: number, on: boolean, kind?: DriveKind) =>
    set((p) => {
      if (on) {
        for (let j = 0; j <= i; j++) if (p.drives[j].kind === 'disabled') p.drives[j].kind = kind ?? 'dd35'
        if (kind) p.drives[i].kind = kind
      } else {
        for (let j = i; j < 4; j++) {
          p.drives[j].kind = 'disabled'
          p.drives[j].media_id = null
        }
      }
    })

  const diskName = (id: string | null) => (id ? mediaList.find((m) => m.id === id)?.name ?? 'Unknown disk' : null)

  const blocked = errors.length > 0
  const canSave = dirty && !blocked && current && !saving
  const startReason = otherRunning ? `${session?.profile_name ?? 'Another machine'} is already running. Power it off first.` : blocked ? 'Fix the problems listed on the right first.' : !current ? 'Checking…' : null

  return (
    <Page className="editor-page">
      <PageHeader
        title={
          <span className="row" style={{ gap: 10 }}>
            {profile.name.trim() || 'Untitled machine'}
            {!exists && <Badge tone="accent">New, not saved yet</Badge>}
            {exists && dirty && <Badge tone="warning">Unsaved changes</Badge>}
          </span>
        }
        subtitle="Changes are checked as you make them. Impossible hardware combinations are explained next to the setting and cannot be saved."
        actions={
          <>
            <Switch label="Show advanced settings" checked={advanced} disabled={advancedIssue} onChange={setAdvanced} data-testid="advanced-toggle" />
            <Button icon="back" onClick={() => void back()}>
              Back to My Amigas
            </Button>
          </>
        }
      />
      <nav className="editor-nav" aria-label="Jump to a section">
        {SECTIONS.map((s) => {
          const n = errorsOf(section(s)).length
          return (
            <button key={s} type="button" className="chip" onClick={() => goTo(s)}>
              {SECTION_TITLE[s]}
              {n > 0 && <span className="chip-dot" aria-label={`${n} problem${n === 1 ? '' : 's'}`} />}
            </button>
          )
        })}
        <button
          type="button"
          className="chip chip-strong"
          onClick={() => {
            const side = document.getElementById('editor-side')
            side?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            side?.focus({ preventScroll: true })
          }}
        >
          Checks and Save
        </button>
      </nav>

      {startFailure && <StartError failure={startFailure} onDismiss={() => setStartFailure(null)} />}
      {validationError && <Banner tone="warning" title="Could not check this configuration">{validationError}</Banner>}

      <div className="editor-grid">
        <div className="editor-main stack">
          <Section id="general" title="General" issues={section('general')}>
            <F field="name" issues={issues}>
              <TextInput label="Name" value={profile.name} maxLength={80} onChange={(e) => set((p) => void (p.name = e.target.value))} {...a11y(issues, 'name')} />
            </F>
            <div className="field">
              <label htmlFor="machine-type">Machine type</label>
              <select id="machine-type" className="select" value={profile.model} onChange={(e) => set((p) => void (p.model = e.target.value as AmigaModel))}>
                {(Object.keys(MODEL_LABEL) as AmigaModel[]).map((m) => (
                  <option key={m} value={m}>
                    {MODEL_LABEL[m]}
                  </option>
                ))}
              </select>
              <span className="hint">{MODEL_HINT[profile.model]} This decides which chipset, Kickstart and drive options count as authentic. It is an emulated configuration, not a particular physical product.</span>
            </div>
            <TextArea label="Notes" hint="Only for you. Shown on the machine card." value={profile.notes} onChange={(e) => set((p) => void (p.notes = e.target.value))} />
          </Section>

          <Section id="cpu" title="Processor" issues={section('cpu')} intro="The 68000 family. The “EC” versions are cheaper chips that leave out features, and the emulator will not pretend otherwise.">
            <div className="grid grid-2">
              <F field="cpu.model" issues={issues}>
                <Select label="CPU model" value={profile.cpu.model} onChange={(e) => setCpuModel(e.target.value as CpuModel)} {...a11y(issues, 'cpu.model')}>
                  {CPU_MODELS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <span className="hint">{CPU_MODELS.find((c) => c.id === profile.cpu.model)?.note}</span>
              </F>
              <F field="cpu.fpu" issues={issues}>
                <Select label="Floating point unit (FPU)" value={profile.cpu.fpu} onChange={(e) => set((p) => void (p.cpu.fpu = e.target.value as MachineProfile['cpu']['fpu']))} {...a11y(issues, 'cpu.fpu')}>
                  {FPU_OPTIONS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </F>
            </div>
            <div className="grid grid-2">
              <F field="cpu.mmu" issues={issues}>
                <Switch label="Memory management unit (MMU)" checked={profile.cpu.mmu} onChange={(v) => set((p) => void (p.cpu.mmu = v))} {...a11y(issues, 'cpu.mmu')} />
                <span className="hint">Only the full 68030 and 68040 have one. Turning it on disables the JIT speed-up.</span>
              </F>
              <Choice
                label="CPU speed"
                value={profile.cpu.speed}
                options={[
                  { id: 'original', label: 'Original speed' },
                  { id: 'max', label: 'As fast as possible' },
                ]}
                onChange={(v) => set((p) => void (p.cpu.speed = v))}
                hint="Original speed keeps the timing the software was written for."
              />
            </div>
            {advanced && (
              <div className="advanced-box" data-testid="cpu-advanced">
                <div className="field-label">Advanced</div>
                <div className="grid grid-2">
                  <F field="cpu.data_cache" issues={issues}>
                    <Switch label="Data cache" checked={profile.cpu.data_cache} onChange={(v) => set((p) => void (p.cpu.data_cache = v))} {...a11y(issues, 'cpu.data_cache')} />
                    <span className="hint">Available from the 68030 upward.</span>
                  </F>
                  <F field="cpu.address_24bit" issues={issues}>
                    <Switch label="24-bit addressing" checked={profile.cpu.address_24bit} onChange={(v) => set((p) => void (p.cpu.address_24bit = v))} {...a11y(issues, 'cpu.address_24bit')} />
                    <span className="hint">Some old software needs it, but memory above 16 MB cannot be used while it is on.</span>
                  </F>
                </div>
              </div>
            )}
          </Section>

          <Section id="chipset" title="Chipset" issues={section('chipset')} intro="The custom chips that draw the screen and play the sound. AGA only exists in the Amiga 1200 and 4000 families.">
            <F field="chipset" issues={issues}>
              <Choice
                label="Chipset"
                value={profile.chipset}
                options={[
                  { id: 'ocs' as Chipset, label: 'OCS (original)' },
                  { id: 'ecs' as Chipset, label: 'ECS (enhanced)' },
                  { id: 'aga' as Chipset, label: 'AGA (advanced)' },
                ]}
                onChange={(v) => set((p) => void (p.chipset = v))}
              />
            </F>
            <F field="display.standard" issues={issues}>
              <Choice
                label="Video standard"
                value={profile.display.standard}
                options={[
                  { id: 'pal', label: 'PAL (50 Hz)' },
                  { id: 'ntsc', label: 'NTSC (60 Hz)' },
                ]}
                onChange={(v) => set((p) => void (p.display.standard = v))}
                hint="Software written for one standard can run at the wrong speed on the other."
              />
            </F>
          </Section>

          <Section id="memory" title="Memory" issues={section('memory')} intro="Chip RAM is shared with the custom chips. Fast RAM is extra memory for the processor. Pick a ready-made layout or set each exact size below.">
            <div className="field">
              <span className="field-label" id="memory-presets-label">
                Quick layouts
              </span>
              <div className="row" role="group" aria-labelledby="memory-presets-label">
                {memPresets.map((m) => (
                  <Button key={m.id} size="sm" onClick={() => set((p) => void (p.memory = m.apply(p.memory)))}>
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid grid-3">
              <F field="memory.chip_kb" issues={issues}>
                <Select label="Chip RAM" value={mem.chip_kb} onChange={(e) => set((p) => void (p.memory.chip_kb = Number(e.target.value)))} {...a11y(issues, 'memory.chip_kb')}>
                  {numOptions(CHIP_KB, mem.chip_kb, kbText)}
                </Select>
              </F>
              <F field="memory.slow_kb" issues={issues}>
                <Select label="Slow RAM (trapdoor)" value={mem.slow_kb} onChange={(e) => set((p) => void (p.memory.slow_kb = Number(e.target.value)))} {...a11y(issues, 'memory.slow_kb')}>
                  {numOptions(SLOW_KB, mem.slow_kb, (n) => (n ? kbText(n) : 'None'))}
                </Select>
              </F>
              <F field="memory.fast_mb" issues={issues}>
                <Select label="Fast RAM (Zorro II)" value={mem.fast_mb} onChange={(e) => set((p) => void (p.memory.fast_mb = Number(e.target.value)))} {...a11y(issues, 'memory.fast_mb')}>
                  {numOptions(FAST_MB, mem.fast_mb, (n) => (n ? mbText(n) : 'None'))}
                </Select>
              </F>
              <F field="memory.accel_mb" issues={issues}>
                <Select label="Accelerator RAM (32-bit)" hint="Needs a 68020 or better." value={mem.accel_mb} onChange={(e) => set((p) => void (p.memory.accel_mb = Number(e.target.value)))} {...a11y(issues, 'memory.accel_mb')}>
                  {numOptions(ACCEL_MB, mem.accel_mb, (n) => (n ? mbText(n) : 'None'))}
                </Select>
              </F>
              <F field="memory.z3_mb" issues={issues}>
                <Select label="Zorro III RAM" hint="Amiga 3000/4000 style expansion." value={mem.z3_mb} onChange={(e) => set((p) => void (p.memory.z3_mb = Number(e.target.value)))} {...a11y(issues, 'memory.z3_mb')}>
                  {numOptions(Z3_MB, mem.z3_mb, (n) => (n ? mbText(n) : 'None'))}
                </Select>
              </F>
            </div>
            <F field="memory" issues={issues}>
              <span />
            </F>
          </Section>

          <Section id="kickstart" title="Kickstart" issues={section('kickstart')} intro="The Amiga's built-in system software. TiLT does not include any: import a ROM file you own in the ROM Library.">
            {roms.loading ? null : romList.length === 0 ? (
              <Banner tone="warning" title="No Kickstart ROMs imported yet">
                A machine cannot start without a Kickstart ROM. <a href="#/amiga/roms">Open the ROM Library</a> to import one, then come back and choose it here.
              </Banner>
            ) : null}
            <F field="rom_id" issues={issues}>
              <Select label="Kickstart ROM" value={profile.rom_id ?? ''} onChange={(e) => set((p) => void (p.rom_id = e.target.value || null))} {...a11y(issues, 'rom_id')}>
                <option value="">No Kickstart selected</option>
                {profile.rom_id && !rom && <option value={profile.rom_id}>Unknown ROM (no longer in the library)</option>}
                {romList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {romLabel(r)}
                  </option>
                ))}
              </Select>
            </F>
            {rom && (
              <div className="rom-detail" data-testid="rom-detail">
                <div className="row">
                  <strong>{rom.info.label}</strong>
                  {rom.info.family && <Badge>{rom.info.family}</Badge>}
                  {rom.info.aga_capable ? <Badge tone="success">Works with AGA</Badge> : <Badge>Not for AGA machines</Badge>}
                  {rom.info.is_aros && <Badge tone="accent">AROS</Badge>}
                  {rom.missing && <Badge tone="danger">File missing</Badge>}
                </div>
                <div className="small muted">
                  {rom.info.version_string ?? 'Version text not found'}
                  {rom.info.likely_machines.length > 0 && <> · Fits: {rom.info.likely_machines.join(', ')}</>}
                </div>
                {rom.info.warnings.map((w) => (
                  <div key={w} className="small" style={{ color: 'var(--warning)' }}>
                    {w}
                  </div>
                ))}
              </div>
            )}
            <F field="ext_rom_id" issues={issues}>
              <Select
                label="Extended ROM (optional)"
                hint="Only a few machines and CD systems use a second ROM. Leave empty if unsure."
                value={profile.ext_rom_id ?? ''}
                onChange={(e) => set((p) => void (p.ext_rom_id = e.target.value || null))}
                {...a11y(issues, 'ext_rom_id')}
              >
                <option value="">None</option>
                {profile.ext_rom_id && !extRom && <option value={profile.ext_rom_id}>Unknown ROM (no longer in the library)</option>}
                {romList.map((r) => (
                  <option key={r.id} value={r.id}>
                    {romLabel(r)}
                  </option>
                ))}
              </Select>
            </F>
            <div className="small">
              <a href="#/amiga/roms">Manage ROMs in the ROM Library</a>
            </div>
          </Section>

          <Section id="floppies" title="Floppy drives" issues={section('floppies')} intro="Turn on the drives this machine has, in order: DF1: needs DF0:, and so on. Disks are inserted from the Floppy Drives screen.">
            <F field="drives" issues={issues}>
              <div className="drive-rows">
                {profile.drives.map((d, i) => (
                  <div key={i} className="drive-row">
                    <F field={`drives.${i}`} issues={issues}>
                      <div className="row">
                        <Switch label={`DF${i}:`} checked={d.kind !== 'disabled'} onChange={(v) => setDrive(i, v)} data-testid={`drive-${i}`} />
                        <select
                          className="select"
                          style={{ width: 220 }}
                          aria-label={`DF${i}: type`}
                          disabled={d.kind === 'disabled'}
                          value={d.kind === 'disabled' ? 'dd35' : d.kind}
                          onChange={(e) => set((p) => void (p.drives[i].kind = e.target.value as DriveKind))}
                        >
                          <option value="dd35">Double density (880 KB)</option>
                          <option value="hd35">High density (1.76 MB)</option>
                        </select>
                        {d.media_id ? (
                          <span className="small">
                            <Icon name="floppy" size={14} /> {diskName(d.media_id)}{' '}
                            <Button size="sm" variant="ghost" onClick={() => set((p) => void (p.drives[i].media_id = null))}>
                              Remove
                            </Button>
                          </span>
                        ) : (
                          d.kind !== 'disabled' && <span className="small muted">No disk set</span>
                        )}
                      </div>
                    </F>
                  </div>
                ))}
              </div>
            </F>
            <div className="small">
              <a href="#/amiga/floppies">Insert disks in the Floppy Drives screen</a>
            </div>
          </Section>

          <Section id="harddisks" title="Hard disks" issues={section('harddisks')} intro="Hard disk images from your Hard Drives library. A safety backup is made each time the machine starts.">
            <F field="hard_disks" issues={issues}>
              {profile.hard_disks.length === 0 ? (
                <p className="muted small">No hard disks attached.</p>
              ) : (
                <ul className="plain-list">
                  {profile.hard_disks.map((h, i) => {
                    const rec = hdfList.find((x) => x.id === h.hdf_id)
                    return (
                      <li key={h.hdf_id} className="row">
                        <F field={`hard_disks.${i}`} issues={issues}>
                          <div className="row">
                            <Icon name="hdd" size={16} />
                            <strong>{rec?.name ?? 'Unknown hard disk'}</strong>
                            <select
                              className="select"
                              style={{ width: 'auto' }}
                              aria-label={`Controller for ${rec?.name ?? 'hard disk'}`}
                              value={h.controller}
                              onChange={(e) => set((p) => void (p.hard_disks[i].controller = e.target.value as 'mainboard_ide' | 'uae'))}
                            >
                              <option value="mainboard_ide">Built-in IDE (A600/A1200/A4000)</option>
                              <option value="uae">Emulator hardfile controller</option>
                            </select>
                            <Switch label="Read-only" checked={h.read_only} onChange={(v) => set((p) => void (p.hard_disks[i].read_only = v))} />
                            <Button size="sm" variant="ghost" icon="x" onClick={() => set((p) => void p.hard_disks.splice(i, 1))}>
                              Detach
                            </Button>
                          </div>
                        </F>
                      </li>
                    )
                  })}
                </ul>
              )}
            </F>
            <div className="row">
              {attachable.length > 0 && (
                <Select
                  aria-label="Attach a hard disk"
                  value=""
                  style={{ width: 'auto', minWidth: 220 }}
                  onChange={(e) => {
                    const id = e.target.value
                    if (!id) return
                    set((p) => {
                      p.hard_disks.push({ hdf_id: id, controller: ['a1200', 'a4000', 'custom'].includes(p.model) ? 'mainboard_ide' : 'uae', read_only: false, boot_priority: 0 })
                    })
                  }}
                >
                  <option value="">Attach a hard disk…</option>
                  {attachable.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}
                    </option>
                  ))}
                </Select>
              )}
              <a href="#/amiga/harddrives">Import or manage hard disks</a>
            </div>
          </Section>

          <Section id="audio" title="Audio" issues={section('audio')}>
            <div className="grid grid-2">
              <F field="audio.volume" issues={issues}>
                <div className="field">
                  <label htmlFor="audio-volume">Volume: {profile.audio.volume}%</label>
                  <input id="audio-volume" type="range" min={0} max={100} value={profile.audio.volume} onChange={(e) => set((p) => void (p.audio.volume = Number(e.target.value)))} {...a11y(issues, 'audio.volume')} />
                </div>
              </F>
              <F field="audio.stereo_separation" issues={issues}>
                <div className="field">
                  <label htmlFor="audio-sep">Stereo separation: {profile.audio.stereo_separation === 0 ? 'mono' : profile.audio.stereo_separation === 10 ? 'full' : profile.audio.stereo_separation} </label>
                  <input id="audio-sep" type="range" min={0} max={10} value={profile.audio.stereo_separation} onChange={(e) => set((p) => void (p.audio.stereo_separation = Number(e.target.value)))} {...a11y(issues, 'audio.stereo_separation')} />
                  <span className="hint">0 is mono, 10 is the widest stereo image.</span>
                </div>
              </F>
            </div>
            <div className="grid grid-2">
              <Switch label="Start muted" checked={profile.audio.muted} onChange={(v) => set((p) => void (p.audio.muted = v))} />
              <F field="audio.sample_rate" issues={issues}>
                <Select label="Sample rate" value={profile.audio.sample_rate} onChange={(e) => set((p) => void (p.audio.sample_rate = Number(e.target.value)))} {...a11y(issues, 'audio.sample_rate')}>
                  {numOptions(SAMPLE_RATES, profile.audio.sample_rate, (n) => `${n.toLocaleString()} Hz`)}
                </Select>
              </F>
            </div>
            {advanced && (
              <div className="advanced-box">
                <div className="field-label">Advanced</div>
                <F field="audio.buffer_ms" issues={issues}>
                  <NumberField label="Audio buffer (milliseconds)" min={10} max={200} value={profile.audio.buffer_ms} onChange={(n) => set((p) => void (p.audio.buffer_ms = n))} hint="Smaller means less delay but a higher risk of crackling. 10 to 200." />
                </F>
              </div>
            )}
          </Section>

          <Section id="display" title="Display" issues={section('display')} intro={<>Video standard ({profile.display.standard.toUpperCase()}) is set under Chipset. The emulator opens in its own window.</>}>
            <div className="grid grid-2">
              <F field="display.window_width" issues={issues}>
                <NumberField label="Window width" min={320} max={7680} value={profile.display.window_width} onChange={(n) => set((p) => void (p.display.window_width = n))} hint="Pixels, when not full screen." />
              </F>
              <F field="display.window_height" issues={issues}>
                <NumberField label="Window height" min={200} max={4320} value={profile.display.window_height} onChange={(n) => set((p) => void (p.display.window_height = n))} hint="Pixels, when not full screen." />
              </F>
            </div>
            <div className="row" style={{ gap: 24 }}>
              <Switch label="Keep the original aspect ratio" checked={profile.display.keep_aspect} onChange={(v) => set((p) => void (p.display.keep_aspect = v))} />
              <Switch label="Start full screen" checked={profile.display.fullscreen} onChange={(v) => set((p) => void (p.display.fullscreen = v))} />
            </div>
          </Section>

          <Section id="input" title="Input" issues={section('input')} intro="Which device is plugged into each of the two controller ports.">
            <F field="input" issues={issues}>
              <div className="grid grid-2">
                {(['port0', 'port1'] as const).map((port, n) => (
                  <Select key={port} label={`Port ${n} ${n === 0 ? '(usually the mouse)' : '(usually a joystick)'}`} value={profile.input[port]} onChange={(e) => set((p) => void (p.input[port] = e.target.value as PortDevice))}>
                    {(Object.keys(PORT_LABEL) as PortDevice[]).map((d) => (
                      <option key={d} value={d}>
                        {PORT_LABEL[d]}
                      </option>
                    ))}
                  </Select>
                ))}
              </div>
            </F>
            <F field="input.mouse_speed" issues={issues}>
              <div className="field">
                <label htmlFor="mouse-speed">Mouse speed: {profile.input.mouse_speed}%</label>
                <input id="mouse-speed" type="range" min={10} max={200} step={5} value={profile.input.mouse_speed} onChange={(e) => set((p) => void (p.input.mouse_speed = Number(e.target.value)))} {...a11y(issues, 'input.mouse_speed')} />
              </div>
            </F>
          </Section>

          <Section id="performance" title="Performance mode" issues={section('performance')} intro="Choose between exact timing and speed. You can change this at any time.">
            <div className="mode-cards" role="radiogroup" aria-label="Performance mode">
              {(
                [
                  ['compatibility', 'Compatibility', 'Cycle-exact timing: the processor and chips are emulated step by step as on the real machine. This gives the best fidelity, and is the right choice for games, demos and anything timing-sensitive. Choose this unless something runs too slowly.'],
                  ['performance', 'Performance', 'Faster, but not cycle-exact. Uses the JIT (a speed-up that translates the processor code) where it is valid: 68020 or better, without the MMU. Timing-sensitive software, such as some games and demos, may misbehave in this mode. If something acts strangely, switch back to Compatibility.'],
                ] as const
              ).map(([id, title, text]) => (
                <label key={id} className={`mode-card ${profile.performance === id ? 'selected' : ''}`}>
                  <input type="radio" name="perf-mode" checked={profile.performance === id} onChange={() => set((p) => void (p.performance = id))} />
                  <span className="mode-card-body">
                    <strong>
                      {title}
                      {profile.performance === id && <Icon name="check" size={16} />}
                    </strong>
                    <span className="small muted">{text}</span>
                  </span>
                </label>
              ))}
            </div>
            <F field="performance" issues={issues}>
              <span />
            </F>
          </Section>
        </div>

        <aside className="editor-side" id="editor-side" tabIndex={-1} aria-label="Checks and actions">
          <Card className="side-card" title="Checks">
            <div role="status" aria-live="polite" data-testid="validation-summary">
              {!current ? (
                <p className="muted small">Checking…</p>
              ) : issues.length === 0 ? (
                <p className="row" style={{ color: 'var(--success)' }}>
                  <Icon name="check" size={16} /> Everything checks out.
                </p>
              ) : null}
              {([['Problems', 'error', errors], ['Warnings', 'warning', warnings], ['Notes', 'info', notes]] as const).map(
                ([title, sev, list]) =>
                  list.length > 0 && (
                    <div key={sev} className={`issue-group ${sev}`}>
                      <h3>
                        {title} ({list.length})
                      </h3>
                      <ul>
                        {list.map((i, n) => (
                          <li key={n}>
                            <button type="button" className="issue-link" onClick={() => goTo(sectionOf(i.field))}>
                              <Icon name={sev === 'error' ? 'x' : sev === 'warning' ? 'warn' : 'info'} size={14} />
                              <span>
                                <span className="issue-where">{SECTION_TITLE[sectionOf(i.field)]}</span> {i.message}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ),
              )}
            </div>
          </Card>
          <Card className="side-card">
            <div className="stack-sm">
              <Button variant="primary" icon="check" disabled={!canSave} onClick={() => void save()} data-testid="save">
                {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button icon="play" disabled={!!startReason || saving} title={startReason ?? undefined} onClick={() => void saveAndStart()} data-testid="save-start">
                Save and start
              </Button>
              <Button variant="ghost" disabled={!dirty} onClick={() => void revert()}>
                Revert changes
              </Button>
              {blocked && (
                <p className="small" style={{ color: 'var(--danger)' }} data-testid="save-blocked">
                  Cannot save yet: {errors.length} {errors.length === 1 ? 'problem needs' : 'problems need'} fixing. The hardware combination you chose is not possible.
                </p>
              )}
              {!blocked && startReason && <p className="small muted">Start is unavailable: {startReason}</p>}
              {saveError && <Banner tone="error" title="The machine was not saved">{saveError}</Banner>}
            </div>
          </Card>
        </aside>
      </div>
    </Page>
  )
}
