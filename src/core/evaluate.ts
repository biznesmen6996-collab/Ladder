import type { Cell, PlcValue, Rung } from './types'
import { getBlockDef, toBool, toNum } from './blocks'
import { asVariableName, evalExpr } from './expr'
import type { RuntimeEnv } from './st/interp'

export interface CellTrace {
  /** napięcie na wejściu (lewa strona) komórki */
  in: boolean
  /** napięcie na wyjściu (prawa strona) komórki */
  out: boolean
  /** stan logiczny elementu (styk zamknięty / cewka wzbudzona) */
  active: boolean
}

export interface RungTrace {
  cells: CellTrace[][]
  /** potencjały węzłów na granicach kolumn: nodes[kolumna 0..C][wiersz] */
  nodes: boolean[][]
  /** czy szczebel zawiera aktywne wyjście */
  energized: boolean
}

/** Stan zboczy (P/N) — przechowywany między cyklami przez symulator. */
export type EdgeStore = Record<string, boolean>

/** Grupuje wiersze zwarte pionowymi połączeniami na danej granicy kolumn. */
function groupRows(rung: Rung, col: number, rows: number): number[] {
  const parent = Array.from({ length: rows }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const union = (a: number, b: number) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb }
  if (col < (rung.cells[0]?.length ?? 0)) {
    for (let r = 0; r < rows - 1; r++) {
      if (rung.cells[r]?.[col]?.linkDown) union(r, r + 1)
    }
  }
  return Array.from({ length: rows }, (_, i) => find(i))
}

/**
 * Wykonuje jeden szczebel drabinki.
 * Zwraca ślad przepływu prądu wykorzystywany do animacji edytora.
 */
export function evalRung(
  rung: Rung,
  env: RuntimeEnv,
  edges: EdgeStore,
  rungKey: string,
): RungTrace {
  const rows = rung.cells.length
  const cols = rung.cells[0]?.length ?? 0
  const nodes: boolean[][] = []
  const trace: CellTrace[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ in: false, out: false, active: false })),
  )

  // granica 0 — lewa szyna zasila wiersz 0, gałęzie przez połączenia pionowe
  let raw = Array.from({ length: rows }, (_, r) => r === 0)
  nodes.push(applyLinks(rung, 0, rows, raw))

  if (!rung.enabled) {
    for (let c = 1; c <= cols; c++) nodes.push(Array.from({ length: rows }, () => false))
    return { cells: trace, nodes, energized: false }
  }

  let energized = false

  for (let c = 0; c < cols; c++) {
    const inNodes = nodes[c]
    raw = Array.from({ length: rows }, () => false)
    for (let r = 0; r < rows; r++) {
      const cell = rung.cells[r][c]
      const power = inNodes[r]
      const res = evalCell(cell, power, env, edges, `${rungKey}:${r}:${c}`)
      trace[r][c] = { in: power, out: res.out, active: res.active }
      raw[r] = res.out
      if (cell.type === 'coil' && res.active) energized = true
    }
    nodes.push(applyLinks(rung, c + 1, rows, raw))
  }

  return { cells: trace, nodes, energized }
}

function applyLinks(rung: Rung, col: number, rows: number, raw: boolean[]): boolean[] {
  const g = groupRows(rung, col, rows)
  const val = new Map<number, boolean>()
  for (let r = 0; r < rows; r++) val.set(g[r], (val.get(g[r]) ?? false) || raw[r])
  return Array.from({ length: rows }, (_, r) => val.get(g[r]) ?? false)
}

interface CellResult { out: boolean; active: boolean }

function evalCell(
  cell: Cell,
  power: boolean,
  env: RuntimeEnv,
  edges: EdgeStore,
  key: string,
): CellResult {
  switch (cell.type) {
    // pusta komórka to przerwa w obwodzie, 'wire' to narysowany odcinek szyny
    case 'empty':
      return { out: false, active: false }

    case 'wire':
      return { out: power, active: power }

    case 'contact': {
      const v = toBool(evalExpr(cell.operand ?? '', env, false))
      const kind = cell.contactKind ?? 'NO'
      let closed: boolean
      if (kind === 'NO') closed = v
      else if (kind === 'NC') closed = !v
      else {
        const prev = edges[key] ?? false
        edges[key] = v
        closed = kind === 'P' ? v && !prev : !v && prev
      }
      return { out: power && closed, active: closed }
    }

    case 'compare': {
      const a = toNum(evalExpr(cell.cmpA ?? '0', env, 0))
      const b = toNum(evalExpr(cell.cmpB ?? '0', env, 0))
      const op = cell.cmpOp ?? '>'
      const closed =
        op === '>' ? a > b : op === '>=' ? a >= b : op === '<' ? a < b :
        op === '<=' ? a <= b : op === '=' ? a === b : a !== b
      return { out: power && closed, active: closed }
    }

    case 'coil': {
      const target = (cell.operand ?? '').trim()
      const kind = cell.coilKind ?? 'COIL'
      let active = power
      if (target) {
        switch (kind) {
          case 'COIL': env.set(target, power); break
          case 'COIL_NEG': env.set(target, !power); active = !power; break
          case 'SET': if (power) env.set(target, true); active = toBool(env.get(target)); break
          case 'RESET': if (power) env.set(target, false); active = toBool(env.get(target)); break
          case 'PULSE_P': {
            const prev = edges[key] ?? false
            edges[key] = power
            active = power && !prev
            env.set(target, active)
            break
          }
          case 'PULSE_N': {
            const prev = edges[key] ?? false
            edges[key] = power
            active = !power && prev
            env.set(target, active)
            break
          }
        }
      }
      return { out: power, active }
    }

    case 'block':
      return evalBlockCell(cell, power, env, key)
  }
}

/** Pin sterowany szyną: pierwsze wejście typu BOOL bez wpisanego wyrażenia. */
export function railPin(cell: Cell): string | undefined {
  const def = getBlockDef(cell.blockType ?? '')
  if (!def) return undefined
  const boolIn = def.inputs.find((p) => p.type === 'BOOL')
  if (!boolIn) return undefined
  const pin = cell.pins?.find((p) => p.name === boolIn.name)
  return pin && pin.expr.trim() ? undefined : boolIn.name
}

function evalBlockCell(cell: Cell, powerIn: boolean, env: RuntimeEnv, key: string): CellResult {
  const type = cell.blockType ?? ''
  const def = getBlockDef(type)
  const power = cell.negEn ? !powerIn : powerIn

  // bloki użytkownika obsługiwane są przez środowisko (env.call)
  const inputPins = env.inputPins(type)
  if (!def && inputPins.length === 0 && !env.instanceType(cell.instance ?? '')) {
    return { out: false, active: false }
  }

  const rail = railPin(cell)
  const inputs: Record<string, PlcValue> = {}
  for (const pinName of inputPins) {
    const pin = cell.pins?.find((p) => p.name === pinName)
    if (pinName === rail) { inputs[pinName] = power; continue }
    const src = pin?.expr ?? ''
    if (src.trim()) inputs[pinName] = evalExpr(src, env, 0)
  }

  // bez wejścia BOOL blok pracuje jak funkcja z wejściem EN
  if (!rail && !power) return { out: false, active: false }

  const instance = cell.instance?.trim() || `__auto_${key.replace(/[^A-Za-z0-9_]/g, '_')}`
  const stateful = def ? def.stateful : true
  let outs: Record<string, PlcValue> = {}
  try {
    outs = env.call(type, stateful ? instance : undefined, inputs)
  } catch {
    return { out: false, active: false }
  }

  // zapis wyjść do zmiennych podpiętych na pinach
  for (const pin of cell.pins ?? []) {
    if (!(pin.name in outs)) continue
    const target = asVariableName(pin.expr)
    if (target) env.set(target, outs[pin.name])
  }

  const enoPin = cell.enoPin ?? def?.outputs.find((o) => o.type === 'BOOL')?.name
  const out = enoPin && enoPin in outs ? toBool(outs[enoPin]) : power
  return { out, active: out }
}
