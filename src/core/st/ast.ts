/** Drzewo składniowe podzbioru Structured Text. */

export type Expr =
  | { k: 'lit'; type: 'BOOL' | 'NUM' | 'TIME' | 'STR'; value: boolean | number | string; raw: string }
  | { k: 'var'; name: string }
  | { k: 'member'; obj: string; pin: string }
  | { k: 'un'; op: 'NOT' | '-' | '+'; a: Expr }
  | { k: 'bin'; op: BinOp; a: Expr; b: Expr }
  | { k: 'call'; name: string; args: CallArg[] }

export type BinOp =
  | 'OR' | 'XOR' | 'AND' | '=' | '<>' | '<' | '>' | '<=' | '>=' | '+' | '-' | '*' | '/' | 'MOD' | '**'

export interface CallArg {
  /** nazwa pinu przy wywołaniu nazwanym (IN := x) */
  name?: string
  /** true dla wyjścia (Q => zmienna) */
  out?: boolean
  expr: Expr
}

export type Stmt =
  | { k: 'assign'; target: Expr; value: Expr; line: number }
  | { k: 'call'; name: string; args: CallArg[]; line: number }
  | { k: 'if'; branches: { cond: Expr; body: Stmt[] }[]; else?: Stmt[]; line: number }
  | { k: 'case'; sel: Expr; cases: { labels: (number | [number, number])[]; body: Stmt[] }[]; else?: Stmt[]; line: number }
  | { k: 'for'; varName: string; from: Expr; to: Expr; by?: Expr; body: Stmt[]; line: number }
  | { k: 'while'; cond: Expr; body: Stmt[]; line: number }
  | { k: 'repeat'; body: Stmt[]; until: Expr; line: number }
  | { k: 'nop'; line: number }
  | { k: 'exit'; line: number }
  | { k: 'continue'; line: number }
  | { k: 'return'; line: number }
