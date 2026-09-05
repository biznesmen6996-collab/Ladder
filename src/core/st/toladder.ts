import type { Cell, DataType, Rung } from '../types'
import { getBlockDef } from '../blocks'
import { DEFAULT_COLS, emptyCell, uid, wireCell } from '../grid'
import type { CallArg, Expr, Stmt } from './ast'
import { parseSt } from './parser'
import { printExpr } from './print'

/* ------------------------------------------------------------------ */
/* Sieć szeregowo-równoległa odwzorowująca wyrażenie logiczne          */
/* ------------------------------------------------------------------ */

type Net =
  | { k: 'leaf'; cell: Cell }
  | { k: 'ser'; parts: Net[] }
  | { k: 'par'; parts: Net[] }

const leaf = (cell: Cell): Net => ({ k: 'leaf', cell })

function flatten(e: Expr, op: 'AND' | 'OR'): Expr[] {
  if (e.k === 'bin' && e.op === op) return [...flatten(e.a, op), ...flatten(e.b, op)]
  return [e]
}

const CMP_OPS = ['>', '>=', '<', '<=', '=', '<>'] as const
type CmpOp = (typeof CMP_OPS)[number]

/** Buduje sieć styków odwzorowującą wyrażenie logiczne. */
export function exprToNet(e: Expr): Net {
  if (e.k === 'bin' && e.op === 'AND') return { k: 'ser', parts: flatten(e, 'AND').map(exprToNet) }
  if (e.k === 'bin' && e.op === 'OR') return { k: 'par', parts: flatten(e, 'OR').map(exprToNet) }
  if (e.k === 'bin' && (CMP_OPS as readonly string[]).includes(e.op)) {
    return leaf({ type: 'compare', cmpOp: e.op as CmpOp, cmpA: printExpr(e.a), cmpB: printExpr(e.b) })
  }
  if (e.k === 'un' && e.op === 'NOT') {
    const inner = e.a
    if (inner.k === 'var' || inner.k === 'member')
      return leaf({ type: 'contact', contactKind: 'NC', operand: printExpr(inner) })
    // negacja złożonego wyrażenia — styk z wyrażeniem w operandzie
    return leaf({ type: 'contact', contactKind: 'NO', operand: printExpr(e) })
  }
  if (e.k === 'lit' && e.type === 'BOOL') return leaf(e.value ? wireCell() : emptyCell())
  return leaf({ type: 'contact', contactKind: 'NO', operand: printExpr(e) })
}

function netSize(n: Net): { w: number; h: number } {
  if (n.k === 'leaf') return { w: 1, h: 1 }
  const sizes = n.parts.map(netSize)
  if (n.k === 'ser')
    return { w: sizes.reduce((a, s) => a + s.w, 0), h: Math.max(1, ...sizes.map((s) => s.h)) }
  return { w: Math.max(1, ...sizes.map((s) => s.w)), h: sizes.reduce((a, s) => a + s.h, 0) }
}

/** Wstawia komórkę zachowując już narysowane połączenia pionowe. */
function put(cells: Cell[][], row: number, col: number, cell: Cell) {
  const prev = cells[row][col]
  cells[row][col] = { ...cell, linkDown: cell.linkDown || prev?.linkDown || undefined }
}

function place(n: Net, cells: Cell[][], row: number, col: number, width: number) {
  if (n.k === 'leaf') {
    put(cells, row, col, n.cell)
    for (let c = col + 1; c < col + width; c++) put(cells, row, c, wireCell())
    return
  }
  if (n.k === 'ser') {
    let c = col
    for (const part of n.parts) {
      const w = netSize(part).w
      place(part, cells, row, c, w)
      c += w
    }
    for (; c < col + width; c++) put(cells, row, c, wireCell())
    return
  }
  // gałęzie równoległe: każda na pełną szerokość, zwarte pionowo na obu końcach
  const starts: number[] = []
  let r = row
  for (const part of n.parts) {
    starts.push(r)
    place(part, cells, r, col, width)
    r += netSize(part).h
  }
  for (let i = 0; i < starts.length - 1; i++) {
    for (let rr = starts[i]; rr < starts[i + 1]; rr++) {
      cells[rr][col].linkDown = true
      if (col + width < cells[rr].length) cells[rr][col + width].linkDown = true
    }
  }
}

/** Tworzy szczebel: sieć warunków po lewej, elementy wyjściowe po prawej. */
export function buildRung(net: Net | null, tail: Cell[], meta?: { comment?: string; label?: string }): Rung {
  const size = net ? netSize(net) : { w: 0, h: 1 }
  const netW = Math.max(size.w, net ? 1 : 0)
  const cols = Math.max(DEFAULT_COLS, netW + tail.length + 1)
  const rows = Math.max(1, size.h)
  const cells: Cell[][] = Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, () => (r === 0 ? wireCell() : emptyCell())))

  if (net) place(net, cells, 0, 0, netW)

  // elementy wyjściowe: cewki przy prawej szynie, bloki bezpośrednio za siecią
  const coils = tail.filter((c) => c.type === 'coil')
  const blocks = tail.filter((c) => c.type !== 'coil')
  let c = netW
  for (const b of blocks) put(cells, 0, c++, b)
  for (; c < cols - coils.length; c++) put(cells, 0, c, wireCell())
  coils.forEach((coil, i) => put(cells, 0, cols - coils.length + i, coil))

  return { id: uid('rung'), enabled: true, cells, comment: meta?.comment, label: meta?.label }
}

/* ------------------------------------------------------------------ */
/* Konwersja instrukcji ST na szczeble                                 */
/* ------------------------------------------------------------------ */

/** Konwencjonalne nazwy pinów sterowanych szyną, gdy typ bloku nie jest znany. */
const RAIL_PIN_NAMES = ['IN', 'EN', 'CLK', 'CU', 'CD', 'SET', 'SET1', 'S', 'START', 'RUN', 'REQ', 'G']

export interface ConvertOptions {
  /** zwraca typ bloku dla nazwy instancji (np. Timer1 → TON) */
  resolveInstance?(name: string): string | undefined
  /** zwraca typ danych zmiennej — pozwala odróżnić przypisanie logiczne od liczbowego */
  resolveVarType?(name: string): DataType | undefined
}

export interface StToLadderResult {
  rungs: Rung[]
  warnings: string[]
  /** instrukcje, których nie da się przedstawić graficznie */
  residual: string[]
}

const isTrue = (e: Expr) => e.k === 'lit' && e.type === 'BOOL' && e.value === true
const isFalse = (e: Expr) => e.k === 'lit' && e.type === 'BOOL' && e.value === false

function andExpr(a: Expr | null, b: Expr): Expr {
  return a ? { k: 'bin', op: 'AND', a, b } : b
}
const notExpr = (e: Expr): Expr => ({ k: 'un', op: 'NOT', a: e })

/**
 * Czy wyrażenie ma charakter logiczny (może sterować cewką).
 * Dla zmiennych i pinów bloków sprawdzamy zadeklarowany typ — bez tego
 * przypisanie liczby (np. Moc := Regulator.OUT) zamieniłoby się w cewkę.
 */
function looksBoolean(e: Expr, opts: ConvertOptions): boolean {
  switch (e.k) {
    case 'lit': return e.type === 'BOOL'
    case 'var': {
      const t = opts.resolveVarType?.(e.name)
      return t === undefined || t === 'BOOL'
    }
    case 'member': {
      const type = opts.resolveInstance?.(e.obj)
      const def = type ? getBlockDef(type) : undefined
      const pin = def?.outputs.find((o) => o.name === e.pin)
      return pin ? pin.type === 'BOOL' : true
    }
    case 'un': return e.op === 'NOT'
    case 'bin': return ['AND', 'OR', 'XOR', ...CMP_OPS].includes(e.op)
    case 'call': {
      const def = getBlockDef(e.name)
      return !def || def.outputs[0]?.type === 'BOOL'
    }
  }
}

class Converter {
  constructor(private opts: ConvertOptions = {}) {}
  rungs: Rung[] = []
  warnings: string[] = []
  residual: string[] = []

  convert(stmts: Stmt[], cond: Expr | null = null) {
    for (const s of stmts) this.stmt(s, cond)
  }

  private stmt(s: Stmt, cond: Expr | null) {
    switch (s.k) {
      case 'nop': return
      case 'assign': return this.assign(s.target, s.value, cond)
      case 'call': return this.call(s.name, s.args, cond)
      case 'if': {
        let accumulated: Expr | null = null
        for (const br of s.branches) {
          const c = accumulated ? { k: 'bin' as const, op: 'AND' as const, a: notExpr(accumulated), b: br.cond } : br.cond
          this.convert(br.body, andExpr(cond, c))
          accumulated = accumulated ? { k: 'bin', op: 'OR', a: accumulated, b: br.cond } : br.cond
        }
        if (s.else && accumulated) this.convert(s.else, andExpr(cond, notExpr(accumulated)))
        return
      }
      default:
        this.residual.push(stmtLabel(s))
        this.warnings.push(`Instrukcja ${stmtLabel(s)} nie ma odpowiednika graficznego — pozostawiono w kodzie ST`)
    }
  }

  private assign(target: Expr, value: Expr, cond: Expr | null) {
    if (target.k !== 'var') {
      this.residual.push(`${printExpr(target)} := ${printExpr(value)};`)
      return
    }
    const name = target.name
    // przypisania stałych logicznych pod warunkiem → cewki SET/RESET
    if (cond && isTrue(value)) {
      this.rungs.push(buildRung(exprToNet(cond), [{ type: 'coil', coilKind: 'SET', operand: name }],
        { comment: `IF ... THEN ${name} := TRUE;` }))
      return
    }
    if (cond && isFalse(value)) {
      this.rungs.push(buildRung(exprToNet(cond), [{ type: 'coil', coilKind: 'RESET', operand: name }],
        { comment: `IF ... THEN ${name} := FALSE;` }))
      return
    }
    if (!cond && looksBoolean(value, this.opts)) {
      this.rungs.push(buildRung(exprToNet(value), [{ type: 'coil', coilKind: 'COIL', operand: name }],
        { comment: `${name} := ${printExpr(value)};` }))
      return
    }
    // warunkowe przypisanie wartości logicznej innej niż stała — cewka pod warunkiem
    if (cond && looksBoolean(value, this.opts)) {
      const net = exprToNet({ k: 'bin', op: 'AND', a: cond, b: value })
      this.rungs.push(buildRung(net, [{ type: 'coil', coilKind: 'SET', operand: name }],
        { comment: `IF ... THEN ${name} := ${printExpr(value)};` }))
      return
    }
    // przypisanie wartości — blok MOVE sterowany warunkiem
    const move: Cell = {
      type: 'block', blockType: 'MOVE',
      pins: [{ name: 'IN', expr: printExpr(value) }, { name: 'OUT', expr: name }],
    }
    this.rungs.push(buildRung(cond ? exprToNet(cond) : null, [move],
      { comment: `${name} := ${printExpr(value)};` }))
  }

  private call(name: string, args: CallArg[], cond: Expr | null) {
    const resolvedType = getBlockDef(name) ? name : this.opts.resolveInstance?.(name)
    const def = getBlockDef(resolvedType ?? name)
    // Szyna steruje pierwszym wejściem BOOL. Gdy typ bloku jest znany i nie ma
    // takiego wejścia (np. PT1, HYST), blok pracuje jako funkcja z wejściem EN —
    // heurystyka nazw pinów obowiązuje tylko dla bloków nieznanego typu.
    const boolIn = def
      ? def.inputs.find((pin) => pin.type === 'BOOL')?.name
      : args.find((a) => a.name && !a.out && RAIL_PIN_NAMES.includes(a.name))?.name
    const pins: { name: string; expr: string }[] = []
    let rail: Expr | null = cond
    let positional = 0
    for (const a of args) {
      const pin = a.name ?? def?.inputs[positional++]?.name
      if (!pin) continue
      if (a.out) { pins.push({ name: pin, expr: printExpr(a.expr) }); continue }
      if (pin === boolIn && !cond) { rail = a.expr; continue }
      if (pin === boolIn && cond) { rail = { k: 'bin', op: 'AND', a: cond, b: a.expr }; continue }
      pins.push({ name: pin, expr: printExpr(a.expr) })
    }
    // gdy typ nie jest znany, nazwa wywołania pełni rolę i typu, i instancji
    const cell: Cell = {
      type: 'block',
      blockType: resolvedType ?? name,
      instance: def && !def.stateful ? undefined : name,
      pins,
    }
    this.rungs.push(buildRung(rail ? exprToNet(rail) : null, [cell],
      { comment: `${name}(...);` }))
  }
}

function stmtLabel(s: Stmt): string {
  switch (s.k) {
    case 'for': return 'FOR ... END_FOR'
    case 'while': return 'WHILE ... END_WHILE'
    case 'repeat': return 'REPEAT ... END_REPEAT'
    case 'case': return 'CASE ... END_CASE'
    case 'exit': return 'EXIT'
    case 'return': return 'RETURN'
    case 'continue': return 'CONTINUE'
    default: return s.k
  }
}

/** Konwertuje kod ST na drabinkę. Instrukcje bez odpowiednika trafiają do `residual`. */
export function stToLadder(src: string, opts: ConvertOptions = {}): StToLadderResult {
  const conv = new Converter(opts)
  let stmts: Stmt[]
  try {
    stmts = parseSt(src)
  } catch (e) {
    return { rungs: [], warnings: [(e as Error).message], residual: [] }
  }
  conv.convert(stmts)
  return { rungs: conv.rungs, warnings: conv.warnings, residual: conv.residual }
}
