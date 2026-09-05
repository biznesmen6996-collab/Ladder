import type { ReactNode } from 'react'
import type { HmiWidget, PlcValue, WidgetKind } from '../core/types'
import { toBool, toNum } from '../core/blocks'

/* ------------------------------------------------------------------ */
/* Definicje komponentów HMI                                           */
/* ------------------------------------------------------------------ */

export interface BindDef { key: string; label: string; type: 'BOOL' | 'NUM' | 'ANY'; hint?: string }

export interface PropDef {
  key: string
  label: string
  type: 'text' | 'number' | 'color' | 'bool' | 'select'
  options?: { value: string; label: string }[]
  default: string | number | boolean
}

export interface RenderCtx {
  w: HmiWidget
  /** wartości podpiętych zmiennych wg roli */
  val: Record<string, PlcValue>
  /** zapis wartości do zmiennej (tryb pracy) */
  set: (role: string, v: PlcValue) => void
  /** true w trybie uruchomieniowym (widgety reagują na dotyk) */
  interactive: boolean
  /** rozmiar renderowania */
  width: number
  height: number
  /** aktywne alarmy (dla komponentu listy alarmów) */
  alarms?: { text: string; priority: string; clearedAt?: number }[]
}

export interface WidgetDef {
  kind: WidgetKind
  label: string
  category: string
  size: { w: number; h: number }
  bindings: BindDef[]
  props: PropDef[]
  render: (ctx: RenderCtx) => ReactNode
}

const p = (key: string, label: string, type: PropDef['type'], def: PropDef['default'], options?: PropDef['options']): PropDef =>
  ({ key, label, type, default: def, options })

const b = (key: string, label: string, type: BindDef['type'], hint?: string): BindDef => ({ key, label, type, hint })

const str = (w: HmiWidget, k: string, d = '') => String(w.props[k] ?? d)
const num = (w: HmiWidget, k: string, d = 0) => Number(w.props[k] ?? d)
const bool = (w: HmiWidget, k: string, d = false) => Boolean(w.props[k] ?? d)

const COLOR_PROPS = {
  on: p('colorOn', 'Kolor załączenia', 'color', '#3ddc84'),
  off: p('colorOff', 'Kolor wyłączenia', 'color', '#2c3644'),
}

const fmt = (v: number, decimals: number) =>
  Number.isFinite(v) ? v.toFixed(decimals) : '—'

const clamp01 = (v: number, lo: number, hi: number) =>
  hi === lo ? 0 : Math.max(0, Math.min(1, (v - lo) / (hi - lo)))

/* ------------------------------------------------------------------ */

const DEFS: WidgetDef[] = []
const def = (d: WidgetDef) => { DEFS.push(d); return d }

/* --------------------------- podstawowe ---------------------------- */

def({
  kind: 'label', label: 'Etykieta', category: 'Podstawowe',
  size: { w: 160, h: 32 },
  bindings: [b('text', 'Tekst dynamiczny', 'ANY', 'opcjonalnie — nadpisuje treść')],
  props: [
    p('text', 'Treść', 'text', 'Etykieta'),
    p('size', 'Rozmiar czcionki', 'number', 16),
    p('color', 'Kolor', 'color', '#e6edf3'),
    p('align', 'Wyrównanie', 'select', 'left', [
      { value: 'left', label: 'do lewej' }, { value: 'center', label: 'wyśrodkowane' }, { value: 'right', label: 'do prawej' },
    ]),
    p('bold', 'Pogrubienie', 'bool', false),
  ],
  render: ({ w, val }) => (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center',
      justifyContent: str(w, 'align', 'left') === 'center' ? 'center' : str(w, 'align') === 'right' ? 'flex-end' : 'flex-start',
      color: str(w, 'color', '#e6edf3'), fontSize: num(w, 'size', 16),
      fontWeight: bool(w, 'bold') ? 700 : 400, padding: '0 4px', overflow: 'hidden',
    }}>
      {val.text !== undefined && w.bind.text ? String(val.text) : str(w, 'text', 'Etykieta')}
    </div>
  ),
})

def({
  kind: 'panel', label: 'Ramka grupująca', category: 'Podstawowe',
  size: { w: 260, h: 180 },
  bindings: [],
  props: [
    p('title', 'Tytuł', 'text', 'Grupa'),
    p('bg', 'Tło', 'color', '#161e28'),
    p('border', 'Obramowanie', 'color', '#2f3d4f'),
  ],
  render: ({ w }) => (
    <div style={{
      width: '100%', height: '100%', border: `1px solid ${str(w, 'border', '#2f3d4f')}`,
      borderRadius: 8, background: str(w, 'bg', '#161e28'), padding: 8,
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#8b98a9' }}>
        {str(w, 'title', 'Grupa')}
      </div>
    </div>
  ),
})

def({
  kind: 'image', label: 'Symbol / emoji', category: 'Podstawowe',
  size: { w: 72, h: 72 },
  bindings: [b('visible', 'Widoczność', 'BOOL')],
  props: [p('glyph', 'Znak', 'text', '⚙️'), p('size', 'Rozmiar', 'number', 44)],
  render: ({ w, val }) => (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: num(w, 'size', 44), opacity: w.bind.visible && !toBool(val.visible) ? 0.18 : 1,
    }}>
      {str(w, 'glyph', '⚙️')}
    </div>
  ),
})

/* --------------------------- sterowanie ---------------------------- */

def({
  kind: 'button', label: 'Przycisk chwilowy', category: 'Sterowanie',
  size: { w: 120, h: 56 },
  bindings: [b('out', 'Zmienna sterowana', 'BOOL', 'zmienia się na czas naciśnięcia')],
  props: [
    p('text', 'Napis', 'text', 'START'),
    p('color', 'Kolor', 'color', '#2f9e5b'),
    p('shape', 'Kształt', 'select', 'round', [{ value: 'round', label: 'zaokrąglony' }, { value: 'circle', label: 'okrągły' }]),
    p('nc', 'Zestyk rozwierny (NC)', 'bool', false),
  ],
  render: ({ w, val, set, interactive }) => {
    // Zestyk rozwierny (typowy przycisk STOP): w spoczynku podaje TRUE,
    // a naciśnięcie przerywa obwód, czyli ustawia FALSE.
    const nc = bool(w, 'nc')
    const pressed = nc ? !toBool(val.out) : toBool(val.out)
    const circle = str(w, 'shape', 'round') === 'circle'
    const press = () => interactive && set('out', !nc)
    const release = () => interactive && set('out', nc)
    return (
      <button
        disabled={!interactive}
        onPointerDown={press}
        onPointerUp={release}
        onPointerCancel={release}
        onPointerLeave={() => { if (pressed) release() }}
        title={nc ? 'Zestyk rozwierny — naciśnięcie przerywa obwód' : undefined}
        style={{
          width: '100%', height: '100%', borderRadius: circle ? '50%' : 8,
          background: pressed ? str(w, 'color', '#2f9e5b') : `color-mix(in srgb, ${str(w, 'color', '#2f9e5b')} 62%, #05080d)`,
          border: `2px solid ${str(w, 'color', '#2f9e5b')}`, color: '#fff', fontWeight: 700,
          fontSize: 14, justifyContent: 'center',
          boxShadow: pressed ? `0 0 16px ${str(w, 'color', '#2f9e5b')}66` : 'none',
          transform: pressed ? 'translateY(1px)' : 'none',
          cursor: interactive ? 'pointer' : 'default', opacity: 1,
        }}
      >
        {str(w, 'text', 'START')}
      </button>
    )
  },
})

def({
  kind: 'toggle', label: 'Przełącznik', category: 'Sterowanie',
  size: { w: 110, h: 48 },
  bindings: [b('out', 'Zmienna sterowana', 'BOOL')],
  props: [p('text', 'Opis', 'text', ''), COLOR_PROPS.on],
  render: ({ w, val, set, interactive }) => {
    const on = toBool(val.out)
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 8 }}
        onClick={() => interactive && set('out', !on)}>
        <div style={{
          width: 52, height: 28, borderRadius: 14, flex: 'none',
          background: on ? str(w, 'colorOn', '#3ddc84') : '#39445485', position: 'relative',
          border: '1px solid #4a5768', transition: 'background 0.15s', cursor: interactive ? 'pointer' : 'default',
        }}>
          <div style={{
            position: 'absolute', top: 2, left: on ? 26 : 2, width: 22, height: 22, borderRadius: '50%',
            background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 4px rgba(0,0,0,.4)',
          }} />
        </div>
        {str(w, 'text') && <span style={{ color: '#c6d0dc', fontSize: 12 }}>{str(w, 'text')}</span>}
      </div>
    )
  },
})

def({
  kind: 'selector', label: 'Przełącznik pozycyjny', category: 'Sterowanie',
  size: { w: 180, h: 56 },
  bindings: [b('out', 'Zmienna (numer pozycji)', 'NUM')],
  props: [p('labels', 'Pozycje (po przecinku)', 'text', 'RĘCZNY,STOP,AUTO')],
  render: ({ w, val, set, interactive }) => {
    const labels = str(w, 'labels', 'RĘCZNY,STOP,AUTO').split(',').map((s) => s.trim())
    const cur = toNum(val.out)
    return (
      <div style={{ display: 'flex', width: '100%', height: '100%', gap: 2, background: '#0d131b', borderRadius: 8, padding: 3, border: '1px solid #2f3d4f' }}>
        {labels.map((l, i) => (
          <button key={i} disabled={!interactive} onClick={() => set('out', i)}
            style={{
              flex: 1, justifyContent: 'center', fontSize: 11, fontWeight: 600, borderRadius: 5,
              background: cur === i ? '#4c9aff' : 'transparent', color: cur === i ? '#fff' : '#8b98a9',
              border: 'none', minHeight: 0,
            }}>
            {l}
          </button>
        ))}
      </div>
    )
  },
})

def({
  kind: 'slider', label: 'Suwak nastawy', category: 'Sterowanie',
  size: { w: 220, h: 62 },
  bindings: [b('out', 'Zmienna nastawy', 'NUM')],
  props: [
    p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100),
    p('step', 'Krok', 'number', 1), p('unit', 'Jednostka', 'text', '%'),
    p('label', 'Opis', 'text', 'Nastawa'),
  ],
  render: ({ w, val, set, interactive }) => (
    <div style={{ width: '100%', height: '100%', padding: 4 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8b98a9', marginBottom: 2 }}>
        <span>{str(w, 'label', 'Nastawa')}</span>
        <span style={{ fontFamily: 'var(--mono)', color: '#e6edf3' }}>
          {fmt(toNum(val.out), num(w, 'step', 1) < 1 ? 2 : 0)} {str(w, 'unit', '%')}
        </span>
      </div>
      <input type="range" disabled={!interactive}
        min={num(w, 'min', 0)} max={num(w, 'max', 100)} step={num(w, 'step', 1)}
        value={toNum(val.out)} onChange={(e) => set('out', Number(e.target.value))}
        style={{ width: '100%' }} />
    </div>
  ),
})

def({
  kind: 'input', label: 'Pole wprowadzania', category: 'Sterowanie',
  size: { w: 150, h: 56 },
  bindings: [b('out', 'Zmienna', 'NUM')],
  props: [p('label', 'Opis', 'text', 'Zadana'), p('unit', 'Jednostka', 'text', '°C'), p('decimals', 'Miejsca dziesiętne', 'number', 1)],
  render: ({ w, val, set, interactive }) => (
    <div style={{ width: '100%', height: '100%', padding: 3 }}>
      <div style={{ fontSize: 10.5, color: '#8b98a9' }}>{str(w, 'label', 'Zadana')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <input type="number" disabled={!interactive} value={toNum(val.out)}
          onChange={(e) => set('out', Number(e.target.value))}
          style={{ fontFamily: 'var(--mono)', minHeight: 28, padding: '2px 6px' }} />
        <span style={{ fontSize: 11, color: '#8b98a9' }}>{str(w, 'unit', '°C')}</span>
      </div>
    </div>
  ),
})

/* --------------------------- sygnalizacja -------------------------- */

def({
  kind: 'lamp', label: 'Lampka sygnalizacyjna', category: 'Sygnalizacja',
  size: { w: 76, h: 76 },
  bindings: [b('in', 'Zmienna', 'BOOL')],
  props: [p('color', 'Kolor', 'color', '#3ddc84'), p('text', 'Opis', 'text', ''), p('blink', 'Miganie przy załączeniu', 'bool', false)],
  render: ({ w, val }) => {
    const on = toBool(val.in)
    const c = str(w, 'color', '#3ddc84')
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
        <svg viewBox="0 0 60 60" style={{ width: '72%', height: '72%' }}>
          <defs>
            <radialGradient id={`lamp-${w.id}`}>
              <stop offset="0%" stopColor={on ? '#fff' : '#0000'} stopOpacity={on ? 0.85 : 0} />
              <stop offset="55%" stopColor={c} stopOpacity={on ? 1 : 0.16} />
              <stop offset="100%" stopColor={c} stopOpacity={on ? 0.85 : 0.1} />
            </radialGradient>
          </defs>
          <circle cx="30" cy="30" r="24" fill={`url(#lamp-${w.id})`} stroke={on ? c : '#44526488'} strokeWidth="3"
            style={on && bool(w, 'blink') ? { animation: 'pulse 0.7s infinite' } : undefined} />
          {on && <circle cx="30" cy="30" r="27" fill="none" stroke={c} strokeWidth="1" opacity="0.35" />}
        </svg>
        {str(w, 'text') && <div style={{ fontSize: 10.5, color: '#8b98a9' }}>{str(w, 'text')}</div>}
      </div>
    )
  },
})

def({
  kind: 'stack-light', label: 'Kolumna sygnalizacyjna', category: 'Sygnalizacja',
  size: { w: 56, h: 160 },
  bindings: [b('red', 'Czerwona', 'BOOL'), b('yellow', 'Żółta', 'BOOL'), b('green', 'Zielona', 'BOOL'), b('blue', 'Niebieska', 'BOOL')],
  props: [],
  render: ({ w, val }) => {
    const lamps: [string, string][] = [['red', '#f4586a'], ['yellow', '#f5a524'], ['green', '#3ddc84'], ['blue', '#4c9aff']]
    const active = lamps.filter(([k]) => w.bind[k])
    const list = active.length ? active : lamps.slice(0, 3)
    return (
      <svg viewBox={`0 0 40 ${list.length * 28 + 16}`} style={{ width: '100%', height: '100%' }}>
        {list.map(([k, c], i) => {
          const on = toBool(val[k])
          return (
            <rect key={k} x="6" y={4 + i * 28} width="28" height="24" rx="4"
              fill={on ? c : '#222b36'} stroke={on ? c : '#3a4656'} strokeWidth="1.5"
              opacity={on ? 1 : 0.5} style={on ? { filter: `drop-shadow(0 0 6px ${c})` } : undefined} />
          )
        })}
        <rect x="12" y={4 + list.length * 28} width="16" height="12" fill="#4a5768" rx="2" />
      </svg>
    )
  },
})

def({
  kind: 'traffic', label: 'Sygnalizator drogowy', category: 'Sygnalizacja',
  size: { w: 64, h: 150 },
  bindings: [b('red', 'Czerwone', 'BOOL'), b('yellow', 'Żółte', 'BOOL'), b('green', 'Zielone', 'BOOL')],
  props: [],
  render: ({ val }) => (
    <svg viewBox="0 0 50 130" style={{ width: '100%', height: '100%' }}>
      <rect x="4" y="4" width="42" height="122" rx="8" fill="#1a222c" stroke="#39445485" strokeWidth="2" />
      {([['red', '#f4586a', 26], ['yellow', '#f5a524', 65], ['green', '#3ddc84', 104]] as const).map(([k, c, cy]) => {
        const on = toBool(val[k])
        return <circle key={k} cx="25" cy={cy} r="15" fill={on ? c : '#2a3441'} opacity={on ? 1 : 0.6}
          style={on ? { filter: `drop-shadow(0 0 9px ${c})` } : undefined} />
      })}
    </svg>
  ),
})

def({
  kind: 'led-bar', label: 'Linijka LED', category: 'Sygnalizacja',
  size: { w: 200, h: 40 },
  bindings: [b('in', 'Wartość', 'NUM')],
  props: [p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100), p('count', 'Liczba diod', 'number', 12)],
  render: ({ w, val }) => {
    const n = Math.max(3, num(w, 'count', 12))
    const f = clamp01(toNum(val.in), num(w, 'min', 0), num(w, 'max', 100))
    const lit = Math.round(f * n)
    return (
      <div style={{ display: 'flex', gap: 3, width: '100%', height: '100%', alignItems: 'stretch' }}>
        {Array.from({ length: n }, (_, i) => {
          const on = i < lit
          const c = i / n > 0.85 ? '#f4586a' : i / n > 0.65 ? '#f5a524' : '#3ddc84'
          return <div key={i} style={{
            flex: 1, borderRadius: 3, background: on ? c : '#232c38',
            boxShadow: on ? `0 0 6px ${c}88` : 'none', border: '1px solid #2f3d4f',
          }} />
        })}
      </div>
    )
  },
})

def({
  kind: 'seg7', label: 'Wyświetlacz 7-segmentowy', category: 'Sygnalizacja',
  size: { w: 150, h: 62 },
  bindings: [b('in', 'Wartość', 'NUM')],
  props: [p('digits', 'Liczba cyfr', 'number', 4), p('decimals', 'Miejsca dziesiętne', 'number', 0), p('color', 'Kolor', 'color', '#f4586a')],
  render: ({ w, val }) => {
    const d = num(w, 'decimals', 0)
    const text = fmt(toNum(val.in), d).padStart(num(w, 'digits', 4) + (d ? d + 1 : 0), ' ')
    return (
      <div style={{
        width: '100%', height: '100%', background: '#0a0e14', border: '2px solid #232c38', borderRadius: 6,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 700, letterSpacing: 3,
        color: str(w, 'color', '#f4586a'), textShadow: `0 0 12px ${str(w, 'color', '#f4586a')}99`,
      }}>
        {text}
      </div>
    )
  },
})

/* --------------------------- pomiary ------------------------------- */

def({
  kind: 'numeric', label: 'Odczyt wartości', category: 'Pomiary',
  size: { w: 150, h: 64 },
  bindings: [b('in', 'Zmienna', 'ANY')],
  props: [
    p('label', 'Opis', 'text', 'Pomiar'), p('unit', 'Jednostka', 'text', '°C'),
    p('decimals', 'Miejsca dziesiętne', 'number', 1), p('color', 'Kolor', 'color', '#4c9aff'),
  ],
  render: ({ w, val }) => (
    <div style={{
      width: '100%', height: '100%', background: '#131b25', border: '1px solid #2b3746',
      borderRadius: 8, padding: '5px 9px', display: 'flex', flexDirection: 'column', justifyContent: 'center',
    }}>
      <div style={{ fontSize: 10.5, color: '#8b98a9' }}>{str(w, 'label', 'Pomiar')}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: str(w, 'color', '#4c9aff') }}>
          {typeof val.in === 'boolean' ? (val.in ? 'TRUE' : 'FALSE') : fmt(toNum(val.in), num(w, 'decimals', 1))}
        </span>
        <span style={{ fontSize: 11, color: '#8b98a9' }}>{str(w, 'unit', '°C')}</span>
      </div>
    </div>
  ),
})

def({
  kind: 'gauge', label: 'Wskaźnik zegarowy', category: 'Pomiary',
  size: { w: 160, h: 140 },
  bindings: [b('in', 'Wartość', 'NUM'), b('sp', 'Wartość zadana', 'NUM')],
  props: [
    p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100),
    p('unit', 'Jednostka', 'text', '%'), p('label', 'Opis', 'text', ''),
    p('warn', 'Próg ostrzegawczy (%)', 'number', 75), p('alarm', 'Próg alarmowy (%)', 'number', 90),
  ],
  render: ({ w, val }) => {
    const lo = num(w, 'min', 0), hi = num(w, 'max', 100)
    const f = clamp01(toNum(val.in), lo, hi)
    const A0 = -220, A1 = 40
    const ang = (t: number) => (A0 + t * (A1 - A0)) * Math.PI / 180
    const pt = (t: number, r: number) => [50 + r * Math.cos(ang(t)), 50 + r * Math.sin(ang(t))]
    const arc = (t0: number, t1: number, r: number) => {
      const [x0, y0] = pt(t0, r), [x1, y1] = pt(t1, r)
      return `M ${x0} ${y0} A ${r} ${r} 0 ${t1 - t0 > 0.5 ? 1 : 0} 1 ${x1} ${y1}`
    }
    const warn = num(w, 'warn', 75) / 100, alarm = num(w, 'alarm', 90) / 100
    const color = f >= alarm ? '#f4586a' : f >= warn ? '#f5a524' : '#4c9aff'
    const [nx, ny] = pt(f, 32)
    const spF = w.bind.sp ? clamp01(toNum(val.sp), lo, hi) : null
    return (
      <svg viewBox="0 0 100 92" style={{ width: '100%', height: '100%' }}>
        <path d={arc(0, 1, 38)} fill="none" stroke="#232c38" strokeWidth="9" strokeLinecap="round" />
        <path d={arc(warn, alarm, 38)} fill="none" stroke="#f5a52455" strokeWidth="9" />
        <path d={arc(alarm, 1, 38)} fill="none" stroke="#f4586a55" strokeWidth="9" />
        {f > 0.004 && <path d={arc(0, f, 38)} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />}
        {spF !== null && (() => { const [sx, sy] = pt(spF, 38); const [ix, iy] = pt(spF, 30)
          return <line x1={ix} y1={iy} x2={sx} y2={sy} stroke="#e6edf3" strokeWidth="2" /> })()}
        <line x1="50" y1="50" x2={nx} y2={ny} stroke={color} strokeWidth="2.5" strokeLinecap="round" />
        <circle cx="50" cy="50" r="4" fill={color} />
        <text x="50" y="70" textAnchor="middle" fontSize="15" fontWeight="700" fill="#e6edf3" fontFamily="var(--mono)">
          {fmt(toNum(val.in), 1)}
        </text>
        <text x="50" y="81" textAnchor="middle" fontSize="8" fill="#8b98a9">
          {str(w, 'unit', '%')}{str(w, 'label') ? ` • ${str(w, 'label')}` : ''}
        </text>
      </svg>
    )
  },
})

def({
  kind: 'bar', label: 'Słupek pomiarowy', category: 'Pomiary',
  size: { w: 70, h: 170 },
  bindings: [b('in', 'Wartość', 'NUM')],
  props: [
    p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100),
    p('unit', 'Jednostka', 'text', '%'), p('color', 'Kolor', 'color', '#4c9aff'),
    p('horizontal', 'Poziomy', 'bool', false),
  ],
  render: ({ w, val }) => {
    const f = clamp01(toNum(val.in), num(w, 'min', 0), num(w, 'max', 100))
    const horiz = bool(w, 'horizontal')
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{
          flex: 1, background: '#131b25', border: '1px solid #2b3746', borderRadius: 5,
          display: 'flex', alignItems: horiz ? 'stretch' : 'flex-end', overflow: 'hidden', padding: 2,
        }}>
          <div style={{
            width: horiz ? `${f * 100}%` : '100%', height: horiz ? '100%' : `${f * 100}%`,
            background: `linear-gradient(${horiz ? '90deg' : '0deg'}, ${str(w, 'color', '#4c9aff')}, ${str(w, 'color', '#4c9aff')}aa)`,
            borderRadius: 3, transition: 'all 0.12s',
          }} />
        </div>
        <div style={{ textAlign: 'center', fontSize: 10.5, fontFamily: 'var(--mono)', color: '#c6d0dc' }}>
          {fmt(toNum(val.in), 1)} {str(w, 'unit', '%')}
        </div>
      </div>
    )
  },
})

def({
  kind: 'trend', label: 'Wykres przebiegu', category: 'Pomiary',
  size: { w: 320, h: 160 },
  bindings: [b('in', 'Zmienna 1', 'NUM'), b('in2', 'Zmienna 2', 'NUM'), b('in3', 'Zmienna 3', 'NUM')],
  props: [p('label', 'Tytuł', 'text', 'Trend'), p('points', 'Liczba próbek', 'number', 120),
    p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100)],
  render: ({ w, val }) => <MiniTrend w={w} val={val} />,
})

/* Bufory przebiegów dla widgetów trendu — trzymane poza stanem Reacta. */
const trendBuffers = new Map<string, number[][]>()

function MiniTrend({ w, val }: { w: HmiWidget; val: Record<string, PlcValue> }) {
  const cap = Math.max(20, num(w, 'points', 120))
  let buf = trendBuffers.get(w.id)
  if (!buf) { buf = [[], [], []]; trendBuffers.set(w.id, buf) }
  const keys = ['in', 'in2', 'in3']
  keys.forEach((k, i) => {
    if (!w.bind[k]) return
    buf![i].push(toNum(val[k]))
    if (buf![i].length > cap) buf![i].shift()
  })
  const lo = num(w, 'min', 0), hi = num(w, 'max', 100)
  const colors = ['#4c9aff', '#3ddc84', '#f5a524']
  return (
    <div style={{ width: '100%', height: '100%', background: '#101720', border: '1px solid #2b3746', borderRadius: 8, padding: 6 }}>
      <div style={{ fontSize: 10.5, color: '#8b98a9', marginBottom: 2 }}>{str(w, 'label', 'Trend')}</div>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" style={{ width: '100%', height: 'calc(100% - 16px)' }}>
        {[0, 0.5, 1].map((f) => <line key={f} x1="0" y1={f * 100} x2="300" y2={f * 100} stroke="#1e2732" strokeWidth="1" />)}
        {buf.map((series, i) => series.length > 1 && (
          <polyline key={i} fill="none" stroke={colors[i]} strokeWidth="1.6" vectorEffect="non-scaling-stroke"
            points={series.map((v, j) =>
              `${(j / Math.max(1, cap - 1)) * 300},${100 - clamp01(v, lo, hi) * 100}`).join(' ')} />
        ))}
      </svg>
    </div>
  )
}

def({
  kind: 'alarms', label: 'Lista alarmów', category: 'Pomiary',
  size: { w: 340, h: 160 },
  bindings: [],
  props: [p('label', 'Tytuł', 'text', 'Alarmy aktywne')],
  render: ({ w, alarms }) => {
    const active = (alarms ?? []).filter((a) => !a.clearedAt).slice(0, 8)
    return (
      <div style={{ width: '100%', height: '100%', background: '#101720', border: '1px solid #2b3746', borderRadius: 8, padding: 6, overflow: 'hidden' }}>
        <div style={{ fontSize: 10.5, color: '#8b98a9', marginBottom: 4 }}>{str(w, 'label', 'Alarmy aktywne')}</div>
        <div style={{ fontSize: 11.5, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {active.length === 0
            ? <span style={{ color: '#5b6879' }}>Brak aktywnych alarmów</span>
            : active.map((a, i) => (
              <div key={i} style={{
                display: 'flex', gap: 6, alignItems: 'center', padding: '2px 5px', borderRadius: 4,
                background: a.priority === 'critical' ? '#f4586a22' : a.priority === 'warning' ? '#f5a52422' : '#4c9aff22',
                color: a.priority === 'critical' ? '#f4586a' : a.priority === 'warning' ? '#f5a524' : '#8ec0ff',
              }}>
                <span>●</span><span style={{ color: '#c6d0dc' }}>{a.text}</span>
              </div>
            ))}
        </div>
      </div>
    )
  },
})

/* --------------------------- technologiczne ------------------------ */

def({
  kind: 'tank', label: 'Zbiornik', category: 'Technologia',
  size: { w: 130, h: 190 },
  bindings: [b('level', 'Poziom', 'NUM'), b('alarmHi', 'Alarm górny', 'BOOL'), b('alarmLo', 'Alarm dolny', 'BOOL')],
  props: [
    p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100),
    p('unit', 'Jednostka', 'text', '%'), p('color', 'Kolor cieczy', 'color', '#38bdf8'),
    p('label', 'Nazwa', 'text', 'Zbiornik'),
  ],
  render: ({ w, val }) => {
    const f = clamp01(toNum(val.level), num(w, 'min', 0), num(w, 'max', 100))
    const hi = toBool(val.alarmHi), lo = toBool(val.alarmLo)
    const liquidTop = 20 + (1 - f) * 70
    return (
      <svg viewBox="0 0 100 120" style={{ width: '100%', height: '100%' }}>
        <rect x="18" y="18" width="64" height="74" rx="4" fill="#0d141c" stroke={hi ? '#f4586a' : lo ? '#f5a524' : '#4a5768'} strokeWidth="2.5" />
        <clipPath id={`tank-${w.id}`}><rect x="20" y="20" width="60" height="70" rx="3" /></clipPath>
        <g clipPath={`url(#tank-${w.id})`}>
          <rect x="20" y={liquidTop} width="60" height={90 - liquidTop + 2} fill={str(w, 'color', '#38bdf8')} opacity="0.85" />
          <path d={`M 20 ${liquidTop} q 7.5 -3 15 0 t 15 0 t 15 0 t 15 0 v 6 H 20 Z`} fill={str(w, 'color', '#38bdf8')} />
        </g>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1="72" y1={20 + (1 - t) * 70} x2="82" y2={20 + (1 - t) * 70} stroke="#6b788a" strokeWidth="1" />
        ))}
        <rect x="40" y="92" width="20" height="8" fill="#394454" stroke="#4a5768" strokeWidth="1.5" />
        <text x="50" y="12" textAnchor="middle" fontSize="9" fill="#8b98a9">{str(w, 'label', 'Zbiornik')}</text>
        <text x="50" y="110" textAnchor="middle" fontSize="11" fontWeight="700" fill="#e6edf3" fontFamily="var(--mono)">
          {fmt(toNum(val.level), 1)} {str(w, 'unit', '%')}
        </text>
        {hi && <circle cx="86" cy="24" r="4" fill="#f4586a" />}
        {lo && <circle cx="86" cy="86" r="4" fill="#f5a524" />}
      </svg>
    )
  },
})

def({
  kind: 'silo', label: 'Silos', category: 'Technologia',
  size: { w: 120, h: 190 },
  bindings: [b('level', 'Poziom', 'NUM')],
  props: [p('min', 'Minimum', 'number', 0), p('max', 'Maksimum', 'number', 100),
    p('color', 'Kolor materiału', 'color', '#c98b3f'), p('label', 'Nazwa', 'text', 'Silos')],
  render: ({ w, val }) => {
    const f = clamp01(toNum(val.level), num(w, 'min', 0), num(w, 'max', 100))
    const top = 18 + (1 - f) * 62
    return (
      <svg viewBox="0 0 100 120" style={{ width: '100%', height: '100%' }}>
        <path d="M 22 16 H 78 V 80 L 50 106 L 22 80 Z" fill="#0d141c" stroke="#4a5768" strokeWidth="2.5" />
        <clipPath id={`silo-${w.id}`}><path d="M 24 18 H 76 V 79 L 50 103 L 24 79 Z" /></clipPath>
        <rect clipPath={`url(#silo-${w.id})`} x="24" y={top} width="52" height={106 - top} fill={str(w, 'color', '#c98b3f')} opacity="0.9" />
        <text x="50" y="11" textAnchor="middle" fontSize="9" fill="#8b98a9">{str(w, 'label', 'Silos')}</text>
        <text x="50" y="118" textAnchor="middle" fontSize="10" fontWeight="700" fill="#e6edf3" fontFamily="var(--mono)">
          {fmt(toNum(val.level), 0)}%
        </text>
      </svg>
    )
  },
})

def({
  kind: 'motor', label: 'Silnik', category: 'Technologia',
  size: { w: 100, h: 100 },
  bindings: [b('run', 'Praca', 'BOOL'), b('fault', 'Awaria', 'BOOL')],
  props: [p('label', 'Oznaczenie', 'text', 'M1')],
  render: ({ w, val }) => {
    const run = toBool(val.run), fault = toBool(val.fault)
    const c = fault ? '#f4586a' : run ? '#3ddc84' : '#5b6879'
    return (
      <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
        <circle cx="40" cy="38" r="26" fill="#131b25" stroke={c} strokeWidth="3" />
        <g style={run && !fault ? { transformOrigin: '40px 38px', animation: 'spin 1.1s linear infinite' } : undefined}>
          <line x1="40" y1="18" x2="40" y2="58" stroke={c} strokeWidth="2.5" />
          <line x1="20" y1="38" x2="60" y2="38" stroke={c} strokeWidth="2.5" />
        </g>
        <circle cx="40" cy="38" r="5" fill={c} />
        <text x="40" y="76" textAnchor="middle" fontSize="11" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'M1')}
        </text>
        {fault && <text x="66" y="18" fontSize="14">⚠</text>}
      </svg>
    )
  },
})

def({
  kind: 'pump', label: 'Pompa', category: 'Technologia',
  size: { w: 100, h: 100 },
  bindings: [b('run', 'Praca', 'BOOL'), b('fault', 'Awaria', 'BOOL')],
  props: [p('label', 'Oznaczenie', 'text', 'P1')],
  render: ({ w, val }) => {
    const run = toBool(val.run), fault = toBool(val.fault)
    const c = fault ? '#f4586a' : run ? '#3ddc84' : '#5b6879'
    return (
      <svg viewBox="0 0 80 80" style={{ width: '100%', height: '100%' }}>
        <circle cx="40" cy="38" r="24" fill="#131b25" stroke={c} strokeWidth="3" />
        <g style={run && !fault ? { transformOrigin: '40px 38px', animation: 'spin 0.55s linear infinite' } : undefined}>
          <path d="M 40 38 L 40 18 A 20 20 0 0 1 57 48 Z" fill={c} opacity="0.8" />
          <path d="M 40 38 L 57 48 A 20 20 0 0 1 23 48 Z" fill={c} opacity="0.55" />
          <path d="M 40 38 L 23 48 A 20 20 0 0 1 40 18 Z" fill={c} opacity="0.35" />
        </g>
        <rect x="14" y="33" width="10" height="10" fill="#394454" stroke={c} strokeWidth="1.5" />
        <rect x="56" y="24" width="10" height="10" fill="#394454" stroke={c} strokeWidth="1.5" />
        <text x="40" y="76" textAnchor="middle" fontSize="11" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'P1')}
        </text>
      </svg>
    )
  },
})

def({
  kind: 'valve', label: 'Zawór', category: 'Technologia',
  size: { w: 100, h: 80 },
  bindings: [b('open', 'Otwarty', 'BOOL'), b('cmd', 'Sterowanie', 'BOOL')],
  props: [p('label', 'Oznaczenie', 'text', 'V1'), p('type', 'Rodzaj', 'select', 'onoff', [
    { value: 'onoff', label: 'dwustawny' }, { value: 'check', label: 'zwrotny' },
  ])],
  render: ({ w, val, set, interactive }) => {
    const open = toBool(val.open)
    const c = open ? '#3ddc84' : '#5b6879'
    return (
      <svg viewBox="0 0 80 64" style={{ width: '100%', height: '100%', cursor: interactive && w.bind.cmd ? 'pointer' : 'default' }}
        onClick={() => interactive && w.bind.cmd && set('cmd', !toBool(val.cmd))}>
        <line x1="0" y1="30" x2="18" y2="30" stroke="#4a5768" strokeWidth="5" />
        <line x1="62" y1="30" x2="80" y2="30" stroke="#4a5768" strokeWidth="5" />
        <path d="M 20 14 L 40 30 L 20 46 Z" fill={open ? c : '#1a222c'} stroke={c} strokeWidth="2.5" />
        <path d="M 60 14 L 40 30 L 60 46 Z" fill={open ? c : '#1a222c'} stroke={c} strokeWidth="2.5" />
        <rect x="35" y="2" width="10" height="12" fill={c} rx="2" />
        <text x="40" y="61" textAnchor="middle" fontSize="10" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'V1')}
        </text>
      </svg>
    )
  },
})

def({
  kind: 'cylinder', label: 'Siłownik pneumatyczny', category: 'Technologia',
  size: { w: 180, h: 70 },
  bindings: [b('extend', 'Wysunięty', 'BOOL'), b('pos', 'Pozycja 0-100', 'NUM')],
  props: [p('label', 'Oznaczenie', 'text', 'C1')],
  render: ({ w, val }) => {
    const f = w.bind.pos ? clamp01(toNum(val.pos), 0, 100) : (toBool(val.extend) ? 1 : 0)
    const rod = 60 + f * 60
    return (
      <svg viewBox="0 0 160 56" style={{ width: '100%', height: '100%' }}>
        <rect x="6" y="12" width="60" height="32" rx="3" fill="#131b25" stroke="#4a5768" strokeWidth="2" />
        <rect x="10" y="16" width={4 + f * 48} height="24" fill="#4c9aff" opacity="0.28" />
        <line x1="66" y1="28" x2={rod} y2="28" stroke="#8b98a9" strokeWidth="6" strokeLinecap="round" />
        <rect x={rod} y="16" width="10" height="24" rx="2" fill="#5b6879" />
        <text x="36" y="53" textAnchor="middle" fontSize="10" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'C1')}
        </text>
      </svg>
    )
  },
})

def({
  kind: 'conveyor', label: 'Przenośnik taśmowy', category: 'Technologia',
  size: { w: 240, h: 80 },
  bindings: [b('run', 'Praca', 'BOOL'), b('reverse', 'Kierunek wstecz', 'BOOL')],
  props: [p('label', 'Oznaczenie', 'text', 'T1'), p('speed', 'Prędkość animacji', 'number', 1)],
  render: ({ w, val }) => {
    const run = toBool(val.run)
    const rev = toBool(val.reverse)
    const dur = Math.max(0.2, 1.6 / Math.max(0.1, num(w, 'speed', 1)))
    return (
      <svg viewBox="0 0 200 64" style={{ width: '100%', height: '100%' }}>
        <rect x="10" y="20" width="180" height="20" rx="10" fill="#131b25" stroke={run ? '#3ddc84' : '#4a5768'} strokeWidth="2" />
        <circle cx="22" cy="30" r="9" fill="#1a222c" stroke={run ? '#3ddc84' : '#4a5768'} strokeWidth="2" />
        <circle cx="178" cy="30" r="9" fill="#1a222c" stroke={run ? '#3ddc84' : '#4a5768'} strokeWidth="2" />
        <g clipPath="url(#conv-clip)">
          <clipPath id="conv-clip"><rect x="12" y="22" width="176" height="16" /></clipPath>
          {Array.from({ length: 12 }, (_, i) => (
            <rect key={i} x={16 + i * 15} y="24" width="7" height="12" rx="2" fill={run ? '#3ddc8455' : '#2a3441'}>
              {run && (
                <animate attributeName="x" from={16 + i * 15} to={16 + i * 15 + (rev ? -15 : 15)}
                  dur={`${dur}s`} repeatCount="indefinite" />
              )}
            </rect>
          ))}
        </g>
        <text x="100" y="58" textAnchor="middle" fontSize="10" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'T1')} {run ? (rev ? '◀' : '▶') : '■'}
        </text>
      </svg>
    )
  },
})

def({
  kind: 'pipe', label: 'Rurociąg', category: 'Technologia',
  size: { w: 180, h: 34 },
  bindings: [b('flow', 'Przepływ', 'BOOL')],
  props: [
    p('color', 'Kolor medium', 'color', '#38bdf8'),
    p('vertical', 'Pionowy', 'bool', false),
  ],
  render: ({ w, val }) => {
    const flow = toBool(val.flow)
    const c = str(w, 'color', '#38bdf8')
    const vert = bool(w, 'vertical')
    return (
      <svg viewBox={vert ? '0 0 30 160' : '0 0 160 30'} preserveAspectRatio="none" style={{ width: '100%', height: '100%' }}>
        <rect x={vert ? 8 : 0} y={vert ? 0 : 8} width={vert ? 14 : 160} height={vert ? 160 : 14}
          fill={flow ? c : '#1a222c'} opacity={flow ? 0.75 : 1} stroke="#4a5768" strokeWidth="1.5" />
        {flow && Array.from({ length: 5 }, (_, i) => (
          <circle key={i} cx={vert ? 15 : i * 34 + 12} cy={vert ? i * 34 + 12 : 15} r="3" fill="#fff" opacity="0.65">
            <animate attributeName={vert ? 'cy' : 'cx'}
              from={vert ? i * 34 + 12 : i * 34 + 12} to={vert ? i * 34 + 46 : i * 34 + 46}
              dur="1s" repeatCount="indefinite" />
          </circle>
        ))}
      </svg>
    )
  },
})

def({
  kind: 'heater', label: 'Grzałka', category: 'Technologia',
  size: { w: 110, h: 70 },
  bindings: [b('on', 'Załączona', 'BOOL'), b('power', 'Moc 0-100', 'NUM')],
  props: [p('label', 'Oznaczenie', 'text', 'H1')],
  render: ({ w, val }) => {
    const on = toBool(val.on)
    const pw = w.bind.power ? clamp01(toNum(val.power), 0, 100) : (on ? 1 : 0)
    const c = pw > 0.02 ? `rgb(${Math.round(180 + 75 * pw)}, ${Math.round(90 - 40 * pw)}, 30)` : '#5b6879'
    return (
      <svg viewBox="0 0 90 56" style={{ width: '100%', height: '100%' }}>
        <rect x="6" y="8" width="78" height="30" rx="4" fill="#131b25" stroke={c} strokeWidth="2" />
        <path d="M 14 30 q 6 -18 12 0 t 12 0 t 12 0 t 12 0 t 12 0" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round"
          style={pw > 0.02 ? { filter: `drop-shadow(0 0 ${3 + pw * 6}px ${c})` } : undefined} />
        <text x="45" y="52" textAnchor="middle" fontSize="10" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'H1')} {pw > 0 ? `${Math.round(pw * 100)}%` : ''}
        </text>
      </svg>
    )
  },
})

def({
  kind: 'sensor', label: 'Czujnik', category: 'Technologia',
  size: { w: 80, h: 76 },
  bindings: [b('in', 'Sygnał', 'BOOL')],
  props: [p('label', 'Oznaczenie', 'text', 'B1'), p('type', 'Rodzaj', 'select', 'prox', [
    { value: 'prox', label: 'zbliżeniowy' }, { value: 'photo', label: 'fotokomórka' }, { value: 'limit', label: 'krańcowy' },
  ])],
  render: ({ w, val }) => {
    const on = toBool(val.in)
    const c = on ? '#3ddc84' : '#5b6879'
    const type = str(w, 'type', 'prox')
    return (
      <svg viewBox="0 0 64 60" style={{ width: '100%', height: '100%' }}>
        <rect x="8" y="12" width="34" height="24" rx="3" fill="#131b25" stroke={c} strokeWidth="2" />
        {type === 'photo' && [0, 1, 2].map((i) => (
          <line key={i} x1="44" y1={18 + i * 6} x2="60" y2={18 + i * 6} stroke={c} strokeWidth="1.5" opacity={on ? 1 : 0.35} />
        ))}
        {type === 'prox' && <path d="M 44 24 q 6 -8 12 0 M 46 24 q 4 -5 8 0" fill="none" stroke={c} strokeWidth="1.6" opacity={on ? 1 : 0.35} />}
        {type === 'limit' && <line x1="42" y1="24" x2="58" y2={on ? 16 : 32} stroke={c} strokeWidth="2.5" strokeLinecap="round" />}
        <circle cx="16" cy="18" r="2.6" fill={c} />
        <text x="32" y="52" textAnchor="middle" fontSize="10" fontWeight="700" fill="#c6d0dc" fontFamily="var(--mono)">
          {str(w, 'label', 'B1')}
        </text>
      </svg>
    )
  },
})

/* ------------------------------------------------------------------ */

export const WIDGET_DEFS = DEFS
export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(DEFS.map((d) => [d.kind, d]))
export const WIDGET_CATEGORIES = Array.from(new Set(DEFS.map((d) => d.category)))

export function defaultProps(kind: WidgetKind): Record<string, unknown> {
  const d = WIDGET_MAP[kind]
  return Object.fromEntries((d?.props ?? []).map((pr) => [pr.key, pr.default]))
}
