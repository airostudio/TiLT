import { call } from '@/api/client'
import type { RoomView as Room, SystemView } from '@/api/types'
import { Badge, Button, Icon, Loading, ErrorNote, Page, PageHeader, useUi } from '@/components/ui'
import { useLoad } from '@/lib/hooks'
import { errorMessage } from '@/api/client'

export function RoomView({ room }: { room: string }) {
  const { toast } = useUi()
  const rooms = useLoad(() => call<Room[]>('rooms'))
  const systems = useLoad(() => call<SystemView[]>('systems_list'), [room])
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

  return (
    <Page>
      <PageHeader title={meta?.name ?? 'Room'} subtitle={meta?.tagline} actions={<Button icon="back" onClick={() => (window.location.hash = '#/')}>All rooms</Button>} />
      <ErrorNote error={systems.error} />
      {systems.loading ? (
        <Loading />
      ) : (
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
                    <Button variant="primary" icon="play" disabled={!s.configured || s.running} onClick={() => void launch(s)}>
                      Start
                    </Button>
                    <Button icon={s.configured ? 'list' : 'settings'} onClick={() => (window.location.hash = `#/room/${room}/${s.id}`)}>
                      {s.configured ? 'Games' : 'Set up'}
                    </Button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Page>
  )
}
