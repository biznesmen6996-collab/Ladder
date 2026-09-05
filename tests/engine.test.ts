import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject, makePou, makeVariable } from '../src/core/factory'
import { makeRung } from '../src/core/grid'
import { Simulator } from '../src/core/simulator'
import { parseTimeLiteral, formatTime } from '../src/core/st/lexer'
import { parseSt } from '../src/core/st/parser'
import type { Project } from '../src/core/types'

function latchProject(): Project {
  const p = emptyProject('Test')
  p.globals = [
    makeVariable({ name: 'Start', type: 'BOOL', address: '%IX0.0' }),
    makeVariable({ name: 'Stop', type: 'BOOL', address: '%IX0.1', initial: 'TRUE' }),
    makeVariable({ name: 'Silnik', type: 'BOOL', address: '%QX0.0' }),
  ]
  const rung = makeRung(5, 2)
  // Start --+--[Stop]--( Silnik )
  //  Silnik-+
  rung.cells[0][0] = { type: 'contact', contactKind: 'NO', operand: 'Start', linkDown: true }
  rung.cells[1][0] = { type: 'contact', contactKind: 'NO', operand: 'Silnik' }
  rung.cells[0][1] = { type: 'contact', contactKind: 'NO', operand: 'Stop', linkDown: true }
  rung.cells[0][4] = { type: 'coil', coilKind: 'COIL', operand: 'Silnik' }
  p.pous[0].rungs = [rung]
  return p
}

test('podtrzymanie start/stop działa jak układ zatrzaskowy', () => {
  const sim = new Simulator(latchProject())
  sim.scan()
  assert.equal(sim.readVar('Silnik'), false, 'bez startu silnik stoi')

  sim.poke('Start', true)
  sim.scan()
  assert.equal(sim.readVar('Silnik'), true, 'start załącza silnik')

  sim.poke('Start', false)
  sim.scan()
  assert.equal(sim.readVar('Silnik'), true, 'podtrzymanie utrzymuje silnik')

  sim.poke('Stop', false)   // przycisk STOP jest zestykiem NC
  sim.scan()
  assert.equal(sim.readVar('Silnik'), false, 'stop wyłącza silnik')
})

test('TON odlicza czas i załącza wyjście', () => {
  const p = latchProject()
  p.config.scanTime = 100
  p.globals.push(makeVariable({ name: 'Wejscie', type: 'BOOL' }))
  p.globals.push(makeVariable({ name: 'Lampa', type: 'BOOL' }))
  p.globals.push(makeVariable({ name: 'Czas', type: 'TIME' }))
  p.globals.push(makeVariable({ name: 'T1', type: 'BOOL', fbType: 'TON' }))
  const rung = makeRung(5, 1)
  rung.cells[0][0] = { type: 'contact', contactKind: 'NO', operand: 'Wejscie' }
  rung.cells[0][1] = {
    type: 'block', blockType: 'TON', instance: 'T1',
    pins: [{ name: 'IN', expr: '' }, { name: 'PT', expr: 'T#1s' }, { name: 'Q', expr: '' }, { name: 'ET', expr: 'Czas' }],
  }
  rung.cells[0][4] = { type: 'coil', coilKind: 'COIL', operand: 'Lampa' }
  p.pous[0].rungs = [rung]

  const sim = new Simulator(p)
  sim.poke('Wejscie', true)
  for (let i = 0; i < 9; i++) sim.scan()
  assert.equal(sim.readVar('Lampa'), false, 'przed upływem 1 s lampa nie świeci')
  sim.scan(); sim.scan()
  assert.equal(sim.readVar('Lampa'), true, 'po 1 s lampa świeci')
  assert.equal(sim.readVar('Czas'), 1000, 'ET zapisany do zmiennej')
  sim.poke('Wejscie', false)
  sim.scan()
  assert.equal(sim.readVar('Lampa'), false, 'opadające IN kasuje timer')
})

test('interpreter ST wykonuje IF/CASE/FOR i wywołania bloków', () => {
  const p = emptyProject('ST')
  p.globals = [
    makeVariable({ name: 'A', type: 'INT', initial: '0' }),
    makeVariable({ name: 'B', type: 'INT', initial: '0' }),
    makeVariable({ name: 'Suma', type: 'INT', initial: '0' }),
    makeVariable({ name: 'Flaga', type: 'BOOL' }),
  ]
  p.pous[0] = makePou({
    name: 'Main', language: 'ST',
    st: `
      Suma := 0;
      FOR i := 1 TO 5 DO
        Suma := Suma + i;
      END_FOR;
      IF Suma > 10 THEN
        Flaga := TRUE;
      ELSE
        Flaga := FALSE;
      END_IF;
      A := LIMIT(0, 250, 100);
      CASE A OF
        100: B := 7;
        1..50: B := 1;
      ELSE
        B := 0;
      END_CASE;
    `,
  })
  p.tasks[0].programs = ['Main']
  const sim = new Simulator(p)
  sim.scan()
  assert.equal(sim.readVar('Suma'), 15)
  assert.equal(sim.readVar('Flaga'), true)
  assert.equal(sim.readVar('A'), 100)
  assert.equal(sim.readVar('B'), 7)
})

test('literały czasu są parsowane i formatowane', () => {
  assert.equal(parseTimeLiteral('T#1s'), 1000)
  assert.equal(parseTimeLiteral('T#1m30s'), 90000)
  assert.equal(parseTimeLiteral('TIME#250ms'), 250)
  assert.equal(formatTime(90000), 'T#1m30s')
  assert.equal(formatTime(250), 'T#250ms')
})

test('parser ST odrzuca niepoprawną składnię z numerem linii', () => {
  assert.throws(() => parseSt('IF A THEN\n  B := ;\nEND_IF;'), /linia 2/)
})

test('krokowanie po szczeblach zamyka cykl', () => {
  const sim = new Simulator(latchProject())
  const steps = sim.getSteps()
  assert.equal(steps.length, 1)
  assert.equal(sim.stepOnce(), true, 'jeden szczebel = jeden pełny cykl')
  assert.equal(sim.stats.scanCount, 1)
})
