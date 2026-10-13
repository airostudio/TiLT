import { useCallback, useEffect, useRef, useState } from 'react'
import { call, errorMessage } from '@/api/client'
import { Card } from '@/components/ui'
import { retroKey } from './retroKeys'

interface FrameReply {
  unchanged?: boolean
  seq: number
  width?: number
  height?: number
  png_base64?: string
}

type InputEvent =
  | { kind: 'key'; code: number; down: boolean }
  | { kind: 'mouse_move'; dx: number; dy: number }
  | { kind: 'mouse_button'; button: number; down: boolean }

const FRAME_INTERVAL_MS = 70

/** Pulls pictures from the embedded machine as fast as the backend can supply them (about 14 per second). */
function useFrames(active: boolean) {
  const [src, setSrc] = useState<string | null>(null)
  const [size, setSize] = useState<[number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!active) return
    let dead = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let seq: number | undefined
    const tick = async () => {
      if (dead) return
      if (document.visibilityState === 'visible') {
        try {
          const r = await call<FrameReply>('session_frame', seq === undefined ? {} : { since: seq })
          if (dead) return
          setError(null)
          if (!r.unchanged && r.png_base64) {
            seq = r.seq
            setSrc(`data:image/png;base64,${r.png_base64}`)
            if (r.width && r.height) setSize([r.width, r.height])
          }
        } catch (e) {
          if (!dead) setError(errorMessage(e))
        }
      }
      if (!dead) timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS)
    }
    void tick()
    return () => {
      dead = true
      if (timer) clearTimeout(timer)
    }
  }, [active])
  return { src, size, error }
}

/**
 * Sends keyboard and mouse input to the embedded machine. Events are batched (one backend call at most
 * every ~16 ms, mouse movement summed) so a fast mouse cannot flood the backend.
 */
function useInput(onError: (m: string) => void) {
  const queue = useRef<InputEvent[]>([])
  const move = useRef({ dx: 0, dy: 0 })
  const held = useRef(new Set<number>())
  const flushing = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>()

  const flush = useCallback(async () => {
    timer.current = undefined
    if (flushing.current) return
    const events = queue.current.splice(0)
    if (move.current.dx || move.current.dy) {
      events.push({ kind: 'mouse_move', dx: move.current.dx, dy: move.current.dy })
      move.current = { dx: 0, dy: 0 }
    }
    if (events.length === 0) return
    flushing.current = true
    try {
      await call('session_input', { events })
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      flushing.current = false
      if (queue.current.length || move.current.dx || move.current.dy) schedule()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onError])
  const schedule = useCallback(() => {
    if (!timer.current) timer.current = setTimeout(() => void flush(), 16)
  }, [flush])

  const key = useCallback(
    (code: number, down: boolean) => {
      if (down) held.current.add(code)
      else held.current.delete(code)
      queue.current.push({ kind: 'key', code, down })
      schedule()
    },
    [schedule],
  )
  const moveBy = useCallback(
    (dx: number, dy: number) => {
      move.current.dx += dx
      move.current.dy += dy
      schedule()
    },
    [schedule],
  )
  const button = useCallback(
    (button: number, down: boolean) => {
      queue.current.push({ kind: 'mouse_button', button, down })
      schedule()
    },
    [schedule],
  )
  /** Let go of everything that is held (focus lost): a stuck key in the guest is worse than a missed one. */
  const releaseAll = useCallback(() => {
    for (const code of held.current) queue.current.push({ kind: 'key', code, down: false })
    held.current.clear()
    queue.current.push({ kind: 'mouse_button', button: 0, down: false }, { kind: 'mouse_button', button: 1, down: false })
    schedule()
  }, [schedule])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )
  return { key, moveBy, button, releaseAll }
}

/** The machine's screen, drawn inside the app, with keyboard and mouse input. */
export function LiveScreen({ paused }: { paused: boolean }) {
  const { src, size, error } = useFrames(true)
  const [captured, setCaptured] = useState(false)
  const [inputError, setInputError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const input = useInput(setInputError)

  const release = () => {
    setCaptured(false)
    input.releaseAll()
    if (document.pointerLockElement === box.current) document.exitPointerLock()
  }

  const capture = () => {
    setCaptured(true)
    box.current?.focus()
    try {
      // Best effort: relative movement while the pointer is locked. Without it we still get movementX/Y.
      void Promise.resolve(box.current?.requestPointerLock?.()).catch(() => undefined)
    } catch {
      /* not available here */
    }
  }

  return (
    <Card title="Screen" className="preview-wrap">
      <div
        ref={box}
        className={`live-screen${captured ? ' captured' : ''}`}
        tabIndex={0}
        role="application"
        aria-label="Amiga screen. Click to type and use the mouse in the machine."
        data-testid="live-screen"
        data-captured={captured}
        onMouseDown={(e) => {
          if (!captured) {
            capture()
            return
          }
          input.button(e.button === 2 ? 1 : e.button === 1 ? 2 : 0, true)
        }}
        onMouseUp={(e) => captured && input.button(e.button === 2 ? 1 : e.button === 1 ? 2 : 0, false)}
        onMouseMove={(e) => captured && input.moveBy(e.movementX, e.movementY)}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (!captured) return
          // Ctrl+Alt gets the mouse back, like the emulator's own window.
          if (e.ctrlKey && e.altKey) {
            release()
            e.preventDefault()
            return
          }
          const code = retroKey(e.code)
          if (code !== null) {
            e.preventDefault()
            if (!e.repeat) input.key(code, true)
          }
        }}
        onKeyUp={(e) => {
          if (!captured) return
          const code = retroKey(e.code)
          if (code !== null) {
            e.preventDefault()
            input.key(code, false)
          }
        }}
        onBlur={() => captured && release()}
      >
        {src ? (
          <img
            src={src}
            alt="The Amiga's screen"
            draggable={false}
            data-testid="live-img"
            data-width={size?.[0]}
            data-height={size?.[1]}
          />
        ) : (
          <span className="live-wait">{error ? 'No picture available right now.' : 'Waiting for the first picture…'}</span>
        )}
        {paused && <span className="live-badge">Paused</span>}
      </div>
      <p className="preview-caption" data-testid="live-help">
        {captured ? (
          <>
            The keyboard and mouse now go to the Amiga. Press <span className="kbd">Ctrl</span> + <span className="kbd">Alt</span> together, or click outside the screen, to get them back.
          </>
        ) : (
          <>Click the screen to type and use the mouse in the Amiga.</>
        )}{' '}
        This runs the machine inside TiLT: there is no sound yet and no joystick, and pictures arrive about 14 times a second, so it is for working, not for judging timing-sensitive games.
      </p>
      {(error || inputError) && (
        <p className="small" style={{ color: 'var(--warning)' }} role="status">
          {error ?? inputError}
        </p>
      )}
    </Card>
  )
}
