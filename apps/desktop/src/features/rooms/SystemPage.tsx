import { useEffect, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { DetectCandidate, GameEntry, SystemView } from '@/api/types'
import { useBackend } from '@/app/backend'
import { Badge, Banner, Button, Card, Empty, ErrorNote, Icon, Loading, Page, PageHeader, PathInput, Table, TextInput, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { formatBytes } from '@/lib/format'

/** Launcher settings + game list for an external emulator system. */
export function SystemPage({ room, system }: { room: string; system: string }) {
  const { toast } = useUi()
  const { offline } = useBackend()
  const systems = useLoad(() => (offline ? Promise.resolve([]) : call<SystemView[]>('systems_list')), [system, offline])
  const [found, setFound] = useState<DetectCandidate[] | null>(null)
  const [finding, setFinding] = useState(false)
  const sys = systems.data?.find((s) => s.id === system)
  const [exe, setExe] = useState('')
  const [dir, setDir] = useState('')
  const [args, setArgs] = useState('')
  const [exts, setExts] = useState('')
  const [games, setGames] = useState<GameEntry[] | null>(null)
  const [gamesError, setGamesError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!sys) return
    setExe(sys.exe ?? '')
    setDir(sys.game_dir ?? '')
    setArgs(sys.args.join('\n'))
    setExts(sys.extensions.join(', '))
  }, [sys])

  const loadGames = async () => {
    try {
      setGames(await call<GameEntry[]>('system_games', { id: system }))
      setGamesError(null)
    } catch (e) {
      setGames(null)
      setGamesError(errorMessage(e))
    }
  }
  useEffect(() => {
    if (sys?.game_dir) void loadGames()
    else {
      setGames(null)
      setGamesError(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sys?.game_dir, system])

  if (offline) {
    return (
      <Page>
        <PageHeader title="Emulator setup" actions={<Button icon="back" onClick={() => (window.location.hash = `#/room/${room}`)}>Back</Button>} />
        <Banner tone="info" title="Needs the TiLT app">Setting up an emulator and listing games needs the TiLT desktop app (or <code>tilt-local</code>) on your computer.</Banner>
      </Page>
    )
  }
  if (systems.loading) return <Loading />
  if (!sys) return <Page><ErrorNote error={`Unknown system “${system}”.`} /></Page>

  const save = async () => {
    try {
      await call('system_save', {
        system: {
          ...sys,
          exe: exe.trim() || null,
          game_dir: dir.trim() || null,
          args: args.split('\n').map((a) => a.trim()).filter(Boolean),
          extensions: exts.split(',').map((e) => e.trim().replace(/^\./, '')).filter(Boolean),
        },
      })
      toast('Settings saved', 'success')
      await systems.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const detect = async () => {
    setFinding(true)
    try {
      setFound(await call<DetectCandidate[]>('system_detect', { id: system }))
    } catch (e) {
      setFound(null)
      toast(errorMessage(e), 'error')
    } finally {
      setFinding(false)
    }
  }
  const canDetect = ['mame', 'vpx', 'pinmame', 'ps2', 'intellivision'].includes(system)
  const launch = async (g?: GameEntry) => {
    try {
      await call('system_launch', { id: system, game: g?.path })
      toast(g ? `Started ${g.name}` : `${sys.name} started`, 'success')
      await systems.reload()
      await loadGames()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const fav = async (g: GameEntry) => {
    await call('system_favorite', { id: system, game: g.path })
    await loadGames()
  }
  const shown = (games ?? []).filter((g) => g.name.toLowerCase().includes(query.toLowerCase()))

  return (
    <Page>
      <PageHeader
        title={sys.name}
        subtitle={sys.description}
        actions={
          <>
            <Button icon="back" onClick={() => (window.location.hash = `#/room/${room}`)}>
              Back
            </Button>
            {sys.running && (
              <Button variant="danger" icon="stop" onClick={async () => { await call('system_stop', { id: system }); await systems.reload() }}>
                Stop
              </Button>
            )}
          </>
        }
      />
      <Banner tone="info" title="How this works">
        TiLT does not emulate this system itself. It starts the emulator you install, passing the game you pick. {sys.setup_hint}
      </Banner>
      {(system === 'mame' || system === 'pinmame' || system === 'vpx') && (
        <Banner tone="info" title="Pinball ROM sets">
          Machines need their ROM sets, which TiLT does not include. <a href="#/room/pinball/roms">Import yours in the Pinball ROM library</a>
          {system === 'mame' && <>; MAME plays straight from that library unless you choose another folder below.</>}
        </Banner>
      )}
      <Card title="Emulator settings">
        <div className="stack">
          <PathInput label="Emulator program" hint="The executable you installed." value={exe} onChange={setExe} />
          {canDetect && (
            <div className="stack-sm" data-testid="detect">
              <div>
                <Button icon="search" onClick={() => void detect()} disabled={finding}>
                  {finding ? 'Looking…' : 'Find it on this computer'}
                </Button>
              </div>
              {found && found.length === 0 && (
                <p className="small muted" data-testid="detect-none">
                  Nothing found in the program path or the usual install folders. Install it, or choose the program yourself above.
                </p>
              )}
              {found && found.length > 0 && (
                <ul className="stack-sm" style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }} aria-label="Programs found">
                  {found.map((c) => (
                    <li key={c.path} className="row" data-testid="detect-found">
                      <span className="mono small truncate" title={c.path}>
                        {c.path}
                      </span>
                      {c.version ? <Badge tone="success">{c.version}</Badge> : <Badge>Found by name, not run</Badge>}
                      <Button size="sm" onClick={() => setExe(c.path)}>
                        Use this
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <PathInput label="Game folder" hint="Folders up to two levels deep are scanned." value={dir} onChange={setDir} directory />
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="args">Arguments (one per line)</label>
              <textarea id="args" className="textarea mono" value={args} onChange={(e) => setArgs(e.target.value)} />
              <span className="hint">
                Placeholders: <code>{'{game}'}</code> full path, <code>{'{game_name}'}</code> name without extension, <code>{'{game_dir}'}</code> game folder. No shell is used.
              </span>
            </div>
            <TextInput label="File types" hint="Comma separated, e.g. iso, chd" value={exts} onChange={(e) => setExts(e.target.value)} />
          </div>
          <div className="row">
            <Button variant="primary" icon="check" onClick={() => void save()}>
              Save settings
            </Button>
            {sys.configured ? <Badge tone="success">Emulator found</Badge> : <Badge tone="warning">Choose the emulator program</Badge>}
            {sys.custom && (
              <Button variant="danger" icon="trash" onClick={async () => { await call('system_delete', { id: system }); window.location.hash = `#/room/${room}` }}>
                Remove system
              </Button>
            )}
          </div>
        </div>
      </Card>
      <Card
        title="Games"
        actions={
          <>
            <input className="input" style={{ width: 220 }} placeholder="Search…" aria-label="Search games" value={query} onChange={(e) => setQuery(e.target.value)} />
            <Button icon="play" disabled={!sys.configured || sys.running} onClick={() => void launch()}>
              Start without a game
            </Button>
          </>
        }
      >
        {gamesError && <ErrorNote error={gamesError} />}
        {!sys.game_dir && <Empty icon="folder" title="No game folder yet">Choose a game folder above and save to list your games.</Empty>}
        {sys.game_dir && games && games.length === 0 && <Empty icon="search" title="No games found">Nothing in that folder matches the file types above.</Empty>}
        {games && games.length > 0 && (
          <Table head={['', 'Game', 'Size', 'Plays', '']} caption="Games">
            {shown.map((g) => (
              <tr key={g.path}>
                <td style={{ width: 40 }}>
                  <Button variant="ghost" size="sm" iconOnly icon="star" aria-label={g.favorite ? `Remove ${g.name} from favourites` : `Add ${g.name} to favourites`} aria-pressed={g.favorite} onClick={() => void fav(g)} style={g.favorite ? { color: 'var(--warning)' } : undefined} />
                </td>
                <td>
                  <div className="truncate" title={g.path}>{g.name}</div>
                </td>
                <td className="muted">{formatBytes(g.size)}</td>
                <td className="muted">{g.plays}</td>
                <td style={{ textAlign: 'right' }}>
                  <Button size="sm" variant="primary" disabled={!sys.configured || sys.running} onClick={() => void launch(g)}>
                    <Icon name="play" size={14} /> Play
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </Page>
  )
}
