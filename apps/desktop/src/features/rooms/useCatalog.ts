import { call } from '@/api/client'
import type { RoomView, SystemView } from '@/api/types'
import { useBackend } from '@/app/backend'
import { useLoad, type Loadable } from '@/lib/hooks'
import { OFFLINE_ROOMS, OFFLINE_SYSTEMS } from './offlineCatalog'

/** Rooms and systems from the backend, or the built-in preview catalogue when there is no backend. */
export function useCatalog(): { rooms: Loadable<RoomView[]>; systems: Loadable<SystemView[]>; offline: boolean } {
  const { offline } = useBackend()
  const rooms = useLoad(() => (offline ? Promise.resolve(OFFLINE_ROOMS) : call<RoomView[]>('rooms')), [offline])
  const systems = useLoad(() => (offline ? Promise.resolve(OFFLINE_SYSTEMS) : call<SystemView[]>('systems_list')), [offline])
  return { rooms, systems, offline }
}
