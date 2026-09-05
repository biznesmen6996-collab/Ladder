import { useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { FbdNode, Pou } from '../core/types'
import { BLOCK_CATEGORIES, BLOCK_DEFS, getBlockDef, toBool } from '../core/blocks'
import { fbdPins } from '../core/fbd'
import { uid } from '../core/grid'
import { Icon, Field, Empty } from './common'

const NODE_W = 130
const TITLE_H = 24
const PIN_H = 18

function nodeSize(node: FbdNode, pins: { inputs: string[]; outputs: string[] }) {
  if (node.kind === 'VAR_IN' || node.kind === 'VAR_OUT' || node.kind === 'CONST') return { w: 118, h: 30 }
  return { w: NODE_W, h: TITLE_H + Math.max(pins.inputs.length, pins.outputs.length, 1) * PIN_H + 8 }
}

function pinPos(node: FbdNode, pins: { inputs: string[]; outputs: string[] }, pin: string, out: boolean) {
  const size = nodeSize(node, pins)
  if (node.kind === 'VAR_IN' || node.kind === 'CONST') return { x: node.x + size.w, y: node.y + size.h / 2 }
  if (node.kind === 'VAR_OUT') return { x: node.x, y: node.y + size.h / 2 }
  const list = out ? pins.outputs : pins.inputs
  const i = Math.max(0, list.indexOf(pin))
  return { x: node.x + (out ? size.w : 0), y: node.y + TITLE_H + 4 + i * PIN_H + PIN_H / 2 }
}

export function FbdEditor() {
  const pou = useStore((s) => s.activePou())
  const st = useStore()
  const snapshot = useStore((s) => s.snapshot)
  const [selected, setSelected] = useState<string | null>(null)
  const [linking, setLinking] = useState<null | { node: string; pin: string; out: boolean; x: number; y: number }>(null)
  const [drag, setDrag] = useState<null | { id: string; dx: number; dy: number }>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const trace = snapshot.fbdTraces[pou.id] ?? {}
  const net = pou.fbd

  const pinsOf = useMemo(() => {
    const map = new Map<string, { inputs: string[]; outputs: string[] }>()
    for (const n of net.nodes) {
      const def = getBlockDef(n.kind)
      if (def) map.set(n.id, { inputs: def.inputs.map((p) => p.name), outputs: def.outputs.map((p) => p.name) })
      else map.set(n.id, fbdPins(n))
    }
    return map
  }, [net.nodes])

  const update = (fn: (p: Pou) => void) => {
    st.commit((proj) => {
      const target = proj.pous.find((x) => x.id === pou.id)
      if (target) fn(target)
    })
  }

  const addNode = (kind: string) => {
    const n = net.nodes.length
    const node: FbdNode = {
      id: uid('n'), kind,
      x: 40 + (n % 4) * 190,
      y: 50 + Math.floor(n / 4) * 60 + (n % 4) * 95,
      instance: getBlockDef(kind)?.stateful ? `${kind}_${net.nodes.filter((n) => n.kind === kind).length + 1}` : undefined,
      operand: kind === 'VAR_IN' || kind === 'VAR_OUT' ? '' : undefined,
      literals: {},
    }
    update((p) => { p.fbd = { ...p.fbd, nodes: [...p.fbd.nodes, node] } })
    setSelected(node.id)
  }

  const deleteNode = (id: string) => {
    update((p) => {
      p.fbd = {
        nodes: p.fbd.nodes.filter((n) => n.id !== id),
        links: p.fbd.links.filter((l) => l.from.node !== id && l.to.node !== id),
      }
    })
    setSelected(null)
  }

  const startLink = (e: React.PointerEvent, node: string, pin: string, out: boolean) => {
    e.stopPropagation()
    const rect = canvasRef.current?.getBoundingClientRect()
    setLinking({ node, pin, out, x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
  }

  const finishLink = (node: string, pin: string, out: boolean) => {
    if (!linking) return
    if (linking.out === out) { setLinking(null); return }
    const from = linking.out ? { node: linking.node, pin: linking.pin } : { node, pin }
    const to = linking.out ? { node, pin } : { node: linking.node, pin: linking.pin }
    update((p) => {
      p.fbd = {
        ...p.fbd,
        links: [...p.fbd.links.filter((l) => !(l.to.node === to.node && l.to.pin === to.pin)),
          { id: uid('l'), from, to }],
      }
    })
    setLinking(null)
  }

  const onMove = (e: React.PointerEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (linking) setLinking({ ...linking, x: e.clientX - (rect?.left ?? 0) + (canvasRef.current?.scrollLeft ?? 0), y: e.clientY - (rect?.top ?? 0) + (canvasRef.current?.scrollTop ?? 0) })
    if (drag) {
      const x = Math.max(0, e.clientX - (rect?.left ?? 0) - drag.dx + (canvasRef.current?.scrollLeft ?? 0))
      const y = Math.max(0, e.clientY - (rect?.top ?? 0) - drag.dy + (canvasRef.current?.scrollTop ?? 0))
      update((p) => {
        const n = p.fbd.nodes.find((x) => x.id === drag.id)
        if (n) { n.x = Math.round(x / 10) * 10; n.y = Math.round(y / 10) * 10 }
      })
    }
  }

  if (pou.language !== 'FBD') {
    return <Empty icon="block" title={`POU „${pou.name}" jest w języku ${pou.language}`}
      hint="Edytor blokowy działa dla jednostek programowych w języku FBD. Zmień język POU w panelu bocznym." />
  }

  const selNode = net.nodes.find((n) => n.id === selected)

  return (
    <div style={{ display: 'flex', height: '100%', minHeight: 0 }}>
      <div className="sidebar" style={{ width: 180, borderRight: '1px solid var(--border)' }}>
        <div className="panel-head">Bloki</div>
        <div className="panel-scroll">
          <div className="section">
            <div className="section-title">Terminale</div>
            <button className="sm" style={{ width: '100%', marginBottom: 4 }} onClick={() => addNode('VAR_IN')}>
              <Icon name="right" size={13} /> Wejście (zmienna)
            </button>
            <button className="sm" style={{ width: '100%', marginBottom: 4 }} onClick={() => addNode('VAR_OUT')}>
              <Icon name="left" size={13} /> Wyjście (zmienna)
            </button>
            <button className="sm" style={{ width: '100%' }} onClick={() => addNode('CONST')}>
              <Icon name="plus" size={13} /> Stała
            </button>
          </div>
          {BLOCK_CATEGORIES.map((cat) => (
            <div key={cat} className="section">
              <div className="section-title">{cat}</div>
              {BLOCK_DEFS.filter((d) => d.category === cat).map((d) => (
                <div key={d.type} className="tree-item" onClick={() => addNode(d.type)} title={d.description}>
                  <span className="mono">{d.type}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
          <span className="chip accent">{pou.name}</span>
          <span className="hint">Kliknij pin i przeciągnij do drugiego pinu, aby narysować połączenie.</span>
          <div className="spacer" />
          {selected && <button className="sm danger" onClick={() => deleteNode(selected)}><Icon name="trash" size={14} /> Usuń blok</button>}
        </div>

        <div
          ref={canvasRef}
          className="fbd-canvas"
          style={{ flex: 1 }}
          onPointerMove={onMove}
          onPointerUp={() => { setDrag(null); setLinking(null) }}
          onClick={() => setSelected(null)}
        >
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', minWidth: 2000, minHeight: 1200 }}>
            {net.links.map((l) => {
              const a = net.nodes.find((n) => n.id === l.from.node)
              const bNode = net.nodes.find((n) => n.id === l.to.node)
              if (!a || !bNode) return null
              const p1 = pinPos(a, pinsOf.get(a.id)!, l.from.pin, true)
              const p2 = pinPos(bNode, pinsOf.get(bNode.id)!, l.to.pin, false)
              const on = toBool(trace[`${l.from.node}:${l.from.pin}`])
              const mx = (p1.x + p2.x) / 2
              return (
                <path key={l.id} d={`M ${p1.x} ${p1.y} C ${mx} ${p1.y}, ${mx} ${p2.y}, ${p2.x} ${p2.y}`}
                  fill="none" stroke={on ? 'var(--live)' : 'var(--border-strong)'} strokeWidth={on ? 2.4 : 1.6} />
              )
            })}
            {linking && (() => {
              const n = net.nodes.find((x) => x.id === linking.node)
              if (!n) return null
              const p1 = pinPos(n, pinsOf.get(n.id)!, linking.pin, linking.out)
              return <line x1={p1.x} y1={p1.y} x2={linking.x} y2={linking.y} stroke="var(--accent)" strokeWidth={2} strokeDasharray="4 3" />
            })()}
          </svg>

          {net.nodes.map((n) => {
            const pins = pinsOf.get(n.id)!
            const size = nodeSize(n, pins)
            const isTerminal = ['VAR_IN', 'VAR_OUT', 'CONST'].includes(n.kind)
            const live = pins.outputs.some((o) => toBool(trace[`${n.id}:${o}`]))
            return (
              <div key={n.id}
                className={`fbd-node${selected === n.id ? ' sel' : ''}${live ? ' live' : ''}`}
                style={{ left: n.x, top: n.y, width: size.w, minHeight: size.h }}
                onClick={(e) => { e.stopPropagation(); setSelected(n.id) }}
              >
                <div className="fbd-title"
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    const rect = canvasRef.current?.getBoundingClientRect()
                    setDrag({ id: n.id, dx: e.clientX - (rect?.left ?? 0) - n.x + (canvasRef.current?.scrollLeft ?? 0), dy: e.clientY - (rect?.top ?? 0) - n.y + (canvasRef.current?.scrollTop ?? 0) })
                    setSelected(n.id)
                  }}>
                  {isTerminal
                    ? (n.operand || (n.kind === 'CONST' ? '0' : n.kind === 'VAR_IN' ? 'wejście…' : 'wyjście…'))
                    : n.kind}
                </div>
                {!isTerminal && (
                  <div className="fbd-pins">
                    <div>
                      {pins.inputs.map((p) => (
                        <div key={p} className="fbd-pin">
                          <span className={`pin-dot${toBool(trace[`${n.id}:${p}`]) ? ' live' : ''}${linking?.node === n.id && linking.pin === p ? ' linking' : ''}`}
                            onPointerDown={(e) => startLink(e, n.id, p, false)}
                            onPointerUp={(e) => { e.stopPropagation(); finishLink(n.id, p, false) }} />
                          <span>{p}</span>
                        </div>
                      ))}
                    </div>
                    <div>
                      {pins.outputs.map((p) => (
                        <div key={p} className="fbd-pin out">
                          <span className={`pin-dot${toBool(trace[`${n.id}:${p}`]) ? ' live' : ''}`}
                            onPointerDown={(e) => startLink(e, n.id, p, true)}
                            onPointerUp={(e) => { e.stopPropagation(); finishLink(n.id, p, true) }} />
                          <span>{p}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {isTerminal && (
                  <div style={{ padding: '0 6px 4px', display: 'flex', justifyContent: n.kind === 'VAR_OUT' ? 'flex-start' : 'flex-end' }}>
                    <span className={`pin-dot${live ? ' live' : ''}`}
                      onPointerDown={(e) => startLink(e, n.id, n.kind === 'VAR_OUT' ? 'IN' : 'OUT', n.kind !== 'VAR_OUT')}
                      onPointerUp={(e) => { e.stopPropagation(); finishLink(n.id, n.kind === 'VAR_OUT' ? 'IN' : 'OUT', n.kind !== 'VAR_OUT') }} />
                  </div>
                )}
              </div>
            )
          })}

          {net.nodes.length === 0 && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
              <div className="hint" style={{ textAlign: 'center', maxWidth: 320 }}>
                Wybierz blok z listy po lewej, aby rozpocząć budowanie schematu blokowego.
              </div>
            </div>
          )}
        </div>
      </div>

      {selNode && (
        <div className="inspector" style={{ width: 250 }}>
          <div className="panel-head">{selNode.kind}</div>
          <div className="panel-scroll">
            {['VAR_IN', 'VAR_OUT', 'CONST'].includes(selNode.kind) ? (
              <Field label={selNode.kind === 'CONST' ? 'Wartość' : 'Zmienna'}>
                <input className="mono" value={selNode.operand ?? ''}
                  onChange={(e) => update((p) => {
                    const n = p.fbd.nodes.find((x) => x.id === selNode.id)
                    if (n) n.operand = e.target.value
                  })} />
              </Field>
            ) : (
              <>
                {getBlockDef(selNode.kind)?.stateful && (
                  <Field label="Nazwa instancji">
                    <input className="mono" value={selNode.instance ?? ''}
                      onChange={(e) => update((p) => {
                        const n = p.fbd.nodes.find((x) => x.id === selNode.id)
                        if (n) n.instance = e.target.value
                      })} />
                  </Field>
                )}
                <div className="section-title">Stałe na niepodłączonych wejściach</div>
                {(getBlockDef(selNode.kind)?.inputs ?? []).map((pin) => (
                  <Field key={pin.name} label={pin.name}>
                    <input className="mono" placeholder={pin.default ?? ''}
                      value={selNode.literals?.[pin.name] ?? ''}
                      onChange={(e) => update((p) => {
                        const n = p.fbd.nodes.find((x) => x.id === selNode.id)
                        if (n) n.literals = { ...n.literals, [pin.name]: e.target.value }
                      })} />
                  </Field>
                ))}
                <div className="section-title">Negacja wejść</div>
                {(getBlockDef(selNode.kind)?.inputs ?? []).filter((pin) => pin.type === 'BOOL').map((pin) => (
                  <label key={pin.name} className="row" style={{ marginBottom: 4 }}>
                    <input type="checkbox" checked={Boolean(selNode.negIn?.[pin.name])}
                      onChange={(e) => update((p) => {
                        const n = p.fbd.nodes.find((x) => x.id === selNode.id)
                        if (n) n.negIn = { ...n.negIn, [pin.name]: e.target.checked }
                      })} />
                    <span>{pin.name}</span>
                  </label>
                ))}
              </>
            )}
            <div className="hint">{getBlockDef(selNode.kind)?.description}</div>
          </div>
        </div>
      )}
    </div>
  )
}
