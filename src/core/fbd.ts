import type { FbdNetwork, FbdNode, PlcValue } from './types'
import { getBlockDef, toBool } from './blocks'
import { evalExpr } from './expr'
import type { RuntimeEnv } from './st/interp'

export const TERMINAL_KINDS = ['VAR_IN', 'VAR_OUT', 'CONST', 'COMMENT'] as const

export interface FbdPinInfo { inputs: string[]; outputs: string[] }

export function fbdPins(node: FbdNode, env?: RuntimeEnv): FbdPinInfo {
  switch (node.kind) {
    case 'VAR_IN': return { inputs: [], outputs: ['OUT'] }
    case 'CONST': return { inputs: [], outputs: ['OUT'] }
    case 'VAR_OUT': return { inputs: ['IN'], outputs: [] }
    case 'COMMENT': return { inputs: [], outputs: [] }
    default: {
      const def = getBlockDef(node.kind)
      if (def) return { inputs: def.inputs.map((p) => p.name), outputs: def.outputs.map((p) => p.name) }
      if (env) return { inputs: env.inputPins(node.kind), outputs: env.outputPins?.(node.kind) ?? [] }
      return { inputs: [], outputs: [] }
    }
  }
}

/** Wartości na połączeniach po ostatnim wykonaniu — do animacji edytora. */
export type FbdTrace = Record<string, PlcValue>

/**
 * Wykonuje sieć FBD. Sprzężenia zwrotne korzystają z wartości z poprzedniego
 * cyklu przechowywanych w obiekcie `memory`.
 */
export function evalFbd(
  net: FbdNetwork,
  env: RuntimeEnv,
  memory: Record<string, PlcValue>,
  scopeKey: string,
): FbdTrace {
  const byId = new Map(net.nodes.map((n) => [n.id, n]))
  const incoming = new Map<string, { node: string; pin: string }>()
  for (const l of net.links) incoming.set(`${l.to.node}:${l.to.pin}`, l.from)

  const outValue = new Map<string, PlcValue>()  // "nodeId:pin" -> wartość
  const done = new Set<string>()
  const visiting = new Set<string>()

  const readPin = (nodeId: string, pin: string): PlcValue => {
    const src = incoming.get(`${nodeId}:${pin}`)
    if (!src) {
      const node = byId.get(nodeId)
      const lit = node?.literals?.[pin]
      const def = getBlockDef(node?.kind ?? '')
      const dflt = def?.inputs.find((p) => p.name === pin)?.default
      return evalExpr(lit ?? dflt ?? '', env, false)
    }
    evalNode(src.node)
    const key = `${src.node}:${src.pin}`
    const v = outValue.get(key) ?? memory[`${scopeKey}:${key}`] ?? false
    return v
  }

  const evalNode = (id: string) => {
    if (done.has(id)) return
    if (visiting.has(id)) return   // pętla sprzężenia zwrotnego — użyj wartości z poprzedniego cyklu
    const node = byId.get(id)
    if (!node) return
    visiting.add(id)
    try {
      const pins = fbdPins(node, env)
      if (node.kind === 'VAR_IN') {
        outValue.set(`${id}:OUT`, evalExpr(node.operand ?? '', env, false))
      } else if (node.kind === 'CONST') {
        outValue.set(`${id}:OUT`, evalExpr(node.operand ?? '0', env, 0))
      } else if (node.kind === 'VAR_OUT') {
        const v = applyNeg(node, 'IN', readPin(id, 'IN'))
        const target = (node.operand ?? '').trim()
        if (target) env.set(target, v)
        outValue.set(`${id}:IN`, v)
      } else if (node.kind !== 'COMMENT') {
        const inputs: Record<string, PlcValue> = {}
        for (const pin of pins.inputs) inputs[pin] = applyNeg(node, pin, readPin(id, pin))
        const def = getBlockDef(node.kind)
        const stateful = def ? def.stateful : true
        const instance = stateful ? (node.instance?.trim() || `__fbd_${scopeKey}_${id}`) : undefined
        let outs: Record<string, PlcValue> = {}
        try { outs = env.call(node.kind, instance, inputs) } catch { outs = {} }
        for (const pin of pins.outputs) outValue.set(`${id}:${pin}`, outs[pin] ?? false)
      }
    } finally {
      visiting.delete(id)
      done.add(id)
    }
  }

  for (const n of net.nodes) evalNode(n.id)

  const trace: FbdTrace = {}
  for (const [k, v] of outValue) {
    trace[k] = v
    memory[`${scopeKey}:${k}`] = v
  }
  return trace
}

function applyNeg(node: FbdNode, pin: string, v: PlcValue): PlcValue {
  return node.negIn?.[pin] ? !toBool(v) : v
}
