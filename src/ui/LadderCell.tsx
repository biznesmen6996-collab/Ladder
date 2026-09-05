import { memo } from 'react'
import type { Cell } from '../core/types'
import type { CellTrace } from '../core/evaluate'
import { getBlockDef } from '../core/blocks'

export const COL_W = 88
export const ROW_H = 62
export const MID = 31
const BLOCK_MIN_W = 140
const PIN_STEP = 15
/** Przybliżona szerokość znaku przy foncie 9,5 px w kroju o stałej szerokości. */
const CH = 5.8

const label = (pin: string, expr?: string) => (expr ? `${pin} ${expr}` : pin)

/** Rozmiar komórki — bloki rosną wraz z liczbą pinów i długością podpiętych nazw. */
export function cellSize(cell: Cell): { w: number; h: number } {
  if (cell.type === 'compare') {
    const text = `${cell.cmpA ?? '?'} ${cell.cmpOp ?? '>'} ${cell.cmpB ?? '?'}`
    return { w: Math.max(COL_W, 28 + text.length * 6.4), h: ROW_H }
  }
  if (cell.type !== 'block') return { w: COL_W, h: ROW_H }
  const def = getBlockDef(cell.blockType ?? '')
  const inputs = def?.inputs ?? []
  const outputs = def?.outputs ?? []
  const rows = Math.max(inputs.length, outputs.length, 1)
  const pinExpr = (name: string) => cell.pins?.find((x) => x.name === name)?.expr
  const inW = Math.max(0, ...inputs.map((pin, i) =>
    label(pin.name, i === 0 && !pinExpr(pin.name) ? undefined : pinExpr(pin.name)).length * CH))
  const outW = Math.max(0, ...outputs.map((pin) => label(pin.name, pinExpr(pin.name)).length * CH))
  const titleW = (cell.blockType ?? '').length * 7 + 20
  const boxW = Math.max(titleW, inW + outW + 22)
  return { w: Math.max(BLOCK_MIN_W, boxW + 28), h: Math.max(ROW_H, 30 + rows * PIN_STEP + 14) }
}

interface Props {
  cell: Cell
  /** wymuszona szerokość/wysokość komórki (wyrównanie kolumn i wierszy siatki) */
  width?: number
  height?: number
  trace?: CellTrace
  linkDown?: boolean
  linkUp?: boolean
  /** potencjał węzła po lewej stronie (dla rysowania połączeń pionowych) */
  nodeIn?: boolean
  nodeOut?: boolean
  selected?: boolean
  live?: boolean
  onClick?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onPointerDown?: (e: React.PointerEvent) => void
  onPointerUp?: () => void
}

const ON = 'var(--live)'
const OFF = 'var(--rail)'
const TXT = 'var(--text)'
const DIM = 'var(--text-dim)'

function wire(x1: number, x2: number, on: boolean, y = MID) {
  return <line x1={x1} y1={y} x2={x2} y2={y} stroke={on ? ON : OFF} strokeWidth={on ? 2.4 : 1.6} strokeLinecap="round" />
}

function LadderCellBase({
  cell, width, height, trace, linkDown, linkUp, nodeIn, nodeOut, selected, live,
  onClick, onDoubleClick, onContextMenu, onPointerDown, onPointerUp,
}: Props) {
  const natural = cellSize(cell)
  const size = { w: width ?? natural.w, h: height ?? natural.h }
  const powerIn = live ? !!trace?.in : false
  const powerOut = live ? !!trace?.out : false
  const active = live ? !!trace?.active : false

  return (
    <div
      className={`cell${selected ? ' sel' : ''}`}
      style={{ width: size.w, height: size.h }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      role="gridcell"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onDoubleClick?.() } }}
    >
      <svg width={size.w} height={size.h} viewBox={`0 0 ${size.w} ${size.h}`} style={{ display: 'block' }}>
        {/* połączenia pionowe (gałęzie równoległe) */}
        {linkUp && (
          <line x1={1.5} y1={0} x2={1.5} y2={MID} stroke={live && nodeIn ? ON : OFF} strokeWidth={live && nodeIn ? 2.4 : 1.6} />
        )}
        {linkDown && (
          <line x1={1.5} y1={MID} x2={1.5} y2={size.h} stroke={live && nodeIn ? ON : OFF} strokeWidth={live && nodeIn ? 2.4 : 1.6} />
        )}
        {(linkUp || linkDown) && (
          <circle cx={1.5} cy={MID} r={2.6} fill={live && nodeIn ? ON : OFF} />
        )}
        <Symbol cell={cell} size={size} powerIn={powerIn} powerOut={powerOut} active={active} live={!!live} nodeOut={!!nodeOut} />
      </svg>
      <div className="cell-hit" />
    </div>
  )
}

interface SymProps {
  cell: Cell
  size: { w: number; h: number }
  powerIn: boolean
  powerOut: boolean
  active: boolean
  live: boolean
  nodeOut: boolean
}

function Symbol({ cell, size, powerIn, powerOut, active, live }: SymProps) {
  const { w } = size
  switch (cell.type) {
    case 'empty':
      return <line x1={0} y1={MID} x2={w} y2={MID} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 4" />

    case 'wire':
      return wire(0, w, powerIn)

    case 'contact': {
      const kind = cell.contactKind ?? 'NO'
      const c = live && active ? ON : OFF
      return (
        <g>
          {wire(0, 34, powerIn)}
          {wire(54, w, powerOut)}
          <line x1={34} y1={17} x2={34} y2={45} stroke={c} strokeWidth={2.6} strokeLinecap="round" />
          <line x1={54} y1={17} x2={54} y2={45} stroke={c} strokeWidth={2.6} strokeLinecap="round" />
          {kind === 'NC' && <line x1={31} y1={45} x2={57} y2={17} stroke={c} strokeWidth={2.2} strokeLinecap="round" />}
          {(kind === 'P' || kind === 'N') && (
            <text x={44} y={36} textAnchor="middle" fontSize={13} fontWeight={700} fill={c} fontFamily="var(--mono)">
              {kind}
            </text>
          )}
          <Label x={w / 2} text={cell.operand || '???'} muted={!cell.operand} />
          <text x={w / 2} y={58} textAnchor="middle" fontSize={9} fill="var(--text-faint)">
            {kind === 'NO' ? '' : kind === 'NC' ? 'zestyk NC' : kind === 'P' ? 'zbocze ↑' : 'zbocze ↓'}
          </text>
        </g>
      )
    }

    case 'compare': {
      const c = live && active ? ON : OFF
      const bw = w - 16
      return (
        <g>
          {wire(0, 8, powerIn)}
          {wire(w - 8, w, powerOut)}
          <rect x={8} y={16} width={bw} height={30} rx={4} fill="var(--bg-panel)" stroke={c} strokeWidth={1.8} />
          <text x={w / 2} y={35} textAnchor="middle" fontSize={11} fill={TXT} fontFamily="var(--mono)">
            {cell.cmpA || '?'} {cell.cmpOp ?? '>'} {cell.cmpB || '?'}
          </text>
          <text x={w / 2} y={11} textAnchor="middle" fontSize={9} fill="var(--text-faint)">porównanie</text>
        </g>
      )
    }

    case 'coil': {
      const kind = cell.coilKind ?? 'COIL'
      const c = live && active ? ON : OFF
      const letter = kind === 'SET' ? 'S' : kind === 'RESET' ? 'R'
        : kind === 'PULSE_P' ? 'P' : kind === 'PULSE_N' ? 'N' : kind === 'COIL_NEG' ? '/' : ''
      return (
        <g>
          {wire(0, 32, powerIn)}
          {wire(56, w, powerOut)}
          <path d="M 34 17 A 15 15 0 0 0 34 45" fill="none" stroke={c} strokeWidth={2.6} strokeLinecap="round" />
          <path d="M 54 17 A 15 15 0 0 1 54 45" fill="none" stroke={c} strokeWidth={2.6} strokeLinecap="round" />
          {letter && (
            <text x={44} y={36} textAnchor="middle" fontSize={13} fontWeight={700} fill={c} fontFamily="var(--mono)">
              {letter}
            </text>
          )}
          <Label x={w / 2} text={cell.operand || '???'} muted={!cell.operand} />
          <text x={w / 2} y={58} textAnchor="middle" fontSize={9} fill="var(--text-faint)">
            {kind === 'SET' ? 'ustaw' : kind === 'RESET' ? 'zeruj' : kind === 'COIL_NEG' ? 'zanegowana' : ''}
          </text>
        </g>
      )
    }

    case 'block':
      return <BlockSymbol cell={cell} size={size} powerIn={powerIn} powerOut={powerOut} live={live} />
  }
}

function BlockSymbol({ cell, size, powerIn, powerOut, live }: {
  cell: Cell; size: { w: number; h: number }; powerIn: boolean; powerOut: boolean; live: boolean
}) {
  const def = getBlockDef(cell.blockType ?? '')
  const inputs = def?.inputs ?? []
  const outputs = def?.outputs ?? []
  const bx = 14
  const bw = size.w - 28
  const by = 8
  const bh = size.h - 16
  const enoPin = cell.enoPin ?? outputs.find((o) => o.type === 'BOOL')?.name
  const enoIdx = Math.max(0, outputs.findIndex((o) => o.name === enoPin))
  const enoY = MID + enoIdx * PIN_STEP
  const borderColor = live && powerIn ? ON : 'var(--border-strong)'

  return (
    <g>
      {wire(0, bx, powerIn)}
      <rect x={bx} y={by} width={bw} height={bh} rx={5} fill="var(--bg-panel)" stroke={borderColor} strokeWidth={1.8} />
      <line x1={bx} y1={by + 19} x2={bx + bw} y2={by + 19} stroke="var(--border)" strokeWidth={1} />
      <text x={bx + bw / 2} y={by + 14} textAnchor="middle" fontSize={11} fontWeight={700} fill={TXT} fontFamily="var(--mono)">
        {cell.blockType}
      </text>
      {cell.instance && (
        <text x={bx + bw / 2} y={size.h - 2} textAnchor="middle" fontSize={9} fill="var(--accent)" fontFamily="var(--mono)">
          {cell.instance}
        </text>
      )}
      {inputs.map((p, i) => {
        const y = MID + i * PIN_STEP
        const bound = cell.pins?.find((x) => x.name === p.name)?.expr
        const railDriven = i === 0 && p.type === 'BOOL' && !bound
        return (
          <g key={p.name}>
            <text x={bx + 5} y={y + 3.5} fontSize={9.5} fontFamily="var(--mono)"
              fill={railDriven ? 'var(--accent)' : DIM}>{p.name}</text>
            {bound && (
              <text x={bx + 5 + (p.name.length + 1) * CH} y={y + 3.5} fontSize={9.5}
                fill="var(--text-faint)" fontFamily="var(--mono)">{bound}</text>
            )}
          </g>
        )
      })}
      {outputs.map((p, i) => {
        const y = MID + i * PIN_STEP
        const bound = cell.pins?.find((x) => x.name === p.name)?.expr
        return (
          <g key={p.name}>
            <text x={bx + bw - 5} y={y + 3.5} fontSize={9.5} fill={DIM} textAnchor="end" fontFamily="var(--mono)">
              {p.name}
            </text>
            {bound && (
              <text x={bx + bw - 5 - (p.name.length + 1) * CH} y={y + 3.5} fontSize={9.5}
                fill="var(--text-faint)" textAnchor="end" fontFamily="var(--mono)">{bound}</text>
            )}
          </g>
        )
      })}
      {/* wyprowadzenie zasilania dalej w prawo */}
      <path
        d={`M ${bx + bw} ${enoY} H ${bx + bw + 6} V ${MID} H ${size.w}`}
        fill="none"
        stroke={live && powerOut ? ON : OFF}
        strokeWidth={live && powerOut ? 2.4 : 1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

function Label({ x, text, muted }: { x: number; text: string; muted?: boolean }) {
  return (
    <text x={x} y={11} textAnchor="middle" fontSize={10.5} fontFamily="var(--mono)"
      fill={muted ? 'var(--err)' : TXT}>
      {truncate(text, 12)}
    </text>
  )
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export const LadderCell = memo(LadderCellBase)
