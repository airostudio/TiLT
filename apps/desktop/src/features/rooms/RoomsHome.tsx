import { Icon, Loading, ErrorNote } from '@/components/ui'
import { useCatalog } from './useCatalog'

export function RoomsHome() {
  const { rooms, systems } = useCatalog()
  return (
    <>
      <div className="hero">
        <h1>Welcome to the arcade</h1>
        <p className="muted" style={{ marginTop: 6, maxWidth: '62ch' }}>
          Pick a room. Everything runs on your computer: nothing is uploaded and no account is needed.
        </p>
      </div>
      <ErrorNote error={rooms.error ?? systems.error} />
      {rooms.loading || systems.loading ? (
        <Loading />
      ) : (
        <div className="rooms" data-testid="rooms">
          {(rooms.data ?? []).map((r) => {
            const inRoom = (systems.data ?? []).filter((s) => s.room === r.id)
            return (
              <a key={r.id} className={`room-card ${r.id}`} href={`#/room/${r.id}`} data-testid={`room-${r.id}`}>
                <div className="row">
                  <Icon name={r.id === 'home' ? 'gamepad' : 'pinball'} size={30} />
                  <span className="spacer" />
                  <Icon name="chevron" />
                </div>
                <div>
                  <h2>{r.name}</h2>
                  <p style={{ opacity: 0.85, marginTop: 4 }}>{r.tagline}</p>
                </div>
                <div className="room-systems">
                  {inRoom.map((s) => (
                    <span className="chip" key={s.id}>
                      {s.name}
                    </span>
                  ))}
                </div>
              </a>
            )
          })}
        </div>
      )}
    </>
  )
}
