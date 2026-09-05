import type { Cell, Rung } from './types'
import { getBlockDef } from './blocks'

export const DEFAULT_COLS = 7
export const DEFAULT_ROWS = 1
export const MAX_COLS = 24
export const MAX_ROWS = 12

let seq = 0
export function uid(prefix = 'id'): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
}

export const emptyCell = (): Cell => ({ type: 'empty' })
export const wireCell = (): Cell => ({ type: 'wire' })

/** Nowy szczebel: pierwszy wiersz to ciągła szyna, kolejne wiersze są puste. */
export function makeRung(cols = DEFAULT_COLS, rows = DEFAULT_ROWS): Rung {
  return {
    id: uid('rung'),
    enabled: true,
    comment: '',
    cells: Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, r === 0 ? wireCell : emptyCell)),
  }
}

export const rowCount = (r: Rung) => r.cells.length
export const colCount = (r: Rung) => (r.cells[0]?.length ?? 0)

/** Głęboka kopia szczebla (z nowym identyfikatorem, gdy fresh=true). */
export function cloneRung(r: Rung, fresh = false): Rung {
  return {
    ...r,
    id: fresh ? uid('rung') : r.id,
    cells: r.cells.map((row) => row.map((c) => ({ ...c, pins: c.pins?.map((p) => ({ ...p })) }))),
  }
}

function ensureRect(rung: Rung) {
  const cols = Math.max(1, ...rung.cells.map((r) => r.length))
  rung.cells = rung.cells.map((row) => {
    const copy = row.slice()
    while (copy.length < cols) copy.push(emptyCell())
    return copy
  })
}

export function setCell(rung: Rung, r: number, c: number, cell: Cell): Rung {
  const out = cloneRung(rung)
  while (out.cells.length <= r) out.cells.push(Array.from({ length: colCount(out) }, emptyCell))
  ensureRect(out)
  out.cells[r][c] = cell
  return out
}

export function addRow(rung: Rung, at?: number): Rung {
  const out = cloneRung(rung)
  if (rowCount(out) >= MAX_ROWS) return out
  const row = Array.from({ length: colCount(out) }, emptyCell)
  out.cells.splice(at ?? out.cells.length, 0, row)
  return out
}

export function removeRow(rung: Rung, at: number): Rung {
  const out = cloneRung(rung)
  if (rowCount(out) <= 1) return out
  out.cells.splice(at, 1)
  return out
}

export function addColumn(rung: Rung, at?: number): Rung {
  const out = cloneRung(rung)
  if (colCount(out) >= MAX_COLS) return out
  const idx = at ?? colCount(out)
  out.cells.forEach((row) => row.splice(idx, 0, emptyCell()))
  return out
}

export function removeColumn(rung: Rung, at: number): Rung {
  const out = cloneRung(rung)
  if (colCount(out) <= 2) return out
  out.cells.forEach((row) => row.splice(at, 1))
  return out
}

/** Przełącza pionowe połączenie po lewej stronie komórki (r,c) z wierszem poniżej. */
export function toggleLink(rung: Rung, r: number, c: number): Rung {
  const out = cloneRung(rung)
  if (r >= rowCount(out) - 1) return out
  out.cells[r][c].linkDown = !out.cells[r][c].linkDown
  return out
}

/**
 * Tworzy gałąź równoległą do zaznaczonego zakresu kolumn:
 * dodaje wiersz pod spodem i zwiera go z wierszem źródłowym na obu końcach.
 */
export function addParallelBranch(rung: Rung, row: number, fromCol: number, toCol: number): Rung {
  let out = addRow(rung, row + 1)
  const lo = Math.max(0, Math.min(fromCol, toCol))
  const hi = Math.min(colCount(out) - 1, Math.max(fromCol, toCol))
  out = cloneRung(out)
  out.cells[row][lo].linkDown = true
  if (hi + 1 < colCount(out)) out.cells[row][hi + 1].linkDown = true
  for (let c = lo; c <= hi; c++) out.cells[row + 1][c] = { type: 'wire' }
  return out
}

/** Usuwa puste wiersze na końcu i przycina nadmiarowe kolumny po prawej. */
export function trimRung(rung: Rung): Rung {
  const out = cloneRung(rung)
  while (rowCount(out) > 1) {
    const last = out.cells[rowCount(out) - 1]
    const prevHasLink = out.cells[rowCount(out) - 2].some((c) => c.linkDown)
    if (last.every((c) => c.type === 'empty' && !c.linkDown) && !prevHasLink) out.cells.pop()
    else break
  }
  while (colCount(out) > DEFAULT_COLS) {
    const idx = colCount(out) - 1
    if (out.cells.every((row) => row[idx].type === 'empty' && !row[idx].linkDown)) {
      out.cells.forEach((row) => row.pop())
    } else break
  }
  return out
}

/** Czy komórka jest wyjściem (cewką) — cewki muszą przylegać do prawej szyny. */
export const isOutputCell = (cell: Cell) => cell.type === 'coil'

/** Domyślne piny dla nowo wstawianego bloku. */
export function defaultPins(blockType: string) {
  const def = getBlockDef(blockType)
  if (!def) return []
  return [
    ...def.inputs.map((p) => ({ name: p.name, expr: p.default ?? '' })),
    ...def.outputs.map((p) => ({ name: p.name, expr: '' })),
  ]
}

/** Pin, który podaje napięcie w prawo (ENO) — pierwsze wyjście BOOL albo przelot EN. */
export function defaultEnoPin(blockType: string): string | undefined {
  const def = getBlockDef(blockType)
  if (!def) return undefined
  const boolOut = def.outputs.find((o) => o.type === 'BOOL')
  return boolOut?.name
}

/** Czy w szczeblu jest jakikolwiek element (do walidacji). */
export function rungIsEmpty(rung: Rung): boolean {
  return rung.cells.every((row) => row.every((c) => c.type === 'empty'))
}
