import { useCallback, useMemo, useRef, useState } from 'react'
import { useStore, type CellRef } from '../state/store'
import type { Cell, Rung, Variable } from '../core/types'
import { colCount, rowCount } from '../core/grid'
import { cellSize, LadderCell, MID } from './LadderCell'
import { CellDialog } from './CellDialog'
import { Icon, Empty } from './common'

/* Szybka paleta — najczęściej używane elementy. */
const QUICK: { label: string; title: string; make: () => Cell }[] = [
  { label: '┤ ├', title: 'Zestyk zwierny (NO)', make: () => ({ type: 'contact', contactKind: 'NO', operand: '' }) },
  { label: '┤/├', title: 'Zestyk rozwierny (NC)', make: () => ({ type: 'contact', contactKind: 'NC', operand: '' }) },
  { label: '┤P├', title: 'Zbocze narastające', make: () => ({ type: 'contact', contactKind: 'P', operand: '' }) },
  { label: '┤N├', title: 'Zbocze opadające', make: () => ({ type: 'contact', contactKind: 'N', operand: '' }) },
  { label: '( )', title: 'Cewka', make: () => ({ type: 'coil', coilKind: 'COIL', operand: '' }) },
  { label: '(S)', title: 'Cewka ustawiająca', make: () => ({ type: 'coil', coilKind: 'SET', operand: '' }) },
  { label: '(R)', title: 'Cewka zerująca', make: () => ({ type: 'coil', coilKind: 'RESET', operand: '' }) },
  { label: 'A>B', title: 'Porównanie', make: () => ({ type: 'compare', cmpOp: '>', cmpA: '', cmpB: '0' }) },
  { label: 'TON', title: 'Timer z opóźnieniem załączenia', make: () => makeBlock('TON') },
  { label: 'CTU', title: 'Licznik w górę', make: () => makeBlock('CTU') },
  { label: '⎔', title: 'Dowolny blok funkcyjny', make: () => makeBlock('MOVE') },
  { label: '─', title: 'Przewód', make: () => ({ type: 'wire' }) },
]

function makeBlock(type: string): Cell {
  return { type: 'block', blockType: type, pins: [], instance: undefined }
}

export function LadderEditor() {
  const pou = useStore((s) => s.activePou())
  const project = useStore((s) => s.project)
  const selection = useStore((s) => s.selection)
  const snapshot = useStore((s) => s.snapshot)
  const running = useStore((s) => s.running)
  const zoom = useStore((s) => s.zoom)
  const st = useStore()

  const [editing, setEditing] = useState<CellRef | null>(null)
  const [menu, setMenu] = useState<{ ref: CellRef; x: number; y: number } | null>(null)

  const variables = useMemo<Variable[]>(() => [...project.globals, ...pou.vars], [project.globals, pou.vars])
  const userBlocks = useMemo(() => [
    ...project.pous.filter((p) => p.kind !== 'PROGRAM'),
    ...project.library.map((l) => l.pou),
  ].map((p) => ({
    name: p.name,
    inputs: p.vars.filter((v) => v.varClass === 'VAR_INPUT' || v.varClass === 'VAR_IN_OUT').map((v) => v.name),
    outputs: p.vars.filter((v) => v.varClass === 'VAR_OUTPUT' || v.varClass === 'VAR_IN_OUT').map((v) => v.name),
    description: p.comment ?? 'Blok zdefiniowany w projekcie',
  })), [project.pous, project.library])

  const live = running || snapshot.stats.scanCount > 0

  const insert = useCallback((make: () => Cell) => {
    const ref = selection
    if (!ref) { st.toast('Najpierw wskaż miejsce w szczeblu', 'warn'); return }
    st.setCell(ref, make())
    setEditing(ref)
  }, [selection, st])

  const editingCell = editing
    ? pou.rungs.find((r) => r.id === editing.rungId)?.cells[editing.r]?.[editing.c]
    : null

  if (pou.language !== 'LD') {
    return (
      <Empty icon="ladder" title={`POU „${pou.name}" jest w języku ${pou.language}`}
        hint="Przełącz się na odpowiednią zakładkę albo zmień język w ustawieniach jednostki programowej."
      />
    )
  }

  return (
    <>
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', overflowX: 'auto', gap: 4, flex: 'none' }}>
        {QUICK.map((q) => (
          <button key={q.label} className="sm" title={q.title} onClick={() => insert(q.make)}
            style={{ fontFamily: 'var(--mono)', minWidth: 44, justifyContent: 'center' }}>
            {q.label}
          </button>
        ))}
        <div className="spacer" />
        <button className="sm ghost icon" title="Pomniejsz" onClick={() => st.setZoom(zoom - 0.1)}><Icon name="minus" /></button>
        <span className="small dim mono" style={{ minWidth: 38, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="sm ghost icon" title="Powiększ" onClick={() => st.setZoom(zoom + 0.1)}><Icon name="plus" /></button>
      </div>

      <div className="stage">
        <div className="ladder-scroll" style={{ zoom }}>
          {pou.rungs.map((rung, i) => (
            <RungView
              key={rung.id}
              rung={rung}
              index={i}
              pouId={pou.id}
              live={live}
              trace={snapshot.traces[`${pou.id}:${rung.id}`]}
              selection={selection}
              onSelect={(ref) => st.select(ref)}
              onEdit={(ref) => { st.select(ref); setEditing(ref) }}
              onMenu={(ref, x, y) => setMenu({ ref, x, y })}
            />
          ))}
          <button className="primary" onClick={() => st.addRung(pou.rungs[pou.rungs.length - 1]?.id)}>
            <Icon name="plus" /> Dodaj szczebel
          </button>
        </div>
      </div>

      {editing && editingCell && (
        <CellDialog
          cell={editingCell}
          variables={variables}
          userBlocks={userBlocks}
          onClose={() => setEditing(null)}
          onDelete={() => { st.clearCell(editing); setEditing(null) }}
          onSave={(c) => { st.setCell(editing, c); setEditing(null) }}
        />
      )}

      {menu && (
        <CellMenu
          x={menu.x} y={menu.y} refCell={menu.ref}
          rung={pou.rungs.find((r) => r.id === menu.ref.rungId)}
          onClose={() => setMenu(null)}
          onEdit={() => { setEditing(menu.ref); setMenu(null) }}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

interface RungProps {
  rung: Rung
  index: number
  pouId: string
  live: boolean
  trace?: import('../core/evaluate').RungTrace
  selection: CellRef | null
  onSelect: (ref: CellRef) => void
  onEdit: (ref: CellRef) => void
  onMenu: (ref: CellRef, x: number, y: number) => void
}

function RungView({ rung, index, pouId, live, trace, selection, onSelect, onEdit, onMenu }: RungProps) {
  const st = useStore()
  const cols = colCount(rung)
  // przytrzymanie palcem otwiera menu kontekstowe na urządzeniach dotykowych
  const hold = useRef<{ timer: number; x: number; y: number } | null>(null)
  const startHold = (e: React.PointerEvent, ref: CellRef) => {
    if (e.pointerType === 'mouse') return
    const { clientX: x, clientY: y } = e
    const timer = window.setTimeout(() => { onSelect(ref); onMenu(ref, x, y) }, 480)
    hold.current = { timer, x, y }
  }
  const endHold = () => { if (hold.current) { clearTimeout(hold.current.timer); hold.current = null } }
  const isSel = selection?.rungId === rung.id
  const [open, setOpen] = useState(false)

  // wyrównanie kolumn i wierszy do najszerszego / najwyższego elementu
  const colW = useMemo(() => Array.from({ length: cols }, (_, c) =>
    Math.max(...rung.cells.map((row) => cellSize(row[c]).w))), [rung, cols])
  const rowH = useMemo(() => rung.cells.map((row) =>
    Math.max(...row.map((cell) => cellSize(cell).h))), [rung])

  const totalH = rowH.reduce((a, b) => a + b, 0)
  const railOn = live && rung.enabled

  return (
    <div className={`rung${isSel ? ' sel' : ''}${rung.enabled ? '' : ' disabled'}${rung.breakpoint ? ' bp' : ''}`}>
      <div className="rung-head">
        <span className="rung-num">{String(index + 1).padStart(3, '0')}</span>
        <div className="rung-comment">
          <input
            value={rung.comment ?? ''}
            placeholder="Opis szczebla — do czego służy ten fragment programu"
            onChange={(e) => st.updateRung(rung.id, (r) => ({ ...r, comment: e.target.value }))}
          />
        </div>
        {trace?.energized && <span className="chip ok">zasilony</span>}
        <button className={`sm ghost icon${rung.breakpoint ? ' danger' : ''}`} title="Pułapka (zatrzymaj symulację na tym szczeblu)"
          onClick={() => st.toggleBreakpoint(rung.id)}>
          <Icon name="bolt" />
        </button>
        <button className="sm ghost icon" title={rung.enabled ? 'Wyłącz szczebel' : 'Włącz szczebel'}
          onClick={() => st.updateRung(rung.id, (r) => ({ ...r, enabled: !r.enabled }))}>
          <Icon name={rung.enabled ? 'eye' : 'lock'} />
        </button>
        <button className="sm ghost icon" title="Operacje na szczeblu" onClick={() => setOpen((v) => !v)}>
          <Icon name="menu" />
        </button>
      </div>

      {open && (
        <div className="row" style={{ padding: '6px 8px', gap: 4, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
          <button className="sm" onClick={() => { st.addRung(rung.id); setOpen(false) }}><Icon name="plus" /> Poniżej</button>
          <button className="sm" onClick={() => st.duplicateRung(rung.id)}><Icon name="copy" /> Duplikuj</button>
          <button className="sm" onClick={() => st.copyRung(rung.id)}>Kopiuj</button>
          <button className="sm" onClick={() => st.pasteRung()}>Wklej</button>
          <button className="sm" onClick={() => st.moveRung(rung.id, -1)}><Icon name="up" /></button>
          <button className="sm" onClick={() => st.moveRung(rung.id, 1)}><Icon name="down" /></button>
          <button className="sm" onClick={() => st.addRungRow(rung.id)}><Icon name="branch" /> Wiersz gałęzi</button>
          <div className="spacer" />
          <button className="sm danger" onClick={() => { st.deleteRung(rung.id); setOpen(false) }}><Icon name="trash" /> Usuń</button>
        </div>
      )}

      <div className="rung-body">
        <div style={{ display: 'inline-flex', alignItems: 'stretch', padding: '0 8px', minWidth: '100%' }}>
          <Rail height={totalH} on={railOn} side="left" />
          <div>
            {rung.cells.map((row, r) => (
              <div key={r} style={{ display: 'flex' }}>
                {row.map((cell, c) => {
                  const ref: CellRef = { pouId, rungId: rung.id, r, c }
                  const sel = selection?.rungId === rung.id && selection.r === r && selection.c === c
                  return (
                    <LadderCell
                      key={c}
                      cell={cell}
                      width={colW[c]}
                      height={rowH[r]}
                      trace={trace?.cells[r]?.[c]}
                      linkDown={cell.linkDown}
                      linkUp={r > 0 ? rung.cells[r - 1][c].linkDown : false}
                      nodeIn={trace?.nodes[c]?.[r]}
                      nodeOut={trace?.nodes[c + 1]?.[r]}
                      selected={sel}
                      live={live && rung.enabled}
                      onClick={() => onSelect(ref)}
                      onDoubleClick={() => onEdit(ref)}
                      onContextMenu={(e) => { e.preventDefault(); onSelect(ref); onMenu(ref, e.clientX, e.clientY) }}
                      onPointerDown={(e) => startHold(e, ref)}
                      onPointerUp={endHold}
                    />
                  )
                })}
              </div>
            ))}
          </div>
          <Rail height={totalH} on={false} side="right" />
        </div>
      </div>
    </div>
  )
}

function Rail({ height, on, side }: { height: number; on: boolean; side: 'left' | 'right' }) {
  return (
    <svg width={14} height={height} style={{ flex: 'none' }} aria-hidden>
      <line x1={side === 'left' ? 10 : 4} y1={0} x2={side === 'left' ? 10 : 4} y2={height}
        stroke={on ? 'var(--live)' : 'var(--rail)'} strokeWidth={on ? 3 : 2.5} strokeLinecap="round" />
      <line x1={side === 'left' ? 10 : 0} y1={MID} x2={side === 'left' ? 14 : 4} y2={MID}
        stroke={on ? 'var(--live)' : 'var(--rail)'} strokeWidth={on ? 2.4 : 1.6} />
    </svg>
  )
}

/* ------------------------------------------------------------------ */

function CellMenu({ x, y, refCell, rung, onClose, onEdit }: {
  x: number; y: number; refCell: CellRef; rung?: Rung; onClose: () => void; onEdit: () => void
}) {
  const st = useStore()
  const act = (fn: () => void) => () => { fn(); onClose() }
  const canLink = rung ? refCell.r < rowCount(rung) - 1 : false

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
      <div style={{
        position: 'fixed', left: Math.min(x, window.innerWidth - 230), top: Math.min(y, window.innerHeight - 300),
        zIndex: 91, background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
        borderRadius: 8, boxShadow: 'var(--shadow)', padding: 4, width: 220,
      }}>
        <MenuItem icon="gear" label="Właściwości elementu…" onClick={act(onEdit)} />
        <MenuItem icon="branch" label="Dodaj gałąź równoległą" onClick={act(() => st.addBranch(refCell))} />
        <MenuItem icon="link" label={canLink ? 'Przełącz łącznik pionowy' : 'Brak wiersza poniżej'}
          disabled={!canLink} onClick={act(() => st.toggleCellLink(refCell))} />
        <Sep />
        <MenuItem icon="right" label="Wstaw kolumnę przed" onClick={act(() => st.insertColumn(refCell))} />
        <MenuItem icon="left" label="Usuń kolumnę" onClick={act(() => st.deleteColumn(refCell))} />
        <MenuItem icon="down" label="Dodaj wiersz gałęzi" onClick={act(() => st.addRungRow(refCell.rungId))} />
        <MenuItem icon="up" label="Usuń ten wiersz" disabled={(rung ? rowCount(rung) : 1) <= 1}
          onClick={act(() => st.deleteRungRow(refCell.rungId, refCell.r))} />
        <Sep />
        <MenuItem icon="trash" label="Wyczyść komórkę" danger onClick={act(() => st.clearCell(refCell))} />
      </div>
    </>
  )
}

function MenuItem({ icon, label, onClick, disabled, danger }: {
  icon: string; label: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button className={`ghost${danger ? ' danger' : ''}`} disabled={disabled} onClick={onClick}
      style={{ width: '100%', justifyContent: 'flex-start', fontSize: 12.5 }}>
      <Icon name={icon} size={14} /> {label}
    </button>
  )
}

const Sep = () => <div style={{ height: 1, background: 'var(--border)', margin: '4px 2px' }} />
