import type {
  AlarmEvent, DataType, IoPoint, PlcValue, Pou, Project, Variable,
} from './types'
import { BLOCK_IMPL, BLOCK_MAP, getBlockDef, toBool, toNum } from './blocks'
import { evalRung, type EdgeStore, type RungTrace } from './evaluate'
import { evalFbd, type FbdTrace } from './fbd'
import { parseSt } from './st/parser'
import type { Stmt } from './st/ast'
import { Interpreter, type RuntimeEnv } from './st/interp'
import { parseTimeLiteral } from './st/lexer'

const SCOPE_SEP = '::'
export const TREND_CAPACITY = 900

export interface TrendSample { t: number; v: number }

export interface SimStats {
  scanCount: number
  simTime: number
  lastScanUs: number
  avgScanUs: number
  maxScanUs: number
}

export interface StepInfo {
  pouId: string
  pouName: string
  /** null dla POU w ST/FBD wykonywanego w całości */
  rungId: string | null
  rungIndex: number
  label: string
}

export interface SimSnapshot {
  vars: Record<string, PlcValue>
  traces: Record<string, RungTrace>
  fbdTraces: Record<string, FbdTrace>
  alarms: AlarmEvent[]
  errors: string[]
  stats: SimStats
  cursor: number
  steps: StepInfo[]
  instances: Record<string, Record<string, PlcValue>>
}

interface InstanceRec {
  type: string
  state: Record<string, PlcValue>
  outs: Record<string, PlcValue>
  pending: Record<string, PlcValue>
  /** czy zmienne lokalne bloku użytkownika zostały już zadeklarowane */
  membersReady?: boolean
}

export function defaultValue(type: DataType): PlcValue {
  if (type === 'BOOL') return false
  if (type === 'STRING') return ''
  return 0
}

export function parseInitial(type: DataType, raw?: string): PlcValue {
  if (raw === undefined || raw === '') return defaultValue(type)
  const t = raw.trim()
  if (type === 'BOOL') return /^(TRUE|1)$/i.test(t)
  if (type === 'STRING') return t.replace(/^'|'$/g, '')
  if (type === 'TIME') return /^(T|TIME)#/i.test(t) ? parseTimeLiteral(t) : Number(t) || 0
  return Number(t) || 0
}

/**
 * Wirtualny sterownik PLC — wykonuje projekt w cyklu skanowania.
 * Czas symulacji jest wirtualny (krok = skonfigurowany czas cyklu),
 * dzięki czemu wyniki nie zależą od wydajności przeglądarki.
 */
export class Simulator {
  private vars = new Map<string, PlcValue>()
  private types = new Map<string, DataType>()
  private instances = new Map<string, InstanceRec>()
  private forced = new Map<string, PlcValue>()
  private edges: EdgeStore = {}
  private fbdMemory: Record<string, PlcValue> = {}
  private traces = new Map<string, RungTrace>()
  private fbdTraces = new Map<string, FbdTrace>()
  private astCache = new Map<string, Stmt[]>()
  private trends = new Map<string, TrendSample[]>()
  private alarmState = new Map<string, AlarmEvent>()

  alarms: AlarmEvent[] = []
  errors: string[] = []
  undeclared = new Set<string>()

  private scope = ''
  private callDepth = 0
  private steps: StepInfo[] = []
  cursor = 0

  stats: SimStats = { scanCount: 0, simTime: 0, lastScanUs: 0, avgScanUs: 0, maxScanUs: 0 }

  constructor(public project: Project) {
    this.reset()
  }

  /* ------------------------------------------------------------------ */
  /* Inicjalizacja                                                       */
  /* ------------------------------------------------------------------ */

  setProject(project: Project, keepValues = false) {
    const old = keepValues ? new Map(this.vars) : null
    this.project = project
    this.reset()
    if (old) {
      for (const [k, v] of old) if (this.vars.has(k)) this.vars.set(k, v)
    }
  }

  reset() {
    this.vars.clear(); this.types.clear(); this.instances.clear()
    this.edges = {}; this.fbdMemory = {}
    this.traces.clear(); this.fbdTraces.clear(); this.trends.clear()
    this.alarmState.clear(); this.alarms = []; this.errors = []
    this.undeclared.clear()
    this.stats = { scanCount: 0, simTime: 0, lastScanUs: 0, avgScanUs: 0, maxScanUs: 0 }
    this.cursor = 0

    for (const v of this.project.globals) this.declare('', v)
    for (const pou of this.project.pous) {
      if (pou.kind !== 'PROGRAM') continue
      for (const v of pou.vars) this.declare(pou.name, v)
    }
    this.buildSteps()
  }

  private declare(scope: string, v: Variable) {
    const key = scope ? `${scope}${SCOPE_SEP}${v.name}` : v.name
    if (v.fbType) {
      this.instances.set(key, { type: v.fbType, state: {}, outs: {}, pending: {} })
      return
    }
    this.types.set(key, v.type)
    this.vars.set(key, parseInitial(v.type, v.initial))
  }

  private buildSteps() {
    this.steps = []
    for (const pou of this.orderedPrograms()) {
      if (pou.language === 'LD') {
        pou.rungs.forEach((r, i) => this.steps.push({
          pouId: pou.id, pouName: pou.name, rungId: r.id, rungIndex: i,
          label: `${pou.name} • szczebel ${i + 1}${r.label ? ` (${r.label})` : ''}`,
        }))
      } else {
        this.steps.push({
          pouId: pou.id, pouName: pou.name, rungId: null, rungIndex: 0,
          label: `${pou.name} • ${pou.language}`,
        })
      }
    }
    if (this.cursor >= this.steps.length) this.cursor = 0
  }

  /** Programy w kolejności wynikającej z zadań (task) lub deklaracji. */
  private orderedPrograms(): Pou[] {
    const programs = this.project.pous.filter((p) => p.kind === 'PROGRAM')
    const tasks = this.project.tasks.filter((t) => t.enabled)
    if (!tasks.length) return programs
    const ordered: Pou[] = []
    for (const t of [...tasks].sort((a, b) => a.priority - b.priority)) {
      for (const name of t.programs) {
        const p = programs.find((x) => x.name === name)
        if (p && !ordered.includes(p)) ordered.push(p)
      }
    }
    for (const p of programs) if (!ordered.includes(p)) ordered.push(p)
    return ordered
  }

  getSteps(): StepInfo[] { return this.steps }

  /* ------------------------------------------------------------------ */
  /* Dostęp do zmiennych                                                 */
  /* ------------------------------------------------------------------ */

  private resolveKey(name: string): string {
    if (this.scope) {
      const local = `${this.scope}${SCOPE_SEP}${name}`
      if (this.vars.has(local) || this.instances.has(local)) return local
    }
    return name
  }

  readVar(key: string): PlcValue {
    if (this.forced.has(key)) return this.forced.get(key)!
    return this.vars.get(key) ?? false
  }

  writeVar(key: string, v: PlcValue) {
    if (this.forced.has(key)) return
    this.vars.set(key, v)
  }

  /** Ustawia wartość z pominięciem wymuszeń (np. z panelu HMI). */
  poke(key: string, v: PlcValue) {
    if (this.forced.has(key)) this.forced.set(key, v)
    else this.vars.set(key, this.coerce(key, v))
  }

  private coerce(key: string, v: PlcValue): PlcValue {
    const t = this.types.get(key)
    if (!t) return v
    if (t === 'BOOL') return toBool(v)
    if (t === 'STRING') return String(v)
    const n = toNum(v)
    if (['SINT', 'INT', 'DINT', 'LINT', 'USINT', 'UINT', 'UDINT', 'BYTE', 'WORD', 'DWORD'].includes(t))
      return Math.round(n)
    return n
  }

  force(key: string, v: PlcValue) { this.forced.set(key, this.coerce(key, v)) }
  unforce(key: string) { this.forced.delete(key) }
  clearForces() { this.forced.clear() }
  isForced(key: string) { return this.forced.has(key) }
  forcedKeys(): string[] { return [...this.forced.keys()] }
  varType(key: string): DataType | undefined { return this.types.get(key) }
  allVarKeys(): string[] { return [...this.vars.keys()] }
  instanceKeys(): string[] { return [...this.instances.keys()] }
  instanceOuts(key: string): Record<string, PlcValue> { return this.instances.get(key)?.outs ?? {} }

  /* ------------------------------------------------------------------ */
  /* Środowisko wykonawcze                                               */
  /* ------------------------------------------------------------------ */

  private env: RuntimeEnv = {
    get: (name) => {
      const key = this.resolveKey(name)
      if (!this.vars.has(key) && !this.instances.has(key)) {
        this.undeclared.add(name)
        return false
      }
      return this.readVar(key)
    },
    set: (name, v) => {
      const key = this.resolveKey(name)
      if (!this.vars.has(key)) {
        this.undeclared.add(name)
        this.types.set(key, typeof v === 'boolean' ? 'BOOL' : typeof v === 'string' ? 'STRING' : 'REAL')
      }
      this.writeVar(key, this.coerce(key, v))
    },
    instanceType: (name) => {
      const key = this.resolveKey(name)
      return this.instances.get(key)?.type
    },
    getMember: (instance, pin) => {
      const key = this.resolveKey(instance)
      const rec = this.instances.get(key)
      if (!rec) return false
      if (pin in rec.outs) return rec.outs[pin]
      if (pin in rec.pending) return rec.pending[pin]
      return this.vars.get(`${key}${SCOPE_SEP}${pin}`) ?? false
    },
    setMember: (instance, pin, v) => {
      const key = this.resolveKey(instance)
      const rec = this.instances.get(key)
      if (rec) rec.pending[pin] = v
    },
    call: (type, instance, inputs) => this.callBlock(type, instance, inputs),
    inputPins: (type) => {
      const def = getBlockDef(type)
      if (def) return def.inputs.map((p) => p.name)
      const pou = this.findPou(type)
      return pou ? pou.vars.filter((v) => v.varClass === 'VAR_INPUT' || v.varClass === 'VAR_IN_OUT').map((v) => v.name) : []
    },
    outputPins: (type) => {
      const def = getBlockDef(type)
      if (def) return def.outputs.map((p) => p.name)
      const pou = this.findPou(type)
      return pou ? pou.vars.filter((v) => v.varClass === 'VAR_OUTPUT' || v.varClass === 'VAR_IN_OUT').map((v) => v.name) : []
    },
    firstOutput: (type) => {
      const def = getBlockDef(type)
      if (def) return def.outputs[0]?.name
      const pou = this.findPou(type)
      return pou?.vars.find((v) => v.varClass === 'VAR_OUTPUT')?.name
    },
    warn: (m) => this.pushError(m),
  }

  getEnv(): RuntimeEnv { return this.env }

  private pushError(msg: string) {
    if (this.errors.length < 50 && !this.errors.includes(msg)) this.errors.push(msg)
  }

  /** Znajduje POU realizujące blok użytkownika (projekt lub biblioteka). */
  findPou(name: string): Pou | undefined {
    const p = this.project.pous.find((x) => x.name === name && x.kind !== 'PROGRAM')
    if (p) return p
    return this.project.library.find((l) => l.name === name)?.pou
  }

  private callBlock(type: string, instance: string | undefined, inputs: Record<string, PlcValue>): Record<string, PlcValue> {
    const impl = BLOCK_IMPL[type]
    const ctx = { dt: this.project.config.scanTime, now: this.stats.simTime }
    if (impl) {
      const def = BLOCK_MAP[type]
      if (!def.stateful) return impl(inputs, {}, ctx)
      const key = instance ? this.resolveKey(instance) : `__anon_${type}`
      let rec = this.instances.get(key)
      if (!rec) { rec = { type, state: {}, outs: {}, pending: {} }; this.instances.set(key, rec) }
      const merged = { ...rec.pending, ...inputs }
      const outs = impl(merged, rec.state, ctx)
      rec.outs = outs
      return outs
    }
    return this.callUserBlock(type, instance, inputs)
  }

  /** Wywołanie bloku funkcyjnego zdefiniowanego przez użytkownika. */
  private callUserBlock(type: string, instance: string | undefined, inputs: Record<string, PlcValue>): Record<string, PlcValue> {
    const pou = this.findPou(type)
    if (!pou) { this.pushError(`Nieznany blok "${type}"`); return {} }
    if (this.callDepth > 16) { this.pushError(`Zbyt głębokie zagnieżdżenie wywołań (${type})`); return {} }

    const key = instance ? this.resolveKey(instance) : `__fn${SCOPE_SEP}${type}`
    let rec = this.instances.get(key)
    if (!rec) {
      rec = { type, state: {}, outs: {}, pending: {} }
      this.instances.set(key, rec)
    }
    if (!rec.membersReady) {
      // zmienne lokalne instancji tworzone są przy pierwszym wywołaniu
      for (const v of pou.vars) this.declare(key, v)
      rec.membersReady = true
    }
    for (const [pin, v] of Object.entries({ ...rec.pending, ...inputs })) {
      const k = `${key}${SCOPE_SEP}${pin}`
      if (this.vars.has(k)) this.vars.set(k, this.coerce(k, v))
    }
    const prevScope = this.scope
    this.scope = key
    this.callDepth++
    try {
      this.runPou(pou, key)
    } finally {
      this.callDepth--
      this.scope = prevScope
    }
    const outs: Record<string, PlcValue> = {}
    for (const v of pou.vars) {
      if (v.varClass === 'VAR_OUTPUT' || v.varClass === 'VAR_IN_OUT')
        outs[v.name] = this.vars.get(`${key}${SCOPE_SEP}${v.name}`) ?? false
    }
    rec.outs = outs
    return outs
  }

  /* ------------------------------------------------------------------ */
  /* Wykonanie POU                                                       */
  /* ------------------------------------------------------------------ */

  private runPou(pou: Pou, scopeKey: string) {
    if (pou.language === 'ST') this.runSt(pou, scopeKey)
    else if (pou.language === 'FBD') this.runFbd(pou, scopeKey)
    else pou.rungs.forEach((_, i) => this.runRung(pou, i, scopeKey))
  }

  private runSt(pou: Pou, scopeKey: string) {
    let ast = this.astCache.get(pou.id + ':' + pou.st.length)
    if (!ast) {
      try {
        ast = parseSt(pou.st)
        this.astCache.set(pou.id + ':' + pou.st.length, ast)
      } catch (e) {
        this.pushError(`${pou.name}: ${(e as Error).message}`)
        return
      }
    }
    try {
      new Interpreter(this.env).run(ast)
    } catch (e) {
      this.pushError(`${pou.name}: ${(e as Error).message}`)
    }
    void scopeKey
  }

  private runFbd(pou: Pou, scopeKey: string) {
    const trace = evalFbd(pou.fbd, this.env, this.fbdMemory, scopeKey)
    this.fbdTraces.set(pou.id, trace)
  }

  private runRung(pou: Pou, index: number, scopeKey: string) {
    const rung = pou.rungs[index]
    if (!rung) return
    const trace = evalRung(rung, this.env, this.edges, `${scopeKey}:${rung.id}`)
    this.traces.set(`${pou.id}:${rung.id}`, trace)
  }

  /* ------------------------------------------------------------------ */
  /* Cykl skanowania                                                     */
  /* ------------------------------------------------------------------ */

  /** Wykonuje pełny cykl. Zwraca id szczebla z pułapką, jeśli trafiono. */
  scan(): string | null {
    const t0 = performance.now()
    this.beginScan()
    let hitBreak: string | null = null
    for (let i = 0; i < this.steps.length; i++) {
      const bp = this.executeStep(i)
      if (bp && !hitBreak) hitBreak = bp
    }
    this.cursor = 0
    this.endScan(t0)
    return hitBreak
  }

  /**
   * Wykonuje pojedynczy krok (jeden szczebel drabinki albo jedno POU w ST/FBD).
   * Zwraca true, gdy krok zamknął cykl skanowania.
   */
  stepOnce(): boolean {
    if (!this.steps.length) { this.scan(); return true }
    const t0 = performance.now()
    if (this.cursor === 0) this.beginScan()
    this.executeStep(this.cursor)
    this.cursor++
    if (this.cursor >= this.steps.length) {
      this.cursor = 0
      this.endScan(t0)
      return true
    }
    return false
  }

  private executeStep(index: number): string | null {
    const step = this.steps[index]
    if (!step) return null
    const pou = this.project.pous.find((p) => p.id === step.pouId)
    if (!pou) return null
    const prevScope = this.scope
    this.scope = pou.name
    try {
      if (step.rungId === null) this.runPou(pou, pou.name)
      else {
        this.runRung(pou, step.rungIndex, pou.name)
        if (pou.rungs[step.rungIndex]?.breakpoint) return step.rungId
      }
    } catch (e) {
      this.pushError(`${pou.name}: ${(e as Error).message}`)
    } finally {
      this.scope = prevScope
    }
    return null
  }

  private beginScan() {
    this.stats.simTime += this.project.config.scanTime
    this.applyIoInputs()
  }

  private endScan(t0: number) {
    this.stats.scanCount++
    const us = (performance.now() - t0) * 1000
    this.stats.lastScanUs = us
    this.stats.maxScanUs = Math.max(this.stats.maxScanUs, us)
    this.stats.avgScanUs = this.stats.avgScanUs * 0.9 + us * 0.1
    this.applyIoOutputs()
    this.evaluateAlarms()
    this.recordTrends()
  }

  /* ------------------------------------------------------------------ */
  /* Symulacja wejść/wyjść                                               */
  /* ------------------------------------------------------------------ */

  private applyIoInputs() {
    const t = this.stats.simTime
    for (const io of this.project.io) {
      if (io.direction !== 'IN' || !io.sim || io.sim === 'manual') continue
      const key = io.variable
      if (!this.vars.has(key)) continue
      const period = Math.max(1, io.period ?? 1000)
      const min = io.min ?? 0
      const max = io.max ?? 100
      let v: PlcValue = 0
      switch (io.sim) {
        case 'toggle': v = Math.floor(t / period) % 2 === 1; break
        case 'pulse': v = t % period < Math.max(1, this.project.config.scanTime); break
        case 'ramp': v = min + ((t % period) / period) * (max - min); break
        case 'sine': v = min + ((Math.sin((2 * Math.PI * t) / period) + 1) / 2) * (max - min); break
        case 'random': v = min + Math.random() * (max - min); break
        case 'noise': v = toNum(this.vars.get(key)) + (Math.random() - 0.5) * (max - min) * 0.02; break
      }
      this.vars.set(key, this.coerce(key, v))
    }
  }

  private applyIoOutputs() { /* miejsce na sprzężenie z modelem procesu */ }

  /* ------------------------------------------------------------------ */
  /* Alarmy i trendy                                                     */
  /* ------------------------------------------------------------------ */

  private evaluateAlarms() {
    for (const def of this.project.alarms) {
      const v = this.readVar(def.variable)
      let active: boolean
      switch (def.condition) {
        case 'true': active = toBool(v); break
        case 'false': active = !toBool(v); break
        case '>': active = toNum(v) > (def.limit ?? 0); break
        case '<': active = toNum(v) < (def.limit ?? 0); break
        case '>=': active = toNum(v) >= (def.limit ?? 0); break
        case '<=': active = toNum(v) <= (def.limit ?? 0); break
      }
      const cur = this.alarmState.get(def.id)
      if (active && !cur) {
        const ev: AlarmEvent = {
          id: `${def.id}_${this.stats.scanCount}`,
          defId: def.id, text: def.text, priority: def.priority, raisedAt: this.stats.simTime,
        }
        this.alarmState.set(def.id, ev)
        this.alarms.unshift(ev)
        if (this.alarms.length > 200) this.alarms.pop()
      } else if (!active && cur) {
        cur.clearedAt = this.stats.simTime
        this.alarmState.delete(def.id)
      }
    }
  }

  ackAlarm(id: string) {
    const a = this.alarms.find((x) => x.id === id)
    if (a) a.ackAt = this.stats.simTime
  }

  ackAllAlarms() { for (const a of this.alarms) if (!a.ackAt) a.ackAt = this.stats.simTime }

  private watched = new Set<string>()
  setWatched(keys: string[]) {
    this.watched = new Set(keys)
    for (const k of [...this.trends.keys()]) if (!this.watched.has(k)) this.trends.delete(k)
  }

  private recordTrends() {
    for (const key of this.watched) {
      let buf = this.trends.get(key)
      if (!buf) { buf = []; this.trends.set(key, buf) }
      buf.push({ t: this.stats.simTime, v: toNum(this.readVar(key)) })
      if (buf.length > TREND_CAPACITY) buf.shift()
    }
  }

  getTrend(key: string): TrendSample[] { return this.trends.get(key) ?? [] }

  /* ------------------------------------------------------------------ */
  /* Migawka stanu dla interfejsu                                        */
  /* ------------------------------------------------------------------ */

  snapshot(): SimSnapshot {
    return {
      vars: Object.fromEntries(this.vars),
      traces: Object.fromEntries(this.traces),
      fbdTraces: Object.fromEntries(this.fbdTraces),
      alarms: this.alarms.slice(0, 100),
      errors: this.errors.slice(),
      stats: { ...this.stats },
      cursor: this.cursor,
      steps: this.steps,
      instances: Object.fromEntries([...this.instances].map(([k, r]) => [k, r.outs])),
    }
  }
}

export function ioDefaults(io: Partial<IoPoint>): IoPoint {
  return {
    id: io.id ?? 'io', address: io.address ?? '%IX0.0', variable: io.variable ?? '',
    direction: io.direction ?? 'IN', sim: io.sim ?? 'manual',
    period: io.period ?? 1000, min: io.min ?? 0, max: io.max ?? 100,
  }
}
