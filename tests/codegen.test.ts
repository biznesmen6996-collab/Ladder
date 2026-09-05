import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject, makePou, makeVariable } from '../src/core/factory'
import { makeRung } from '../src/core/grid'
import { Simulator } from '../src/core/simulator'
import { pouToSt, projectToSt } from '../src/core/st/codegen'
import { stToLadder } from '../src/core/st/toladder'
import type { Project, Rung } from '../src/core/types'

function latchRung(): Rung {
  const rung = makeRung(5, 2)
  rung.cells[0][0] = { type: 'contact', contactKind: 'NO', operand: 'Start', linkDown: true }
  rung.cells[1][0] = { type: 'contact', contactKind: 'NO', operand: 'Silnik' }
  rung.cells[0][1] = { type: 'contact', contactKind: 'NO', operand: 'Stop', linkDown: true }
  rung.cells[0][4] = { type: 'coil', coilKind: 'COIL', operand: 'Silnik' }
  return rung
}

function latchProject(): Project {
  const p = emptyProject('Test')
  p.globals = [
    makeVariable({ name: 'Start', type: 'BOOL' }),
    makeVariable({ name: 'Stop', type: 'BOOL', initial: 'TRUE' }),
    makeVariable({ name: 'Silnik', type: 'BOOL' }),
  ]
  p.pous[0].rungs = [latchRung()]
  return p
}

test('drabinka generuje poprawny kod ST', () => {
  const { code } = pouToSt(latchProject().pous[0])
  assert.match(code, /Silnik := \(Start OR Silnik\) AND Stop;/)
  assert.match(code, /^PROGRAM Main$/m)
  assert.match(code, /END_PROGRAM/)
})

test('kod ST wraca do drabinki i zachowuje działanie układu', () => {
  const st = 'Silnik := (Start OR Silnik) AND Stop;'
  const { rungs, warnings } = stToLadder(st)
  assert.equal(warnings.length, 0)
  assert.equal(rungs.length, 1)

  const p = latchProject()
  p.pous[0].rungs = rungs
  const sim = new Simulator(p)
  sim.scan()
  assert.equal(sim.readVar('Silnik'), false)
  sim.poke('Start', true); sim.scan()
  assert.equal(sim.readVar('Silnik'), true, 'start załącza')
  sim.poke('Start', false); sim.scan()
  assert.equal(sim.readVar('Silnik'), true, 'podtrzymanie działa po konwersji z kodu')
  sim.poke('Stop', false); sim.scan()
  assert.equal(sim.readVar('Silnik'), false, 'stop wyłącza')
})

test('pełna pętla drabinka → ST → drabinka daje ten sam wynik', () => {
  const original = latchProject()
  const st = pouToSt(original.pous[0]).code
  const body = st.split('\n').filter((l) => l.includes(':=')).join('\n')
  const back = stToLadder(body)
  assert.ok(back.rungs.length >= 1)

  const roundTrip = latchProject()
  roundTrip.pous[0].rungs = back.rungs

  const a = new Simulator(original)
  const b = new Simulator(roundTrip)
  const sequence = [
    { Start: false, Stop: true }, { Start: true, Stop: true }, { Start: false, Stop: true },
    { Start: false, Stop: false }, { Start: false, Stop: true }, { Start: true, Stop: true },
  ]
  for (const step of sequence) {
    for (const sim of [a, b]) {
      sim.poke('Start', step.Start)
      sim.poke('Stop', step.Stop)
      sim.scan()
    }
    assert.equal(a.readVar('Silnik'), b.readVar('Silnik'), `rozbieżność przy ${JSON.stringify(step)}`)
  }
})

test('IF/THEN konwertuje się na cewki SET i RESET', () => {
  const { rungs } = stToLadder('IF Start AND NOT Awaria THEN Praca := TRUE; END_IF;\nIF Stop THEN Praca := FALSE; END_IF;')
  assert.equal(rungs.length, 2)
  const kinds = rungs.map((r) => r.cells[0].find((c) => c.type === 'coil')?.coilKind)
  assert.deepEqual(kinds, ['SET', 'RESET'])
})

test('wywołanie timera w ST staje się blokiem w drabince', () => {
  const { rungs } = stToLadder('T1(IN := Czujnik, PT := T#3s);')
  assert.equal(rungs.length, 1)
  const block = rungs[0].cells[0].find((c) => c.type === 'block')
  assert.ok(block, 'powstał blok')
  assert.equal(block?.blockType, 'T1')
  const contact = rungs[0].cells[0].find((c) => c.type === 'contact')
  assert.equal(contact?.operand, 'Czujnik', 'warunek trafił na szynę')
})

test('eksport całego projektu zawiera zmienne globalne i konfigurację', () => {
  const p = latchProject()
  const { code } = projectToSt(p)
  assert.match(code, /VAR_GLOBAL/)
  assert.match(code, /Stop : BOOL := TRUE;/)
  assert.match(code, /CONFIGURATION Config/)
  assert.match(code, /TASK MainTask\(INTERVAL := T#10ms, PRIORITY := 1\);/)
})

test('program w ST z blokiem funkcyjnym użytkownika wykonuje się w symulatorze', () => {
  const p = emptyProject('FB')
  const fb = makePou({
    name: 'Zatrzask', kind: 'FUNCTION_BLOCK', language: 'ST',
    vars: [
      makeVariable({ name: 'S', type: 'BOOL', varClass: 'VAR_INPUT' }),
      makeVariable({ name: 'R', type: 'BOOL', varClass: 'VAR_INPUT' }),
      makeVariable({ name: 'Q', type: 'BOOL', varClass: 'VAR_OUTPUT' }),
    ],
    st: 'IF S THEN Q := TRUE; END_IF;\nIF R THEN Q := FALSE; END_IF;',
  })
  p.pous.push(fb)
  p.globals = [
    makeVariable({ name: 'We1', type: 'BOOL' }),
    makeVariable({ name: 'We2', type: 'BOOL' }),
    makeVariable({ name: 'Wy', type: 'BOOL' }),
    makeVariable({ name: 'Z1', type: 'BOOL', fbType: 'Zatrzask' }),
  ]
  p.pous[0] = makePou({ name: 'Main', language: 'ST', st: 'Z1(S := We1, R := We2);\nWy := Z1.Q;' })
  p.tasks[0].programs = ['Main']

  const sim = new Simulator(p)
  sim.scan()
  assert.equal(sim.readVar('Wy'), false)
  sim.poke('We1', true); sim.scan()
  assert.equal(sim.readVar('Wy'), true, 'własny blok funkcyjny ustawia wyjście')
  sim.poke('We1', false); sim.scan()
  assert.equal(sim.readVar('Wy'), true, 'blok pamięta stan między cyklami')
  sim.poke('We2', true); sim.scan()
  assert.equal(sim.readVar('Wy'), false, 'reset kasuje zatrzask')
})
