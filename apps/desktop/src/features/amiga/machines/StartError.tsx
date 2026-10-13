import { Banner, Button } from '@/components/ui'

export interface StartFailure {
  code: string
  message: string
}

/** A readable explanation of why a machine did not start, with the fix one click away. */
export function StartError({ failure, onDismiss }: { failure: StartFailure; onDismiss?: () => void }) {
  const text = failure.message
  const engine = failure.code === 'not_found' && /engine|amiberry/i.test(text)
  const rom = /kickstart|\brom\b/i.test(text)
  return (
    <Banner
      tone="error"
      title="The machine did not start"
      actions={
        <div className="row" style={{ flexShrink: 0 }}>
          {engine && (
            <Button size="sm" onClick={() => (window.location.hash = '#/amiga/settings')}>
              Open Settings
            </Button>
          )}
          {rom && !engine && (
            <Button size="sm" onClick={() => (window.location.hash = '#/amiga/roms')}>
              Open ROM Library
            </Button>
          )}
          {onDismiss && (
            <Button size="sm" variant="ghost" onClick={onDismiss}>
              Dismiss
            </Button>
          )}
        </div>
      }
    >
      <span data-testid="start-error">{text}</span>
      {engine && <div className="small muted">Nothing was changed. Once the emulator engine (Amiberry) is installed or its location is set in Settings, try again.</div>}
    </Banner>
  )
}
