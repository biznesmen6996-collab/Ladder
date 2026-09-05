import type { Expr } from './ast'

const PREC: Record<string, number> = {
  OR: 1, XOR: 2, AND: 3, '=': 4, '<>': 4, '<': 5, '>': 5, '<=': 5, '>=': 5,
  '+': 6, '-': 6, '*': 7, '/': 7, MOD: 7, '**': 8,
}

/** Zamienia drzewo wyrażenia z powrotem na tekst ST. */
export function printExpr(e: Expr, parentPrec = 0): string {
  switch (e.k) {
    case 'lit': return e.raw
    case 'var': return e.name
    case 'member': return `${e.obj}.${e.pin}`
    case 'un': {
      const inner = printExpr(e.a, 9)
      return e.op === 'NOT' ? `NOT ${inner}` : `${e.op}${inner}`
    }
    case 'bin': {
      const prec = PREC[e.op] ?? 0
      const text = `${printExpr(e.a, prec)} ${e.op} ${printExpr(e.b, prec + 1)}`
      return prec < parentPrec ? `(${text})` : text
    }
    case 'call': {
      const args = e.args.map((a) =>
        a.name ? `${a.name} ${a.out ? '=>' : ':='} ${printExpr(a.expr)}` : printExpr(a.expr))
      return `${e.name}(${args.join(', ')})`
    }
  }
}
