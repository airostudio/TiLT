import { useState } from 'react'
import { call, errorMessage, runJob } from '@/api/client'
import type { ErrorDto, PinballRomSet, PinballRoms as Lib, RomStatus } from '@/api/types'
import { Badge, Banner, Button, Card, Empty, ErrorNote, Loading, Page, PageHeader, PathInput, Table, useUi } from '@/components/ui'
import { useBackend } from '@/app/backend'
import { useLoad } from '@/lib/hooks'
import { formatBytes } from '@/lib/format'

const STATUS: Record<RomStatus, { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' }> = {
  good: { label: 'Good (MAME)', tone: 'success' },
  bad: { label: 'Wrong or incomplete', tone: 'danger' },
  unknown_set: { label: 'MAME does not know it', tone: 'warning' },
  not_checked: { label: 'Not checked', tone: 'neutral' },
}

interface ImportResult {
  path: string
  ok?: PinballRomSet
  error?: ErrorDto
}

/** The pinball ROM library: import sets, have MAME check them, play them. */
export function PinballRoms() {
  const { toast, confirm } = useUi()
  const { offline } = useBackend()
  const lib = useLoad(() => (offline ? Promise.resolve(null) : call<Lib>('pinball_roms')), [offline])
  const [path, setPath] = useState('')
  const [folder, setFolder] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [query, setQuery] = useState('')

  const back = (
    <Button icon="back" onClick={() => (window.location.hash = '#/room/pinball')}>
      Pinball Arcade
    </Button>
  )
  if (offline) {
    return (
      <Page>
        <PageHeader title="Pinball ROM library" actions={back} />
        <Banner tone="info" title="Needs the TiLT app">Importing and checking ROM sets needs the TiLT desktop app (or <code>tilt-local</code>) on your computer.</Banner>
      </Page>
    )
  }

  const sets = lib.data?.sets ?? []
  const mame = lib.data?.mame ?? null
  const shown = sets.filter((s) => `${s.name} ${s.title ?? ''}`.toLowerCase().includes(query.toLowerCase()))

  const doImport = async () => {
    setBusy('import')
    setResults(null)
    try {
      const r = await runJob<ImportResult[]>('pinball_rom_import', { paths: [path.trim()] })
      setResults(r)
      const ok = r.filter((x) => x.ok).length
      toast(`Imported ${ok} of ${r.length} file${r.length === 1 ? '' : 's'}`, ok === r.length && r.length > 0 ? 'success' : 'info')
      await lib.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const check = async (name?: string) => {
    setBusy(name ?? 'all')
    try {
      await runJob('pinball_rom_verify', name ? { name } : {})
      await lib.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (s: PinballRomSet) => {
    const ok = await confirm({
      title: `Remove ${s.name}?`,
      body: 'The copy in the TiLT library is deleted. The file you imported from is not touched.',
      confirmLabel: 'Remove',
      danger: true,
    })
    if (!ok) return
    try {
      await call('pinball_rom_remove', { name: s.name })
      await lib.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const play = async (s: PinballRomSet) => {
    try {
      await call('system_launch', { id: 'mame', game: s.path })
      toast(`Started ${s.title ?? s.name} in MAME`, 'success')
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  return (
    <Page>
      <PageHeader
        title="Pinball ROM library"
        subtitle="ROM sets are the .zip files PinMAME and MAME use, named after the machine (for example tz_94h.zip). TiLT includes none: import the ones you own."
        actions={back}
      />
      <Banner tone="info" title="How sets are checked">
        TiLT has no ROM database of its own and never guesses. A set is only called <strong>Good</strong> when MAME itself checked every file; without MAME it stays <strong>Not checked</strong>. {mame ? 'MAME is set up.' : <>MAME is not set up yet: <a href="#/room/pinball/mame">choose or find it</a>.</>}
      </Banner>
      <Card title="Import ROM sets">
        <div className="stack">
          <div className="row" role="radiogroup" aria-label="What to import">
            <label className="row">
              <input type="radio" name="what" checked={folder} onChange={() => setFolder(true)} /> A folder of sets
            </label>
            <label className="row">
              <input type="radio" name="what" checked={!folder} onChange={() => setFolder(false)} /> One set
            </label>
          </div>
          <PathInput label={folder ? 'Folder with .zip sets' : 'ROM set (.zip)'} hint="Files are copied into the TiLT library after being checked. Your originals are only read." value={path} onChange={setPath} directory={folder} extensions={folder ? undefined : ['zip']} />
          <div className="row">
            <Button variant="primary" icon="plus" disabled={!path.trim() || busy !== null} onClick={() => void doImport()} data-testid="pinball-import">
              {busy === 'import' ? 'Importing…' : 'Import'}
            </Button>
          </div>
          {results && (
            <div data-testid="import-results" className="stack-sm">
              {results.filter((r) => r.error).length > 0 && (
                <Banner tone="warning" title={`${results.filter((r) => r.error).length} not imported`}>
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    {results.filter((r) => r.error).slice(0, 20).map((r) => (
                      <li key={r.path}>
                        <span className="mono">{r.path.split(/[\\/]/).pop()}</span>: {r.error?.message}
                      </li>
                    ))}
                  </ul>
                </Banner>
              )}
            </div>
          )}
        </div>
      </Card>
      <Card
        title={`Your ROM sets (${sets.length})`}
        actions={
          <>
            <input className="input" style={{ width: 200 }} placeholder="Search…" aria-label="Search ROM sets" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button icon="check" disabled={!mame || sets.length === 0 || busy !== null} onClick={() => void check()} data-testid="check-all" title={mame ? undefined : 'Set up MAME first'}>
              {busy === 'all' ? 'Checking…' : 'Check all with MAME'}
            </Button>
          </>
        }
      >
        <ErrorNote error={lib.error} />
        {lib.loading ? (
          <Loading />
        ) : sets.length === 0 ? (
          <Empty icon="chip" title="No ROM sets yet">
            Import a folder of ROM sets above. Nothing is uploaded: they stay on this computer.
          </Empty>
        ) : (
          <Table head={['Set', 'Machine', 'Size', 'Status', '']} caption="Imported pinball ROM sets">
            {shown.map((s) => (
              <tr key={s.name} data-testid="pinball-rom-row">
                <td className="mono">{s.name}</td>
                <td>
                  {s.title ? (
                    <div className="stack-sm" style={{ gap: 2 }}>
                      <strong>{s.title}</strong>
                      <span className="muted xs">{[s.manufacturer, s.year].filter(Boolean).join(' · ')}</span>
                    </div>
                  ) : (
                    <span className="muted small">Known after MAME checks it</span>
                  )}
                </td>
                <td className="muted">{formatBytes(s.size)}</td>
                <td>
                  {s.missing ? <Badge tone="danger">File missing</Badge> : <Badge tone={STATUS[s.verification.status].tone}>{STATUS[s.verification.status].label}</Badge>}
                  <div className="muted xs" style={{ maxWidth: 360 }} title={s.verification.detail}>
                    {s.verification.detail}
                  </div>
                </td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button size="sm" disabled={!mame || busy !== null || s.missing} onClick={() => void check(s.name)}>
                    Check
                  </Button>{' '}
                  <Button size="sm" variant="primary" icon="play" disabled={!mame || s.missing} onClick={() => void play(s)} title={mame ? undefined : 'Set up MAME first'}>
                    Play
                  </Button>{' '}
                  <Button size="sm" variant="danger" iconOnly icon="trash" aria-label={`Remove ${s.name}`} onClick={() => void remove(s)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
        {lib.data && (
          <p className="small muted" style={{ marginTop: 8 }}>
            Library folder: <span className="mono">{lib.data.folder}</span>. Visual Pinball tables that use PinMAME read ROMs from their own folder; copy sets there if a table asks for one.
          </p>
        )}
      </Card>
    </Page>
  )
}
