import type { PlcValue } from './types'
import { parseExpression } from './st/parser'
import type { Expr } from './st/ast'
import { Interpreter, type RuntimeEnv } from './st/interp'

const cache = new Map<string, Expr | null>()

/** Parsuje wyrażenie ST z pamięcią podręczną; null gdy wyrażenie jest błędne lub puste. */
export function compileExpr(src: string): Expr | null {
  const key = src.trim()
  if (!key) return null
  if (cache.has(key)) return cache.get(key) ?? null
  let ast: Expr | null = null
  try { ast = parseExpression(key) } catch { ast = null }
  cache.set(key, ast)
  return ast
}

export function exprError(src: string): string | null {
  if (!src.trim()) return null
  try { parseExpression(src); return null } catch (e) { return (e as Error).message }
}

/** Oblicza wyrażenie w danym środowisku; fallback gdy wyrażenie jest puste/niepoprawne. */
export function evalExpr(src: string, env: RuntimeEnv, fallback: PlcValue = false): PlcValue {
  const ast = compileExpr(src)
  if (!ast) return fallback
  try { return new Interpreter(env).eval(ast) } catch { return fallback }
}

/** Zwraca nazwę zmiennej, jeśli wyrażenie jest prostym identyfikatorem. */
export function asVariableName(src: string): string | null {
  const ast = compileExpr(src)
  return ast && ast.k === 'var' ? ast.name : null
}

export function clearExprCache() { cache.clear() }
