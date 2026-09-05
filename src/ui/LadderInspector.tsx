import { useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { Cell } from '../core/types'
import { BLOCK_CATEGORIES, BLOCK_DEFS } from '../core/blocks'
import { defaultEnoPin, defaultPins } from '../core/grid'
import { Icon } from './common'

/** Panel wstawiania elementów do zaznaczonej komórki drabinki. */
export function LadderInspector() {
  const selection = useStore((s) => s.selection)
  const pou = useStore((s) => s.activePou())
  const st = useStore()
  const [q, setQ] = useState('')

  const cell = selection
    ? pou.rungs.find((r) => r.id === selection.rungId)?.cells[selection.r]?.[selection.c]
    : null

  const put = (make: () => Cell) => {
    if (!selection) { st.toast('Wskaż najpierw komórkę w drabince', 'warn'); return }
    st.setCell(selection, make())
  }

  const blocks = useMemo(() => {
    const query = q.trim().toLowerCase()
    return BLOCK_DEFS.filter((d) =>
      !query || d.type.toLowerCase().includes(query) || d.description.toLowerCase().includes(query))
  }, [q])

  return (
    <>
      <div className="panel-head"><Icon name="ladder" size={14} /> Paleta elementów</div>
      <div className="panel-scroll">
        {!selection && (
          <div className="hint" style={{ marginBottom: 10 }}>
            Kliknij komórkę w drabince, a następnie wybierz element z palety.
            Podwójne kliknięcie komórki otwiera pełne właściwości.
          </div>
        )}
        {cell && (
          <div className="chip accent" style={{ marginBottom: 10 }}>
            Zaznaczono: {describe(cell)}
          </div>
        )}

        <div className="section">
          <div className="section-title">Styki</div>
          <div className="palette-grid">
            <PalItem label="┤ ├" name="NO" onClick={() => put(() => ({ type: 'contact', contactKind: 'NO', operand: '' }))} />
            <PalItem label="┤/├" name="NC" onClick={() => put(() => ({ type: 'contact', contactKind: 'NC', operand: '' }))} />
            <PalItem label="┤P├" name="zbocze ↑" onClick={() => put(() => ({ type: 'contact', contactKind: 'P', operand: '' }))} />
            <PalItem label="┤N├" name="zbocze ↓" onClick={() => put(() => ({ type: 'contact', contactKind: 'N', operand: '' }))} />
            <PalItem label="A>B" name="porównanie" onClick={() => put(() => ({ type: 'compare', cmpOp: '>', cmpA: '', cmpB: '0' }))} />
            <PalItem label="─" name="przewód" onClick={() => put(() => ({ type: 'wire' }))} />
          </div>
        </div>

        <div className="section">
          <div className="section-title">Cewki</div>
          <div className="palette-grid">
            <PalItem label="( )" name="cewka" onClick={() => put(() => ({ type: 'coil', coilKind: 'COIL', operand: '' }))} />
            <PalItem label="(/)" name="negowana" onClick={() => put(() => ({ type: 'coil', coilKind: 'COIL_NEG', operand: '' }))} />
            <PalItem label="(S)" name="ustaw" onClick={() => put(() => ({ type: 'coil', coilKind: 'SET', operand: '' }))} />
            <PalItem label="(R)" name="zeruj" onClick={() => put(() => ({ type: 'coil', coilKind: 'RESET', operand: '' }))} />
            <PalItem label="(P)" name="impuls ↑" onClick={() => put(() => ({ type: 'coil', coilKind: 'PULSE_P', operand: '' }))} />
            <PalItem label="(N)" name="impuls ↓" onClick={() => put(() => ({ type: 'coil', coilKind: 'PULSE_N', operand: '' }))} />
          </div>
        </div>

        <div className="section">
          <div className="section-title">Operacje na szczeblu</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            <button className="sm" disabled={!selection} onClick={() => selection && st.addBranch(selection)}>
              <Icon name="branch" size={13} /> Gałąź
            </button>
            <button className="sm" disabled={!selection} onClick={() => selection && st.toggleCellLink(selection)}>
              <Icon name="link" size={13} /> Łącznik
            </button>
            <button className="sm" disabled={!selection} onClick={() => selection && st.insertColumn(selection)}>
              <Icon name="right" size={13} /> Kolumna
            </button>
            <button className="sm danger" disabled={!selection} onClick={() => selection && st.clearCell(selection)}>
              <Icon name="trash" size={13} /> Wyczyść
            </button>
          </div>
        </div>

        <div className="section">
          <div className="section-title">Bloki funkcyjne</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj bloku…" style={{ marginBottom: 6 }} />
          {BLOCK_CATEGORIES.map((cat) => {
            const items = blocks.filter((d) => d.category === cat)
            if (!items.length) return null
            return (
              <div key={cat} style={{ marginBottom: 8 }}>
                <div className="small faint" style={{ marginBottom: 3 }}>{cat}</div>
                {items.map((d) => (
                  <div key={d.type} className="tree-item" title={d.description}
                    onClick={() => put(() => ({
                      type: 'block', blockType: d.type,
                      pins: defaultPins(d.type),
                      enoPin: defaultEnoPin(d.type),
                      instance: d.stateful ? suggest(d.type) : undefined,
                    }))}>
                    <span className="mono" style={{ fontSize: 11.5 }}>{d.type}</span>
                    <span className="tag" style={{ fontSize: 9.5 }}>{d.stateful ? 'FB' : 'FUN'}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

let counter = 0
const suggest = (type: string) => `${type}_${++counter}`

function PalItem({ label, name, onClick }: { label: string; name: string; onClick: () => void }) {
  return (
    <div className="palette-item" onClick={onClick} title={name}>
      <span className="mono" style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
      <span>{name}</span>
    </div>
  )
}

function describe(cell: Cell): string {
  switch (cell.type) {
    case 'contact': return `styk ${cell.contactKind ?? 'NO'} ${cell.operand || '(bez zmiennej)'}`
    case 'coil': return `cewka ${cell.coilKind ?? 'COIL'} ${cell.operand || '(bez zmiennej)'}`
    case 'block': return `blok ${cell.blockType}${cell.instance ? ` (${cell.instance})` : ''}`
    case 'compare': return `porównanie ${cell.cmpA} ${cell.cmpOp} ${cell.cmpB}`
    case 'wire': return 'przewód'
    default: return 'puste pole'
  }
}
