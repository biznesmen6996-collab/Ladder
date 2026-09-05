import type { BlockDef, PlcValue } from './types'

/* Konwersje pomocnicze ------------------------------------------------ */
export const toBool = (v: PlcValue | undefined): boolean =>
  typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : !!v && v !== 'FALSE' && v !== '0'
export const toNum = (v: PlcValue | undefined): number =>
  typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number(v ?? 0) || 0

export interface BlockCtx {
  /** czas od poprzedniego cyklu w ms */
  dt: number
  /** czas symulacji w ms */
  now: number
}

export type BlockImpl = (
  inp: Record<string, PlcValue>,
  st: Record<string, PlcValue>,
  ctx: BlockCtx,
) => Record<string, PlcValue>

interface BlockSpec {
  def: BlockDef
  run: BlockImpl
}

const B: BlockSpec[] = []

function reg(
  type: string,
  category: string,
  description: string,
  inputs: BlockDef['inputs'],
  outputs: BlockDef['outputs'],
  stateful: boolean,
  run: BlockImpl,
  en = false,
) {
  B.push({ def: { type, category, description, inputs, outputs, stateful, en }, run })
}

const p = (name: string, type: BlockDef['inputs'][number]['type'], def?: string, comment?: string) =>
  ({ name, type, default: def, comment })

/* ---------------------------------------------------------------- */
/* Timery                                                            */
/* ---------------------------------------------------------------- */

reg('TON', 'Timery', 'Opóźnienie załączenia — Q po czasie PT od narastającego IN',
  [p('IN', 'BOOL'), p('PT', 'TIME', 'T#1s', 'czas nastawy')],
  [p('Q', 'BOOL'), p('ET', 'TIME', undefined, 'czas bieżący')], true,
  (i, s, c) => {
    const IN = toBool(i.IN), PT = toNum(i.PT)
    let et = toNum(s.et)
    if (!IN) { et = 0 } else if (et < PT) { et = Math.min(PT, et + c.dt) }
    s.et = et
    return { Q: IN && et >= PT, ET: et }
  })

reg('TOF', 'Timery', 'Opóźnienie wyłączenia — Q gaśnie po czasie PT od opadającego IN',
  [p('IN', 'BOOL'), p('PT', 'TIME', 'T#1s')],
  [p('Q', 'BOOL'), p('ET', 'TIME')], true,
  (i, s, c) => {
    const IN = toBool(i.IN), PT = toNum(i.PT)
    let et = toNum(s.et)
    if (IN) { et = 0 } else if (et < PT) { et = Math.min(PT, et + c.dt) }
    s.et = et
    return { Q: IN || et < PT, ET: et }
  })

reg('TP', 'Timery', 'Generator impulsu o długości PT',
  [p('IN', 'BOOL'), p('PT', 'TIME', 'T#1s')],
  [p('Q', 'BOOL'), p('ET', 'TIME')], true,
  (i, s, c) => {
    const IN = toBool(i.IN), PT = toNum(i.PT)
    let et = toNum(s.et); let run = toBool(s.run); const prev = toBool(s.prev)
    if (!prev && IN && !run) { run = true; et = 0 }
    if (run) { et = Math.min(PT, et + c.dt); if (et >= PT) run = false }
    if (!run && !IN) et = PT
    s.et = et; s.run = run; s.prev = IN
    return { Q: run, ET: et }
  })

reg('TONR', 'Timery', 'Timer akumulacyjny z resetem (retentive)',
  [p('IN', 'BOOL'), p('PT', 'TIME', 'T#10s'), p('RESET', 'BOOL')],
  [p('Q', 'BOOL'), p('ET', 'TIME')], true,
  (i, s, c) => {
    const PT = toNum(i.PT)
    let et = toNum(s.et)
    if (toBool(i.RESET)) et = 0
    else if (toBool(i.IN) && et < PT) et = Math.min(PT, et + c.dt)
    s.et = et
    return { Q: et >= PT, ET: et }
  })

reg('BLINK', 'Timery', 'Generator prostokąta — miganie z zadanymi czasami',
  [p('EN', 'BOOL'), p('T_ON', 'TIME', 'T#500ms'), p('T_OFF', 'TIME', 'T#500ms')],
  [p('Q', 'BOOL')], true,
  (i, s, c) => {
    if (!toBool(i.EN)) { s.t = 0; s.q = false; return { Q: false } }
    let t = toNum(s.t) + c.dt
    let q = toBool(s.q)
    const lim = q ? toNum(i.T_ON) : toNum(i.T_OFF)
    if (t >= lim) { t = 0; q = !q }
    s.t = t; s.q = q
    return { Q: q }
  })

/* ---------------------------------------------------------------- */
/* Liczniki                                                          */
/* ---------------------------------------------------------------- */

reg('CTU', 'Liczniki', 'Licznik w górę',
  [p('CU', 'BOOL'), p('RESET', 'BOOL'), p('PV', 'INT', '10')],
  [p('Q', 'BOOL'), p('CV', 'INT')], true,
  (i, s) => {
    let cv = toNum(s.cv); const cu = toBool(i.CU), prev = toBool(s.prev)
    if (toBool(i.RESET)) cv = 0
    else if (cu && !prev) cv++
    s.cv = cv; s.prev = cu
    return { Q: cv >= toNum(i.PV), CV: cv }
  })

reg('CTD', 'Liczniki', 'Licznik w dół',
  [p('CD', 'BOOL'), p('LOAD', 'BOOL'), p('PV', 'INT', '10')],
  [p('Q', 'BOOL'), p('CV', 'INT')], true,
  (i, s) => {
    let cv = toNum(s.cv); const cd = toBool(i.CD), prev = toBool(s.prev)
    if (toBool(i.LOAD)) cv = toNum(i.PV)
    else if (cd && !prev) cv--
    s.cv = cv; s.prev = cd
    return { Q: cv <= 0, CV: cv }
  })

reg('CTUD', 'Liczniki', 'Licznik góra/dół',
  [p('CU', 'BOOL'), p('CD', 'BOOL'), p('RESET', 'BOOL'), p('LOAD', 'BOOL'), p('PV', 'INT', '10')],
  [p('QU', 'BOOL'), p('QD', 'BOOL'), p('CV', 'INT')], true,
  (i, s) => {
    let cv = toNum(s.cv)
    const cu = toBool(i.CU), cd = toBool(i.CD)
    if (toBool(i.RESET)) cv = 0
    else if (toBool(i.LOAD)) cv = toNum(i.PV)
    else {
      if (cu && !toBool(s.pu)) cv++
      if (cd && !toBool(s.pd)) cv--
    }
    s.cv = cv; s.pu = cu; s.pd = cd
    return { QU: cv >= toNum(i.PV), QD: cv <= 0, CV: cv }
  })

reg('RUNTIME', 'Liczniki', 'Licznik czasu pracy (motogodziny)',
  [p('RUN', 'BOOL'), p('RESET', 'BOOL')],
  [p('HOURS', 'REAL'), p('MS', 'TIME')], true,
  (i, s, c) => {
    let ms = toNum(s.ms)
    if (toBool(i.RESET)) ms = 0
    else if (toBool(i.RUN)) ms += c.dt
    s.ms = ms
    return { HOURS: ms / 3600000, MS: ms }
  })

/* ---------------------------------------------------------------- */
/* Detekcja zboczy i przerzutniki                                    */
/* ---------------------------------------------------------------- */

reg('R_TRIG', 'Zbocza', 'Detekcja zbocza narastającego',
  [p('CLK', 'BOOL')], [p('Q', 'BOOL')], true,
  (i, s) => { const c = toBool(i.CLK); const q = c && !toBool(s.prev); s.prev = c; return { Q: q } })

reg('F_TRIG', 'Zbocza', 'Detekcja zbocza opadającego',
  [p('CLK', 'BOOL')], [p('Q', 'BOOL')], true,
  (i, s) => { const c = toBool(i.CLK); const q = !c && toBool(s.prev); s.prev = c; return { Q: q } })

reg('RS', 'Przerzutniki', 'Przerzutnik z dominacją resetu',
  [p('SET', 'BOOL'), p('RESET1', 'BOOL')], [p('Q1', 'BOOL')], true,
  (i, s) => {
    let q = toBool(s.q)
    if (toBool(i.SET)) q = true
    if (toBool(i.RESET1)) q = false
    s.q = q; return { Q1: q }
  })

reg('SR', 'Przerzutniki', 'Przerzutnik z dominacją ustawienia',
  [p('SET1', 'BOOL'), p('RESET', 'BOOL')], [p('Q1', 'BOOL')], true,
  (i, s) => {
    let q = toBool(s.q)
    if (toBool(i.RESET)) q = false
    if (toBool(i.SET1)) q = true
    s.q = q; return { Q1: q }
  })

reg('DEBOUNCE', 'Zbocza', 'Filtr drgań styków — sygnał musi być stabilny przez T',
  [p('IN', 'BOOL'), p('T', 'TIME', 'T#50ms')], [p('Q', 'BOOL')], true,
  (i, s, c) => {
    const IN = toBool(i.IN)
    let q = toBool(s.q); let t = toNum(s.t)
    if (IN === q) t = 0
    else { t += c.dt; if (t >= toNum(i.T)) { q = IN; t = 0 } }
    s.q = q; s.t = t
    return { Q: q }
  })

/* ---------------------------------------------------------------- */
/* Arytmetyka i logika (funkcje bezstanowe)                          */
/* ---------------------------------------------------------------- */

const arity2 = (t: string, cat: string, desc: string, f: (a: number, b: number) => number) =>
  reg(t, cat, desc, [p('IN1', 'ANY_NUM', '0'), p('IN2', 'ANY_NUM', '0')], [p('OUT', 'ANY_NUM')], false,
    (i) => ({ OUT: f(toNum(i.IN1), toNum(i.IN2)) }), true)

arity2('ADD', 'Matematyka', 'Suma IN1 + IN2', (a, b) => a + b)
arity2('SUB', 'Matematyka', 'Różnica IN1 - IN2', (a, b) => a - b)
arity2('MUL', 'Matematyka', 'Iloczyn IN1 * IN2', (a, b) => a * b)
arity2('DIV', 'Matematyka', 'Iloraz IN1 / IN2 (0 przy dzieleniu przez zero)', (a, b) => (b === 0 ? 0 : a / b))
arity2('MOD', 'Matematyka', 'Reszta z dzielenia', (a, b) => (b === 0 ? 0 : a % b))
arity2('EXPT', 'Matematyka', 'Potęgowanie IN1 ^ IN2', (a, b) => Math.pow(a, b))

const arity1 = (t: string, cat: string, desc: string, f: (a: number) => number) =>
  reg(t, cat, desc, [p('IN', 'ANY_NUM', '0')], [p('OUT', 'ANY_NUM')], false,
    (i) => ({ OUT: f(toNum(i.IN)) }), true)

arity1('ABS', 'Matematyka', 'Wartość bezwzględna', Math.abs)
arity1('SQRT', 'Matematyka', 'Pierwiastek kwadratowy', (a) => Math.sqrt(Math.max(0, a)))
arity1('LN', 'Matematyka', 'Logarytm naturalny', (a) => (a > 0 ? Math.log(a) : 0))
arity1('LOG', 'Matematyka', 'Logarytm dziesiętny', (a) => (a > 0 ? Math.log10(a) : 0))
arity1('EXP', 'Matematyka', 'Funkcja wykładnicza e^IN', Math.exp)
arity1('SIN', 'Matematyka', 'Sinus (radiany)', Math.sin)
arity1('COS', 'Matematyka', 'Cosinus (radiany)', Math.cos)
arity1('TAN', 'Matematyka', 'Tangens (radiany)', Math.tan)
arity1('NEG', 'Matematyka', 'Zmiana znaku', (a) => -a)
arity1('TRUNC', 'Konwersje', 'Obcięcie części ułamkowej', Math.trunc)
arity1('ROUND', 'Konwersje', 'Zaokrąglenie do najbliższej całkowitej', Math.round)

const cmp = (t: string, desc: string, f: (a: number, b: number) => boolean) =>
  reg(t, 'Porównania', desc, [p('IN1', 'ANY_NUM', '0'), p('IN2', 'ANY_NUM', '0')], [p('OUT', 'BOOL')], false,
    (i) => ({ OUT: f(toNum(i.IN1), toNum(i.IN2)) }), true)

cmp('GT', 'IN1 > IN2', (a, b) => a > b)
cmp('GE', 'IN1 >= IN2', (a, b) => a >= b)
cmp('LT', 'IN1 < IN2', (a, b) => a < b)
cmp('LE', 'IN1 <= IN2', (a, b) => a <= b)
cmp('EQ', 'IN1 = IN2', (a, b) => a === b)
cmp('NE', 'IN1 <> IN2', (a, b) => a !== b)

reg('AND', 'Logika', 'Iloczyn logiczny', [p('IN1', 'BOOL'), p('IN2', 'BOOL')], [p('OUT', 'BOOL')], false,
  (i) => ({ OUT: toBool(i.IN1) && toBool(i.IN2) }), true)
reg('OR', 'Logika', 'Suma logiczna', [p('IN1', 'BOOL'), p('IN2', 'BOOL')], [p('OUT', 'BOOL')], false,
  (i) => ({ OUT: toBool(i.IN1) || toBool(i.IN2) }), true)
reg('XOR', 'Logika', 'Suma modulo 2', [p('IN1', 'BOOL'), p('IN2', 'BOOL')], [p('OUT', 'BOOL')], false,
  (i) => ({ OUT: toBool(i.IN1) !== toBool(i.IN2) }), true)
reg('NOT', 'Logika', 'Negacja', [p('IN', 'BOOL')], [p('OUT', 'BOOL')], false,
  (i) => ({ OUT: !toBool(i.IN) }), true)

const bitop = (t: string, desc: string, f: (a: number, b: number) => number) =>
  reg(t, 'Operacje bitowe', desc, [p('IN', 'WORD', '0'), p('N', 'INT', '1')], [p('OUT', 'WORD')], false,
    (i) => ({ OUT: f(toNum(i.IN) | 0, toNum(i.N) | 0) }), true)

bitop('SHL', 'Przesunięcie bitowe w lewo', (a, n) => (a << n) >>> 0)
bitop('SHR', 'Przesunięcie bitowe w prawo', (a, n) => a >>> n)
bitop('ROL', 'Rotacja bitowa w lewo (16 bit)', (a, n) => (((a << n) | (a >>> (16 - n))) & 0xffff))
bitop('ROR', 'Rotacja bitowa w prawo (16 bit)', (a, n) => (((a >>> n) | (a << (16 - n))) & 0xffff))

reg('AND_WORD', 'Operacje bitowe', 'Bitowe AND', [p('IN1', 'WORD', '0'), p('IN2', 'WORD', '0')], [p('OUT', 'WORD')], false,
  (i) => ({ OUT: (toNum(i.IN1) & toNum(i.IN2)) >>> 0 }), true)
reg('OR_WORD', 'Operacje bitowe', 'Bitowe OR', [p('IN1', 'WORD', '0'), p('IN2', 'WORD', '0')], [p('OUT', 'WORD')], false,
  (i) => ({ OUT: (toNum(i.IN1) | toNum(i.IN2)) >>> 0 }), true)

/* ---------------------------------------------------------------- */
/* Wybór i przesyłanie danych                                        */
/* ---------------------------------------------------------------- */

reg('MOVE', 'Dane', 'Przepisanie wartości IN do OUT', [p('IN', 'ANY', '0')], [p('OUT', 'ANY')], false,
  (i) => ({ OUT: i.IN ?? 0 }), true)

reg('SEL', 'Dane', 'Wybór: G=FALSE→IN0, G=TRUE→IN1',
  [p('G', 'BOOL'), p('IN0', 'ANY', '0'), p('IN1', 'ANY', '0')], [p('OUT', 'ANY')], false,
  (i) => ({ OUT: toBool(i.G) ? (i.IN1 ?? 0) : (i.IN0 ?? 0) }), true)

reg('MUX', 'Dane', 'Multiplekser 4-wejściowy sterowany K',
  [p('K', 'INT', '0'), p('IN0', 'ANY', '0'), p('IN1', 'ANY', '0'), p('IN2', 'ANY', '0'), p('IN3', 'ANY', '0')],
  [p('OUT', 'ANY')], false,
  (i) => ({ OUT: [i.IN0, i.IN1, i.IN2, i.IN3][Math.max(0, Math.min(3, toNum(i.K)))] ?? 0 }), true)

reg('LIMIT', 'Dane', 'Ograniczenie wartości do zakresu MN..MX',
  [p('MN', 'ANY_NUM', '0'), p('IN', 'ANY_NUM', '0'), p('MX', 'ANY_NUM', '100')], [p('OUT', 'ANY_NUM')], false,
  (i) => ({ OUT: Math.min(toNum(i.MX), Math.max(toNum(i.MN), toNum(i.IN))) }), true)

reg('MAX', 'Dane', 'Większa z dwóch wartości', [p('IN1', 'ANY_NUM', '0'), p('IN2', 'ANY_NUM', '0')], [p('OUT', 'ANY_NUM')], false,
  (i) => ({ OUT: Math.max(toNum(i.IN1), toNum(i.IN2)) }), true)
reg('MIN', 'Dane', 'Mniejsza z dwóch wartości', [p('IN1', 'ANY_NUM', '0'), p('IN2', 'ANY_NUM', '0')], [p('OUT', 'ANY_NUM')], false,
  (i) => ({ OUT: Math.min(toNum(i.IN1), toNum(i.IN2)) }), true)

/* ---------------------------------------------------------------- */
/* Bloki technologiczne — automatyka przemysłowa                     */
/* ---------------------------------------------------------------- */

reg('SCALE', 'Technologiczne', 'Skalowanie liniowe sygnału (np. 0..27648 → 0..100 bar)',
  [p('IN', 'REAL', '0'), p('IN_MIN', 'REAL', '0'), p('IN_MAX', 'REAL', '27648'),
   p('OUT_MIN', 'REAL', '0'), p('OUT_MAX', 'REAL', '100')],
  [p('OUT', 'REAL')], false,
  (i) => {
    const a = toNum(i.IN_MIN), b = toNum(i.IN_MAX)
    const r = b - a === 0 ? 0 : (toNum(i.IN) - a) / (b - a)
    return { OUT: toNum(i.OUT_MIN) + r * (toNum(i.OUT_MAX) - toNum(i.OUT_MIN)) }
  }, true)

reg('HYST', 'Technologiczne', 'Komparator z histerezą (przekaźnik dwustawny)',
  [p('IN', 'REAL', '0'), p('ON_LEVEL', 'REAL', '80'), p('OFF_LEVEL', 'REAL', '20')],
  [p('Q', 'BOOL')], true,
  (i, s) => {
    const v = toNum(i.IN), on = toNum(i.ON_LEVEL), off = toNum(i.OFF_LEVEL)
    let q = toBool(s.q)
    if (on >= off) { if (v >= on) q = true; else if (v <= off) q = false }
    else { if (v <= on) q = true; else if (v >= off) q = false }
    s.q = q; return { Q: q }
  })

reg('PT1', 'Technologiczne', 'Filtr dolnoprzepustowy pierwszego rzędu (inercja)',
  [p('IN', 'REAL', '0'), p('T', 'TIME', 'T#1s')], [p('OUT', 'REAL')], true,
  (i, s, c) => {
    const T = Math.max(1, toNum(i.T))
    const a = c.dt / (T + c.dt)
    const y = toNum(s.y) + a * (toNum(i.IN) - toNum(s.y))
    s.y = y; return { OUT: y }
  })

reg('RAMP', 'Technologiczne', 'Ogranicznik szybkości narastania/opadania',
  [p('IN', 'REAL', '0'), p('RATE_UP', 'REAL', '10'), p('RATE_DOWN', 'REAL', '10')],
  [p('OUT', 'REAL'), p('BUSY', 'BOOL')], true,
  (i, s, c) => {
    const target = toNum(i.IN); let y = toNum(s.y)
    const up = toNum(i.RATE_UP) * c.dt / 1000, dn = toNum(i.RATE_DOWN) * c.dt / 1000
    if (y < target) y = Math.min(target, y + up)
    else if (y > target) y = Math.max(target, y - dn)
    s.y = y
    return { OUT: y, BUSY: Math.abs(y - target) > 1e-9 }
  })

reg('PID', 'Technologiczne', 'Regulator PID z ograniczeniem i anti-windup',
  [p('SP', 'REAL', '0'), p('PV', 'REAL', '0'), p('KP', 'REAL', '1.0'), p('TI', 'TIME', 'T#5s'),
   p('TD', 'TIME', 'T#0s'), p('OUT_MIN', 'REAL', '0'), p('OUT_MAX', 'REAL', '100'),
   p('MAN', 'BOOL'), p('MAN_VAL', 'REAL', '0')],
  [p('OUT', 'REAL'), p('ERR', 'REAL'), p('SAT', 'BOOL')], true,
  (i, s, c) => {
    const sp = toNum(i.SP), pv = toNum(i.PV), kp = toNum(i.KP)
    const ti = toNum(i.TI) / 1000, td = toNum(i.TD) / 1000
    const lo = toNum(i.OUT_MIN), hi = toNum(i.OUT_MAX)
    const dt = c.dt / 1000
    const err = sp - pv
    if (toBool(i.MAN)) {
      const mv = Math.min(hi, Math.max(lo, toNum(i.MAN_VAL)))
      s.integ = mv - kp * err; s.prevErr = err
      return { OUT: mv, ERR: err, SAT: false }
    }
    let integ = toNum(s.integ)
    if (ti > 0) integ += (kp / ti) * err * dt
    const deriv = dt > 0 ? kp * td * (err - toNum(s.prevErr)) / dt : 0
    let out = kp * err + integ + deriv
    let sat = false
    if (out > hi) { out = hi; sat = true } else if (out < lo) { out = lo; sat = true }
    if (sat && ti > 0) integ = out - kp * err - deriv   // anti-windup
    s.integ = integ; s.prevErr = err
    return { OUT: out, ERR: err, SAT: sat }
  })

reg('TOTALIZER', 'Technologiczne', 'Całkowanie przepływu — licznik sumaryczny',
  [p('FLOW', 'REAL', '0', 'jednostka/s'), p('RUN', 'BOOL'), p('RESET', 'BOOL')],
  [p('TOTAL', 'REAL')], true,
  (i, s, c) => {
    let t = toNum(s.total)
    if (toBool(i.RESET)) t = 0
    else if (toBool(i.RUN)) t += toNum(i.FLOW) * c.dt / 1000
    s.total = t; return { TOTAL: t }
  })

reg('AVG', 'Technologiczne', 'Średnia krocząca wykładnicza z N próbek',
  [p('IN', 'REAL', '0'), p('N', 'INT', '10')], [p('OUT', 'REAL')], true,
  (i, s) => {
    const n = Math.max(1, toNum(i.N))
    const cnt = Math.min(n, toNum(s.cnt) + 1)
    const y = toNum(s.y) + (toNum(i.IN) - toNum(s.y)) / cnt
    s.y = y; s.cnt = cnt
    return { OUT: y }
  })

reg('MOTOR', 'Technologiczne', 'Rozrusznik silnika: podtrzymanie start/stop z blokadą awaryjną',
  [p('START', 'BOOL'), p('STOP', 'BOOL'), p('FAULT', 'BOOL'), p('ENABLE', 'BOOL', 'TRUE')],
  [p('RUN', 'BOOL'), p('TRIPPED', 'BOOL')], true,
  (i, s) => {
    let run = toBool(s.run)
    const trip = toBool(i.FAULT)
    if (trip || toBool(i.STOP) || !toBool(i.ENABLE)) run = false
    else if (toBool(i.START)) run = true
    s.run = run
    return { RUN: run, TRIPPED: trip }
  })

reg('ALTERNATE', 'Technologiczne', 'Naprzemienna praca dwóch pomp (wyrównanie zużycia)',
  [p('REQ', 'BOOL'), p('SWAP', 'BOOL')], [p('A', 'BOOL'), p('B', 'BOOL')], true,
  (i, s) => {
    const req = toBool(i.REQ)
    let sel = toBool(s.sel)
    if (toBool(i.SWAP) && !toBool(s.pswap)) sel = !sel
    if (!req && toBool(s.preq)) sel = !sel
    s.sel = sel; s.preq = req; s.pswap = toBool(i.SWAP)
    return { A: req && !sel, B: req && sel }
  })

reg('SEQ', 'Technologiczne', 'Sekwencer krokowy — przejście do kolejnego kroku na NEXT',
  [p('NEXT', 'BOOL'), p('RESET', 'BOOL'), p('MAX_STEP', 'INT', '5')],
  [p('STEP', 'INT'), p('DONE', 'BOOL')], true,
  (i, s) => {
    let step = toNum(s.step)
    const n = toBool(i.NEXT)
    if (toBool(i.RESET)) step = 0
    else if (n && !toBool(s.prev)) step = Math.min(toNum(i.MAX_STEP), step + 1)
    s.step = step; s.prev = n
    return { STEP: step, DONE: step >= toNum(i.MAX_STEP) }
  })

reg('DEADBAND', 'Technologiczne', 'Strefa nieczułości wokół zera',
  [p('IN', 'REAL', '0'), p('BAND', 'REAL', '1')], [p('OUT', 'REAL')], false,
  (i) => {
    const v = toNum(i.IN), b = Math.abs(toNum(i.BAND))
    return { OUT: Math.abs(v) <= b ? 0 : v - Math.sign(v) * b }
  }, true)

/* ---------------------------------------------------------------- */
/* Konwersje typów                                                   */
/* ---------------------------------------------------------------- */

reg('BOOL_TO_INT', 'Konwersje', 'BOOL → INT', [p('IN', 'BOOL')], [p('OUT', 'INT')], false,
  (i) => ({ OUT: toBool(i.IN) ? 1 : 0 }), true)
reg('INT_TO_BOOL', 'Konwersje', 'INT → BOOL', [p('IN', 'INT', '0')], [p('OUT', 'BOOL')], false,
  (i) => ({ OUT: toNum(i.IN) !== 0 }), true)
reg('INT_TO_REAL', 'Konwersje', 'INT → REAL', [p('IN', 'INT', '0')], [p('OUT', 'REAL')], false,
  (i) => ({ OUT: toNum(i.IN) }), true)
reg('REAL_TO_INT', 'Konwersje', 'REAL → INT (zaokrąglenie)', [p('IN', 'REAL', '0')], [p('OUT', 'INT')], false,
  (i) => ({ OUT: Math.round(toNum(i.IN)) }), true)
reg('TIME_TO_DINT', 'Konwersje', 'TIME → DINT (ms)', [p('IN', 'TIME', 'T#0s')], [p('OUT', 'DINT')], false,
  (i) => ({ OUT: toNum(i.IN) }), true)
reg('DINT_TO_TIME', 'Konwersje', 'DINT (ms) → TIME', [p('IN', 'DINT', '0')], [p('OUT', 'TIME')], false,
  (i) => ({ OUT: toNum(i.IN) }), true)

/* ---------------------------------------------------------------- */

export const BLOCK_DEFS: BlockDef[] = B.map((b) => b.def)
export const BLOCK_MAP: Record<string, BlockDef> = Object.fromEntries(B.map((b) => [b.def.type, b.def]))
export const BLOCK_IMPL: Record<string, BlockImpl> = Object.fromEntries(B.map((b) => [b.def.type, b.run]))

export const BLOCK_CATEGORIES = Array.from(new Set(BLOCK_DEFS.map((d) => d.category)))

export function getBlockDef(type: string): BlockDef | undefined {
  return BLOCK_MAP[type]
}
