import { tokenize, type Token } from './lexer'
import type { BinOp, CallArg, Expr, Stmt } from './ast'

export class ParseError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`${message} (linia ${line}, kolumna ${col})`)
  }
}

/** Kolejność wiązania operatorów — od najsłabszego. */
const LEVELS: BinOp[][] = [
  ['OR'],
  ['XOR'],
  ['AND'],
  ['=', '<>'],
  ['<', '>', '<=', '>='],
  ['+', '-'],
  ['*', '/', 'MOD'],
]

export class Parser {
  private t: Token[]
  private i = 0

  constructor(src: string) {
    this.t = tokenize(src)
  }

  private peek(o = 0): Token { return this.t[Math.min(this.i + o, this.t.length - 1)] }
  private next(): Token { return this.t[this.i++] }
  private at(value: string): boolean {
    const tk = this.peek()
    return (tk.kind === 'op' || tk.kind === 'kw') && tk.value === value
  }
  private accept(value: string): boolean { if (this.at(value)) { this.i++; return true } return false }
  private expect(value: string): Token {
    if (!this.at(value)) {
      const tk = this.peek()
      throw new ParseError(`Oczekiwano "${value}", znaleziono "${tk.value || 'koniec pliku'}"`, tk.line, tk.col)
    }
    return this.next()
  }

  /** Parsuje listę instrukcji do końca wejścia. */
  parseProgram(): Stmt[] {
    const out: Stmt[] = []
    while (this.peek().kind !== 'eof') {
      // pomijamy nagłówki POU i sekcje VAR — obsługiwane osobno
      if (this.skipDeclarations()) continue
      out.push(this.statement())
    }
    return out
  }

  /** Pomija nagłówki POU oraz bloki VAR ... END_VAR, jeśli występują w kodzie. */
  private skipDeclarations(): boolean {
    const tk = this.peek()
    if (tk.kind !== 'kw') return false
    if (['PROGRAM', 'FUNCTION_BLOCK', 'FUNCTION'].includes(tk.value)) {
      this.next()
      if (this.peek().kind === 'ident') this.next()
      if (this.accept(':')) this.next()
      return true
    }
    if (['END_PROGRAM', 'END_FUNCTION_BLOCK', 'END_FUNCTION'].includes(tk.value)) { this.next(); return true }
    if (tk.value.startsWith('VAR')) {
      this.next()
      while (this.peek().kind !== 'eof' && !this.at('END_VAR')) this.next()
      this.accept('END_VAR')
      return true
    }
    return false
  }

  private statementList(...terminators: string[]): Stmt[] {
    const out: Stmt[] = []
    while (this.peek().kind !== 'eof' && !terminators.some((t) => this.at(t))) {
      out.push(this.statement())
    }
    return out
  }

  private statement(): Stmt {
    const tk = this.peek()
    const line = tk.line
    if (this.accept(';')) return { k: 'nop', line }
    if (tk.kind === 'kw') {
      switch (tk.value) {
        case 'IF': return this.ifStmt()
        case 'CASE': return this.caseStmt()
        case 'FOR': return this.forStmt()
        case 'WHILE': return this.whileStmt()
        case 'REPEAT': return this.repeatStmt()
        case 'EXIT': this.next(); this.accept(';'); return { k: 'exit', line }
        case 'CONTINUE': this.next(); this.accept(';'); return { k: 'continue', line }
        case 'RETURN': this.next(); this.accept(';'); return { k: 'return', line }
      }
    }
    // przypisanie lub wywołanie
    const target = this.primary()
    if (this.accept(':=')) {
      const value = this.expression()
      this.accept(';')
      return { k: 'assign', target, value, line }
    }
    this.accept(';')
    if (target.k === 'call') return { k: 'call', name: target.name, args: target.args, line }
    if (target.k === 'var') return { k: 'call', name: target.name, args: [], line }
    throw new ParseError('Oczekiwano przypisania (:=) lub wywołania bloku', tk.line, tk.col)
  }

  private ifStmt(): Stmt {
    const line = this.peek().line
    this.expect('IF')
    const branches: { cond: Expr; body: Stmt[] }[] = []
    const cond = this.expression()
    this.expect('THEN')
    branches.push({ cond, body: this.statementList('ELSIF', 'ELSE', 'END_IF') })
    while (this.accept('ELSIF')) {
      const c = this.expression()
      this.expect('THEN')
      branches.push({ cond: c, body: this.statementList('ELSIF', 'ELSE', 'END_IF') })
    }
    let els: Stmt[] | undefined
    if (this.accept('ELSE')) els = this.statementList('END_IF')
    this.expect('END_IF')
    this.accept(';')
    return { k: 'if', branches, else: els, line }
  }

  private caseStmt(): Stmt {
    const line = this.peek().line
    this.expect('CASE')
    const sel = this.expression()
    this.expect('OF')
    const cases: { labels: (number | [number, number])[]; body: Stmt[] }[] = []
    let els: Stmt[] | undefined
    while (!this.at('END_CASE') && !this.at('ELSE') && this.peek().kind !== 'eof') {
      const labels: (number | [number, number])[] = []
      do {
        const a = this.next()
        if (a.kind !== 'num') throw new ParseError('Etykieta CASE musi być liczbą', a.line, a.col)
        if (this.accept('..')) {
          const b = this.next()
          labels.push([a.num ?? 0, b.num ?? 0])
        } else labels.push(a.num ?? 0)
      } while (this.accept(','))
      this.expect(':')
      cases.push({ labels, body: this.caseBody() })
    }
    if (this.accept('ELSE')) els = this.statementList('END_CASE')
    this.expect('END_CASE')
    this.accept(';')
    return { k: 'case', sel, cases, else: els, line }
  }

  /** Ciało gałęzi CASE — kończy się przy kolejnej etykiecie, ELSE lub END_CASE. */
  private caseBody(): Stmt[] {
    const out: Stmt[] = []
    while (this.peek().kind !== 'eof' && !this.at('END_CASE') && !this.at('ELSE')) {
      if (this.peek().kind === 'num' && [':', ',', '..'].includes(this.peek(1).value)) break
      out.push(this.statement())
    }
    return out
  }

  private forStmt(): Stmt {
    const line = this.peek().line
    this.expect('FOR')
    const v = this.next()
    if (v.kind !== 'ident') throw new ParseError('Oczekiwano zmiennej sterującej pętli', v.line, v.col)
    this.expect(':=')
    const from = this.expression()
    this.expect('TO')
    const to = this.expression()
    const by = this.accept('BY') ? this.expression() : undefined
    this.expect('DO')
    const body = this.statementList('END_FOR')
    this.expect('END_FOR')
    this.accept(';')
    return { k: 'for', varName: v.value, from, to, by, body, line }
  }

  private whileStmt(): Stmt {
    const line = this.peek().line
    this.expect('WHILE')
    const cond = this.expression()
    this.expect('DO')
    const body = this.statementList('END_WHILE')
    this.expect('END_WHILE')
    this.accept(';')
    return { k: 'while', cond, body, line }
  }

  private repeatStmt(): Stmt {
    const line = this.peek().line
    this.expect('REPEAT')
    const body = this.statementList('UNTIL')
    this.expect('UNTIL')
    const until = this.expression()
    this.expect('END_REPEAT')
    this.accept(';')
    return { k: 'repeat', body, until, line }
  }

  /* ----------------------------- wyrażenia ----------------------------- */

  expression(): Expr { return this.binary(0) }

  private binary(level: number): Expr {
    if (level >= LEVELS.length) return this.power()
    let left = this.binary(level + 1)
    for (;;) {
      const op = LEVELS[level].find((o) => this.at(o))
      if (!op) return left
      this.next()
      const right = this.binary(level + 1)
      left = { k: 'bin', op, a: left, b: right }
    }
  }

  private power(): Expr {
    const base = this.unary()
    if (this.accept('**')) return { k: 'bin', op: '**', a: base, b: this.power() }
    return base
  }

  private unary(): Expr {
    if (this.accept('NOT')) return { k: 'un', op: 'NOT', a: this.unary() }
    if (this.accept('-')) return { k: 'un', op: '-', a: this.unary() }
    if (this.accept('+')) return { k: 'un', op: '+', a: this.unary() }
    return this.primary()
  }

  private primary(): Expr {
    const tk = this.next()
    if (tk.kind === 'num') return { k: 'lit', type: 'NUM', value: tk.num ?? 0, raw: tk.value }
    if (tk.kind === 'time') return { k: 'lit', type: 'TIME', value: tk.num ?? 0, raw: tk.value }
    if (tk.kind === 'str') return { k: 'lit', type: 'STR', value: tk.value, raw: `'${tk.value}'` }
    if (tk.kind === 'kw' && (tk.value === 'TRUE' || tk.value === 'FALSE'))
      return { k: 'lit', type: 'BOOL', value: tk.value === 'TRUE', raw: tk.value }
    if (tk.kind === 'op' && tk.value === '(') {
      const e = this.expression()
      this.expect(')')
      return e
    }
    if (tk.kind === 'ident') {
      if (this.at('(')) return this.callArgs(tk.value)
      if (this.at('.')) {
        this.next()
        const pin = this.next()
        return { k: 'member', obj: tk.value, pin: pin.value }
      }
      return { k: 'var', name: tk.value }
    }
    // funkcje o nazwach będących słowami kluczowymi (NOT/MOD w formie funkcyjnej)
    if (tk.kind === 'kw' && this.at('(')) return this.callArgs(tk.value)
    throw new ParseError(`Nieoczekiwany symbol "${tk.value || 'koniec pliku'}"`, tk.line, tk.col)
  }

  private callArgs(name: string): Expr {
    this.expect('(')
    const args: CallArg[] = []
    if (!this.at(')')) {
      do {
        const save = this.i
        const tk = this.peek()
        if (tk.kind === 'ident' && (this.peek(1).value === ':=' || this.peek(1).value === '=>')) {
          this.next()
          const isOut = this.next().value === '=>'
          args.push({ name: tk.value, out: isOut, expr: this.expression() })
        } else {
          this.i = save
          args.push({ expr: this.expression() })
        }
      } while (this.accept(','))
    }
    this.expect(')')
    return { k: 'call', name, args }
  }
}

export function parseSt(src: string): Stmt[] {
  return new Parser(src).parseProgram()
}

export function parseExpression(src: string): Expr {
  return new Parser(src).expression()
}
