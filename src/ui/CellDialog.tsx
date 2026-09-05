import { useMemo, useState } from 'react'
import type { Cell, CoilKind, CompareOp, ContactKind, Variable } from '../core/types'
import { BLOCK_CATEGORIES, BLOCK_DEFS, getBlockDef } from '../core/blocks'
import { defaultEnoPin, defaultPins } from '../core/grid'
import { exprError } from '../core/expr'
import { Field, Modal, Segmented } from './common'

interface Props {
  cell: Cell
  variables: Variable[]
  /** typy bloków zdefiniowanych przez użytkownika */
  userBlocks: { name: string; inputs: string[]; outputs: string[]; description: string }[]
  onSave: (cell: Cell) => void
  onClose: () => void
  onDelete: () => void
}

const CONTACTS: { v: ContactKind; label: string; hint: string }[] = [
  { v: 'NO', label: '─┤ ├─', hint: 'zestyk zwierny (NO)' },
  { v: 'NC', label: '─┤/├─', hint: 'zestyk rozwierny (NC)' },
  { v: 'P', label: '─┤P├─', hint: 'zbocze narastające' },
  { v: 'N', label: '─┤N├─', hint: 'zbocze opadające' },
]

const COILS: { v: CoilKind; label: string; hint: string }[] = [
  { v: 'COIL', label: '─( )─', hint: 'cewka zwykła' },
  { v: 'COIL_NEG', label: '─(/)─', hint: 'cewka zanegowana' },
  { v: 'SET', label: '─(S)─', hint: 'ustaw (zapamiętaj)' },
  { v: 'RESET', label: '─(R)─', hint: 'zeruj' },
  { v: 'PULSE_P', label: '─(P)─', hint: 'impuls na zboczu ↑' },
  { v: 'PULSE_N', label: '─(N)─', hint: 'impuls na zboczu ↓' },
]

const CMP_OPS: CompareOp[] = ['>', '>=', '<', '<=', '=', '<>']

export function CellDialog({ cell, variables, userBlocks, onSave, onClose, onDelete }: Props) {
  const [draft, setDraft] = useState<Cell>(() => structuredClone(cell))
  const [blockFilter, setBlockFilter] = useState('')
  const patch = (p: Partial<Cell>) => setDraft((d) => ({ ...d, ...p }))

  const def = getBlockDef(draft.blockType ?? '')
  const userDef = userBlocks.find((b) => b.name === draft.blockType)

  const blocksByCategory = useMemo(() => {
    const q = blockFilter.trim().toLowerCase()
    const match = (t: string, d: string) => !q || t.toLowerCase().includes(q) || d.toLowerCase().includes(q)
    const groups: [string, { type: string; description: string }[]][] = []
    if (userBlocks.length) {
      const own = userBlocks.filter((b) => match(b.name, b.description))
        .map((b) => ({ type: b.name, description: b.description }))
      if (own.length) groups.push(['Bloki własne', own])
    }
    for (const cat of BLOCK_CATEGORIES) {
      const items = BLOCK_DEFS.filter((d) => d.category === cat && match(d.type, d.description))
        .map((d) => ({ type: d.type, description: d.description }))
      if (items.length) groups.push([cat, items])
    }
    return groups
  }, [blockFilter, userBlocks])

  const setType = (type: Cell['type']) => {
    if (type === 'contact') patch({ type, contactKind: draft.contactKind ?? 'NO' })
    else if (type === 'coil') patch({ type, coilKind: draft.coilKind ?? 'COIL' })
    else if (type === 'compare') patch({ type, cmpOp: draft.cmpOp ?? '>', cmpA: draft.cmpA ?? '', cmpB: draft.cmpB ?? '0' })
    else if (type === 'block') patch({ type, blockType: draft.blockType ?? 'TON' })
    else patch({ type })
  }

  const chooseBlock = (type: string) => {
    const isUser = userBlocks.some((b) => b.name === type)
    const pins = isUser
      ? [...(userBlocks.find((b) => b.name === type)?.inputs ?? []).map((n) => ({ name: n, expr: '' })),
         ...(userBlocks.find((b) => b.name === type)?.outputs ?? []).map((n) => ({ name: n, expr: '' }))]
      : defaultPins(type)
    const stateful = isUser || getBlockDef(type)?.stateful
    patch({
      blockType: type,
      pins,
      enoPin: isUser ? undefined : defaultEnoPin(type),
      instance: stateful ? (draft.instance || suggestInstance(type, variables)) : undefined,
    })
  }

  const setPin = (name: string, expr: string) => {
    const pins = [...(draft.pins ?? [])]
    const i = pins.findIndex((p) => p.name === name)
    if (i >= 0) pins[i] = { name, expr }
    else pins.push({ name, expr })
    patch({ pins })
  }

  const pinValue = (name: string) => draft.pins?.find((p) => p.name === name)?.expr ?? ''
  const operandError = draft.type === 'contact' ? exprError(draft.operand ?? '') : null

  const inputs = def?.inputs.map((p) => p.name) ?? userDef?.inputs ?? []
  const outputs = def?.outputs.map((p) => p.name) ?? userDef?.outputs ?? []

  return (
    <Modal
      title="Element drabinki"
      onClose={onClose}
      wide={draft.type === 'block'}
      footer={
        <>
          <button className="danger" onClick={onDelete}>Usuń element</button>
          <div className="spacer" />
          <button onClick={onClose}>Anuluj</button>
          <button className="primary" onClick={() => onSave(draft)}>Zapisz</button>
        </>
      }
    >
      <Field label="Rodzaj elementu">
        <Segmented
          value={draft.type}
          onChange={setType}
          options={[
            { value: 'wire', label: 'Przewód' },
            { value: 'contact', label: 'Styk' },
            { value: 'coil', label: 'Cewka' },
            { value: 'compare', label: 'Porównanie' },
            { value: 'block', label: 'Blok' },
            { value: 'empty', label: 'Puste' },
          ]}
        />
      </Field>

      {draft.type === 'contact' && (
        <>
          <Field label="Typ styku">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {CONTACTS.map((c) => (
                <button key={c.v} className={draft.contactKind === c.v ? 'active' : ''}
                  onClick={() => patch({ contactKind: c.v })} title={c.hint}>
                  <span className="mono">{c.label}</span>
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {CONTACTS.find((c) => c.v === draft.contactKind)?.hint}
            </div>
          </Field>
          <Field label="Zmienna lub wyrażenie" hint={operandError ?? 'Można wpisać zmienną (Start), adres (%IX0.0) albo wyrażenie (Timer1.Q)'}>
            <VarInput value={draft.operand ?? ''} onChange={(v) => patch({ operand: v })} variables={variables} filter="BOOL" />
          </Field>
        </>
      )}

      {draft.type === 'coil' && (
        <>
          <Field label="Typ cewki">
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {COILS.map((c) => (
                <button key={c.v} className={draft.coilKind === c.v ? 'active' : ''}
                  onClick={() => patch({ coilKind: c.v })} title={c.hint}>
                  <span className="mono">{c.label}</span>
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 4 }}>
              {COILS.find((c) => c.v === draft.coilKind)?.hint}
            </div>
          </Field>
          <Field label="Zmienna wyjściowa">
            <VarInput value={draft.operand ?? ''} onChange={(v) => patch({ operand: v })} variables={variables} filter="BOOL" />
          </Field>
        </>
      )}

      {draft.type === 'compare' && (
        <div className="grid3">
          <Field label="Lewa strona">
            <VarInput value={draft.cmpA ?? ''} onChange={(v) => patch({ cmpA: v })} variables={variables} />
          </Field>
          <Field label="Operator">
            <select value={draft.cmpOp ?? '>'} onChange={(e) => patch({ cmpOp: e.target.value as CompareOp })}>
              {CMP_OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>
          <Field label="Prawa strona">
            <VarInput value={draft.cmpB ?? ''} onChange={(v) => patch({ cmpB: v })} variables={variables} />
          </Field>
        </div>
      )}

      {draft.type === 'block' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 260px) 1fr', gap: 14 }}>
          <div>
            <Field label="Szukaj bloku">
              <input value={blockFilter} onChange={(e) => setBlockFilter(e.target.value)} placeholder="np. timer, PID, licznik" />
            </Field>
            <div style={{ maxHeight: 340, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
              {blocksByCategory.map(([cat, items]) => (
                <div key={cat}>
                  <div className="section-title" style={{ padding: '6px 8px', margin: 0, background: 'var(--bg-panel)', position: 'sticky', top: 0 }}>
                    {cat}
                  </div>
                  {items.map((b) => (
                    <div key={b.type} className={`tree-item${draft.blockType === b.type ? ' sel' : ''}`}
                      onClick={() => chooseBlock(b.type)} title={b.description}>
                      <span className="mono">{b.type}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="hint" style={{ marginBottom: 10 }}>
              {def?.description ?? userDef?.description ?? 'Wybierz blok z listy po lewej.'}
            </div>
            {(def?.stateful || userDef) && (
              <Field label="Nazwa instancji" hint="Instancja przechowuje stan bloku między cyklami — każdy timer potrzebuje własnej.">
                <input value={draft.instance ?? ''} onChange={(e) => patch({ instance: e.target.value })} className="mono" />
              </Field>
            )}
            {inputs.length > 0 && (
              <>
                <div className="section-title">Wejścia</div>
                {inputs.map((name, i) => (
                  <Field key={name} label={`${name}${i === 0 && def?.inputs[0]?.type === 'BOOL' ? '  (domyślnie sterowane szyną)' : ''}`}>
                    <VarInput value={pinValue(name)} onChange={(v) => setPin(name, v)} variables={variables}
                      placeholder={i === 0 && def?.inputs[0]?.type === 'BOOL' ? 'puste = warunek ze szczebla' : def?.inputs[i]?.default ?? ''} />
                  </Field>
                ))}
              </>
            )}
            {outputs.length > 0 && (
              <>
                <div className="section-title">Wyjścia — zmienne docelowe</div>
                {outputs.map((name) => (
                  <Field key={name} label={name}>
                    <VarInput value={pinValue(name)} onChange={(v) => setPin(name, v)} variables={variables} placeholder="(opcjonalnie)" />
                  </Field>
                ))}
                <Field label="Wyjście podające napięcie dalej (ENO)">
                  <select value={draft.enoPin ?? ''} onChange={(e) => patch({ enoPin: e.target.value || undefined })}>
                    <option value="">— przelot warunku szczebla —</option>
                    {outputs.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </Field>
              </>
            )}
          </div>
        </div>
      )}

      <Field label="Komentarz elementu">
        <input value={draft.comment ?? ''} onChange={(e) => patch({ comment: e.target.value })} placeholder="opcjonalny opis" />
      </Field>
    </Modal>
  )
}

function suggestInstance(type: string, variables: Variable[]): string {
  let n = 1
  const taken = new Set(variables.map((v) => v.name))
  while (taken.has(`${type}_${n}`)) n++
  return `${type}_${n}`
}

export function VarInput({ value, onChange, variables, filter, placeholder }: {
  value: string
  onChange: (v: string) => void
  variables: Variable[]
  filter?: string
  placeholder?: string
}) {
  const listId = `vars-${filter ?? 'all'}`
  const options = filter ? variables.filter((v) => v.type === filter || v.fbType) : variables
  return (
    <>
      <input className="mono" value={value} placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)} list={listId} autoComplete="off" spellCheck={false} />
      <datalist id={listId}>
        {options.map((v) => (
          <option key={v.id} value={v.name}>{v.fbType ?? v.type}{v.comment ? ` — ${v.comment}` : ''}</option>
        ))}
      </datalist>
    </>
  )
}
