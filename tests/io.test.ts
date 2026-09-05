import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject, makeVariable } from '../src/core/factory'
import { makeRung } from '../src/core/grid'
import { Simulator } from '../src/core/simulator'
import { exportIl, exportJson, exportPlcOpenXml, exportTagsCsv, exportMarkdown } from '../src/core/exporters'
import { importJson, importPlcOpenXml, importStAsLadder, detectFormat } from '../src/core/importers'
import type { Project } from '../src/core/types'

function latchProject(): Project {
  const p = emptyProject('Zatrzask')
  p.globals = [
    makeVariable({ name: 'Start', type: 'BOOL', address: '%IX0.0', comment: 'Przycisk START' }),
    makeVariable({ name: 'Stop', type: 'BOOL', address: '%IX0.1', initial: 'TRUE' }),
    makeVariable({ name: 'Silnik', type: 'BOOL', address: '%QX0.0' }),
  ]
  const rung = makeRung(5, 2)
  rung.cells[0][0] = { type: 'contact', contactKind: 'NO', operand: 'Start', linkDown: true }
  rung.cells[1][0] = { type: 'contact', contactKind: 'NO', operand: 'Silnik' }
  rung.cells[0][1] = { type: 'contact', contactKind: 'NO', operand: 'Stop', linkDown: true }
  rung.cells[0][4] = { type: 'coil', coilKind: 'COIL', operand: 'Silnik' }
  p.pous[0].rungs = [rung]
  return p
}

/** Zwraca listę znaczników, które nie zostały poprawnie domknięte. */
function unbalancedTags(xml: string): string[] {
  const stack: string[] = []
  const problems: string[] = []
  const re = /<\/?([\w:]+)([^>]*?)(\/?)>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    if (m[0].startsWith('</')) {
      const open = stack.pop()
      if (open !== m[1]) problems.push(`</${m[1]}> zamiast </${open}>`)
    } else if (!m[3]) stack.push(m[1])
  }
  return [...problems, ...stack]
}

function runSequence(p: Project): boolean[] {
  const sim = new Simulator(p)
  const out: boolean[] = []
  const seq = [
    { Start: false, Stop: true }, { Start: true, Stop: true }, { Start: false, Stop: true },
    { Start: false, Stop: false }, { Start: false, Stop: true },
  ]
  for (const s of seq) {
    sim.poke('Start', s.Start); sim.poke('Stop', s.Stop)
    sim.scan()
    out.push(sim.readVar('Silnik') as boolean)
  }
  return out
}

test('PLCopen XML jest poprawnie zbudowany', () => {
  const xml = exportPlcOpenXml(latchProject())
  assert.match(xml, /<project xmlns="http:\/\/www\.plcopen\.org\/xml\/tc6_0201">/)
  assert.match(xml, /<pou name="Main" pouType="program">/)
  assert.match(xml, /<leftPowerRail/)
  assert.match(xml, /<contact localId="\d+"/)
  assert.match(xml, /<coil localId="\d+"/)
  assert.match(xml, /<variable>Silnik<\/variable>/)
  assert.deepEqual(unbalancedTags(xml), [], 'znaczniki są zbalansowane')
})

test('projekt przechodzi pełną pętlę eksport → import PLCopen i działa tak samo', () => {
  const original = latchProject()
  const xml = exportPlcOpenXml(original)
  const { project: reimported, warnings } = importPlcOpenXml(xml)
  assert.deepEqual(warnings, [])
  assert.equal(reimported.pous.length, 1)
  assert.equal(reimported.globals.length, 3)
  assert.equal(reimported.globals[0].address, '%IX0.0')
  assert.equal(reimported.globals[1].initial, 'TRUE')
  assert.deepEqual(runSequence(reimported), runSequence(original),
    'po imporcie układ zachowuje się identycznie')
})

test('import PLCopen odtwarza gałąź równoległą podtrzymania', () => {
  const xml = exportPlcOpenXml(latchProject())
  const { project } = importPlcOpenXml(xml)
  const rung = project.pous[0].rungs[0]
  assert.ok(rung.cells.length >= 2, 'szczebel ma gałąź równoległą')
  const operands = rung.cells.flat().filter((c) => c.type === 'contact').map((c) => c.operand).sort()
  assert.deepEqual(operands, ['Silnik', 'Start', 'Stop'])
  assert.ok(rung.cells.flat().some((c) => c.linkDown), 'zachowano połączenia pionowe')
})

test('eksport i import JSON zachowuje projekt', () => {
  const p = latchProject()
  const { project } = importJson(exportJson(p))
  assert.equal(project.name, 'Zatrzask')
  assert.deepEqual(runSequence(project), runSequence(p))
})

test('eksport do listy instrukcji IL', () => {
  const il = exportIl(latchProject())
  assert.match(il, /LD {3}Start/)
  assert.match(il, /OR {3}Silnik/)
  assert.match(il, /AND {2}Stop/)
  assert.match(il, /ST {3}Silnik/)
})

test('eksport tagów do CSV i dokumentacji Markdown', () => {
  const csv = exportTagsCsv(latchProject())
  assert.match(csv, /Nazwa;Typ;Adres/)
  assert.match(csv, /Start;BOOL;%IX0\.0;GLOBAL;;NIE;;Przycisk START/)
  const md = exportMarkdown(latchProject())
  assert.match(md, /# Zatrzask/)
  assert.match(md, /\| Start \| BOOL \| %IX0\.0 \| Przycisk START \|/)
})

test('import kodu ST tworzy drabinkę wraz z deklaracjami zmiennych', () => {
  const src = `
VAR_GLOBAL
  Start AT %IX0.0 : BOOL;
  Stop AT %IX0.1 : BOOL := TRUE;
  Silnik AT %QX0.0 : BOOL; (* stycznik *)
END_VAR

PROGRAM Main
  Silnik := (Start OR Silnik) AND Stop;
END_PROGRAM
`
  const { project } = importStAsLadder(src)
  assert.equal(project.globals.length, 3)
  assert.equal(project.globals[2].comment, 'stycznik')
  assert.equal(project.globals[1].initial, 'TRUE')
  assert.equal(project.pous[0].language, 'LD')
  assert.deepEqual(runSequence(project), [false, true, true, false, false])
})

test('rozpoznawanie formatu pliku', () => {
  assert.equal(detectFormat('{"project":{}}', 'a.json'), 'json')
  assert.equal(detectFormat('<project/>', 'a.xml'), 'plcopen')
  assert.equal(detectFormat('PROGRAM Main\nEND_PROGRAM', 'a.st'), 'st')
  assert.equal(detectFormat('  <?xml version="1.0"?><project/>'), 'plcopen')
})
