import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TEMPLATES } from '../src/data/templates'
import { Simulator } from '../src/core/simulator'
import { exportPlcOpenXml, exportSt, exportIl } from '../src/core/exporters'
import { importPlcOpenXml } from '../src/core/importers'
import { WIDGET_MAP } from '../src/hmi/widgets'

test('każdy szablon buduje poprawny projekt', () => {
  for (const t of TEMPLATES) {
    const p = t.build()
    assert.ok(p.pous.length > 0, `${t.name}: brak POU`)
    const main = p.pous.find((x) => x.kind === 'PROGRAM')
    assert.ok(main, `${t.name}: brak programu`)
    if (t.id !== 'blank') {
      assert.ok(main!.rungs.length > 0, `${t.name}: kod nie zamienił się na szczeble`)
      assert.ok(p.globals.length > 0, `${t.name}: brak zmiennych`)
      assert.ok(p.hmi[0].widgets.length > 0, `${t.name}: pusty ekran HMI`)
    }
  }
})

test('szablony wykonują się w symulatorze bez błędów', () => {
  for (const t of TEMPLATES) {
    const sim = new Simulator(t.build())
    for (let i = 0; i < 200; i++) sim.scan()
    assert.deepEqual(sim.errors, [], `${t.name}: błędy wykonania`)
    assert.equal(sim.stats.scanCount, 200)
  }
})

test('wszystkie komponenty HMI w szablonach mają definicje i poprawne role', () => {
  for (const t of TEMPLATES) {
    const p = t.build()
    for (const screen of p.hmi) {
      for (const w of screen.widgets) {
        const d = WIDGET_MAP[w.kind]
        assert.ok(d, `${t.name}: nieznany komponent ${w.kind}`)
        for (const role of Object.keys(w.bind)) {
          assert.ok(d.bindings.some((b) => b.key === role),
            `${t.name}/${w.kind}: nieznana rola podpięcia "${role}"`)
        }
      }
    }
  }
})

test('zmienne podpięte w HMI istnieją w projekcie', () => {
  for (const t of TEMPLATES) {
    const p = t.build()
    const names = new Set([
      ...p.globals.map((v) => v.name),
      ...p.pous.flatMap((pou) => pou.vars.map((v) => `${pou.name}::${v.name}`)),
    ])
    for (const screen of p.hmi) {
      for (const w of screen.widgets) {
        for (const [role, key] of Object.entries(w.bind)) {
          if (!key) continue
          assert.ok(names.has(key), `${t.name}/${w.kind}.${role}: brak zmiennej "${key}"`)
        }
      }
    }
  }
})

test('alarmy w szablonach wskazują istniejące zmienne', () => {
  for (const t of TEMPLATES) {
    const p = t.build()
    const names = new Set(p.globals.map((v) => v.name))
    for (const a of p.alarms) assert.ok(names.has(a.variable), `${t.name}: alarm na nieznanej zmiennej ${a.variable}`)
  }
})

test('szablon rozruchu silnika działa zgodnie z założeniem', () => {
  const t = TEMPLATES.find((x) => x.id === 'motor-start-stop')!
  const sim = new Simulator(t.build())
  sim.scan()
  assert.equal(sim.readVar('Stycznik'), false)
  sim.poke('Start', true); sim.scan()
  assert.equal(sim.readVar('Stycznik'), true, 'START załącza stycznik')
  sim.poke('Start', false); sim.scan()
  assert.equal(sim.readVar('Stycznik'), true, 'podtrzymanie działa')
  assert.equal(sim.readVar('LampkaPraca'), true)
  sim.poke('Termik', false); sim.scan()
  assert.equal(sim.readVar('Stycznik'), false, 'termik wyłącza napęd')
  assert.equal(sim.readVar('LampkaAwaria'), true)
})

test('sekwencja świateł przechodzi przez wszystkie fazy', () => {
  const t = TEMPLATES.find((x) => x.id === 'traffic-light')!
  const sim = new Simulator(t.build())
  const seen = new Set<number>()
  for (let i = 0; i < 2000; i++) {
    sim.scan()
    seen.add(Number(sim.readVar('Krok')))
  }
  assert.deepEqual([...seen].sort(), [0, 1, 2, 3], 'automat przechodzi przez 4 fazy')
})

test('regulacja PID doprowadza temperaturę do wartości zadanej', () => {
  const t = TEMPLATES.find((x) => x.id === 'pid-temp')!
  const sim = new Simulator(t.build())
  for (let i = 0; i < 6000; i++) sim.scan()
  const temp = Number(sim.readVar('Temperatura'))
  const sp = Number(sim.readVar('Zadana'))
  assert.ok(Math.abs(temp - sp) < 3, `temperatura ${temp.toFixed(1)}°C zbliżyła się do zadanej ${sp}°C`)
})

test('regulacja poziomu utrzymuje się w zadanym paśmie', () => {
  const t = TEMPLATES.find((x) => x.id === 'tank-level')!
  const sim = new Simulator(t.build())
  for (let i = 0; i < 400; i++) sim.scan()   // faza napełniania
  let min = 100, max = 0
  for (let i = 0; i < 3000; i++) {
    sim.scan()
    const lvl = Number(sim.readVar('Poziom'))
    min = Math.min(min, lvl); max = Math.max(max, lvl)
  }
  assert.ok(min > 20, `poziom nie spadł poniżej progu (min ${min.toFixed(1)}%)`)
  assert.ok(max < 95, `poziom nie przekroczył progu alarmowego (max ${max.toFixed(1)}%)`)
})

test('każdy szablon eksportuje się do wszystkich formatów', () => {
  for (const t of TEMPLATES) {
    const p = t.build()
    const xml = exportPlcOpenXml(p)
    assert.match(xml, /<project xmlns=/, `${t.name}: XML`)
    assert.doesNotThrow(() => importPlcOpenXml(xml), `${t.name}: ponowny import XML`)
    assert.ok(exportSt(p).includes('PROGRAM Main'), `${t.name}: ST`)
    assert.ok(exportIl(p).length > 50, `${t.name}: IL`)
  }
})

test('komponenty HMI w szablonach nie zachodzą na siebie', () => {
  // rury i ramki grupujące mogą leżeć pod innymi elementami — reszta nie powinna się nakładać
  const DECOR = new Set(['pipe', 'panel', 'label'])
  for (const t of TEMPLATES) {
    const p = t.build()
    for (const screen of p.hmi) {
      const items = screen.widgets.filter((w) => !DECOR.has(w.kind))
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i], b = items[j]
          const overlap =
            a.x < b.x + b.w && b.x < a.x + a.w &&
            a.y < b.y + b.h && b.y < a.y + a.h
          assert.ok(!overlap,
            `${t.name}: ${a.kind} (${a.x},${a.y}) nachodzi na ${b.kind} (${b.x},${b.y})`)
        }
      }
      for (const w of screen.widgets) {
        assert.ok(w.x + w.w <= screen.width + 1 && w.y + w.h <= screen.height + 1,
          `${t.name}: ${w.kind} wychodzi poza ekran ${screen.width}×${screen.height}`)
      }
    }
  }
})
