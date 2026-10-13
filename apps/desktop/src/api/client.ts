// Transport to the backend. In the desktop app every call goes through the single
// allow-listed Tauri command `amiga`. In a browser (dev/e2e) it posts to the dev bridge
// which fronts the same Rust service, so the UI always talks to the REAL backend.

import type { ErrorDto, JobView } from './types'

export class ApiError extends Error {
  code: string
  constructor(e: ErrorDto) {
    super(e.message)
    this.code = e.code
  }
}

interface TauriGlobal {
  __TAURI_INTERNALS__?: unknown
}

export const isTauri = (): boolean => typeof window !== 'undefined' && !!(window as unknown as TauriGlobal).__TAURI_INTERNALS__

async function rawCall(cmd: string, args: unknown): Promise<unknown> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core')
    try {
      return await invoke('amiga', { cmd, args })
    } catch (e) {
      // the shell rejects with the ErrorDto the service produced
      if (e && typeof e === 'object' && 'code' in e && 'message' in e) throw new ApiError(e as ErrorDto)
      throw new ApiError({ code: 'internal', message: String(e) })
    }
  }
  let res: Response
  try {
    res = await fetch(`/api/${cmd}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args ?? {}) })
  } catch {
    throw new ApiError({ code: 'offline', message: 'The Amiga Studio backend is not reachable.' })
  }
  let body: { ok?: unknown; error?: ErrorDto }
  try {
    body = (await res.json()) as { ok?: unknown; error?: ErrorDto }
  } catch {
    // e.g. a static host answering 404 HTML: there is no backend behind this page
    throw new ApiError({ code: 'offline', message: 'The Amiga Studio backend is not reachable.' })
  }
  if (body.error) throw new ApiError(body.error)
  return body.ok
}

export function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return rawCall(cmd, args) as Promise<T>
}

/** Poll a background job until it finishes. Rejects on failure; `onProgress` gets updates. */
export async function waitForJob<R>(jobId: string, onProgress?: (j: JobView<R>) => void, intervalMs = 150): Promise<R> {
  for (;;) {
    const j = await call<JobView<R>>('job_get', { id: jobId })
    onProgress?.(j)
    if (j.state === 'done') return j.result as R
    if (j.state === 'failed') throw new ApiError(j.error ?? { code: 'internal', message: 'The operation failed.' })
    if (j.state === 'cancelled') throw new ApiError({ code: 'cancelled', message: 'The operation was cancelled.' })
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}

export interface JobOptions<R> {
  onProgress?: (j: JobView<R>) => void
  /** Called with the job id as soon as it starts (use it to offer Cancel). */
  onStart?: (jobId: string) => void
}

/** Start a job-returning command and await its result, with progress. */
export async function runJob<R>(cmd: string, args: Record<string, unknown>, opts: JobOptions<R> = {}): Promise<R> {
  const { job } = await call<{ job: string }>(cmd, args)
  opts.onStart?.(job)
  return waitForJob<R>(job, opts.onProgress)
}

export const cancelJob = (id: string): Promise<boolean> => call<boolean>('job_cancel', { id })

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e))
