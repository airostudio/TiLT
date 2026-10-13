import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '@/api/client'

export interface Loadable<T> {
  data: T | null
  error: string | null
  loading: boolean
  reload: () => Promise<void>
  set: (v: T) => void
}

/** Load data on mount (and when `deps` change); `reload()` refreshes without flashing a spinner. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []): Loadable<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      const v = await fnRef.current()
      if (alive.current) {
        setData(v)
        setError(null)
      }
    } catch (e) {
      if (alive.current) setError(errorMessage(e))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    alive.current = true
    setLoading(true)
    void reload()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload, set: setData }
}

/** Re-run `fn` every `ms` while `active`. */
export function useInterval(fn: () => void, ms: number, active = true): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => ref.current(), ms)
    return () => clearInterval(t)
  }, [ms, active])
}

export function useLocalStorage<T>(key: string, initial: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw == null ? initial : (JSON.parse(raw) as T)
    } catch {
      return initial
    }
  })
  const set = useCallback(
    (nv: T) => {
      setV(nv)
      try {
        localStorage.setItem(key, JSON.stringify(nv))
      } catch {
        /* storage unavailable: the choice just won't persist */
      }
    },
    [key],
  )
  return [v, set]
}
