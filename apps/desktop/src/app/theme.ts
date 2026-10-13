import { useEffect } from 'react'
import { useLocalStorage } from '@/lib/hooks'

export type Theme = 'dark' | 'light'

export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useLocalStorage<Theme>('tilt.theme', 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  return [theme, setTheme]
}
