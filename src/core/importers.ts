import type {
  Cell, DataType, FbdLink, FbdNode, Pou, Project, Rung, VarClass, Variable,
} from './types'
import { getBlockDef } from './blocks'
import { uid } from './grid'
import { emptyProject, makePou, makeVariable } from './factory'
import { buildRung } from './st/toladder'
import { stToLadder } from './st/toladder'
import { parseTimeLiteral } from './st/lexer'
import { child, children, findAll, localName, parseXml, type XmlNode } from './xml'

export interface ImportResult {
  project: Project
  warnings: string[]
}

const TYPE_NAMES: DataType[] = [
  'BOOL', 'BYTE', 'WORD', 'DWORD', 'SINT', 'INT', 'DINT', 'LINT',
  'USINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'TIME', 'STRING',
]

/* ================================================================== */
/* JSON — natywny format projektu                                      */
/* ================================================================== */

export function importJson(text: string): ImportResult {
  const data = JSON.parse(text)
  const project: Project = data.project ?? data
  if (!project || !Array.isArray(project.pous)) throw new Error('To nie jest plik projektu Ladder Studio')
  const base = emptyProject(project.name || 'Projekt')
  return {
    project: {
      ...base,
      ...project,
      hmi: project.hmi?.length ? project.hmi : base.hmi,
      tasks: project.tasks?.length ? project.tasks : base.tasks,
      config: { ...base.config, ...project.config },
      modifiedAt: Date.now(),
    },
    warnings: [],
  }
}

/* ================================================================== */
/* Structured Text                                                     */
/* ================================================================== */

/** Import pliku ST: rozpoznaje sekcje VAR i tworzy program w kodzie. */
export function importSt(text: string, name = 'Import ST'): ImportResult {
  const warnings: string[] = []
  const project = emptyProject(name)
  const globals = parseVarSections(text, /VAR_GLOBAL(\s+RETAIN)?/gi)
  project.globals = globals

  const pouRe = /(PROGRAM|FUNCTION_BLOCK|FUNCTION)\s+([\p{L}_][\p{L}\p{N}_]*)([\s\S]*?)END_\1/giu
  const pous: Pou[] = []
  let m: RegExpExecArray | null
  while ((m = pouRe.exec(text)) !== null) {
    const kind = m[1].toUpperCase() as Pou['kind']
    const body = m[3]
    const vars = parseVarSections(body, /VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP)?/gi)
    const code = body.replace(/VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP)?[\s\S]*?END_VAR/gi, '').trim()
    pous.push(makePou({ name: m[2], kind, language: 'ST', vars, st: code }))
  }
  if (!pous.length) {
    const code = text.replace(/VAR_GLOBAL[\s\S]*?END_VAR/gi, '').trim()
    pous.push(makePou({ name: 'Main', language: 'ST', st: code }))
    warnings.push('Nie znaleziono nagłówka POU — cały kod umieszczono w programie Main')
  }
  project.pous = pous
  project.tasks[0].programs = pous.filter((p) => p.kind === 'PROGRAM').map((p) => p.name)
  return { project, warnings }
}

/** Deklaracja zmiennej wraz z opcjonalnym komentarzem po średniku. */
const DECL_RE =
  /([\p{L}_][\p{L}\p{N}_]*)\s*(?:AT\s+(%[A-Za-z0-9.]+))?\s*:\s*([\p{L}_][\p{L}\p{N}_]*)(?:\s*\(\d+\))?(?:\s*:=\s*([^;]+?))?\s*;[ \t]*(?:\(\*([\s\S]*?)\*\)|\/\/([^\n]*))?/gu

function parseVarSections(text: string, header: RegExp): Variable[] {
  const out: Variable[] = []
  const re = new RegExp(`(${header.source})([\\s\\S]*?)END_VAR`, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const kw = m[1].toUpperCase().replace(/\s+RETAIN/, '')
    const retain = /RETAIN/i.test(m[1])
    const varClass = (TYPE_CLASS[kw] ?? 'VAR') as VarClass
    const body = m[m.length - 1]
    DECL_RE.lastIndex = 0
    let d: RegExpExecArray | null
    while ((d = DECL_RE.exec(body)) !== null) {
      const typeName = d[3].toUpperCase()
      const isStd = (TYPE_NAMES as string[]).includes(typeName)
      out.push(makeVariable({
        name: d[1],
        address: d[2],
        type: isStd ? (typeName as DataType) : 'BOOL',
        fbType: isStd ? undefined : d[3],
        initial: d[4]?.trim(),
        varClass,
        retain: retain || undefined,
        comment: (d[5] ?? d[6])?.trim() || undefined,
      }))
    }
  }
  return out
}

const TYPE_CLASS: Record<string, VarClass> = {
  VAR: 'VAR', VAR_INPUT: 'VAR_INPUT', VAR_OUTPUT: 'VAR_OUTPUT',
  VAR_IN_OUT: 'VAR_IN_OUT', VAR_TEMP: 'VAR_TEMP', VAR_GLOBAL: 'VAR_GLOBAL',
}

/** Import kodu ST z jednoczesną konwersją na drabinkę. */
export function importStAsLadder(text: string, name = 'Import ST'): ImportResult {
  const res = importSt(text, name)
  const warnings = [...res.warnings]
  res.project.pous = res.project.pous.map((pou) => {
    const scope = [...res.project.globals, ...pou.vars]
    const conv = stToLadder(pou.st, {
      resolveInstance: (n) => scope.find((v) => v.name === n)?.fbType,
      resolveVarType: (n) => scope.find((v) => v.name === n)?.type,
    })
    warnings.push(...conv.warnings.map((w) => `${pou.name}: ${w}`))
    if (!conv.rungs.length) return pou
    return { ...pou, language: 'LD' as const, rungs: conv.rungs }
  })
  return { project: res.project, warnings }
}

/* ================================================================== */
/* PLCopen XML                                                         */
/* ================================================================== */

export function importPlcOpenXml(text: string): ImportResult {
  const warnings: string[] = []
  const root = parseXml(text)
  if (localName(root) !== 'project') throw new Error('Plik nie jest projektem PLCopen XML')

  const name = child(root, 'contentHeader')?.attrs.name ?? 'Projekt PLCopen'
  const project = emptyProject(name)
  project.description = child(root, 'fileHeader')?.attrs.contentDescription ?? ''

  const globalLists = findAll(root, 'globalVars')
  project.globals = globalLists.flatMap((g) => children(g, 'variable').map((v) => readVariable(v, 'VAR_GLOBAL')))

  const pous = findAll(root, 'pou')
  project.pous = []
  for (const p of pous) {
    const pou = readPou(p, warnings)
    if (pou.kind === 'PROGRAM') project.pous.push(pou)
    else project.pous.push(pou)
  }
  if (!project.pous.some((p) => p.kind === 'PROGRAM')) {
    project.pous.unshift(makePou({ name: 'Main' }))
    warnings.push('Projekt nie zawierał programu — dodano pusty program Main')
  }

  const tasks = findAll(root, 'task')
  if (tasks.length) {
    project.tasks = tasks.map((t, i) => ({
      id: uid('task'),
      name: t.attrs.name || `Task${i + 1}`,
      interval: t.attrs.interval ? parseTimeLiteral(t.attrs.interval) : 10,
      priority: Number(t.attrs.priority) || i + 1,
      programs: children(t, 'pouInstance').map((pi) => pi.attrs.typeName).filter(Boolean),
      enabled: true,
    }))
  } else {
    project.tasks[0].programs = project.pous.filter((p) => p.kind === 'PROGRAM').map((p) => p.name)
  }
  return { project, warnings }
}

function readVariable(node: XmlNode, varClass: VarClass): Variable {
  const t = child(node, 'type')
  const first = t?.children[0]
  const typeName = first ? localName(first) : 'BOOL'
  const derived = typeName === 'derived' ? first?.attrs.name : undefined
  const initial = child(child(node, 'initialValue') ?? node, 'simpleValue')?.attrs.value
  return makeVariable({
    name: node.attrs.name,
    address: node.attrs.address || undefined,
    type: (TYPE_NAMES as string[]).includes(typeName.toUpperCase())
      ? (typeName.toUpperCase() as DataType)
      : typeName === 'string' ? 'STRING' : 'BOOL',
    fbType: derived,
    initial,
    varClass,
    comment: findAll(node, 'xhtml')[0]?.text || undefined,
  })
}

function readPou(node: XmlNode, warnings: string[]): Pou {
  const kind: Pou['kind'] =
    node.attrs.pouType === 'function' ? 'FUNCTION'
      : node.attrs.pouType === 'functionBlock' ? 'FUNCTION_BLOCK' : 'PROGRAM'
  const iface = child(node, 'interface')
  const vars: Variable[] = []
  const grab = (tag: string, cls: VarClass) => {
    for (const list of iface ? children(iface, tag) : [])
      for (const v of children(list, 'variable')) vars.push(readVariable(v, cls))
  }
  grab('inputVars', 'VAR_INPUT')
  grab('outputVars', 'VAR_OUTPUT')
  grab('inOutVars', 'VAR_IN_OUT')
  grab('localVars', 'VAR')
  grab('tempVars', 'VAR_TEMP')

  const pou = makePou({ name: node.attrs.name || 'POU', kind, vars })
  const body = child(node, 'body')
  const st = body && child(body, 'ST')
  const ld = body && child(body, 'LD')
  const fbd = body && child(body, 'FBD')

  if (st) {
    pou.language = 'ST'
    pou.st = findAll(st, 'xhtml')[0]?.text ?? st.text
  } else if (ld) {
    pou.language = 'LD'
    pou.rungs = readLdBody(ld, warnings, pou.name)
  } else if (fbd) {
    pou.language = 'FBD'
    pou.fbd = readFbdBody(fbd)
  } else {
    warnings.push(`${pou.name}: nieobsługiwany język ciała POU — utworzono pusty program`)
  }
  const doc = child(node, 'documentation')
  if (doc) pou.comment = findAll(doc, 'xhtml')[0]?.text || doc.text
  return pou
}

/* -------------------- odtworzenie drabinki z grafu ------------------ */

interface LdElement {
  id: number
  node: XmlNode
  tag: string
  /** połączenia wejściowe: pin -> lista id źródeł */
  inputs: Map<string, number[]>
  /** stałe na pinach */
  literals: Map<string, string>
}

function readLdBody(ld: XmlNode, warnings: string[], pouName: string): Rung[] {
  const elements = new Map<number, LdElement>()
  for (const n of ld.children) {
    const id = Number(n.attrs.localId)
    if (!Number.isFinite(id)) continue
    const el: LdElement = { id, node: n, tag: localName(n), inputs: new Map(), literals: new Map() }
    if (el.tag === 'block') {
      for (const v of children(child(n, 'inputVariables') ?? { children: [] } as unknown as XmlNode, 'variable')) {
        const pin = v.attrs.formalParameter || 'IN'
        const cpi = child(v, 'connectionPointIn')
        const refs = cpi ? children(cpi, 'connection').map((c) => Number(c.attrs.refLocalId)) : []
        if (refs.length) el.inputs.set(pin, refs)
        const expr = cpi && child(cpi, 'expression')
        if (expr) el.literals.set(pin, expr.text)
      }
    } else {
      const cpi = child(n, 'connectionPointIn')
      const refs = cpi ? children(cpi, 'connection').map((c) => Number(c.attrs.refLocalId)) : []
      el.inputs.set('IN', refs)
    }
    elements.set(id, el)
  }

  // każdy element wyjściowy (cewka) tworzy osobny szczebel
  const coils = [...elements.values()].filter((e) => e.tag === 'coil')
  const rungs: Rung[] = []
  const guard = new Set<number>()

  const netOf = (id: number): NetNode | null => {
    const el = elements.get(id)
    if (!el) return null
    if (el.tag === 'leftPowerRail') return null
    if (guard.has(id)) { warnings.push(`${pouName}: wykryto pętlę w schemacie LD`); return null }
    guard.add(id)
    try {
      const upstreamRefs = el.tag === 'block'
        ? ([...el.inputs.entries()].find(([pin]) => pin === 'EN' || isRailPin(el, pin))?.[1] ?? [])
        : (el.inputs.get('IN') ?? [])
      const ups = upstreamRefs.map(netOf).filter((n): n is NetNode => n !== null)
      const upstream: NetNode | null = ups.length === 0 ? null : ups.length === 1 ? ups[0] : { k: 'par', parts: ups }
      const self = elementToCell(el)
      if (!self) return upstream
      return upstream ? { k: 'ser', parts: [upstream, { k: 'leaf', cell: self }] } : { k: 'leaf', cell: self }
    } finally {
      guard.delete(id)
    }
  }

  for (const coil of coils) {
    const upstreamRefs = coil.inputs.get('IN') ?? []
    const ups = upstreamRefs.map(netOf).filter((n): n is NetNode => n !== null)
    const net = ups.length === 0 ? null : ups.length === 1 ? ups[0] : { k: 'par' as const, parts: ups }
    const cell = elementToCell(coil)
    rungs.push(buildRung(net, cell ? [cell] : [], { comment: undefined }))
  }
  if (!rungs.length) warnings.push(`${pouName}: w schemacie LD nie znaleziono cewek`)
  return rungs
}

type NetNode =
  | { k: 'leaf'; cell: Cell }
  | { k: 'ser'; parts: NetNode[] }
  | { k: 'par'; parts: NetNode[] }

function isRailPin(el: LdElement, pin: string): boolean {
  const def = getBlockDef(el.node.attrs.typeName ?? '')
  return def?.inputs.find((p) => p.type === 'BOOL')?.name === pin
}

function elementToCell(el: LdElement): Cell | null {
  const a = el.node.attrs
  if (el.tag === 'contact') {
    const kind = a.edge === 'rising' ? 'P' : a.edge === 'falling' ? 'N' : a.negated === 'true' ? 'NC' : 'NO'
    return { type: 'contact', contactKind: kind, operand: child(el.node, 'variable')?.text ?? '' }
  }
  if (el.tag === 'coil') {
    const kind = a.storage === 'set' ? 'SET' : a.storage === 'reset' ? 'RESET'
      : a.edge === 'rising' ? 'PULSE_P' : a.edge === 'falling' ? 'PULSE_N'
        : a.negated === 'true' ? 'COIL_NEG' : 'COIL'
    return { type: 'coil', coilKind: kind, operand: child(el.node, 'variable')?.text ?? '' }
  }
  if (el.tag === 'block') {
    const typeName = a.typeName ?? ''
    const cmp = { GT: '>', GE: '>=', LT: '<', LE: '<=', EQ: '=', NE: '<>' }[typeName]
    if (cmp) {
      return {
        type: 'compare', cmpOp: cmp as Cell['cmpOp'],
        cmpA: el.literals.get('IN1') ?? '0', cmpB: el.literals.get('IN2') ?? '0',
      }
    }
    const def = getBlockDef(typeName)
    const pins = [
      ...(def?.inputs ?? []).map((p) => ({ name: p.name, expr: el.literals.get(p.name) ?? '' })),
      ...(def?.outputs ?? []).map((p) => ({ name: p.name, expr: '' })),
    ]
    return { type: 'block', blockType: typeName, instance: a.instanceName || undefined, pins }
  }
  if (el.tag === 'inVariable') {
    return { type: 'contact', contactKind: 'NO', operand: child(el.node, 'expression')?.text ?? '' }
  }
  return null
}

/* ---------------------------- FBD ---------------------------------- */

function readFbdBody(fbd: XmlNode): { nodes: FbdNode[]; links: FbdLink[] } {
  const nodes: FbdNode[] = []
  const links: FbdLink[] = []
  const idMap = new Map<number, string>()

  for (const n of fbd.children) {
    const localId = Number(n.attrs.localId)
    if (!Number.isFinite(localId)) continue
    const pos = child(n, 'position')
    const id = uid('n')
    idMap.set(localId, id)
    const x = Number(pos?.attrs.x ?? 0)
    const y = Number(pos?.attrs.y ?? 0)
    const tag = localName(n)
    if (tag === 'inVariable') nodes.push({ id, kind: 'VAR_IN', x, y, operand: child(n, 'expression')?.text ?? '' })
    else if (tag === 'outVariable') nodes.push({ id, kind: 'VAR_OUT', x, y, operand: child(n, 'expression')?.text ?? '' })
    else if (tag === 'block') nodes.push({ id, kind: n.attrs.typeName ?? '', x, y, instance: n.attrs.instanceName, literals: {} })
  }

  for (const n of fbd.children) {
    const localId = Number(n.attrs.localId)
    const toId = idMap.get(localId)
    if (!toId) continue
    const tag = localName(n)
    const collect = (pin: string, cpi: XmlNode | undefined) => {
      if (!cpi) return
      for (const c of children(cpi, 'connection')) {
        const from = idMap.get(Number(c.attrs.refLocalId))
        if (from) links.push({ id: uid('l'), from: { node: from, pin: c.attrs.formalParameter || 'OUT' }, to: { node: toId, pin } })
      }
      const expr = child(cpi, 'expression')
      if (expr) {
        const node = nodes.find((x) => x.id === toId)
        if (node) node.literals = { ...node.literals, [pin]: expr.text }
      }
    }
    if (tag === 'block') {
      for (const v of children(child(n, 'inputVariables') ?? ({ children: [] } as unknown as XmlNode), 'variable'))
        collect(v.attrs.formalParameter || 'IN', child(v, 'connectionPointIn'))
    } else {
      collect('IN', child(n, 'connectionPointIn'))
    }
  }
  return { nodes, links }
}

/* ================================================================== */
/* Rozpoznanie formatu                                                 */
/* ================================================================== */

export type ImportFormat = 'json' | 'plcopen' | 'st'

export function detectFormat(text: string, filename = ''): ImportFormat {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'json') return 'json'
  if (ext === 'xml' || ext === 'plcopen') return 'plcopen'
  const head = text.slice(0, 400).trim()
  if (head.startsWith('{')) return 'json'
  if (head.startsWith('<')) return 'plcopen'
  return 'st'
}

export function importAny(text: string, filename = '', asLadder = true): ImportResult {
  switch (detectFormat(text, filename)) {
    case 'json': return importJson(text)
    case 'plcopen': return importPlcOpenXml(text)
    default: return asLadder ? importStAsLadder(text) : importSt(text)
  }
}
