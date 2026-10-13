import { useEffect, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import type { Issue, MachineProfile, Validation } from '@/api/types'

/**
 * Live validation: asks the backend (`profile_validate`) about the profile a moment after the
 * last change. `current` is false while the issues on screen still belong to an older edit, so
 * callers can hold back Save until the answer for exactly what is on screen has arrived.
 */
export function useValidation(profile: MachineProfile | null, delayMs = 250): { issues: Issue[]; current: boolean; error: string | null } {
  const key = profile ? JSON.stringify(profile) : ''
  const [state, setState] = useState<{ key: string; issues: Issue[] } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!key) return
    let dead = false
    const t = setTimeout(async () => {
      try {
        const v = await call<Validation>('profile_validate', { profile: JSON.parse(key) as MachineProfile })
        if (!dead) {
          setState({ key, issues: v.issues })
          setError(null)
        }
      } catch (e) {
        if (!dead) setError(errorMessage(e))
      }
    }, delayMs)
    return () => {
      dead = true
      clearTimeout(t)
    }
  }, [key, delayMs])
  return { issues: state?.issues ?? [], current: !!key && state?.key === key, error }
}
