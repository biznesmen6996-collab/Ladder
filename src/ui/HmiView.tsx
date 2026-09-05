import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { HmiWidget, PlcValue, WidgetKind } from '../core/types'
import { uid } from '../core/grid'
import { WIDGET_CATEGORIES, WIDGET_DEFS, WIDGET_MAP, defaultProps } from '../hmi/widgets'
import { Icon, Field, Empty } from './common'

const GRID = 10
const snap = (v: number) => Math.round(v / GRID) * GRID

/** Klucze wszystkich zmiennych dostępnych do podpięcia pod komponenty HMI. */
export function useVariableKeys(): { key: string; label: string; type: string }[] {
  const project = useStore((s) => s.project)
  return useMemo(() => {
    const out: { key: string; label: string; type: string }[] = []
    for (const v of project.globals) if (!v.fbType) out.push({ key: v.name, label: v.name, type: v.type })
    for (const pou of project.pous)
      for (const v of pou.vars) if (!v.fbType) out.push({ key: `${pou.name}::${v.name}`, label: `${pou.name}.${v.name}`, type: v.type })
    return out
  }, [project])
}

export function HmiView({ runtime }: { runtime: boolean }) {
  const satellite = useStore((s) => s.satellite)
  const project = useStore((s) => s.project)
  const screenId = useStore((s) => s.activeScreenId)
  const selected = useStore((s) => s.selectedWidgetIds)
  const snapshot = useStore((s) => s.snapshot)
  const st = useStore()
  const stageRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<null | { mode: 'move' | 'resize'; startX: number; startY: number; orig: HmiWidget[] }>(null)

  const screen = project.hmi.find((s) => s.id === screenId) ?? project.hmi[0]

  const values = useCallback((w: HmiWidget): Record<string, PlcValue> => {
    const out: Record<string, PlcValue> = {}
    for (const [role, key] of Object.entries(w.bind)) if (key) out[role] = snapshot.vars[key]
    return out
  }, [snapshot.vars])

  const setValue = useCallback((w: HmiWidget, role: string, v: PlcValue) => {
    const key = w.bind[role]
    if (key) st.poke(key, v)
  }, [st])

  const onPointerDown = (e: React.PointerEvent, w: HmiWidget, mode: 'move' | 'resize') => {
    if (runtime || w.locked) return
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const ids = selected.includes(w.id) ? selected : [w.id]
    if (!selected.includes(w.id)) st.selectWidgets(e.shiftKey ? [...selected, w.id] : [w.id])
    const orig = screen.widgets.filter((x) => ids.includes(x.id)).map((x) => ({ ...x }))
    setDrag({ mode, startX: e.clientX, startY: e.clientY, orig })
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag) return
    const dx = (e.clientX - drag.startX) / scale
    const dy = (e.clientY - drag.startY) / scale
    for (const o of drag.orig) {
      if (drag.mode === 'move') st.updateWidget(o.id, { x: Math.max(0, snap(o.x + dx)), y: Math.max(0, snap(o.y + dy)) })
      else st.updateWidget(o.id, { w: Math.max(24, snap(o.w + dx)), h: Math.max(20, snap(o.h + dy)) })
    }
  }

  const addWidget = (kind: WidgetKind) => {
    const d = WIDGET_MAP[kind]
    st.addWidget({
      id: uid('w'), kind, x: 40, y: 40, w: d.size.w, h: d.size.h,
      bind: {}, props: defaultProps(kind), z: (screen.widgets.length ?? 0) + 1,
    })
  }

  // ekran HMI ma stałą rozdzielczość — skalujemy go do rozmiaru okna
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const fit = () => {
      const pad = 32
      const s = Math.min(1, (el.clientWidth - pad) / screen.width, (el.clientHeight - pad) / screen.height)
      setScale(Number.isFinite(s) && s > 0.15 ? s : 1)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [screen.width, screen.height])

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      {!runtime && !satellite && <HmiPalette onAdd={addWidget} />}

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flex: 'none' }}>
          <select value={screen.id} onChange={(e) => st.setActiveScreen(e.target.value)} style={{ width: 180 }}>
            {project.hmi.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          {!runtime && !satellite && (
            <>
              <button className="sm" onClick={st.addScreen}><Icon name="plus" size={14} /> Ekran</button>
              <button className="sm danger icon" onClick={() => st.deleteScreen(screen.id)} title="Usuń ekran"><Icon name="trash" size={14} /></button>
              <span className="spacer" />
              <button className="sm" onClick={st.copyWidgets} disabled={!selected.length}>Kopiuj</button>
              <button className="sm" onClick={st.pasteWidgets}>Wklej</button>
              <button className="sm danger" onClick={() => st.deleteWidgets(selected)} disabled={!selected.length}>
                <Icon name="trash" size={14} /> Usuń
              </button>
            </>
          )}
          <span className="spacer" />
          {satellite ? (
            <span className="chip">okno podglądu — projektowanie w oknie głównym</span>
          ) : (
            <>
              <button className="sm" onClick={() => st.setView(runtime ? 'hmi' : 'hmi-run')}>
                <Icon name={runtime ? 'gear' : 'play'} size={14} /> {runtime ? 'Tryb projektowania' : 'Uruchom panel'}
              </button>
              <button className="sm icon" title="Otwórz panel w osobnym oknie (drugi monitor)"
                onClick={() => window.open(`${location.pathname}?view=hmi-run&screen=${screen.id}`, '_blank', 'width=1280,height=800')}>
                <Icon name="monitor" size={14} />
              </button>
            </>
          )}
        </div>

        <div ref={viewportRef} className="stage"
          style={{ padding: 16, display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
          <div
            ref={stageRef}
            className="hmi-stage"
            style={{
              width: screen.width, height: screen.height,
              transform: `scale(${scale})`, transformOrigin: 'top center',
              marginBottom: (scale - 1) * screen.height,
              background: screen.background || undefined,
            }}
            onPointerMove={onPointerMove}
            onPointerUp={() => setDrag(null)}
            onPointerLeave={() => setDrag(null)}
            onClick={() => !runtime && st.selectWidgets([])}
          >
            {screen.widgets.length === 0 && !runtime && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <div className="hint" style={{ textAlign: 'center', maxWidth: 300 }}>
                  Wybierz komponent z palety po lewej, aby zbudować panel operatorski.<br />
                  Każdy komponent podpinasz do zmiennej programu w panelu właściwości.
                </div>
              </div>
            )}
            {[...screen.widgets].sort((a, b) => (a.z ?? 0) - (b.z ?? 0)).map((w) => {
              const d = WIDGET_MAP[w.kind]
              if (!d) return null
              const isSel = selected.includes(w.id)
              return (
                <div
                  key={w.id}
                  className={`widget${runtime ? '' : ' selectable'}${isSel && !runtime ? ' sel' : ''}`}
                  style={{ left: w.x, top: w.y, width: w.w, height: w.h, zIndex: w.z ?? 1, transform: w.rotation ? `rotate(${w.rotation}deg)` : undefined }}
                  onPointerDown={(e) => onPointerDown(e, w, 'move')}
                  onClick={(e) => { if (!runtime) { e.stopPropagation(); st.selectWidgets(e.shiftKey ? [...selected, w.id] : [w.id]) } }}
                >
                  <div style={{ width: '100%', height: '100%', pointerEvents: runtime ? 'auto' : 'none' }}>
                    {d.render({
                      w, val: values(w), set: (role, v) => setValue(w, role, v),
                      interactive: runtime, width: w.w, height: w.h, alarms: snapshot.alarms,
                    })}
                  </div>
                  {isSel && !runtime && (
                    <div className="handle" onPointerDown={(e) => onPointerDown(e, w, 'resize')} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {!runtime && !satellite && <HmiInspector />}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function HmiPalette({ onAdd }: { onAdd: (k: WidgetKind) => void }) {
  const [q, setQ] = useState('')
  const filtered = WIDGET_DEFS.filter((d) =>
    !q.trim() || d.label.toLowerCase().includes(q.toLowerCase()) || d.kind.includes(q.toLowerCase()))

  return (
    <div className="sidebar" style={{ width: 190, borderRight: '1px solid var(--border)', borderLeft: 0 }}>
      <div className="panel-head">Komponenty</div>
      <div style={{ padding: 8, flex: 'none' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj…" />
      </div>
      <div className="panel-scroll">
        {WIDGET_CATEGORIES.map((cat) => {
          const items = filtered.filter((d) => d.category === cat)
          if (!items.length) return null
          return (
            <div key={cat} className="section">
              <div className="section-title">{cat}</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {items.map((d) => (
                  <div key={d.kind} className="hmi-palette-item" onClick={() => onAdd(d.kind)} title={d.label}>
                    <div className="hmi-preview">
                      {d.render({
                        w: { id: `prev-${d.kind}`, kind: d.kind, x: 0, y: 0, w: 60, h: 40, bind: {}, props: defaultProps(d.kind) },
                        val: {}, set: () => {}, interactive: false, width: 60, height: 40,
                      })}
                    </div>
                    <span>{d.label}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function HmiInspector() {
  const project = useStore((s) => s.project)
  const screenId = useStore((s) => s.activeScreenId)
  const selected = useStore((s) => s.selectedWidgetIds)
  const st = useStore()
  const vars = useVariableKeys()
  const screen = project.hmi.find((s) => s.id === screenId)
  const widget = screen?.widgets.find((w) => w.id === selected[0])

  if (!widget) {
    return (
      <div className="inspector" style={{ width: 260 }}>
        <div className="panel-head">Właściwości ekranu</div>
        <div className="panel-scroll">
          {screen && (
            <>
              <Field label="Nazwa ekranu">
                <input value={screen.name} onChange={(e) => st.updateScreen(screen.id, { name: e.target.value })} />
              </Field>
              <div className="grid2">
                <Field label="Szerokość">
                  <input type="number" value={screen.width} onChange={(e) => st.updateScreen(screen.id, { width: Number(e.target.value) })} />
                </Field>
                <Field label="Wysokość">
                  <input type="number" value={screen.height} onChange={(e) => st.updateScreen(screen.id, { height: Number(e.target.value) })} />
                </Field>
              </div>
              <Field label="Tło">
                <input type="color" value={screen.background ?? '#10161f'}
                  onChange={(e) => st.updateScreen(screen.id, { background: e.target.value })} />
              </Field>
              <div className="hint">
                Typowe rozdzielczości paneli: 800×480 (7"), 1024×600 (10"), 1280×800 (12"), 1920×1080 (stanowisko).
              </div>
            </>
          )}
        </div>
      </div>
    )
  }

  const d = WIDGET_MAP[widget.kind]

  return (
    <div className="inspector" style={{ width: 260 }}>
      <div className="panel-head">{d.label}</div>
      <div className="panel-scroll">
        <div className="grid2">
          <Field label="X"><input type="number" value={widget.x} onChange={(e) => st.updateWidget(widget.id, { x: Number(e.target.value) })} /></Field>
          <Field label="Y"><input type="number" value={widget.y} onChange={(e) => st.updateWidget(widget.id, { y: Number(e.target.value) })} /></Field>
          <Field label="Szer."><input type="number" value={widget.w} onChange={(e) => st.updateWidget(widget.id, { w: Number(e.target.value) })} /></Field>
          <Field label="Wys."><input type="number" value={widget.h} onChange={(e) => st.updateWidget(widget.id, { h: Number(e.target.value) })} /></Field>
        </div>

        {d.bindings.length > 0 && (
          <div className="section">
            <div className="section-title">Podpięte zmienne</div>
            {d.bindings.map((bd) => (
              <Field key={bd.key} label={bd.label} hint={bd.hint}>
                <select value={widget.bind[bd.key] ?? ''}
                  onChange={(e) => st.updateWidget(widget.id, { bind: { ...widget.bind, [bd.key]: e.target.value } })}>
                  <option value="">— brak —</option>
                  {vars
                    .filter((v) => bd.type === 'ANY' || (bd.type === 'BOOL' ? v.type === 'BOOL' : v.type !== 'BOOL'))
                    .map((v) => <option key={v.key} value={v.key}>{v.label} ({v.type})</option>)}
                </select>
              </Field>
            ))}
          </div>
        )}

        {d.props.length > 0 && (
          <div className="section">
            <div className="section-title">Wygląd</div>
            {d.props.map((pd) => {
              const value = widget.props[pd.key] ?? pd.default
              const set = (v: unknown) => st.updateWidget(widget.id, { props: { ...widget.props, [pd.key]: v } })
              return (
                <Field key={pd.key} label={pd.label}>
                  {pd.type === 'bool' ? (
                    <input type="checkbox" checked={Boolean(value)} onChange={(e) => set(e.target.checked)} />
                  ) : pd.type === 'select' ? (
                    <select value={String(value)} onChange={(e) => set(e.target.value)}>
                      {pd.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input type={pd.type === 'number' ? 'number' : pd.type === 'color' ? 'color' : 'text'}
                      value={String(value)}
                      onChange={(e) => set(pd.type === 'number' ? Number(e.target.value) : e.target.value)} />
                  )}
                </Field>
              )
            })}
          </div>
        )}

        <div className="row">
          <button className="sm" onClick={() => st.updateWidget(widget.id, { z: (widget.z ?? 1) + 1 })}>Na wierzch</button>
          <button className="sm" onClick={() => st.updateWidget(widget.id, { z: Math.max(0, (widget.z ?? 1) - 1) })}>Pod spód</button>
        </div>
      </div>
    </div>
  )
}

export function HmiEmpty() {
  return <Empty icon="hmi" title="Panel operatorski" hint="Dodaj komponenty i podepnij je do zmiennych programu." />
}
