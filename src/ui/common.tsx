import { useEffect, type ReactNode } from 'react'

/* ------------------------------ ikony ------------------------------ */

const ICONS: Record<string, string> = {
  play: 'M8 5v14l11-7z',
  pause: 'M6 5h4v14H6zm8 0h4v14h-4z',
  stop: 'M6 6h12v12H6z',
  step: 'M6 5v14l7-7zM15 5h3v14h-3z',
  stepRung: 'M4 12h6m0-4v8m4-4h6',
  reset: 'M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 14h8v7H8z',
  open: 'M3 6h7l2 2h9v12H3z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3m-8 0 1 14h8l1-14',
  copy: 'M9 3h10v14H9zM5 7v14h10',
  up: 'M12 19V5m0 0-6 6m6-6 6 6',
  down: 'M12 5v14m0 0 6-6m-6 6-6-6',
  left: 'M19 12H5m0 0 6-6m-6 6 6 6',
  right: 'M5 12h14m0 0-6-6m6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'M6 6l12 12M18 6L6 18',
  gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6M4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6 1.4 1.4m0-11.4-1.4 1.4M7.7 16.3l-1.4 1.4',
  moon: 'M20 14a8 8 0 1 1-9-11 7 7 0 0 0 9 11z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4',
  ladder: 'M4 3v18M20 3v18M4 8h16M4 16h16M9 5v6M11 5v6',
  code: 'M8 6l-5 6 5 6m8-12 5 6-5 6',
  block: 'M4 6h7v12H4zM13 9h7v6h-7zM11 12h2',
  hmi: 'M3 4h18v13H3zM8 21h8m-4-4v4',
  vars: 'M4 6h16M4 12h16M4 18h10',
  io: 'M3 8h5l3-3v14l-3-3H3zM16 8a5 5 0 0 1 0 8',
  alarm: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6M10 20a2 2 0 0 0 4 0',
  lib: 'M4 5h5v14H4zM10 5h5v14h-5zM17 6l3 12',
  template: 'M3 4h18v4H3zM3 10h8v10H3zM13 10h8v10h-8z',
  export: 'M12 3v12m0-12 4 4m-4-4-8 4M4 15v5h16v-5',
  branch: 'M6 6v12M6 6h12M6 18h12M18 6v12',
  link: 'M8 12h8M12 8v8',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12m10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  lock: 'M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4',
  window: 'M3 4h18v16H3zM3 9h18',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14M20 20l-4-4',
  check: 'M5 13l4 4L19 7',
  warn: 'M12 4l9 16H3zM12 10v4m0 3v.5',
  chevron: 'M9 6l6 6-6 6',
  undo: 'M9 7H5V3M5 7a8 8 0 1 1 0 8',
  redo: 'M15 7h4V3m0 4a8 8 0 1 0 0 8',
  monitor: 'M3 4h18v12H3zM9 20h6m-3-4v4',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
}

export function Icon({ name, size = 16 }: { name: keyof typeof ICONS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      style={{ flex: 'none' }} aria-hidden>
      <path d={ICONS[name] ?? ICONS.block} />
    </svg>
  )
}

/* ------------------------------ modal ------------------------------ */

export function Modal({ title, children, onClose, footer, wide }: {
  title: ReactNode
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <span style={{ flex: 1 }}>{title}</span>
          <button className="ghost icon" onClick={onClose} aria-label="Zamknij"><Icon name="close" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/* ------------------------------ pola ------------------------------- */

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint" style={{ marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

export function Segmented<T extends string>({ value, options, onChange }: {
  value: T
  options: { value: T; label: string; title?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="row" style={{ gap: 2, background: 'var(--bg-input)', padding: 2, borderRadius: 6, border: '1px solid var(--border)' }}>
      {options.map((o) => (
        <button key={o.value} className={`sm ${value === o.value ? 'active' : 'ghost'}`}
          style={{ flex: 1, justifyContent: 'center' }} title={o.title}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, hint, action }: {
  icon?: string; title: string; hint?: string; action?: ReactNode
}) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-faint)' }}>
      {icon && <div style={{ marginBottom: 10, display: 'flex', justifyContent: 'center' }}><Icon name={icon} size={34} /></div>}
      <div style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 6 }}>{title}</div>
      {hint && <div className="hint" style={{ maxWidth: 420, margin: '0 auto 12px' }}>{hint}</div>}
      {action}
    </div>
  )
}
