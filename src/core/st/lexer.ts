/** Lekser języka Structured Text (podzbiór IEC 61131-3). */

export type TokKind = 'ident' | 'kw' | 'num' | 'time' | 'str' | 'op' | 'eof'

export interface Token {
  kind: TokKind
  value: string
  /** wartość liczbowa dla num/time (TIME w milisekundach) */
  num?: number
  pos: number
  line: number
  col: number
}

export const KEYWORDS = new Set([
  'IF', 'THEN', 'ELSIF', 'ELSE', 'END_IF',
  'CASE', 'OF', 'END_CASE',
  'FOR', 'TO', 'BY', 'DO', 'END_FOR',
  'WHILE', 'END_WHILE',
  'REPEAT', 'UNTIL', 'END_REPEAT',
  'EXIT', 'RETURN', 'CONTINUE',
  'AND', 'OR', 'XOR', 'NOT', 'MOD',
  'TRUE', 'FALSE',
  'VAR', 'VAR_INPUT', 'VAR_OUTPUT', 'VAR_IN_OUT', 'VAR_GLOBAL', 'VAR_TEMP', 'END_VAR',
  'PROGRAM', 'END_PROGRAM', 'FUNCTION_BLOCK', 'END_FUNCTION_BLOCK', 'FUNCTION', 'END_FUNCTION',
  'RETAIN', 'CONSTANT', 'AT',
])

/** Znaki dopuszczalne w nazwach zmiennych — litery dowolnego alfabetu, cyfry i podkreślenie. */
export const IDENT_START = /[\p{L}_]/u
export const IDENT_PART = /[\p{L}\p{N}_]/u

const OPS = [
  ':=', '=>', '<=', '>=', '<>', '**', '..',
  '+', '-', '*', '/', '(', ')', '[', ']', ',', ';', ':', '.', '<', '>', '=', '#', '%',
]

export class LexError extends Error {
  constructor(message: string, public line: number, public col: number) {
    super(`${message} (linia ${line}, kolumna ${col})`)
  }
}

/** Zamienia literał czasu IEC (T#1h30m, TIME#500ms) na milisekundy. */
export function parseTimeLiteral(text: string): number {
  const body = text.replace(/^(TIME|T)#/i, '').replace(/_/g, '')
  const re = /(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)/gi
  let ms = 0
  let matched = false
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    matched = true
    const v = parseFloat(m[1])
    switch (m[2].toLowerCase()) {
      case 'ms': ms += v; break
      case 's': ms += v * 1000; break
      case 'm': ms += v * 60000; break
      case 'h': ms += v * 3600000; break
      case 'd': ms += v * 86400000; break
    }
  }
  if (!matched) ms = parseFloat(body) || 0
  return ms
}

/** Formatuje milisekundy jako literał TIME. */
export function formatTime(ms: number): string {
  if (!isFinite(ms)) return 'T#0s'
  const neg = ms < 0
  let v = Math.abs(Math.round(ms))
  const d = Math.floor(v / 86400000); v -= d * 86400000
  const h = Math.floor(v / 3600000); v -= h * 3600000
  const m = Math.floor(v / 60000); v -= m * 60000
  const s = Math.floor(v / 1000); v -= s * 1000
  let out = ''
  if (d) out += `${d}d`
  if (h) out += `${h}h`
  if (m) out += `${m}m`
  if (s) out += `${s}s`
  if (v || !out) out += `${v}ms`
  return `${neg ? '-' : ''}T#${out}`
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = []
  let i = 0, line = 1, col = 1
  const adv = (n = 1) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1 } else col++; i++ } }

  while (i < src.length) {
    const ch = src[i]
    // białe znaki
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') { adv(); continue }
    // komentarze
    if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') adv(); continue }
    if (ch === '(' && src[i + 1] === '*') {
      adv(2)
      while (i < src.length && !(src[i] === '*' && src[i + 1] === ')')) adv()
      adv(2); continue
    }
    const startLine = line, startCol = col, start = i

    // literał czasu: T#..., TIME#...
    const timeMatch = /^(TIME|T)#[0-9_smhd.]+/i.exec(src.slice(i))
    if (timeMatch && /^[A-Za-z]/.test(ch)) {
      const text = timeMatch[0]
      adv(text.length)
      toks.push({ kind: 'time', value: text, num: parseTimeLiteral(text), pos: start, line: startLine, col: startCol })
      continue
    }
    // identyfikator / słowo kluczowe (dopuszczamy litery narodowe, np. "ZawórSpust")
    if (IDENT_START.test(ch)) {
      let j = i
      while (j < src.length && IDENT_PART.test(src[j])) j++
      const text = src.slice(i, j)
      adv(j - i)
      const up = text.toUpperCase()
      toks.push({ kind: KEYWORDS.has(up) ? 'kw' : 'ident', value: KEYWORDS.has(up) ? up : text, pos: start, line: startLine, col: startCol })
      continue
    }
    // liczba (w tym 16#FF, 2#1010)
    if (/[0-9]/.test(ch)) {
      const based = /^(\d+)#([0-9A-Fa-f_]+)/.exec(src.slice(i))
      if (based) {
        adv(based[0].length)
        toks.push({ kind: 'num', value: based[0], num: parseInt(based[2].replace(/_/g, ''), parseInt(based[1], 10)) || 0, pos: start, line: startLine, col: startCol })
        continue
      }
      let j = i
      while (j < src.length && /[0-9_]/.test(src[j])) j++
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) { j++; while (j < src.length && /[0-9_]/.test(src[j])) j++ }
      if (/[eE]/.test(src[j] ?? '')) {
        let k = j + 1
        if (/[+-]/.test(src[k] ?? '')) k++
        if (/[0-9]/.test(src[k] ?? '')) { k++; while (k < src.length && /[0-9]/.test(src[k])) k++; j = k }
      }
      const text = src.slice(i, j)
      adv(j - i)
      toks.push({ kind: 'num', value: text, num: parseFloat(text.replace(/_/g, '')), pos: start, line: startLine, col: startCol })
      continue
    }
    // łańcuch znaków
    if (ch === "'" || ch === '"') {
      const quote = ch
      adv()
      let out = ''
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '$' && src[i + 1]) {
          const esc = src[i + 1]
          out += esc === 'N' || esc === 'n' ? '\n' : esc === 'T' || esc === 't' ? '\t' : esc
          adv(2); continue
        }
        out += src[i]; adv()
      }
      adv()
      toks.push({ kind: 'str', value: out, pos: start, line: startLine, col: startCol })
      continue
    }
    // adres bezpośredni %IX0.0
    if (ch === '%') {
      const m = /^%[IQM][XBWDL]?[0-9]+(\.[0-9]+)?/i.exec(src.slice(i))
      if (m) {
        adv(m[0].length)
        toks.push({ kind: 'ident', value: m[0], pos: start, line: startLine, col: startCol })
        continue
      }
    }
    // operatory
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      adv(op.length)
      toks.push({ kind: 'op', value: op, pos: start, line: startLine, col: startCol })
      continue
    }
    throw new LexError(`Nieoczekiwany znak "${ch}"`, line, col)
  }
  toks.push({ kind: 'eof', value: '', pos: i, line, col })
  return toks
}
