import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { DataType, PlcValue, VarClass, Variable } from '../core/types'
import { simulator } from '../state/runtime'
import { formatTime } from '../core/st/lexer'
import { Icon, Empty } from './common'

const TYPES: DataType[] = [
  'BOOL', 'INT', 'DINT', 'REAL', 'TIME', 'WORD', 'BYTE', 'DWORD',
  'SINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'LREAL', 'STRING',
]

const CLASSES: VarClass[] = ['VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_TEMP']

export function formatValue(v: PlcValue | undefined, type?: DataType): string {
  if (v === undefined) return '—'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'string') return v
  if (type === 'TIME') return formatTime(v)
  return Number.isInteger(v) ? String(v) : v.toFixed(3)
}

export function VariableTable() {
  const project = useStore((s) => s.project)
  const pou = useStore((s) => s.activePou())
  const snapshot = useStore((s) => s.snapshot)
  const watch = useStore((s) => s.watch)
  const st = useStore()
  const [scope, setScope] = useState<'global' | 'local'>('global')
  const [filter, setFilter] = useState('')

  const isGlobal = scope === 'global'
  const list = isGlobal ? project.globals : pou.vars
  const pouId = isGlobal ? undefined : pou.id

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return list
    return list.filter((v) =>
      v.name.toLowerCase().includes(q) ||
      (v.comment ?? '').toLowerCase().includes(q) ||
      (v.address ?? '').toLowerCase().includes(q))
  }, [list, filter])

  const undeclared = useMemo(
    () => [...simulator.undeclared].filter((n) => !project.globals.some((v) => v.name === n)),
    [project.globals, snapshot.stats.scanCount],
  )

  const key = (v: Variable) => (isGlobal ? v.name : `${pou.name}::${v.name}`)

  const addVar = () => {
    let n = 1
    const taken = new Set([...project.globals, ...pou.vars].map((v) => v.name))
    while (taken.has(`Zmienna${n}`)) n++
    st.addVariable({ name: `Zmienna${n}`, type: 'BOOL' }, pouId)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flex: 'none' }}>
        <button className={isGlobal ? 'active sm' : 'sm'} onClick={() => setScope('global')}>
          Globalne ({project.globals.length})
        </button>
        <button className={!isGlobal ? 'active sm' : 'sm'} onClick={() => setScope('local')}>
          Lokalne w {pou.name} ({pou.vars.length})
        </button>
        <div style={{ position: 'relative', flex: 1, minWidth: 140 }}>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filtruj zmienne…" style={{ paddingLeft: 28 }} />
          <span style={{ position: 'absolute', left: 8, top: 8, color: 'var(--text-faint)' }}><Icon name="search" size={14} /></span>
        </div>
        <button className="sm primary" onClick={addVar}><Icon name="plus" size={14} /> Dodaj</button>
      </div>

      {undeclared.length > 0 && (
        <div className="row" style={{ padding: '6px 10px', background: 'color-mix(in srgb, var(--warn) 12%, transparent)', flexWrap: 'wrap', flex: 'none' }}>
          <Icon name="warn" size={14} />
          <span className="small">W programie użyto niezadeklarowanych zmiennych: <b className="mono">{undeclared.slice(0, 6).join(', ')}</b></span>
          <button className="sm" onClick={() => {
            for (const n of undeclared) st.addVariable({ name: n, type: 'BOOL', comment: 'dodana automatycznie' })
            st.toast(`Dodano ${undeclared.length} zmiennych`, 'ok')
          }}>Dodaj wszystkie jako BOOL</button>
        </div>
      )}

      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {shown.length === 0 ? (
          <Empty icon="vars" title="Brak zmiennych"
            hint="Zmienne to sygnały programu: wejścia, wyjścia i pamięć wewnętrzna. Dodaj pierwszą, aby zacząć."
            action={<button className="primary" onClick={addVar}><Icon name="plus" /> Dodaj zmienną</button>} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 30 }} />
                <th style={{ minWidth: 130 }}>Nazwa</th>
                <th style={{ width: 110 }}>Typ</th>
                <th style={{ width: 110 }}>Adres</th>
                {!isGlobal && <th style={{ width: 120 }}>Klasa</th>}
                <th style={{ width: 100 }}>Wart. pocz.</th>
                <th style={{ width: 110 }}>Wartość</th>
                <th>Opis</th>
                <th style={{ width: 76 }} />
              </tr>
            </thead>
            <tbody>
              {shown.map((v) => {
                const k = key(v)
                const value = snapshot.vars[k]
                const forced = simulator.isForced(k)
                const isBool = v.type === 'BOOL' && !v.fbType
                return (
                  <tr key={v.id}>
                    <td>
                      <button className="ghost icon sm" title={watch.includes(k) ? 'Usuń z obserwowanych' : 'Obserwuj na wykresie'}
                        onClick={() => st.toggleWatch(k)}
                        style={{ color: watch.includes(k) ? 'var(--accent)' : 'var(--text-faint)' }}>
                        <Icon name="eye" size={14} />
                      </button>
                    </td>
                    <td>
                      <input className="mono" value={v.name}
                        onChange={(e) => st.updateVariable(v.id, { name: e.target.value }, pouId)} />
                    </td>
                    <td>
                      <select value={v.fbType ?? v.type}
                        onChange={(e) => {
                          const val = e.target.value
                          const std = (TYPES as string[]).includes(val)
                          st.updateVariable(v.id, std ? { type: val as DataType, fbType: undefined } : { fbType: val }, pouId)
                        }}>
                        {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        <optgroup label="Instancja bloku">
                          {['TON', 'TOF', 'TP', 'TONR', 'CTU', 'CTD', 'CTUD', 'R_TRIG', 'F_TRIG', 'RS', 'SR',
                            'PID', 'BLINK', 'HYST', 'PT1', 'RAMP', 'MOTOR', 'SEQ', 'TOTALIZER', 'RUNTIME',
                            ...project.pous.filter((p) => p.kind === 'FUNCTION_BLOCK').map((p) => p.name),
                            ...project.library.map((l) => l.name)]
                            .map((t) => <option key={t} value={t}>{t}</option>)}
                        </optgroup>
                      </select>
                    </td>
                    <td>
                      <input className="mono" value={v.address ?? ''} placeholder="%IX0.0"
                        onChange={(e) => st.updateVariable(v.id, { address: e.target.value || undefined }, pouId)} />
                    </td>
                    {!isGlobal && (
                      <td>
                        <select value={v.varClass} onChange={(e) => st.updateVariable(v.id, { varClass: e.target.value as VarClass }, pouId)}>
                          {CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </td>
                    )}
                    <td>
                      <input className="mono" value={v.initial ?? ''} placeholder="—"
                        onChange={(e) => st.updateVariable(v.id, { initial: e.target.value || undefined }, pouId)} />
                    </td>
                    <td>
                      {v.fbType ? <span className="dim small">instancja</span> : (
                        <span className={`value-pill${value === true ? ' on' : ''}${forced ? ' forced' : ''}`}
                          onClick={() => { if (isBool) st.poke(k, !value) }}
                          style={{ cursor: isBool ? 'pointer' : 'default' }}
                          title={isBool ? 'Kliknij, aby przełączyć' : ''}>
                          {formatValue(value, v.type)}
                        </span>
                      )}
                    </td>
                    <td>
                      <input value={v.comment ?? ''} placeholder="opis sygnału"
                        onChange={(e) => st.updateVariable(v.id, { comment: e.target.value }, pouId)} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 2 }}>
                        <button className="ghost icon sm" title={forced ? 'Zdejmij wymuszenie' : 'Wymuś wartość'}
                          onClick={() => st.toggleForce(k)}
                          style={{ color: forced ? 'var(--warn)' : 'var(--text-faint)' }}>
                          <Icon name="lock" size={14} />
                        </button>
                        <button className="ghost icon sm danger" title="Usuń zmienną"
                          onClick={() => st.deleteVariable(v.id, pouId)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
