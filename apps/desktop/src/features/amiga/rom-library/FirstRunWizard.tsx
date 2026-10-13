import { useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { MachineProfile, RomImportResult, RomRecord, Validation } from '@/api/types'
import { Badge, Banner, Button, Card, Icon, useUi } from '@/components/ui'
import { RomImport } from './RomImport'
import { proposeAssociations } from './associate'

type Step = 'welcome' | 'import' | 'done'

/** First launch: explain, import Kickstart ROMs, and attach them to the predefined machines. */
export function FirstRunWizard({ onFinished }: { onFinished: () => void }) {
  const { toast } = useUi()
  const [step, setStep] = useState<Step>('welcome')
  const [imported, setImported] = useState<RomRecord[]>([])
  const [assigned, setAssigned] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = async (r: RomImportResult[]) => {
    const all = await call<RomRecord[]>('rom_list')
    setImported(all)
    if (r.some((x) => x.ok)) setStep('import')
  }

  const associate = async () => {
    setBusy(true)
    try {
      const [profiles, roms] = await Promise.all([call<MachineProfile[]>('profile_list'), call<RomRecord[]>('rom_list')])
      const done: string[] = []
      for (const { profile, rom } of proposeAssociations(profiles, roms)) {
        const next = { ...profile, rom_id: rom.id }
        const v = await call<Validation>('profile_validate', { profile: next })
        if (v.issues.some((i) => i.severity === 'error')) continue
        await call('profile_save', { profile: next })
        done.push(`${profile.name} → ${rom.info.family ?? rom.info.label}`)
      }
      setAssigned(done)
      setStep('done')
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="wizard" data-testid="first-run-wizard">
      <ol className="row" style={{ listStyle: 'none', padding: 0, margin: '0 0 16px' }} aria-label="Setup steps">
        {(['welcome', 'import', 'done'] as Step[]).map((s, i) => (
          <li key={s} className="row-nowrap" aria-current={s === step ? 'step' : undefined}>
            <Badge tone={s === step ? 'accent' : 'neutral'}>{i + 1}</Badge>
            <span className={s === step ? '' : 'muted'}>{{ welcome: 'Welcome', import: 'Import Kickstart', done: 'Ready' }[s]}</span>
            {i < 2 && <Icon name="chevron" size={14} />}
          </li>
        ))}
      </ol>

      {step === 'welcome' && (
        <div className="stack">
          <h2>Welcome to Amiga Studio</h2>
          <p className="muted" style={{ maxWidth: '68ch' }}>
            Amiga Studio runs classic Amigas, from the A500 to the accelerated A1200 and A4000, on your computer. To start a machine it needs a <strong>Kickstart ROM</strong>, the Amiga's built-in system software.
          </p>
          <Banner tone="info" title="Your files stay yours">
            Amiga Studio does not include any Kickstart ROMs, Workbench disks or software. You import the ones you own. Everything is stored on this computer: no account, no uploads, no internet needed.
          </Banner>
          <div className="row">
            <Button variant="primary" icon="chevron" onClick={() => setStep('import')}>
              Import my Kickstart ROMs
            </Button>
            <Button variant="ghost" onClick={onFinished}>
              Skip for now
            </Button>
          </div>
        </div>
      )}

      {step === 'import' && (
        <div className="stack">
          <h2>Import your Kickstart ROMs</h2>
          <p className="muted">Select one or more ROM files. The version is read from inside each ROM, so file names don't matter.</p>
          <RomImport onDone={(r) => void refresh(r)} />
          {imported.length > 0 && (
            <>
              <Banner tone="success" title={`${imported.length} ROM${imported.length === 1 ? '' : 's'} in your library`}>
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {imported.map((r) => (
                    <li key={r.id}>{r.info.label}</li>
                  ))}
                </ul>
              </Banner>
              <div className="row">
                <Button variant="primary" disabled={busy} onClick={() => void associate()}>
                  Use them in my machines
                </Button>
                <span className="muted small">Each predefined machine without a ROM gets the best matching one. You can change this any time.</span>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="stack">
          <h2>You're set</h2>
          {assigned.length > 0 ? (
            <Banner tone="success" title="Machines ready to start">
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {assigned.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Banner>
          ) : (
            <Banner tone="warning">No predefined machine matched your ROMs. Open My Amigas to choose a Kickstart for a machine yourself.</Banner>
          )}
          <p className="muted">Next you can set up Workbench from your install disks, import floppy images, or attach a hard disk.</p>
          <div className="row">
            <Button variant="primary" onClick={onFinished}>
              Go to the dashboard
            </Button>
            <Button onClick={() => (window.location.hash = '#/amiga/disks')}>Set up Workbench</Button>
          </div>
        </div>
      )}
    </Card>
  )
}
