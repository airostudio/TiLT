import { useCallback, useRef, useState } from 'react'
import { ApiError, runJob } from '@/api/client'
import type { JobView } from '@/api/types'

export interface JobRunner {
  /** The latest progress report of the running job (null before the first poll). */
  job: JobView | null
  jobId: string | null
  running: boolean
  /** Start a job-returning backend command and wait for it. Rejects with ApiError. */
  run: <R>(cmd: string, args: Record<string, unknown>) => Promise<R>
}

/** One background job at a time, with progress and an id for Cancel. */
export function useJob(): JobRunner {
  const [job, setJob] = useState<JobView | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const busy = useRef(false)

  const run = useCallback(async <R,>(cmd: string, args: Record<string, unknown>): Promise<R> => {
    if (busy.current) throw new ApiError({ code: 'locked', message: 'Another operation is still running' })
    busy.current = true
    setRunning(true)
    setJob(null)
    setJobId(null)
    try {
      return await runJob<R>(cmd, args, {
        onProgress: (j) => setJob(j as JobView),
        onStart: setJobId,
      })
    } finally {
      busy.current = false
      setRunning(false)
      setJob(null)
      setJobId(null)
    }
  }, [])

  return { job, jobId, running, run }
}

export const isCancelled = (e: unknown): boolean => e instanceof ApiError && e.code === 'cancelled'
