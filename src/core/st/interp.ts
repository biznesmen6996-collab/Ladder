import type { PlcValue } from '../types'
import { toBool, toNum } from '../blocks'
import type { BinOp, CallArg, Expr, Stmt } from './ast'

/** Środowisko wykonawcze dostarczane przez symulator. */
export interface RuntimeEnv {
  get(name: string): PlcValue
  set(name: string, v: PlcValue): void
  /** typ bloku funkcyjnego, jeśli nazwa jest instancją FB */
  instanceType(name: string): string | undefined
  /** wykonanie bloku/funkcji; instance = undefined dla funkcji bezstanowych */
  call(type: string, instance: string | undefined, inputs: Record<string, PlcValue>): Record<string, PlcValue>
  /** odczyt wyjścia instancji, np. Timer1.Q */
  getMember(instance: string, pin: string): PlcValue
  /** zapis parametru instancji, np. Timer1.PT := T#2s */
  setMember(instance: string, pin: string, v: PlcValue): void
  /** nazwy pinów wejściowych bloku w kolejności (do wywołań pozycyjnych) */
  inputPins(type: string): string[]
  /** nazwy pinów wyjściowych bloku */
  outputPins?(type: string): string[]
  /** nazwa pierwszego wyjścia bloku (wynik wywołania w wyrażeniu) */
  firstOutput(type: string): string | undefined
  warn?(msg: string): void
}

export class RuntimeError extends Error {}

const BREAK = Symbol('exit')
const CONTINUE = Symbol('continue')
const RETURN = Symbol('return')
type Signal = typeof BREAK | typeof CONTINUE | typeof RETURN | undefined

const MAX_ITERATIONS = 100000

export class Interpreter {
  private iterGuard = 0

  constructor(private env: RuntimeEnv) {}

  run(stmts: Stmt[]): void {
    this.iterGuard = 0
    this.execList(stmts)
  }

  private execList(stmts: Stmt[]): Signal {
    for (const s of stmts) {
      const sig = this.exec(s)
      if (sig) return sig
    }
    return undefined
  }

  private exec(s: Stmt): Signal {
    switch (s.k) {
      case 'nop': return undefined
      case 'assign': {
        const v = this.eval(s.value)
        if (s.target.k === 'var') this.env.set(s.target.name, v)
        else if (s.target.k === 'member') this.env.setMember(s.target.obj, s.target.pin, v)
        else throw new RuntimeError('Nieprawidłowy cel przypisania')
        return undefined
      }
      case 'call': {
        this.invoke(s.name, s.args)
        return undefined
      }
      case 'if': {
        for (const br of s.branches) {
          if (toBool(this.eval(br.cond))) return this.execList(br.body)
        }
        return s.else ? this.execList(s.else) : undefined
      }
      case 'case': {
        const v = toNum(this.eval(s.sel))
        for (const c of s.cases) {
          const hit = c.labels.some((l) => (Array.isArray(l) ? v >= l[0] && v <= l[1] : v === l))
          if (hit) return this.execList(c.body)
        }
        return s.else ? this.execList(s.else) : undefined
      }
      case 'for': {
        const from = toNum(this.eval(s.from))
        const to = toNum(this.eval(s.to))
        const by = s.by ? toNum(this.eval(s.by)) : 1
        if (by === 0) throw new RuntimeError('Krok pętli FOR nie może wynosić 0')
        for (let v = from; by > 0 ? v <= to : v >= to; v += by) {
          this.tick()
          this.env.set(s.varName, v)
          const sig = this.execList(s.body)
          if (sig === BREAK) break
          if (sig === RETURN) return sig
        }
        return undefined
      }
      case 'while': {
        while (toBool(this.eval(s.cond))) {
          this.tick()
          const sig = this.execList(s.body)
          if (sig === BREAK) break
          if (sig === RETURN) return sig
        }
        return undefined
      }
      case 'repeat': {
        for (;;) {
          this.tick()
          const sig = this.execList(s.body)
          if (sig === BREAK) break
          if (sig === RETURN) return sig
          if (toBool(this.eval(s.until))) break
        }
        return undefined
      }
      case 'exit': return BREAK
      case 'continue': return CONTINUE
      case 'return': return RETURN
    }
  }

  private tick() {
    if (++this.iterGuard > MAX_ITERATIONS)
      throw new RuntimeError('Przekroczono limit iteracji — prawdopodobnie pętla nieskończona')
  }

  /** Wywołanie bloku funkcyjnego lub funkcji; zwraca mapę wyjść. */
  private invoke(name: string, args: CallArg[]): Record<string, PlcValue> {
    const instType = this.env.instanceType(name)
    const type = instType ?? name
    const pins = this.env.inputPins(type)
    const inputs: Record<string, PlcValue> = {}
    const outBindings: { pin: string; target: Expr }[] = []
    let positional = 0
    for (const a of args) {
      if (a.name && a.out) { outBindings.push({ pin: a.name, target: a.expr }); continue }
      if (a.name) { inputs[a.name] = this.eval(a.expr); continue }
      const pin = pins[positional++]
      if (!pin) throw new RuntimeError(`Za dużo argumentów w wywołaniu ${name}`)
      inputs[pin] = this.eval(a.expr)
    }
    const outs = this.env.call(type, instType ? name : undefined, inputs)
    for (const b of outBindings) {
      if (b.target.k === 'var') this.env.set(b.target.name, outs[b.pin] ?? false)
    }
    return outs
  }

  eval(e: Expr): PlcValue {
    switch (e.k) {
      case 'lit': return e.value
      case 'var': return this.env.get(e.name)
      case 'member': return this.env.getMember(e.obj, e.pin)
      case 'un': {
        const a = this.eval(e.a)
        if (e.op === 'NOT') return typeof a === 'number' ? ~a >>> 0 : !toBool(a)
        if (e.op === '-') return -toNum(a)
        return toNum(a)
      }
      case 'bin': return this.binary(e.op, e.a, e.b)
      case 'call': {
        const outs = this.invoke(e.name, e.args)
        const type = this.env.instanceType(e.name) ?? e.name
        const first = this.env.firstOutput(type)
        return first !== undefined ? (outs[first] ?? false) : false
      }
    }
  }

  private binary(op: BinOp, ea: Expr, eb: Expr): PlcValue {
    // skrócone obliczanie dla operatorów logicznych na wartościach BOOL
    if (op === 'AND') {
      const a = this.eval(ea)
      if (typeof a === 'number') return (a & toNum(this.eval(eb))) >>> 0
      if (!toBool(a)) return false
      return toBool(this.eval(eb))
    }
    if (op === 'OR') {
      const a = this.eval(ea)
      if (typeof a === 'number') return (a | toNum(this.eval(eb))) >>> 0
      if (toBool(a)) return true
      return toBool(this.eval(eb))
    }
    const a = this.eval(ea)
    const b = this.eval(eb)
    switch (op) {
      case 'XOR':
        return typeof a === 'number' && typeof b === 'number' ? (a ^ b) >>> 0 : toBool(a) !== toBool(b)
      case '=': return typeof a === 'string' || typeof b === 'string' ? String(a) === String(b) : looseEq(a, b)
      case '<>': return typeof a === 'string' || typeof b === 'string' ? String(a) !== String(b) : !looseEq(a, b)
      case '<': return toNum(a) < toNum(b)
      case '>': return toNum(a) > toNum(b)
      case '<=': return toNum(a) <= toNum(b)
      case '>=': return toNum(a) >= toNum(b)
      case '+':
        if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b)
        return toNum(a) + toNum(b)
      case '-': return toNum(a) - toNum(b)
      case '*': return toNum(a) * toNum(b)
      case '/': { const d = toNum(b); return d === 0 ? 0 : toNum(a) / d }
      case 'MOD': { const d = toNum(b); return d === 0 ? 0 : toNum(a) % d }
      case '**': return Math.pow(toNum(a), toNum(b))
      default: throw new RuntimeError(`Nieznany operator ${String(op)}`)
    }
  }
}

function looseEq(a: PlcValue, b: PlcValue): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') return toBool(a) === toBool(b)
  return toNum(a) === toNum(b)
}
