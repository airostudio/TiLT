import { call, errorMessage } from '@/api/client'
import type { AutoConfigured, PinballRoms, SystemView } from '@/api/types'
import { Badge, Button, Card, Icon, Loading, ErrorNote, Page, PageHeader, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { useCatalog } from './useCatalog'

export function RoomView({ room }: { room: string }) {
  const { toast } = useUi()
  const { rooms, systems, offline } = useCatalog()
  const roms = useLoad(() => (offline || room !== 'pinball' ? Promise.resolve(null) : call<PinballRoms>('pinball_roms')), [room, offline])
  const meta = rooms.data?.find((r) => r.id === room)
  const list = (systems.data ?? []).filter((s) => s.room === room)

  const launch = async (s: SystemView) => {
    try {
      await call('system_launch', { id: s.id })
      toast(`${s.name} started`, 'success')
      await systems.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }

  const find = async () => {
    try {
      const found = await call<AutoConfigured[]>('systems_autoconfigure', { room })
      toast(found.length ? `Found ${found.map((f) => f.name).join(', ')}` : 'No new emulators found in the usual places', found.length ? 'success' : 'info')
      await systems.reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    }
  }
  const sets = roms.data?.sets ?? []

  return (
    <Page>
      <PageHeader
        title={meta?.name ?? 'Room'}
        subtitle={meta?.tagline}
        actions={
          <>
            {!offline && (
              <Button icon="search" onClick={() => void find()} data-testid="find-emulators">
                Find installed emulators
              </Button>
            )}
            <Button icon="back" onClick={() => (window.location.hash = '#/')}>
              All rooms
            </Button>
          </>
        }
      />
      <ErrorNote error={systems.error} />
      {systems.loading ? (
        <Loading />
      ) : (
        <>
        <div className="grid grid-3">
          {list.map((s) => (
            <div key={s.id} className="card system-card" data-testid={`system-${s.id}`}>
              <div className="row">
                <div className="system-icon">
                  <Icon name={s.kind === 'amiga' ? 'amiga' : s.room === 'pinball' ? 'pinball' : 'gamepad'} size={24} />
                </div>
                <span className="spacer" />
                {s.kind === 'amiga' ? (
                  <Badge tone="accent">Built in</Badge>
                ) : offline ? (
                  <Badge>Preview</Badge>
                ) : s.configured ? (
                  <Badge tone="success">Ready</Badge>
                ) : (
                  <Badge tone="warning">Needs setup</Badge>
                )}
                {s.running && <Badge tone="success">Running</Badge>}
              </div>
              <div>
                <h2>{s.name}</h2>
                <p className="muted small" style={{ marginTop: 4 }}>
                  {s.description}
                </p>
              </div>
              <div className="row" style={{ marginTop: 'auto' }}>
                {s.kind === 'amiga' ? (
                  <Button variant="primary" icon="play" onClick={() => (window.location.hash = '#/amiga/dashboard')}>
                    Open
                  </Button>
                ) : (
                  <>
                    <Button variant="primary" icon="play" disabled={offline || !s.configured || s.running} onClick={() => void launch(s)}>
                      Start
                    </Button>
                    <Button icon={s.configured ? 'list' : 'settings'} disabled={offline} onClick={() => (window.location.hash = `#/room/${room}/${s.id}`)}>
                      {s.configured ? 'Games' : 'Set up'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        {room === 'pinball' && (
          <Card title="Pinball ROMs">
            <div className="row" data-testid="pinball-roms-card">
              <div>
                <p className="small">
                  Pinball machines need their ROM sets, which TiLT does not include. Import the ones you own; MAME checks them.
                  {!offline && roms.data && <> You have <strong>{sets.length}</strong> in the library.</>}
                </p>
              </div>
              <span className="spacer" />
              <Button variant="primary" icon="chip" disabled={offline} onClick={() => (window.location.hash = '#/room/pinball/roms')}>
                Open the ROM library
              </Button>
            </div>
          </Card>
        )}
        </>
      )}
    </Page>
  )
}
