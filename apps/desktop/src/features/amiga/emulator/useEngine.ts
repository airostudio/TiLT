import { useCallback, useEffect, useRef, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { EngineInfo } from '@/api/types'

export interface EngineState {
  info: EngineInfo | null
  /** `not_found` means Amiberry is not installed / not configured. */
  error: { code: string; message: string } | null
  loading: boolean
  reload: () => Promise<void>
}

/** Asks the backend (`engine_info`) whether the emulator engine can be found and probed. */
export function useEngine(): EngineState {
  const [info, setInfo] = useState<EngineInfo | null>(null)
  const [error, setError] = useState<EngineState['error']>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const reload = useCallback(async () => {
    try {
      const i = await call<EngineInfo>('engine_info')
      if (!alive.current) return
      setInfo(i)
      setError(null)
    } catch (e) {
      if (!alive.current) return
      setInfo(null)
      setError({ code: (e as { code?: string }).code ?? 'internal', message: errorMessage(e) })
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    void reload()
    return () => {
      alive.current = false
    }
  }, [reload])
  return { info, error, loading, reload }
}

export const NO_CONTROL_FALLBACK =
  "This build of the emulator has no control channel on this platform, so TiLT cannot pause it, change disks or take previews while it runs. Use the emulator's own menu (F12) for that, or restart the machine to apply changes made here."
