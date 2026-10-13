import { useEffect, useMemo, useRef, useState } from 'react'
import { call } from '@/api/client'
import type { SessionRecord } from '@/api/types'
import { Badge, Banner, Button, Card, Icon, KV, Page, PageHeader, Spinner, Table, Tabs, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useLoad } from '@/lib/hooks'
import { formatDate, formatDuration } from '@/lib/format'
import { useEngine } from '../emulator/useEngine'
import { buildReport, runSelfCheck, summarise, type CheckResult, type CheckStatus } from './selfCheck'
import { TOPICS } from './topics'
import './help.css'

type Tab = 'start' | 'diagnostics' | 'about'

const STATUS_TEXT: Record<CheckStatus, string> = { pass: 'Pass', warn: 'Warning', fail: 'Fail' }
const STATUS_ICON = { pass: 'check', warn: 'warn', fail: 'x' } as const

function GettingStarted() {
  const [open, setOpen] = useState<Record<string, boolean>>({ rom: true })
  return (
    <div className="stack">
      <Banner tone="info" title="The short version">
        Import a Kickstart ROM you own, pick a machine in My Amigas, press Start. Everything else (floppies, hard disks, backups) builds on that. Open any topic below for the details.
      </Banner>
      <div className="topics" data-testid="topics">
        {TOPICS.map((t) => (
          <details
            key={t.id}
            className="topic"
            open={!!open[t.id]}
            onToggle={(e) => {
              const isOpen = (e.currentTarget as HTMLDetailsElement).open
              setOpen((o) => (o[t.id] === isOpen ? o : { ...o, [t.id]: isOpen }))
            }}
          >
            <summary>{t.title}</summary>
            <div className="topic-body">{t.body}</div>
          </details>
        ))}
      </div>
    </div>
  )
}

function Diagnostics() {
  const { toast } = useUi()
  const { info, refreshInfo } = useBackend()
  const engine = useEngine()
  const sessions = useLoad(() => call<SessionRecord[]>('sessions_recent'), [])
  const [checks, setChecks] = useState<CheckResult[] | null>(null)
  const [running, setRunning] = useState(false)
  const [showReport, setShowReport] = useState(false)
  const reportRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    void refreshInfo()
  }, [refreshInfo])

  const run = async (): Promise<CheckResult[]> => {
    setRunning(true)
    try {
      const rows = await runSelfCheck()
      setChecks(rows)
      await sessions.reload()
      return rows
    } finally {
      setRunning(false)
    }
  }

  const report = useMemo(() => buildReport(info, engine.info, checks, sessions.data ?? []), [info, engine.info, checks, sessions.data])

  const copy = async () => {
    // make sure the report contains a fresh self-check
    const rows = checks ?? (await run())
    const text = buildReport(info, engine.info, rows, sessions.data ?? [])
    try {
      await navigator.clipboard.writeText(text)
      toast('Diagnostics copied to the clipboard', 'success')
    } catch {
      setShowReport(true)
      toast('Could not reach the clipboard. The report is shown below: select it and copy it yourself.', 'error')
      setTimeout(() => reportRef.current?.select(), 50)
    }
  }

  const sum = checks ? summarise(checks) : null
  const sess = sessions.data ?? []

  return (
    <div className="stack">
      <Card title="System">
        <KV
          rows={[
            ['Amiga Studio', info ? `version ${info.version}` : 'Reading…'],
            ['Platform', info ? `${info.platform} / ${info.arch}` : 'Reading…'],
            ['Library location', info ? <span className="mono" data-testid="diag-root">{info.storage_root}</span> : 'Reading…'],
            [
              'Emulator engine',
              engine.loading ? (
                'Looking…'
              ) : engine.info ? (
                <span data-testid="diag-engine">
                  {engine.info.banner} <span className="muted mono">({engine.info.path})</span>
                </span>
              ) : (
                <span data-testid="diag-engine">
                  <Badge tone="danger">Not found</Badge> {engine.error?.message} <a href="#/amiga/settings">Open Settings</a>
                </span>
              ),
            ],
            [
              'Live control',
              engine.info ? (
                engine.info.runtime_control ? (
                  <Badge tone="success">Available</Badge>
                ) : (
                  <span>
                    <Badge tone="warning">Not available</Badge> {engine.info.runtime_control_note}
                  </span>
                )
              ) : info ? (
                info.runtime_control ? (
                  'Expected to be available on this platform'
                ) : (
                  <Badge tone="warning">Not available on this platform</Badge>
                )
              ) : (
                'Reading…'
              ),
            ],
          ]}
        />
      </Card>

      <Card
        title="Self-check"
        actions={
          <Button variant="primary" icon="activity" disabled={running} onClick={() => void run()} data-testid="run-selfcheck">
            {running ? 'Checking…' : checks ? 'Run again' : 'Run self-check'}
          </Button>
        }
      >
        {!checks && !running && <p className="muted small">Checks the emulator engine, your library, ROMs, disks, hard disks and free space. It reads and reports; the only thing it changes is finishing any operation an earlier crash left half-done.</p>}
        {running && (
          <div className="row muted" role="status">
            <Spinner /> Checking…
          </div>
        )}
        {sum && (
          <p className="row" data-testid="selfcheck-summary" role="status">
            <Badge tone="success">{sum.pass} passed</Badge>
            <Badge tone={sum.warn ? 'warning' : 'neutral'}>{sum.warn} {sum.warn === 1 ? 'warning' : 'warnings'}</Badge>
            <Badge tone={sum.fail ? 'danger' : 'neutral'}>{sum.fail} failed</Badge>
          </p>
        )}
        {checks && (
          <ul className="check-rows" data-testid="selfcheck-rows">
            {checks.map((c) => (
              <li key={c.id} className={`check-line ${c.status}`} data-testid={`check-${c.id}`} data-status={c.status}>
                <Icon name={STATUS_ICON[c.status]} size={16} className="check-line-icon" />
                <div>
                  <div>
                    <span className="check-line-state">{STATUS_TEXT[c.status]}</span> <strong>{c.title}</strong>
                  </div>
                  <div className="small muted">{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Recent sessions"
        actions={
          <Button size="sm" variant="ghost" onClick={() => void sessions.reload()}>
            Refresh
          </Button>
        }
      >
        {sessions.error && <Banner tone="error">{sessions.error}</Banner>}
        {sess.length === 0 && !sessions.loading ? (
          <p className="muted small">No machine has been started yet.</p>
        ) : (
          <Table head={['Machine', 'Started', 'Ran for', 'How it ended']} caption="Recent emulator sessions">
            {sess.map((s) => (
              <tr key={s.id} data-testid="session-row">
                <td>{s.profile_name}</td>
                <td>{formatDate(s.started_at)}</td>
                <td>{s.ended_at ? formatDuration(Math.max(0, s.ended_at - s.started_at)) : '-'}</td>
                <td>
                  {s.outcome === 'clean' ? (
                    <Badge tone="success" title="The emulator exited by itself and finished writing to its disks.">Clean</Badge>
                  ) : s.outcome === 'unclean' ? (
                    <Badge tone="warning" title="The emulator did not exit cleanly. AmigaDOS may validate disks on the next boot.">Not clean</Badge>
                  ) : s.ended_at ? (
                    <Badge>{s.outcome ?? 'Ended'}</Badge>
                  ) : (
                    <Badge tone="accent" title="Still running, or TiLT was closed before it ended.">Running or interrupted</Badge>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          "Not clean" means the emulator did not exit cleanly (for example it had to be stopped by force, or crashed). That is not harmful in itself, but AmigaDOS may validate disks the next time they are used.
        </p>
      </Card>

      <Card title="Copy diagnostics">
        <div className="stack-sm">
          <p className="small muted">Copies a plain-text report of the system information, the self-check and recent sessions, to paste into a support request. It contains no personal data beyond the file locations already shown on this screen, and nothing is sent anywhere.</p>
          <div className="row">
            <Button icon="copy" onClick={() => void copy()} data-testid="copy-diagnostics">
              Copy diagnostics to clipboard
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowReport((v) => !v)} aria-expanded={showReport}>
              {showReport ? 'Hide report' : 'Show report'}
            </Button>
          </div>
          {showReport && <textarea ref={reportRef} className="textarea mono report" readOnly value={report} aria-label="Diagnostics report" data-testid="report-text" rows={14} />}
        </div>
      </Card>
    </div>
  )
}

function About() {
  return (
    <div className="stack">
      <Card title="About Amiga Studio">
        <div className="stack-sm about">
          <p>
            Amiga Studio is part of TiLT and is free software, licensed <strong>GPL-3.0-or-later</strong>.
          </p>
          <h3>Built on</h3>
          <ul>
            <li>
              <strong>Amiberry</strong> (GPL-3.0, derived from WinUAE) is the emulation engine. It runs as a separate program that Amiga Studio starts and supervises; it is not linked into the app.
            </li>
            <li>
              <strong>xdms-rs</strong> (MIT or Apache-2.0) unpacks DMS disk archives.
            </li>
            <li>The desktop shell, interface and other libraries have their own permissive licences, listed in the third-party notices.</li>
          </ul>
          <h3>What is not included</h3>
          <p>No proprietary Amiga software is bundled: no Kickstart ROMs, no Workbench disks, no XCOPY, no games. You supply your own, and your files are only read from places you choose.</p>
          <h3>Privacy</h3>
          <p>Amiga Studio has no account, no telemetry and does not upload your ROMs, disks or hard disk images.</p>
          <h3>Licence details</h3>
          <p>
            Full licence information, the third-party notices and the source offer for the emulation engine are in <code>docs/amiga-studio/licensing.md</code> in the TiLT source tree.
          </p>
        </div>
      </Card>
    </div>
  )
}

export default function Help() {
  const [tab, setTab] = useState<Tab>('start')
  return (
    <Page>
      <PageHeader title="Help and diagnostics" subtitle="Getting started, a self-check that tests the real setup, and licensing information." />
      <Tabs
        tabs={[
          { id: 'start', label: 'Getting started' },
          { id: 'diagnostics', label: 'Diagnostics' },
          { id: 'about', label: 'About and licensing' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'start' && <GettingStarted />}
      {tab === 'diagnostics' && <Diagnostics />}
      {tab === 'about' && <About />}
    </Page>
  )
}
