import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import { simulator } from '../state/runtime'
import { formatValue } from './VariableTable'
import { Icon, Empty } from './common'
import { formatTime } from '../core/st/lexer'
import type { DataType } from '../core/types'

const SPEEDS = [
  { v: 0.1, label: '0,1×' },
  { v: 0.25, label: '0,25×' },
  { v: 0.5, label: '0,5×' },
  { v: 1, label: '1×' },
  { v: 2, label: '2×' },
  { v: 5, label: '5×' },
  { v: 10, label: '10×' },
  { v: Infinity, label: 'max' },
]

export function SimToolbar() {
  const running = useStore((s) => s.running)
  const speed = useStore((s) => s.speed)
  const snapshot = useStore((s) => s.snapshot)
  const project = useStore((s) => s.project)
  const st = useStore()

  const step = snapshot.steps[snapshot.cursor]

  return (
    <div className="simbar">
      <span className={`sim-dot ${running ? 'run' : snapshot.stats.scanCount ? 'pause' : ''}`} />
      {running
        ? <button className="stop" onClick={st.simStop}><Icon name="pause" /> Zatrzymaj</button>
        : <button className="run" onClick={st.simStart}><Icon name="play" /> Uruchom</button>}
      <button title="Wykonaj jeden pełny cykl skanowania" onClick={st.simStepScan}>
        <Icon name="step" /> Cykl
      </button>
      <button title="Wykonaj jeden szczebel drabinki" onClick={st.simStepRung}>
        <Icon name="stepRung" /> Krok
      </button>
      <button title="Zeruj stan sterownika" onClick={st.simReset}><Icon name="reset" /></button>

      <span className="small dim wide-only" style={{ marginLeft: 6 }}>Prędkość</span>
      <select value={String(speed)} onChange={(e) => st.setSpeed(Number(e.target.value))} style={{ width: 84 }}>
        {SPEEDS.map((s) => <option key={s.label} value={String(s.v)}>{s.label}</option>)}
      </select>

      <span className="small dim wide-only">Cykl</span>
      <input type="number" min={1} max={1000} value={project.config.scanTime}
        className="wide-only" style={{ width: 68 }}
        onChange={(e) => st.commit((p) => { p.config.scanTime = Math.max(1, Number(e.target.value) || 10) })} />
      <span className="small dim wide-only">ms</span>

      <div className="spacer" />
      {step && !running && (
        <span className="chip wide-only" title="Następny krok przy przycisku „Krok”">następny: {step.label}</span>
      )}
      <span className="chip mono" title="Liczba wykonanych cykli">#{snapshot.stats.scanCount}</span>
      <span className="chip mono" title="Czas symulacji">{formatTime(snapshot.stats.simTime).replace('T#', '')}</span>
      <span className="chip mono wide-only" title="Średni czas wykonania cyklu">
        {(snapshot.stats.avgScanUs / 1000).toFixed(2)} ms
      </span>
      {snapshot.errors.length > 0 && (
        <span className="chip err" title={snapshot.errors.join('\n')}>
          <Icon name="warn" size={12} /> {snapshot.errors.length}
        </span>
      )}
    </div>
  )
}

type Tab = 'watch' | 'trend' | 'alarms' | 'diag' | 'forces'

export function SimPanel() {
  const [tab, setTab] = useState<Tab>('watch')
  // na wąskich ekranach panel startuje zwinięty, żeby zostawić miejsce na edytor
  const [collapsed, setCollapsed] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 900)
  const snapshot = useStore((s) => s.snapshot)
  const watch = useStore((s) => s.watch)
  const activeAlarms = snapshot.alarms.filter((a) => !a.clearedAt).length

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: 'watch', label: 'Podgląd', badge: watch.length || undefined },
    { id: 'trend', label: 'Trendy' },
    { id: 'alarms', label: 'Alarmy', badge: activeAlarms || undefined },
    { id: 'forces', label: 'Wymuszenia', badge: simulator.forcedKeys().length || undefined },
    { id: 'diag', label: 'Diagnostyka', badge: snapshot.errors.length || undefined },
  ]

  return (
    <div className={`bottom-panel${collapsed ? ' collapsed' : ''}`}>
      <div className="tabbar" style={{ height: 34 }}>
        {tabs.map((t) => (
          <button key={t.id} className={`tab${tab === t.id && !collapsed ? ' sel' : ''}`}
            onClick={() => { setTab(t.id); setCollapsed(false) }}>
            {t.label}
            {t.badge ? <span className="chip accent" style={{ padding: '0 5px' }}>{t.badge}</span> : null}
          </button>
        ))}
        <div className="spacer" />
        <button className="ghost icon sm" onClick={() => setCollapsed((v) => !v)}
          title={collapsed ? 'Rozwiń panel' : 'Zwiń panel'}>
          <Icon name={collapsed ? 'up' : 'down'} size={14} />
        </button>
      </div>
      {!collapsed && (
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          {tab === 'watch' && <WatchTable />}
          {tab === 'trend' && <TrendView />}
          {tab === 'alarms' && <AlarmView />}
          {tab === 'forces' && <ForceView />}
          {tab === 'diag' && <DiagView />}
        </div>
      )}
    </div>
  )
}

function WatchTable() {
  const watch = useStore((s) => s.watch)
  const snapshot = useStore((s) => s.snapshot)
  const st = useStore()

  if (!watch.length) {
    return <Empty icon="eye" title="Tablica obserwacji jest pusta"
      hint="Kliknij ikonę oka przy zmiennej w tabeli zmiennych, aby śledzić jej wartość i zapisywać przebieg na wykresie." />
  }

  return (
    <table className="data">
      <thead>
        <tr><th>Zmienna</th><th style={{ width: 130 }}>Wartość</th><th style={{ width: 200 }}>Sterowanie</th><th style={{ width: 40 }} /></tr>
      </thead>
      <tbody>
        {watch.map((k) => {
          const v = snapshot.vars[k]
          const type = simulator.varType(k)
          const forced = simulator.isForced(k)
          return (
            <tr key={k}>
              <td className="mono">{k}</td>
              <td>
                <span className={`value-pill${v === true ? ' on' : ''}${forced ? ' forced' : ''}`}>
                  {formatValue(v, type)}
                </span>
              </td>
              <td>
                {typeof v === 'boolean'
                  ? <button className="sm" onClick={() => st.poke(k, !v)}>Przełącz</button>
                  : <input type="number" value={typeof v === 'number' ? v : 0}
                      onChange={(e) => st.poke(k, Number(e.target.value))} />}
              </td>
              <td>
                <button className="ghost icon sm" onClick={() => st.toggleWatch(k)} title="Usuń z obserwowanych">
                  <Icon name="close" size={13} />
                </button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function TrendView() {
  const watch = useStore((s) => s.watch)
  const snapshot = useStore((s) => s.snapshot)
  const series = useMemo(
    () => watch.map((k) => ({ key: k, data: simulator.getTrend(k), type: simulator.varType(k) })),
    [watch, snapshot.stats.scanCount],
  )
  const hasData = series.some((s) => s.data.length > 1)

  if (!hasData) {
    return <Empty icon="io" title="Brak zarejestrowanych przebiegów"
      hint="Dodaj zmienne do obserwacji i uruchom symulację — wykres rysuje się na bieżąco." />
  }
  return <TrendChart series={series} />
}

const COLORS = ['#4c9aff', '#3ddc84', '#f5a524', '#f4586a', '#c792ea', '#7fdbca', '#ff9ec7', '#a3e635']

function TrendChart({ series }: { series: { key: string; data: { t: number; v: number }[]; type?: DataType }[] }) {
  const W = 900, H = 190, padL = 52, padB = 24, padT = 10, padR = 10
  const all = series.flatMap((s) => s.data)
  if (!all.length) return null
  const t0 = Math.min(...all.map((d) => d.t))
  const t1 = Math.max(...all.map((d) => d.t))
  let vMin = Math.min(...all.map((d) => d.v))
  let vMax = Math.max(...all.map((d) => d.v))
  if (vMax - vMin < 1e-9) { vMax = vMin + 1; vMin -= 0.05 }
  const pad = (vMax - vMin) * 0.08
  vMin -= pad; vMax += pad

  const x = (t: number) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR)
  const y = (v: number) => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB)

  return (
    <div style={{ padding: 10 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 200 }}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const v = vMin + f * (vMax - vMin)
          return (
            <g key={f}>
              <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="var(--grid)" strokeWidth={1} />
              <text x={padL - 6} y={y(v) + 3.5} textAnchor="end" fontSize={10} fill="var(--text-faint)" fontFamily="var(--mono)">
                {Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}
              </text>
            </g>
          )
        })}
        {series.map((s, i) => s.data.length > 1 && (
          <polyline key={s.key} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={1.8}
            strokeLinejoin="round" strokeLinecap="round"
            points={s.data.map((d) => `${x(d.t).toFixed(1)},${y(d.v).toFixed(1)}`).join(' ')} />
        ))}
        <text x={padL} y={H - 6} fontSize={10} fill="var(--text-faint)" fontFamily="var(--mono)">
          {formatTime(t0).replace('T#', '')}
        </text>
        <text x={W - padR} y={H - 6} textAnchor="end" fontSize={10} fill="var(--text-faint)" fontFamily="var(--mono)">
          {formatTime(t1).replace('T#', '')}
        </text>
      </svg>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
        {series.map((s, i) => (
          <span key={s.key} className="row small" style={{ gap: 5 }}>
            <span style={{ width: 12, height: 3, borderRadius: 2, background: COLORS[i % COLORS.length] }} />
            <span className="mono">{s.key}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

function AlarmView() {
  const snapshot = useStore((s) => s.snapshot)
  const st = useStore()
  if (!snapshot.alarms.length) {
    return <Empty icon="alarm" title="Brak zdarzeń alarmowych"
      hint="Alarmy definiujesz w zakładce Alarmy; tutaj pojawi się historia ich wystąpień." />
  }
  return (
    <>
      <div className="row" style={{ padding: '6px 10px' }}>
        <button className="sm" onClick={st.ackAlarms}><Icon name="check" size={14} /> Potwierdź wszystkie</button>
      </div>
      <table className="data">
        <thead>
          <tr><th style={{ width: 90 }}>Czas</th><th style={{ width: 90 }}>Priorytet</th><th>Treść</th><th style={{ width: 110 }}>Stan</th></tr>
        </thead>
        <tbody>
          {snapshot.alarms.map((a) => (
            <tr key={a.id}>
              <td className="mono small">{formatTime(a.raisedAt).replace('T#', '')}</td>
              <td>
                <span className={`chip ${a.priority === 'critical' ? 'err' : a.priority === 'warning' ? 'warn' : ''}`}>
                  {a.priority === 'critical' ? 'krytyczny' : a.priority === 'warning' ? 'ostrzeżenie' : 'info'}
                </span>
              </td>
              <td>{a.text}</td>
              <td className="small dim">
                {a.clearedAt ? 'ustąpił' : 'aktywny'}{a.ackAt ? ' • potwierdzony' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}

function ForceView() {
  const snapshot = useStore((s) => s.snapshot)
  const st = useStore()
  const keys = simulator.forcedKeys()
  if (!keys.length) {
    return <Empty icon="lock" title="Brak wymuszeń"
      hint="Wymuszenie utrzymuje stałą wartość zmiennej niezależnie od programu — przydaje się przy testowaniu bez podłączonych czujników." />
  }
  return (
    <>
      <div className="row" style={{ padding: '6px 10px' }}>
        <button className="sm danger" onClick={() => { simulator.clearForces(); st.poke('', false) }}>
          <Icon name="trash" size={14} /> Zdejmij wszystkie
        </button>
      </div>
      <table className="data">
        <thead><tr><th>Zmienna</th><th style={{ width: 160 }}>Wymuszona wartość</th><th style={{ width: 50 }} /></tr></thead>
        <tbody>
          {keys.map((k) => {
            const v = snapshot.vars[k]
            return (
              <tr key={k}>
                <td className="mono">{k}</td>
                <td>
                  {typeof v === 'boolean'
                    ? <button className="sm" onClick={() => st.setForce(k, !v)}>{v ? 'TRUE' : 'FALSE'}</button>
                    : <input type="number" value={typeof v === 'number' ? v : 0}
                        onChange={(e) => st.setForce(k, Number(e.target.value))} />}
                </td>
                <td><button className="ghost icon sm" onClick={() => st.toggleForce(k)}><Icon name="close" size={13} /></button></td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

function DiagView() {
  const snapshot = useStore((s) => s.snapshot)
  const project = useStore((s) => s.project)
  return (
    <div style={{ padding: 12 }}>
      <div className="grid3" style={{ marginBottom: 12 }}>
        <Stat label="Wykonane cykle" value={String(snapshot.stats.scanCount)} />
        <Stat label="Czas symulacji" value={formatTime(snapshot.stats.simTime).replace('T#', '')} />
        <Stat label="Czas cyklu (śr.)" value={`${(snapshot.stats.avgScanUs / 1000).toFixed(3)} ms`} />
        <Stat label="Czas cyklu (maks.)" value={`${(snapshot.stats.maxScanUs / 1000).toFixed(3)} ms`} />
        <Stat label="Kroki programu" value={String(snapshot.steps.length)} />
        <Stat label="Instancje bloków" value={String(Object.keys(snapshot.instances).length)} />
      </div>
      <div className="section-title">Zadania</div>
      <table className="data" style={{ marginBottom: 12 }}>
        <thead><tr><th>Nazwa</th><th>Interwał</th><th>Priorytet</th><th>Programy</th></tr></thead>
        <tbody>
          {project.tasks.map((t) => (
            <tr key={t.id}>
              <td className="mono">{t.name}</td>
              <td className="mono">{t.interval} ms</td>
              <td className="mono">{t.priority}</td>
              <td className="small dim">{t.programs.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="section-title">Komunikaty</div>
      {snapshot.errors.length === 0
        ? <div className="hint">Brak błędów wykonania.</div>
        : snapshot.errors.map((e, i) => (
          <div key={i} className="row small" style={{ color: 'var(--err)', marginBottom: 4 }}>
            <Icon name="warn" size={14} /> {e}
          </div>
        ))}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px' }}>
      <div className="small faint">{label}</div>
      <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
    </div>
  )
}
