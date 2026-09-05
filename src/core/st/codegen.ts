import type { Cell, Pou, Project, Rung, Variable } from '../types'
import { getBlockDef } from '../blocks'
import { formatTime } from './lexer'

/* Budowanie wyrażeń logicznych z zachowaniem minimalnej liczby nawiasów. */
interface E { t: string; p: number }   // p: 0 = atom, 1 = AND, 2 = OR
const atom = (t: string): E => ({ t, p: 0 })
const TRUE: E = atom('TRUE')

const wrap = (e: E, max: number) => (e.p > max ? `(${e.t})` : e.t)

function and(a: E, b: E): E {
  if (a.t === 'TRUE') return b
  if (b.t === 'TRUE') return a
  if (a.t === 'FALSE' || b.t === 'FALSE') return atom('FALSE')
  return { t: `${wrap(a, 1)} AND ${wrap(b, 1)}`, p: 1 }
}
function or(a: E, b: E): E {
  if (a.t === 'FALSE') return b
  if (b.t === 'FALSE') return a
  if (a.t === 'TRUE' || b.t === 'TRUE') return TRUE
  return { t: `${wrap(a, 2)} OR ${wrap(b, 2)}`, p: 2 }
}
function not(a: E): E {
  if (a.t === 'TRUE') return atom('FALSE')
  if (a.t === 'FALSE') return TRUE
  return { t: `NOT ${wrap(a, 0)}`, p: 0 }
}

export interface CodegenResult {
  code: string
  /** dodatkowe zmienne pomocnicze wygenerowane dla styków zboczowych */
  aux: Variable[]
  warnings: string[]
}

/** Konwertuje pojedynczy szczebel drabinki na instrukcje ST. */
export function rungToSt(rung: Rung, ctx: { aux: Variable[]; warnings: string[]; keyPrefix: string }): string[] {
  const out: string[] = []
  if (!rung.enabled) return [`(* szczebel wyłączony *)`]
  const rows = rung.cells.length
  const cols = rung.cells[0]?.length ?? 0

  const groups = (col: number) => {
    const parent = Array.from({ length: rows }, (_, i) => i)
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
    if (col < cols) {
      for (let r = 0; r < rows - 1; r++) {
        if (rung.cells[r][col].linkDown) { const a = find(r), b = find(r + 1); if (a !== b) parent[a] = b }
      }
    }
    return Array.from({ length: rows }, (_, i) => find(i))
  }

  const merge = (col: number, raw: E[]): E[] => {
    const g = groups(col)
    const acc = new Map<number, E>()
    for (let r = 0; r < rows; r++) acc.set(g[r], or(acc.get(g[r]) ?? atom('FALSE'), raw[r]))
    return Array.from({ length: rows }, (_, r) => acc.get(g[r]) ?? atom('FALSE'))
  }

  let nodes = merge(0, Array.from({ length: rows }, (_, r) => (r === 0 ? TRUE : atom('FALSE'))))

  for (let c = 0; c < cols; c++) {
    const raw: E[] = []
    for (let r = 0; r < rows; r++) {
      raw.push(cellToSt(rung.cells[r][c], nodes[r], out, { ...ctx, key: `${ctx.keyPrefix}_${r}_${c}` }))
    }
    nodes = merge(c + 1, raw)
  }
  return out
}

function litOrExpr(src: string | undefined, fallback = 'FALSE'): string {
  const t = (src ?? '').trim()
  return t === '' ? fallback : t
}

function cellToSt(
  cell: Cell,
  inE: E,
  out: string[],
  ctx: { aux: Variable[]; warnings: string[]; key: string },
): E {
  switch (cell.type) {
    case 'empty':
      return atom('FALSE')

    case 'wire':
      return inE

    case 'contact': {
      const op = litOrExpr(cell.operand)
      const kind = cell.contactKind ?? 'NO'
      if (kind === 'NO') return and(inE, atom(op))
      if (kind === 'NC') return and(inE, not(atom(op)))
      const inst = `${kind === 'P' ? 'R' : 'F'}Trig_${ctx.key}`
      ctx.aux.push({ id: inst, name: inst, type: 'BOOL', fbType: kind === 'P' ? 'R_TRIG' : 'F_TRIG', varClass: 'VAR' })
      out.push(`${inst}(CLK := ${op});`)
      return and(inE, atom(`${inst}.Q`))
    }

    case 'compare': {
      const a = litOrExpr(cell.cmpA, '0'), b = litOrExpr(cell.cmpB, '0')
      return and(inE, { t: `${a} ${cell.cmpOp ?? '>'} ${b}`, p: 0 })
    }

    case 'coil': {
      const target = (cell.operand ?? '').trim()
      if (!target) { ctx.warnings.push('Cewka bez przypisanej zmiennej'); return inE }
      switch (cell.coilKind ?? 'COIL') {
        case 'COIL': out.push(`${target} := ${inE.t};`); break
        case 'COIL_NEG': out.push(`${target} := ${not(inE).t};`); break
        case 'SET': out.push(`IF ${inE.t} THEN ${target} := TRUE; END_IF;`); break
        case 'RESET': out.push(`IF ${inE.t} THEN ${target} := FALSE; END_IF;`); break
        case 'PULSE_P': {
          const inst = `RTrigCoil_${ctx.key}`
          ctx.aux.push({ id: inst, name: inst, type: 'BOOL', fbType: 'R_TRIG', varClass: 'VAR' })
          out.push(`${inst}(CLK := ${inE.t});`)
          out.push(`${target} := ${inst}.Q;`)
          break
        }
        case 'PULSE_N': {
          const inst = `FTrigCoil_${ctx.key}`
          ctx.aux.push({ id: inst, name: inst, type: 'BOOL', fbType: 'F_TRIG', varClass: 'VAR' })
          out.push(`${inst}(CLK := ${inE.t});`)
          out.push(`${target} := ${inst}.Q;`)
          break
        }
      }
      return inE
    }

    case 'block':
      return blockToSt(cell, inE, out, ctx)
  }
}

function blockToSt(
  cell: Cell,
  inE: E,
  out: string[],
  ctx: { aux: Variable[]; warnings: string[]; key: string },
): E {
  const type = cell.blockType ?? ''
  const def = getBlockDef(type)
  const power = cell.negEn ? not(inE) : inE
  const boolIn = def?.inputs.find((p) => p.type === 'BOOL')
  const railPin = boolIn && !(cell.pins?.find((p) => p.name === boolIn.name)?.expr ?? '').trim()
    ? boolIn.name : undefined

  const args: string[] = []
  for (const pin of def?.inputs ?? cell.pins ?? []) {
    const name = 'name' in pin ? pin.name : ''
    if (name === railPin) { args.push(`${name} := ${power.t}`); continue }
    const expr = (cell.pins?.find((p) => p.name === name)?.expr ?? '').trim()
    if (expr) args.push(`${name} := ${expr}`)
  }

  const stateful = def ? def.stateful : true
  const instance = (cell.instance ?? '').trim() || `${type}_${ctx.key}`
  if (stateful && !(cell.instance ?? '').trim()) {
    ctx.aux.push({ id: instance, name: instance, type: 'BOOL', fbType: type, varClass: 'VAR' })
  }

  const call = stateful
    ? `${instance}(${args.join(', ')});`
    : null

  const assigns: string[] = []
  for (const o of def?.outputs ?? []) {
    const target = (cell.pins?.find((p) => p.name === o.name)?.expr ?? '').trim()
    if (!target) continue
    if (stateful) assigns.push(`${target} := ${instance}.${o.name};`)
    else assigns.push(`${target} := ${type}(${args.map((a) => a.split(' := ')[1]).join(', ')});`)
  }

  if (stateful) {
    if (railPin) {
      out.push(call!)
      out.push(...assigns)
    } else {
      // blok bez wejścia BOOL sterowany warunkiem EN
      const body = [call!, ...assigns].map((l) => `  ${l}`).join('\n')
      out.push(power.t === 'TRUE' ? [call!, ...assigns].join('\n') : `IF ${power.t} THEN\n${body}\nEND_IF;`)
    }
    const enoPin = cell.enoPin ?? def?.outputs.find((o) => o.type === 'BOOL')?.name
    return enoPin ? and(power, atom(`${instance}.${enoPin}`)) : power
  }

  // funkcja bezstanowa
  const callExpr = `${type}(${args.map((a) => a.split(' := ').slice(1).join(' := ')).join(', ')})`
  if (assigns.length) {
    const lines = (def?.outputs ?? []).map((o) => {
      const target = (cell.pins?.find((p) => p.name === o.name)?.expr ?? '').trim()
      return target ? `${target} := ${callExpr};` : null
    }).filter(Boolean) as string[]
    if (power.t === 'TRUE') out.push(...lines)
    else out.push(`IF ${power.t} THEN\n${lines.map((l) => `  ${l}`).join('\n')}\nEND_IF;`)
  }
  const boolOut = def?.outputs.find((o) => o.type === 'BOOL')
  if (boolOut) return and(power, atom(callExpr))
  return power
}

/* ------------------------------------------------------------------ */
/* Deklaracje zmiennych                                                */
/* ------------------------------------------------------------------ */

export function varDecl(v: Variable): string {
  const at = v.address ? ` AT ${v.address}` : ''
  const type = v.fbType ?? v.type
  const init = v.fbType ? '' : v.initial ? ` := ${formatInit(v)}` : ''
  const comment = v.comment ? ` (* ${v.comment} *)` : ''
  return `  ${v.name}${at} : ${type}${init};${comment}`
}

function formatInit(v: Variable): string {
  if (v.type === 'TIME') {
    const n = Number(v.initial)
    return isNaN(n) ? (v.initial ?? 'T#0s') : formatTime(n)
  }
  if (v.type === 'STRING') return `'${v.initial}'`
  if (v.type === 'BOOL') return /^(TRUE|1)$/i.test(v.initial ?? '') ? 'TRUE' : 'FALSE'
  return v.initial ?? '0'
}

function varSection(vars: Variable[], keyword: string, extra = ''): string {
  if (!vars.length) return ''
  return `${keyword}${extra}\n${vars.map(varDecl).join('\n')}\nEND_VAR\n`
}

/** Generuje treść POU w ST (dla LD/FBD kod jest tłumaczony z grafiki). */
export function pouBodyToSt(pou: Pou, aux: Variable[], warnings: string[]): string {
  if (pou.language === 'ST') return pou.st.trim()
  if (pou.language === 'FBD') return fbdToSt(pou, aux, warnings)
  const lines: string[] = []
  pou.rungs.forEach((rung, i) => {
    const header = `(* --- Szczebel ${i + 1}${rung.label ? `: ${rung.label}` : ''} --- *)`
    lines.push(header)
    if (rung.comment) lines.push(`(* ${rung.comment} *)`)
    const stmts = rungToSt(rung, { aux, warnings, keyPrefix: `R${i + 1}` })
    lines.push(...(stmts.length ? stmts : ['(* pusty szczebel *)']))
    lines.push('')
  })
  return lines.join('\n').trimEnd()
}

/** Tłumaczy sieć FBD na ST (kolejność topologiczna, sprzężenia przez zmienne). */
function fbdToSt(pou: Pou, aux: Variable[], warnings: string[]): string {
  const lines: string[] = []
  const byId = new Map(pou.fbd.nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, { node: string; pin: string }>()
  for (const l of pou.fbd.links) incoming.set(`${l.to.node}:${l.to.pin}`, l.from)
  const done = new Set<string>()
  const visiting = new Set<string>()
  const exprOf = new Map<string, string>()

  const pinExpr = (nodeId: string, pin: string): string => {
    const src = incoming.get(`${nodeId}:${pin}`)
    const node = byId.get(nodeId)
    if (!src) {
      const lit = node?.literals?.[pin]
      const def = getBlockDef(node?.kind ?? '')
      return (lit ?? def?.inputs.find((p) => p.name === pin)?.default ?? 'FALSE')
    }
    emit(src.node)
    let e = exprOf.get(`${src.node}:${src.pin}`) ?? 'FALSE'
    if (node?.negIn?.[pin]) e = `NOT (${e})`
    return e
  }

  const emit = (id: string) => {
    if (done.has(id)) return
    if (visiting.has(id)) { warnings.push('Wykryto sprzężenie zwrotne w FBD — użyto wartości z poprzedniego cyklu'); return }
    const node = byId.get(id)
    if (!node) return
    visiting.add(id)
    if (node.kind === 'VAR_IN' || node.kind === 'CONST') {
      exprOf.set(`${id}:OUT`, node.operand?.trim() || 'FALSE')
    } else if (node.kind === 'VAR_OUT') {
      const target = node.operand?.trim()
      if (target) lines.push(`${target} := ${pinExpr(id, 'IN')};`)
    } else if (node.kind !== 'COMMENT') {
      const def = getBlockDef(node.kind)
      const args = (def?.inputs ?? []).map((p) => `${p.name} := ${pinExpr(id, p.name)}`)
      const stateful = def ? def.stateful : true
      if (stateful) {
        const inst = node.instance?.trim() || `${node.kind}_${id.slice(-4)}`
        if (!node.instance?.trim())
          aux.push({ id: inst, name: inst, type: 'BOOL', fbType: node.kind, varClass: 'VAR' })
        lines.push(`${inst}(${args.join(', ')});`)
        for (const o of def?.outputs ?? []) exprOf.set(`${id}:${o.name}`, `${inst}.${o.name}`)
      } else {
        const call = `${node.kind}(${args.map((a) => a.split(' := ').slice(1).join(' := ')).join(', ')})`
        for (const o of def?.outputs ?? []) exprOf.set(`${id}:${o.name}`, call)
      }
    }
    visiting.delete(id)
    done.add(id)
  }

  for (const n of pou.fbd.nodes) if (n.kind === 'VAR_OUT') emit(n.id)
  for (const n of pou.fbd.nodes) emit(n.id)
  return lines.join('\n')
}

/** Pełny kod POU wraz z deklaracjami. */
export function pouToSt(pou: Pou): CodegenResult {
  const aux: Variable[] = []
  const warnings: string[] = []
  const body = pouBodyToSt(pou, aux, warnings)
  const kw = pou.kind
  const header = pou.kind === 'FUNCTION' ? `FUNCTION ${pou.name} : ${pou.returnType ?? 'BOOL'}` : `${kw} ${pou.name}`
  const groups: [Variable[], string][] = [
    [pou.vars.filter((v) => v.varClass === 'VAR_INPUT'), 'VAR_INPUT'],
    [pou.vars.filter((v) => v.varClass === 'VAR_OUTPUT'), 'VAR_OUTPUT'],
    [pou.vars.filter((v) => v.varClass === 'VAR_IN_OUT'), 'VAR_IN_OUT'],
    [[...pou.vars.filter((v) => v.varClass === 'VAR' || v.varClass === 'VAR_TEMP'), ...dedupe(aux)], 'VAR'],
  ]
  const decls = groups.map(([vars, kwd]) => varSection(vars, kwd)).join('')
  const end = pou.kind === 'FUNCTION' ? 'END_FUNCTION' : pou.kind === 'FUNCTION_BLOCK' ? 'END_FUNCTION_BLOCK' : 'END_PROGRAM'
  const comment = pou.comment ? `(* ${pou.comment} *)\n` : ''
  return {
    code: `${comment}${header}\n${decls}${body ? body + '\n' : ''}${end}\n`,
    aux,
    warnings,
  }
}

function dedupe(vars: Variable[]): Variable[] {
  const seen = new Set<string>()
  return vars.filter((v) => (seen.has(v.name) ? false : (seen.add(v.name), true)))
}

/** Kod całego projektu: zmienne globalne, biblioteka, POU. */
export function projectToSt(project: Project): CodegenResult {
  const aux: Variable[] = []
  const warnings: string[] = []
  const parts: string[] = []
  parts.push(`(*`)
  parts.push(` * ${project.name}`)
  if (project.description) parts.push(` * ${project.description}`)
  parts.push(` * Wygenerowano z Ladder Studio — IEC 61131-3 Structured Text`)
  parts.push(` * Czas cyklu: ${project.config.scanTime} ms`)
  parts.push(` *)`)
  parts.push('')
  if (project.globals.length) {
    const retained = project.globals.filter((v) => v.retain)
    const normal = project.globals.filter((v) => !v.retain)
    parts.push(varSection(normal, 'VAR_GLOBAL'))
    if (retained.length) parts.push(varSection(retained, 'VAR_GLOBAL', ' RETAIN'))
  }
  for (const entry of project.library.filter((l) => !l.builtin)) {
    const r = pouToSt(entry.pou)
    aux.push(...r.aux); warnings.push(...r.warnings)
    parts.push(r.code)
  }
  for (const pou of project.pous.filter((p) => p.kind !== 'PROGRAM')) {
    const r = pouToSt(pou)
    aux.push(...r.aux); warnings.push(...r.warnings)
    parts.push(r.code)
  }
  for (const pou of project.pous.filter((p) => p.kind === 'PROGRAM')) {
    const r = pouToSt(pou)
    aux.push(...r.aux); warnings.push(...r.warnings)
    parts.push(r.code)
  }
  parts.push(configurationSection(project))
  return { code: parts.join('\n'), aux, warnings }
}

function configurationSection(project: Project): string {
  const tasks = project.tasks.filter((t) => t.enabled)
  if (!tasks.length) return ''
  const body = tasks.map((t) => {
    const progs = t.programs.map((p, i) => `    PROGRAM P${i}_${p} WITH ${t.name} : ${p};`).join('\n')
    return `  TASK ${t.name}(INTERVAL := ${formatTime(t.interval)}, PRIORITY := ${t.priority});\n${progs}`
  }).join('\n')
  return `CONFIGURATION Config\n  RESOURCE Resource ON PLC\n${body}\n  END_RESOURCE\nEND_CONFIGURATION\n`
}
