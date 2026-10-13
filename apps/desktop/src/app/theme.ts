import { useEffect, useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'

// One shared store so every useTheme() caller (top bar, Settings) stays in sync.
const KEY = 'tilt.theme'
const listeners = new Set<() => void>()

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === '"light"' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}
let current: Theme = read()

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function setThemeValue(t: Theme): void {
  current = t
  try {
    localStorage.setItem(KEY, JSON.stringify(t))
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
  document.documentElement.dataset.theme = t
  listeners.forEach((l) => l())
}

export function useTheme(): [Theme, (t: Theme) => void] {
  const theme = useSyncExternalStore(subscribe, () => current)
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return [theme, setThemeValue]
}
