import type { Cell, Pou, Project, Rung, Variable } from './types'
import { getBlockDef } from './blocks'
import { XmlWriter, escapeXml } from './xml'
import { pouBodyToSt, projectToSt, varDecl } from './st/codegen'
import { formatTime } from './st/lexer'
import { parseSt } from './st/parser'
import { printExpr } from './st/print'
import type { Expr, Stmt } from './st/ast'

/* ================================================================== */
/* PLCopen XML (TC6 2.01)                                              */
/* ================================================================== */

const PLCOPEN_NS = 'http://www.plcopen.org/xml/tc6_0201'
const CELL_W = 120
const CELL_H = 70

function isoNow() { return new Date().toISOString().replace(/\.\d+Z$/, '') }

function typeElement(w: XmlWriter, v: Variable) {
  w.open('type')
  if (v.fbType) w.empty('derived', { name: v.fbType })
  else if (v.type === 'STRING') w.empty('string')
  else w.empty(v.type)
  w.close('type')
}

function variableElement(w: XmlWriter, v: Variable) {
  w.open('variable', { name: v.name, address: v.address })
  typeElement(w, v)
  if (v.initial) {
    w.open('initialValue')
    w.empty('simpleValue', { value: v.type === 'TIME' ? formatTime(Number(v.initial) || 0) : v.initial })
    w.close('initialValue')
  }
  if (v.comment) {
    w.open('documentation')
    w.leaf('xhtml', v.comment, { xmlns: 'http://www.w3.org/1999/xhtml' })
    w.close('documentation')
  }
  w.close('variable')
}

function varListElement(w: XmlWriter, tag: string, vars: Variable[], attrs: Record<string, string> = {}) {
  if (!vars.length) return
  w.open(tag, attrs)
  for (const v of vars) variableElement(w, v)
  w.close(tag)
}

/* ---------------------- ciało w języku LD -------------------------- */

interface LdCtx {
  ids: Map<string, number>          // "r:c" -> localId
  next: number
  railId: number
}

const cellKey = (r: number, c: number) => `${r}:${c}`

function rungGroups(rung: Rung, col: number): number[] {
  const rows = rung.cells.length
  const parent = Array.from({ length: rows }, (_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  if (col < (rung.cells[0]?.length ?? 0)) {
    for (let r = 0; r < rows - 1; r++) {
      if (rung.cells[r][col].linkDown) { const a = find(r), b = find(r + 1); if (a !== b) parent[a] = b }
    }
  }
  return Array.from({ length: rows }, (_, i) => find(i))
}

interface ConnRef { refLocalId: number; formalParameter?: string }

/** Zwraca elementy zasilające węzeł (r, granica c); przewody są przezroczyste. */
function sourcesAt(rung: Rung, ctx: LdCtx, col: number, row: number, seen = new Set<string>()): ConnRef[] {
  const group = rungGroups(rung, col)
  const g = group[row]
  const key = `${col}#${g}`
  if (seen.has(key)) return []
  seen.add(key)
  const out: ConnRef[] = []
  const rows = rung.cells.length
  for (let r = 0; r < rows; r++) {
    if (group[r] !== g) continue
    if (col === 0) {
      if (r === 0) out.push({ refLocalId: ctx.railId })
      continue
    }
    const cell = rung.cells[r][col - 1]
    if (cell.type === 'empty') continue
    if (cell.type === 'wire') { out.push(...sourcesAt(rung, ctx, col - 1, r, seen)); continue }
    const id = ctx.ids.get(cellKey(r, col - 1))
    if (id === undefined) continue
    if (cell.type === 'block') {
      const def = getBlockDef(cell.blockType ?? '')
      const pin = cell.enoPin ?? def?.outputs.find((o) => o.type === 'BOOL')?.name ?? 'ENO'
      out.push({ refLocalId: id, formalParameter: pin })
    } else out.push({ refLocalId: id })
  }
  const uniq = new Map<string, ConnRef>()
  for (const c of out) uniq.set(`${c.refLocalId}:${c.formalParameter ?? ''}`, c)
  return [...uniq.values()]
}

function connectionPointIn(w: XmlWriter, refs: ConnRef[]) {
  w.open('connectionPointIn')
  w.empty('relPosition', { x: 0, y: 20 })
  for (const r of refs) w.empty('connection', { refLocalId: r.refLocalId, formalParameter: r.formalParameter })
  w.close('connectionPointIn')
}

function writeLdRung(w: XmlWriter, rung: Rung, ctx: LdCtx, yOffset: number) {
  const rows = rung.cells.length
  const cols = rung.cells[0]?.length ?? 0

  ctx.railId = ctx.next++
  w.open('leftPowerRail', { localId: ctx.railId, height: rows * CELL_H, width: 8 })
  w.empty('position', { x: 0, y: yOffset })
  w.open('connectionPointOut', { formalParameter: '' })
  w.empty('relPosition', { x: 8, y: 20 })
  w.close('connectionPointOut')
  w.close('leftPowerRail')

  // identyfikatory przydzielane kolumnami, aby odwołania wskazywały już zapisane elementy
  for (let c = 0; c < cols; c++)
    for (let r = 0; r < rows; r++) {
      const cell = rung.cells[r][c]
      if (cell.type === 'empty' || cell.type === 'wire') continue
      ctx.ids.set(cellKey(r, c), ctx.next++)
    }

  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      const cell = rung.cells[r][c]
      if (cell.type === 'empty' || cell.type === 'wire') continue
      const id = ctx.ids.get(cellKey(r, c))!
      const x = 40 + c * CELL_W
      const y = yOffset + r * CELL_H
      writeLdElement(w, cell, id, x, y, sourcesAt(rung, ctx, c, r))
    }
  }

  const coilRefs: ConnRef[] = []
  for (let r = 0; r < rows; r++) coilRefs.push(...sourcesAt(rung, ctx, cols, r))
  const railOut = ctx.next++
  w.open('rightPowerRail', { localId: railOut, height: rows * CELL_H, width: 8 })
  w.empty('position', { x: 40 + cols * CELL_W, y: yOffset })
  connectionPointIn(w, dedupeRefs(coilRefs))
  w.close('rightPowerRail')
}

function dedupeRefs(refs: ConnRef[]): ConnRef[] {
  const m = new Map<string, ConnRef>()
  for (const r of refs) m.set(`${r.refLocalId}:${r.formalParameter ?? ''}`, r)
  return [...m.values()]
}

function writeLdElement(w: XmlWriter, cell: Cell, id: number, x: number, y: number, refs: ConnRef[]) {
  if (cell.type === 'contact') {
    const kind = cell.contactKind ?? 'NO'
    w.open('contact', {
      localId: id, negated: kind === 'NC',
      edge: kind === 'P' ? 'rising' : kind === 'N' ? 'falling' : undefined,
      height: 20, width: 40,
    })
    w.empty('position', { x, y })
    connectionPointIn(w, refs)
    w.open('connectionPointOut'); w.empty('relPosition', { x: 40, y: 20 }); w.close('connectionPointOut')
    w.leaf('variable', cell.operand ?? '')
    w.close('contact')
    return
  }
  if (cell.type === 'coil') {
    const kind = cell.coilKind ?? 'COIL'
    w.open('coil', {
      localId: id, negated: kind === 'COIL_NEG',
      storage: kind === 'SET' ? 'set' : kind === 'RESET' ? 'reset' : undefined,
      edge: kind === 'PULSE_P' ? 'rising' : kind === 'PULSE_N' ? 'falling' : undefined,
      height: 20, width: 40,
    })
    w.empty('position', { x, y })
    connectionPointIn(w, refs)
    w.open('connectionPointOut'); w.empty('relPosition', { x: 40, y: 20 }); w.close('connectionPointOut')
    w.leaf('variable', cell.operand ?? '')
    w.close('coil')
    return
  }
  if (cell.type === 'compare') {
    const op = cell.cmpOp ?? '>'
    const typeName = { '>': 'GT', '>=': 'GE', '<': 'LT', '<=': 'LE', '=': 'EQ', '<>': 'NE' }[op]
    writeBlockElement(w, id, typeName, undefined, x, y,
      [{ pin: 'IN1', expr: cell.cmpA ?? '0' }, { pin: 'IN2', expr: cell.cmpB ?? '0' }],
      ['OUT'], refs, 'EN')
    return
  }
  // blok funkcyjny
  const def = getBlockDef(cell.blockType ?? '')
  const boolIn = def?.inputs.find((p) => p.type === 'BOOL')?.name
  const railPin = boolIn && !(cell.pins?.find((p) => p.name === boolIn)?.expr ?? '').trim() ? boolIn : 'EN'
  const inputs = (def?.inputs ?? []).map((p) => ({
    pin: p.name,
    expr: p.name === railPin ? undefined : (cell.pins?.find((q) => q.name === p.name)?.expr || p.default || ''),
  }))
  writeBlockElement(w, id, cell.blockType ?? '', cell.instance, x, y,
    inputs, (def?.outputs ?? []).map((o) => o.name), refs, railPin)
}

function writeBlockElement(
  w: XmlWriter, id: number, typeName: string, instance: string | undefined,
  x: number, y: number,
  inputs: { pin: string; expr?: string }[], outputs: string[], refs: ConnRef[], railPin: string,
) {
  w.open('block', { localId: id, typeName, instanceName: instance, height: 80, width: 100 })
  w.empty('position', { x, y })
  w.open('inputVariables')
  if (railPin === 'EN') {
    w.open('variable', { formalParameter: 'EN' })
    connectionPointIn(w, refs)
    w.close('variable')
  }
  for (const inp of inputs) {
    w.open('variable', { formalParameter: inp.pin })
    if (inp.pin === railPin) connectionPointIn(w, refs)
    else {
      w.open('connectionPointIn')
      w.empty('relPosition', { x: 0, y: 20 })
      if (inp.expr) w.leaf('expression', inp.expr)
      w.close('connectionPointIn')
    }
    w.close('variable')
  }
  w.close('inputVariables')
  w.empty('inOutVariables')
  w.open('outputVariables')
  if (railPin === 'EN') {
    w.open('variable', { formalParameter: 'ENO' })
    w.open('connectionPointOut'); w.empty('relPosition', { x: 100, y: 20 }); w.close('connectionPointOut')
    w.close('variable')
  }
  for (const o of outputs) {
    w.open('variable', { formalParameter: o })
    w.open('connectionPointOut'); w.empty('relPosition', { x: 100, y: 20 }); w.close('connectionPointOut')
    w.close('variable')
  }
  w.close('outputVariables')
  w.close('block')
}

/* ---------------------- ciało w języku FBD ------------------------- */

function writeFbdBody(w: XmlWriter, pou: Pou) {
  const ids = new Map<string, number>()
  let next = 1
  for (const n of pou.fbd.nodes) ids.set(n.id, next++)
  const incoming = new Map<string, { node: string; pin: string }>()
  for (const l of pou.fbd.links) incoming.set(`${l.to.node}:${l.to.pin}`, l.from)

  const inRef = (nodeId: string, pin: string): ConnRef[] => {
    const src = incoming.get(`${nodeId}:${pin}`)
    if (!src) return []
    const id = ids.get(src.node)
    return id === undefined ? [] : [{ refLocalId: id, formalParameter: src.pin === 'OUT' ? undefined : src.pin }]
  }

  for (const n of pou.fbd.nodes) {
    const id = ids.get(n.id)!
    if (n.kind === 'VAR_IN' || n.kind === 'CONST') {
      w.open('inVariable', { localId: id, height: 20, width: 80 })
      w.empty('position', { x: n.x, y: n.y })
      w.open('connectionPointOut'); w.empty('relPosition', { x: 80, y: 10 }); w.close('connectionPointOut')
      w.leaf('expression', n.operand ?? '')
      w.close('inVariable')
    } else if (n.kind === 'VAR_OUT') {
      w.open('outVariable', { localId: id, height: 20, width: 80 })
      w.empty('position', { x: n.x, y: n.y })
      connectionPointIn(w, inRef(n.id, 'IN'))
      w.leaf('expression', n.operand ?? '')
      w.close('outVariable')
    } else if (n.kind !== 'COMMENT') {
      const def = getBlockDef(n.kind)
      w.open('block', { localId: id, typeName: n.kind, instanceName: n.instance, height: 80, width: 100 })
      w.empty('position', { x: n.x, y: n.y })
      w.open('inputVariables')
      for (const p of def?.inputs ?? []) {
        w.open('variable', { formalParameter: p.name, negated: n.negIn?.[p.name] || undefined })
        const refs = inRef(n.id, p.name)
        if (refs.length) connectionPointIn(w, refs)
        else {
          w.open('connectionPointIn'); w.empty('relPosition', { x: 0, y: 20 })
          const lit = n.literals?.[p.name] ?? p.default
          if (lit) w.leaf('expression', lit)
          w.close('connectionPointIn')
        }
        w.close('variable')
      }
      w.close('inputVariables')
      w.empty('inOutVariables')
      w.open('outputVariables')
      for (const o of def?.outputs ?? []) {
        w.open('variable', { formalParameter: o.name })
        w.open('connectionPointOut'); w.empty('relPosition', { x: 100, y: 20 }); w.close('connectionPointOut')
        w.close('variable')
      }
      w.close('outputVariables')
      w.close('block')
    }
  }
}

/* ---------------------------- POU ---------------------------------- */

function writePou(w: XmlWriter, pou: Pou) {
  const pouType = pou.kind === 'PROGRAM' ? 'program' : pou.kind === 'FUNCTION' ? 'function' : 'functionBlock'
  w.open('pou', { name: pou.name, pouType })
  w.open('interface')
  if (pou.kind === 'FUNCTION') {
    w.open('returnType'); w.empty(pou.returnType ?? 'BOOL'); w.close('returnType')
  }
  varListElement(w, 'inputVars', pou.vars.filter((v) => v.varClass === 'VAR_INPUT'))
  varListElement(w, 'outputVars', pou.vars.filter((v) => v.varClass === 'VAR_OUTPUT'))
  varListElement(w, 'inOutVars', pou.vars.filter((v) => v.varClass === 'VAR_IN_OUT'))
  varListElement(w, 'localVars', pou.vars.filter((v) => v.varClass === 'VAR' || v.varClass === 'VAR_TEMP'))
  w.close('interface')

  w.open('body')
  if (pou.language === 'ST') {
    w.open('ST')
    w.leaf('xhtml', pou.st, { xmlns: 'http://www.w3.org/1999/xhtml' })
    w.close('ST')
  } else if (pou.language === 'FBD') {
    w.open('FBD')
    writeFbdBody(w, pou)
    w.close('FBD')
  } else {
    w.open('LD')
    const ctx: LdCtx = { ids: new Map(), next: 1, railId: 1 }
    pou.rungs.forEach((rung, i) => writeLdRung(w, rung, ctx, i * (rung.cells.length + 1) * CELL_H))
    w.close('LD')
  }
  w.close('body')

  if (pou.comment) {
    w.open('documentation')
    w.leaf('xhtml', pou.comment, { xmlns: 'http://www.w3.org/1999/xhtml' })
    w.close('documentation')
  }
  w.close('pou')
}

/** Eksport projektu do PLCopen XML — formatu wymiany między środowiskami PLC. */
export function exportPlcOpenXml(project: Project): string {
  const w = new XmlWriter()
  w.open('project', { xmlns: PLCOPEN_NS })
  w.open('fileHeader', {
    companyName: 'Ladder Studio', productName: 'Ladder Studio', productVersion: '1.0',
    creationDateTime: isoNow(), contentDescription: project.description,
  })
  w.close('fileHeader')
  w.open('contentHeader', { name: project.name, modificationDateTime: isoNow() })
  w.open('coordinateInfo')
  for (const lang of ['fbd', 'ld', 'sfc']) {
    w.open(lang); w.empty('scaling', { x: 1, y: 1 }); w.close(lang)
  }
  w.close('coordinateInfo')
  w.close('contentHeader')

  w.open('types')
  w.empty('dataTypes')
  w.open('pous')
  for (const entry of project.library.filter((l) => !l.builtin)) writePou(w, entry.pou)
  for (const pou of project.pous.filter((p) => p.kind !== 'PROGRAM')) writePou(w, pou)
  for (const pou of project.pous.filter((p) => p.kind === 'PROGRAM')) writePou(w, pou)
  w.close('pous')
  w.close('types')

  w.open('instances')
  w.open('configurations')
  w.open('configuration', { name: 'Config' })
  w.open('resource', { name: 'Resource' })
  for (const t of project.tasks) {
    w.open('task', { name: t.name, interval: formatTime(t.interval), priority: t.priority })
    for (const p of t.programs) w.empty('pouInstance', { name: `${p}_inst`, typeName: p })
    w.close('task')
  }
  w.close('resource')
  varListElement(w, 'globalVars', project.globals, { name: 'Globals' })
  w.close('configuration')
  w.close('configurations')
  w.close('instances')
  w.close('project')
  return w.toString()
}

/* ================================================================== */
/* Lista instrukcji (IL / AWL)                                         */
/* ================================================================== */

function ilLeafText(e: Expr): string | null {
  if (e.k === 'var') return e.name
  if (e.k === 'member') return `${e.obj}.${e.pin}`
  if (e.k === 'lit') return e.raw
  return null
}

/** Formatuje wiersz listy instrukcji: mnemonik wyrównany do 5 znaków. */
const ilLine = (mnemonic: string, operand = '') => `  ${mnemonic.padEnd(5)}${operand}`.trimEnd()

function ilLoad(e: Expr, out: string[]) {
  if (e.k === 'bin' && (e.op === 'AND' || e.op === 'OR' || e.op === 'XOR')) {
    ilLoad(e.a, out)
    ilChain(e.b, e.op, out)
    return
  }
  if (e.k === 'un' && e.op === 'NOT') {
    const leaf = ilLeafText(e.a)
    if (leaf) { out.push(ilLine('LDN', leaf)); return }
  }
  const leaf = ilLeafText(e)
  out.push(ilLine('LD', leaf ?? printExpr(e)))
}

function ilChain(e: Expr, op: string, out: string[]) {
  if (e.k === 'un' && e.op === 'NOT') {
    const leaf = ilLeafText(e.a)
    if (leaf) { out.push(ilLine(`${op}N`, leaf)); return }
  }
  const leaf = ilLeafText(e)
  if (leaf) { out.push(ilLine(op, leaf)); return }
  if (e.k === 'bin' && ['AND', 'OR', 'XOR'].includes(e.op)) {
    out.push(`  ${op}(`)
    ilLoad(e, out)
    out.push('  )')
    return
  }
  out.push(ilLine(op, printExpr(e)))
}

let labelSeq = 0

function ilStatements(stmts: Stmt[], out: string[]) {
  for (const s of stmts) {
    switch (s.k) {
      case 'assign': {
        if (s.target.k !== 'var') { out.push(`  (* pominięto: ${printExpr(s.target)} *)`); break }
        ilLoad(s.value, out)
        out.push(ilLine('ST', s.target.name))
        break
      }
      case 'call': {
        const args = s.args.map((a) => (a.name ? `${a.name} ${a.out ? '=>' : ':='} ${printExpr(a.expr)}` : printExpr(a.expr)))
        out.push(ilLine('CAL', `${s.name}(${args.join(', ')})`))
        break
      }
      case 'if': {
        const end = `END_${++labelSeq}`
        s.branches.forEach((br) => {
          const skip = `L${++labelSeq}`
          ilLoad(br.cond, out)
          out.push(ilLine('JMPCN', skip))
          ilStatements(br.body, out)
          out.push(ilLine('JMP', end))
          out.push(`${skip}:`)
        })
        if (s.else) ilStatements(s.else, out)
        out.push(`${end}:`)
        break
      }
      case 'nop': break
      default:
        out.push(`  (* instrukcja ${s.k} nie ma odpowiednika w IL *)`)
    }
  }
}

/** Eksport do listy instrukcji (IL) — klasyczny format tekstowy sterowników. */
export function exportIl(project: Project): string {
  labelSeq = 0
  const lines: string[] = [
    `(* ${project.name} — lista instrukcji IEC 61131-3 (IL) *)`,
    `(* Wygenerowano z Ladder Studio *)`,
    '',
  ]
  if (project.globals.length) {
    lines.push('VAR_GLOBAL')
    lines.push(...project.globals.map(varDecl))
    lines.push('END_VAR', '')
  }
  for (const pou of project.pous) {
    lines.push(`${pou.kind} ${pou.name}`)
    if (pou.vars.length) {
      lines.push('VAR')
      lines.push(...pou.vars.map(varDecl))
      lines.push('END_VAR')
    }
    const st = pouBodyToSt(pou, [], [])
    try {
      ilStatements(parseSt(st), lines)
    } catch (e) {
      lines.push(`  (* nie udało się przetłumaczyć: ${(e as Error).message} *)`)
    }
    lines.push(`END_${pou.kind}`, '')
  }
  return lines.join('\n')
}

/* ================================================================== */
/* Pozostałe formaty                                                   */
/* ================================================================== */

export function exportSt(project: Project): string {
  return projectToSt(project).code
}

export function exportJson(project: Project): string {
  return JSON.stringify({ format: 'ladder-studio-project', version: 1, project }, null, 2)
}

/** Lista tagów w CSV — do importu w systemach SCADA/HMI. */
export function exportTagsCsv(project: Project): string {
  const rows: string[][] = [['Nazwa', 'Typ', 'Adres', 'Zakres', 'Wartość początkowa', 'Retain', 'Grupa', 'Opis']]
  const push = (v: Variable, scope: string) => rows.push([
    v.name, v.fbType ?? v.type, v.address ?? '', scope, v.initial ?? '',
    v.retain ? 'TAK' : 'NIE', v.group ?? '', v.comment ?? '',
  ])
  for (const v of project.globals) push(v, 'GLOBAL')
  for (const pou of project.pous) for (const v of pou.vars) push(v, pou.name)
  return rows.map((r) => r.map(csvCell).join(';')).join('\r\n')
}

function csvCell(s: string): string {
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Dokumentacja projektu w Markdown — do teczki maszyny. */
export function exportMarkdown(project: Project): string {
  const out: string[] = [`# ${project.name}`, '']
  if (project.description) out.push(project.description, '')
  out.push(`- Sterownik: ${project.config.vendor} ${project.config.plcModel}`)
  out.push(`- Czas cyklu: ${project.config.scanTime} ms`)
  out.push(`- Liczba programów: ${project.pous.length}`, '')
  out.push('## Lista zmiennych globalnych', '')
  out.push('| Nazwa | Typ | Adres | Opis |', '|---|---|---|---|')
  for (const v of project.globals)
    out.push(`| ${v.name} | ${v.fbType ?? v.type} | ${v.address ?? ''} | ${v.comment ?? ''} |`)
  out.push('')
  for (const pou of project.pous) {
    out.push(`## ${pou.kind} ${pou.name} (${pou.language})`, '')
    if (pou.comment) out.push(pou.comment, '')
    if (pou.language === 'LD') {
      pou.rungs.forEach((r, i) => {
        out.push(`### Szczebel ${i + 1}${r.label ? ` — ${r.label}` : ''}`)
        if (r.comment) out.push('', r.comment)
        out.push('', '```iecst', ...pouRungSt(pou, i), '```', '')
      })
    } else {
      out.push('```iecst', pouBodyToSt(pou, [], []), '```', '')
    }
  }
  if (project.alarms.length) {
    out.push('## Alarmy', '', '| Zmienna | Warunek | Priorytet | Treść |', '|---|---|---|---|')
    for (const a of project.alarms)
      out.push(`| ${a.variable} | ${a.condition} ${a.limit ?? ''} | ${a.priority} | ${a.text} |`)
  }
  return out.join('\n')
}

function pouRungSt(pou: Pou, index: number): string[] {
  const single: Pou = { ...pou, rungs: [pou.rungs[index]] }
  return pouBodyToSt(single, [], []).split('\n').filter((l) => !l.startsWith('(* ---'))
}

/** Samodzielny plik HTML z panelem HMI — do podglądu bez środowiska. */
export function exportHmiSvgSnapshot(project: Project, screenIndex = 0): string {
  const screen = project.hmi[screenIndex]
  if (!screen) return ''
  const body = screen.widgets.map((wd) =>
    `<rect x="${wd.x}" y="${wd.y}" width="${wd.w}" height="${wd.h}" fill="none" stroke="#888"/>` +
    `<text x="${wd.x + 4}" y="${wd.y + 14}" font-size="11" fill="#888">${escapeXml(wd.kind)}</text>`,
  ).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" height="${screen.height}">\n${body}\n</svg>`
}
