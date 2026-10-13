// Shared UI kit. Feature code imports from '@/components/ui'.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { Icon, type IconName } from './Icon'
import { canBrowse, onFilesDropped, pickPaths } from '@/lib/files'
import { cancelJob } from '@/api/client'
import type { JobView } from '@/api/types'

export { Icon } from './Icon'
export type { IconName } from './Icon'

// ---------- Button ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'md' | 'sm'
  icon?: IconName
  iconOnly?: boolean
}
export function Button({ variant = 'secondary', size = 'md', icon, iconOnly, className = '', children, type = 'button', ...rest }: BtnProps) {
  const cls = ['btn', variant === 'secondary' ? '' : variant, size === 'sm' ? 'sm' : '', iconOnly ? 'icon' : '', className].filter(Boolean).join(' ')
  return (
    <button type={type} className={cls} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  )
}

// ---------- Layout ----------
export function Page({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`page ${className}`}>{children}</div>
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div style={{ flex: 1, minWidth: 240 }}>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  )
}

export function Card({
  title,
  actions,
  children,
  className = '',
  ...rest
}: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string } & Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>) {
  return (
    <section className={`card ${className}`} {...rest}>
      {(title || actions) && (
        <div className="card-title">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Badge({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; children: ReactNode; title?: string }) {
  return (
    <span className={`badge ${tone === 'neutral' ? '' : tone}`} title={title}>
      {children}
    </span>
  )
}

export function StatusDot({ state }: { state: 'on' | 'off' | 'warn' | 'err' }) {
  return <span className={`dot ${state === 'on' ? 'on' : state === 'warn' ? 'warn' : state === 'err' ? 'err' : ''}`} aria-hidden="true" />
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

export function Banner({ tone = 'info', title, children, actions }: { tone?: 'info' | 'warning' | 'error' | 'success'; title?: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  const icon: IconName = tone === 'error' ? 'warn' : tone === 'warning' ? 'warn' : tone === 'success' ? 'check' : 'info'
  return (
    <div className={`banner ${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <Icon name={icon} />
      <div className="banner-body">
        {title && <div className="banner-title">{title}</div>}
        {children}
      </div>
      {actions}
    </div>
  )
}

export function Empty({ icon = 'box', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={32} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}

export function Spinner() {
  return <span className="spinner" role="status" aria-label="Loading" />
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="row muted" style={{ padding: 24 }}>
      <Spinner /> {label}
    </div>
  )
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <Banner tone="error">{error}</Banner> : null
}

// ---------- Forms ----------
export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function TextInput({ label, hint, ...rest }: { label?: ReactNode; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId()
  const input = <input id={id} className="input" {...rest} />
  return label ? (
    <Field label={label} hint={hint} htmlFor={id}>
      {input}
    </Field>
  ) : (
    input
  )
}

export function Select({ label, hint, children, ...rest }: { label?: ReactNode; hint?: ReactNode } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId()
  const sel = (
    <select id={id} className="select" {...rest}>
      {children}
    </select>
  )
  return label ? (
    <Field label={label} hint={hint} htmlFor={id}>
      {sel}
    </Field>
  ) : (
    sel
  )
}

export function TextArea({ label, hint, ...rest }: { label?: ReactNode; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const id = useId()
  const t = <textarea id={id} className="textarea" {...rest} />
  return label ? (
    <Field label={label} hint={hint} htmlFor={id}>
      {t}
    </Field>
  ) : (
    t
  )
}

export function Toggle({ label, checked, onChange, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="toggle">
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className="tab" onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---------- Progress ----------
export function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  return (
    <div
      className={`progress ${total === 0 ? 'indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuenow={total ? pct : undefined}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

/** Progress + Cancel for a running background job. */
export function JobProgress({ job, label, jobId }: { job: JobView | null; label: string; jobId?: string | null }) {
  const id = jobId ?? job?.id
  return (
    <div className="stack-sm" role="status" aria-live="polite">
      <div className="row">
        <Spinner />
        <span>{label}</span>
        <span className="spacer" />
        {job && job.total > 0 && <span className="muted small">{Math.round((job.done / job.total) * 100)}%</span>}
        {id && (
          <Button size="sm" variant="ghost" onClick={() => void cancelJob(id)}>
            Cancel
          </Button>
        )}
      </div>
      <ProgressBar done={job?.done ?? 0} total={job?.total ?? 0} label={label} />
    </div>
  )
}

// ---------- Modal ----------
export function Modal({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}

// ---------- Toasts + confirm ----------
type Toast = { id: number; tone: 'success' | 'error' | 'info'; text: string }
interface UiCtx {
  toast: (text: string, tone?: Toast['tone']) => void
  confirm: (o: { title: string; body: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>
}
const Ctx = createContext<UiCtx | null>(null)

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [dlg, setDlg] = useState<null | { title: string; body: ReactNode; confirmLabel: string; danger: boolean; resolve: (v: boolean) => void }>(null)
  const seq = useRef(0)
  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = ++seq.current
    setToasts((t) => [...t, { id, tone, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 8000 : 4500)
  }, [])
  const confirm = useCallback<UiCtx['confirm']>(
    (o) =>
      new Promise((resolve) => {
        setDlg({ title: o.title, body: o.body, confirmLabel: o.confirmLabel ?? 'Confirm', danger: !!o.danger, resolve })
      }),
    [],
  )
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])
  const done = (v: boolean) => {
    dlg?.resolve(v)
    setDlg(null)
  }
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
            {t.text}
          </div>
        ))}
      </div>
      {dlg && (
        <Modal
          title={dlg.title}
          onClose={() => done(false)}
          actions={
            <>
              <Button onClick={() => done(false)}>Cancel</Button>
              <Button variant={dlg.danger ? 'danger' : 'primary'} onClick={() => done(true)}>
                {dlg.confirmLabel}
              </Button>
            </>
          }
        >
          <div>{dlg.body}</div>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

export function useUi(): UiCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useUi must be used inside <UiProvider>')
  return c
}

// ---------- Path input & drop zone ----------
/** A path text box with a native Browse button on desktop. Browsers (dev/e2e) just type a path. */
export function PathInput({
  label,
  hint,
  value,
  onChange,
  directory,
  extensions,
  placeholder,
}: {
  label: ReactNode
  hint?: ReactNode
  value: string
  onChange: (v: string) => void
  directory?: boolean
  extensions?: string[]
  placeholder?: string
}) {
  const id = useId()
  return (
    <Field label={label} hint={hint} htmlFor={id}>
      <div className="row-nowrap">
        <input id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? (directory ? 'Folder path' : 'File path')} spellCheck={false} />
        {canBrowse() && (
          <Button
            icon="folder"
            onClick={async () => {
              const r = await pickPaths({ directory, extensions })
              if (r && r[0]) onChange(r[0])
            }}
          >
            Browse…
          </Button>
        )}
      </div>
    </Field>
  )
}

/** Accepts files dropped from the OS (desktop), a Browse button, or typed paths (browser). */
export function DropZone({
  onPaths,
  extensions,
  title,
  hint,
  multiple = true,
  disabled,
}: {
  onPaths: (paths: string[]) => void
  extensions?: string[]
  title: string
  hint?: ReactNode
  multiple?: boolean
  disabled?: boolean
}) {
  const [over, setOver] = useState(false)
  const [typed, setTyped] = useState('')
  const cb = useRef(onPaths)
  cb.current = onPaths
  useEffect(() => {
    let un: (() => void) | undefined
    let dead = false
    void onFilesDropped((p) => !disabled && cb.current(p), setOver).then((u) => {
      if (dead) u()
      else un = u
    })
    return () => {
      dead = true
      un?.()
    }
  }, [disabled])
  return (
    <div className={`dropzone ${over ? 'over' : ''}`} data-testid="dropzone">
      <div className="stack-sm" style={{ alignItems: 'center' }}>
        <Icon name="upload" size={28} />
        <strong>{title}</strong>
        {hint && <span className="small">{hint}</span>}
        {canBrowse() ? (
          <Button
            variant="primary"
            disabled={disabled}
            onClick={async () => {
              const r = await pickPaths({ multiple, extensions })
              if (r && r.length) onPaths(r)
            }}
          >
            Choose files…
          </Button>
        ) : (
          <form
            className="row-nowrap"
            style={{ width: '100%', maxWidth: 560 }}
            onSubmit={(e) => {
              e.preventDefault()
              const parts = typed.split('\n').map((s) => s.trim()).filter(Boolean)
              if (parts.length) {
                onPaths(parts)
                setTyped('')
              }
            }}
          >
            <input className="input" aria-label="File path" placeholder="Full path to a file on this computer" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={disabled} />
            <Button type="submit" variant="primary" disabled={disabled || !typed.trim()}>
              Import
            </Button>
          </form>
        )}
      </div>
    </div>
  )
}

// ---------- tiny helpers ----------
export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export function Table({ head, children, caption }: { head: ReactNode[]; children: ReactNode; caption?: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}
