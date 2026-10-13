// Native file dialogs and drag-and-drop. In the desktop app these use Tauri; in a plain
// browser (dev/e2e) they return null / do nothing and the UI shows a path text box instead.

import { isTauri } from '@/api/client'

export interface PickOptions {
  multiple?: boolean
  directory?: boolean
  title?: string
  extensions?: string[]
  filterName?: string
}

export const canBrowse = (): boolean => isTauri()

export async function pickPaths(opts: PickOptions = {}): Promise<string[] | null> {
  if (!isTauri()) return null
  const { open } = await import('@tauri-apps/plugin-dialog')
  const r = await open({
    multiple: !!opts.multiple,
    directory: !!opts.directory,
    title: opts.title,
    filters: opts.extensions ? [{ name: opts.filterName ?? 'Files', extensions: opts.extensions }] : undefined,
  })
  if (r == null) return []
  return Array.isArray(r) ? r : [r]
}

export async function pickSavePath(opts: { title?: string; defaultName?: string; extensions?: string[] } = {}): Promise<string | null> {
  if (!isTauri()) return null
  const { save } = await import('@tauri-apps/plugin-dialog')
  const r = await save({
    title: opts.title,
    defaultPath: opts.defaultName,
    filters: opts.extensions ? [{ name: 'Disk image', extensions: opts.extensions }] : undefined,
  })
  return r ?? null
}

/** Subscribe to OS file drops (desktop only). Returns an unsubscribe function. */
export async function onFilesDropped(cb: (paths: string[]) => void, setHover?: (over: boolean) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined
  const { getCurrentWebview } = await import('@tauri-apps/api/webview')
  const un = await getCurrentWebview().onDragDropEvent((e) => {
    const p = e.payload
    if (p.type === 'over' || p.type === 'enter') setHover?.(true)
    else if (p.type === 'leave') setHover?.(false)
    else if (p.type === 'drop') {
      setHover?.(false)
      cb(p.paths)
    }
  })
  return un
}
