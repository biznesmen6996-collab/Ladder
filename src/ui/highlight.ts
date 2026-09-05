import { KEYWORDS } from '../core/st/lexer'

const TYPES = new Set([
  'BOOL', 'BYTE', 'WORD', 'DWORD', 'SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT',
  'UDINT', 'REAL', 'LREAL', 'TIME', 'STRING', 'ARRAY', 'STRUCT',
])

export interface Token { text: string; cls: string }

const RE = new RegExp([
  String.raw`\(\*[\s\S]*?\*\)`,          // komentarz blokowy
  String.raw`//[^\n]*`,                   // komentarz liniowy
  String.raw`'(?:[^'$]|\$.)*'`,           // łańcuch
  String.raw`\b(?:TIME|T)#[0-9_smhd.]+`,  // literał czasu
  String.raw`%[IQM][XBWDL]?[0-9.]+`,      // adres bezpośredni
  String.raw`\b\d+#[0-9A-Fa-f_]+\b`,      // liczba o innej podstawie
  String.raw`\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b`,
  String.raw`[\p{L}_][\p{L}\p{N}_]*`,
  String.raw`:=|=>|<=|>=|<>|\*\*|\.\.|[-+*/<>=(),;:.\[\]]`,
  String.raw`\s+`,
].join('|'), 'gu')

/** Dzieli kod ST na tokeny z klasami CSS do podświetlania składni. */
export function highlightSt(code: string): Token[] {
  const out: Token[] = []
  let last = 0
  let m: RegExpExecArray | null
  RE.lastIndex = 0
  while ((m = RE.exec(code)) !== null) {
    if (m.index > last) out.push({ text: code.slice(last, m.index), cls: '' })
    out.push({ text: m[0], cls: classify(m[0]) })
    last = m.index + m[0].length
  }
  if (last < code.length) out.push({ text: code.slice(last), cls: '' })
  return out
}

function classify(t: string): string {
  if (t.startsWith('(*') || t.startsWith('//')) return 'tok-com'
  if (t.startsWith("'")) return 'tok-str'
  if (/^\s+$/.test(t)) return ''
  if (/^(TIME|T)#/i.test(t) || /^\d/.test(t)) return 'tok-num'
  if (/^%/.test(t)) return 'tok-fn'
  if (/^[\p{L}_]/u.test(t)) {
    const up = t.toUpperCase()
    if (TYPES.has(up)) return 'tok-type'
    if (KEYWORDS.has(up)) return 'tok-kw'
    return ''
  }
  return 'tok-op'
}
