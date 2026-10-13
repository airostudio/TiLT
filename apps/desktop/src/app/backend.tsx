import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { call } from '@/api/client'
import type { AppInfo, SessionStatus } from '@/api/types'

interface BackendCtx {
  info: AppInfo | null
  /** `offline` = the backend process cannot be reached (dev bridge not running). */
  offline: boolean
  refreshInfo: () => Promise<void>
  session: SessionStatus | null
  refreshSession: () => Promise<void>
}

const Ctx = createContext<BackendCtx | null>(null)

export function BackendProvider({ children, pollSession }: { children: ReactNode; pollSession: boolean }) {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [offline, setOffline] = useState(false)
  const [session, setSession] = useState<SessionStatus | null>(null)

  const refreshInfo = useCallback(async () => {
    try {
      setInfo(await call<AppInfo>('app_info'))
      setOffline(false)
    } catch (e) {
      if ((e as { code?: string }).code === 'offline') setOffline(true)
    }
  }, [])
  const refreshSession = useCallback(async () => {
    try {
      setSession(await call<SessionStatus>('session_status'))
    } catch {
      /* transient; the next poll will retry */
    }
  }, [])

  useEffect(() => {
    void refreshInfo()
  }, [refreshInfo])
  useEffect(() => {
    if (!pollSession) return
    void refreshSession()
    const t = setInterval(() => void refreshSession(), 2000)
    return () => clearInterval(t)
  }, [pollSession, refreshSession])

  const value = useMemo(() => ({ info, offline, refreshInfo, session, refreshSession }), [info, offline, refreshInfo, session, refreshSession])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useBackend(): BackendCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useBackend outside BackendProvider')
  return c
}
