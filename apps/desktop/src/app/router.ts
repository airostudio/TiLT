import { useEffect, useState } from 'react'

// Tiny hash router: #/  |  #/room/<room>  |  #/room/<room>/<system>  |  #/amiga/<section>
export function parseHash(h: string): string[] {
  const clean = h.replace(/^#\/?/, '').split('?')[0]
  return clean ? clean.split('/').map(decodeURIComponent) : []
}

export function useRoute(): [string[], (path: string) => void] {
  const [parts, setParts] = useState(() => parseHash(window.location.hash))
  useEffect(() => {
    const on = () => setParts(parseHash(window.location.hash))
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return [parts, (p: string) => (window.location.hash = p.startsWith('#') ? p : `#${p}`)]
}
