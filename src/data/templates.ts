import type { AlarmDef, HmiWidget, IoPoint, Project, Variable, WidgetKind } from '../core/types'
import { emptyProject, makePou, makeVariable } from '../core/factory'
import { uid } from '../core/grid'
import { stToLadder } from '../core/st/toladder'
import { defaultProps } from '../hmi/widgets'

export interface Template {
  id: string
  name: string
  category: string
  description: string
  glyph: string
  build: () => Project
}

/* ---------------------------- pomocnicze ---------------------------- */

interface VarSpec {
  name: string
  type?: Variable['type']
  fb?: string
  addr?: string
  init?: string
  comment?: string
}

const V = (specs: VarSpec[]): Variable[] =>
  specs.map((s) => makeVariable({
    name: s.name, type: s.type ?? 'BOOL', fbType: s.fb, address: s.addr,
    initial: s.init, comment: s.comment, varClass: 'VAR_GLOBAL',
  }))

interface W {
  kind: WidgetKind
  x: number; y: number; w?: number; h?: number
  bind?: Record<string, string>
  props?: Record<string, unknown>
}

const widgets = (list: W[]): HmiWidget[] =>
  list.map((it, i) => ({
    id: uid('w'), kind: it.kind, x: it.x, y: it.y,
    w: it.w ?? 120, h: it.h ?? 80,
    bind: it.bind ?? {}, props: { ...defaultProps(it.kind), ...(it.props ?? {}) }, z: i + 1,
  }))

const alarms = (list: Omit<AlarmDef, 'id'>[]): AlarmDef[] => list.map((a) => ({ ...a, id: uid('alm') }))

const io = (list: Omit<IoPoint, 'id'>[]): IoPoint[] => list.map((p) => ({ ...p, id: uid('io') }))

/** Buduje projekt: zmienne globalne + program zapisany w ST zamieniony na drabinkę. */
function project(opts: {
  name: string
  description: string
  vars: Variable[]
  code: string
  screen: { name: string; width: number; height: number; widgets: HmiWidget[] }
  alarms?: AlarmDef[]
  io?: IoPoint[]
  scanTime?: number
}): Project {
  const p = emptyProject(opts.name)
  p.description = opts.description
  p.globals = opts.vars
  p.config.scanTime = opts.scanTime ?? 10
  const conv = stToLadder(opts.code, {
    resolveInstance: (n) => opts.vars.find((v) => v.name === n)?.fbType,
    resolveVarType: (n) => opts.vars.find((v) => v.name === n)?.type,
  })
  p.pous = [makePou({
    name: 'Main', language: 'LD', rungs: conv.rungs,
    st: opts.code, comment: opts.description,
  })]
  p.tasks[0].programs = ['Main']
  p.hmi = [{ id: uid('scr'), ...opts.screen }]
  p.alarms = opts.alarms ?? []
  p.io = opts.io ?? []
  return p
}

/* ==================================================================== */
/* Szablony                                                             */
/* ==================================================================== */

export const TEMPLATES: Template[] = [
  /* ---------------------------------------------------------------- */
  {
    id: 'blank',
    name: 'Pusty projekt',
    category: 'Start',
    glyph: '📄',
    description: 'Czysty projekt z jednym programem w drabince — punkt wyjścia do własnej aplikacji.',
    build: () => emptyProject('Nowy projekt'),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'motor-start-stop',
    name: 'Rozruch silnika START/STOP',
    category: 'Napędy',
    glyph: '⚙️',
    description:
      'Klasyczny układ zatrzaskowy z podtrzymaniem, przyciskiem STOP w postaci zestyku rozwiernego, ' +
      'zabezpieczeniem termicznym i lampką sygnalizacyjną. Podstawa każdego kursu automatyki.',
    build: () => project({
      name: 'Rozruch silnika START/STOP',
      description: 'Podtrzymanie stycznika z blokadą od przekaźnika termicznego',
      vars: V([
        { name: 'Start', addr: '%IX0.0', comment: 'Przycisk START (zwierny)' },
        { name: 'Stop', addr: '%IX0.1', init: 'TRUE', comment: 'Przycisk STOP (rozwierny)' },
        { name: 'Termik', addr: '%IX0.2', init: 'TRUE', comment: 'Styk przekaźnika termicznego (rozwierny)' },
        { name: 'Stycznik', addr: '%QX0.0', comment: 'Cewka stycznika K1' },
        { name: 'LampkaPraca', addr: '%QX0.1', comment: 'Lampka zielona — praca' },
        { name: 'LampkaAwaria', addr: '%QX0.2', comment: 'Lampka czerwona — awaria' },
        { name: 'CzasPracy', type: 'REAL', comment: 'Motogodziny' },
        { name: 'Licznik', fb: 'RUNTIME', comment: 'Licznik czasu pracy' },
      ]),
      code: `
Stycznik := (Start OR Stycznik) AND Stop AND Termik;
LampkaPraca := Stycznik;
LampkaAwaria := NOT Termik;
Licznik(RUN := Stycznik, RESET := FALSE);
CzasPracy := Licznik.HOURS;
`.trim(),
      screen: {
        name: 'Panel silnika', width: 800, height: 480,
        widgets: widgets([
          { kind: 'label', x: 30, y: 20, w: 400, h: 34, props: { text: 'Stanowisko napędowe M1', size: 20, bold: true } },
          { kind: 'button', x: 40, y: 90, w: 130, h: 70, bind: { out: 'Start' }, props: { text: 'START', color: '#2f9e5b' } },
          { kind: 'button', x: 190, y: 90, w: 130, h: 70, bind: { out: 'Stop' }, props: { text: 'STOP', color: '#c0392b' } },
          { kind: 'toggle', x: 40, y: 180, w: 200, h: 44, bind: { out: 'Termik' }, props: { text: 'Termik OK (symulacja)' } },
          { kind: 'motor', x: 420, y: 90, w: 140, h: 140, bind: { run: 'Stycznik', fault: 'LampkaAwaria' }, props: { label: 'M1' } },
          { kind: 'lamp', x: 600, y: 90, w: 80, h: 90, bind: { in: 'LampkaPraca' }, props: { color: '#3ddc84', text: 'PRACA' } },
          { kind: 'lamp', x: 690, y: 90, w: 80, h: 90, bind: { in: 'LampkaAwaria' }, props: { color: '#f4586a', text: 'AWARIA', blink: true } },
          { kind: 'numeric', x: 420, y: 260, w: 200, h: 70, bind: { in: 'CzasPracy' }, props: { label: 'Czas pracy', unit: 'h', decimals: 3 } },
          { kind: 'stack-light', x: 660, y: 240, w: 60, h: 150, bind: { red: 'LampkaAwaria', green: 'LampkaPraca' } },
        ]),
      },
      alarms: alarms([
        { variable: 'Termik', condition: 'false', text: 'Zadziałał przekaźnik termiczny silnika M1', priority: 'critical', ackRequired: true },
      ]),
      io: io([
        { address: '%IX0.0', variable: 'Start', direction: 'IN', sim: 'manual' },
        { address: '%IX0.1', variable: 'Stop', direction: 'IN', sim: 'manual' },
        { address: '%QX0.0', variable: 'Stycznik', direction: 'OUT' },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'star-delta',
    name: 'Rozruch gwiazda-trójkąt',
    category: 'Napędy',
    glyph: '🔺',
    description:
      'Rozruch silnika indukcyjnego z przełączeniem uzwojeń: stycznik sieciowy, stycznik gwiazdy, ' +
      'przerwa bezpieczeństwa i stycznik trójkąta. Zawiera blokadę wzajemną styczników.',
    build: () => project({
      name: 'Rozruch gwiazda-trójkąt',
      description: 'Przełączanie Y/Δ z przerwą bezpieczeństwa 100 ms',
      vars: V([
        { name: 'Start', addr: '%IX0.0', comment: 'Przycisk START' },
        { name: 'Stop', addr: '%IX0.1', init: 'TRUE', comment: 'Przycisk STOP (rozwierny)' },
        { name: 'Termik', addr: '%IX0.2', init: 'TRUE', comment: 'Zabezpieczenie termiczne' },
        { name: 'K1_Siec', addr: '%QX0.0', comment: 'Stycznik sieciowy' },
        { name: 'K2_Gwiazda', addr: '%QX0.1', comment: 'Stycznik gwiazdy' },
        { name: 'K3_Trojkat', addr: '%QX0.2', comment: 'Stycznik trójkąta' },
        { name: 'CzasGwiazdy', type: 'TIME', comment: 'Czas rozruchu w gwieździe' },
        { name: 'T_Gwiazda', fb: 'TON', comment: 'Timer czasu gwiazdy' },
        { name: 'T_Przerwa', fb: 'TON', comment: 'Timer przerwy bezpieczeństwa' },
      ]),
      code: `
K1_Siec := (Start OR K1_Siec) AND Stop AND Termik;
T_Gwiazda(IN := K1_Siec, PT := T#5s);
CzasGwiazdy := T_Gwiazda.ET;
K2_Gwiazda := K1_Siec AND NOT T_Gwiazda.Q AND NOT K3_Trojkat;
T_Przerwa(IN := T_Gwiazda.Q, PT := T#100ms);
K3_Trojkat := T_Przerwa.Q AND K1_Siec AND NOT K2_Gwiazda;
`.trim(),
      screen: {
        name: 'Panel Y/Δ', width: 900, height: 480,
        widgets: widgets([
          { kind: 'label', x: 30, y: 18, w: 460, h: 32, props: { text: 'Rozruch gwiazda-trójkąt', size: 19, bold: true } },
          { kind: 'button', x: 40, y: 80, w: 120, h: 66, bind: { out: 'Start' }, props: { text: 'START', color: '#2f9e5b' } },
          { kind: 'button', x: 175, y: 80, w: 120, h: 66, bind: { out: 'Stop' }, props: { text: 'STOP', color: '#c0392b' } },
          { kind: 'lamp', x: 40, y: 180, w: 80, h: 90, bind: { in: 'K1_Siec' }, props: { color: '#4c9aff', text: 'K1 sieć' } },
          { kind: 'lamp', x: 130, y: 180, w: 80, h: 90, bind: { in: 'K2_Gwiazda' }, props: { color: '#f5a524', text: 'K2 gwiazda' } },
          { kind: 'lamp', x: 220, y: 180, w: 80, h: 90, bind: { in: 'K3_Trojkat' }, props: { color: '#3ddc84', text: 'K3 trójkąt' } },
          { kind: 'motor', x: 420, y: 90, w: 150, h: 150, bind: { run: 'K1_Siec' }, props: { label: 'M1' } },
          { kind: 'bar', x: 620, y: 80, w: 80, h: 190, bind: { in: 'CzasGwiazdy' }, props: { min: 0, max: 5000, unit: 'ms', color: '#f5a524' } },
          { kind: 'trend', x: 380, y: 290, w: 460, h: 160, bind: { in: 'CzasGwiazdy' }, props: { label: 'Przebieg rozruchu', min: 0, max: 5000 } },
          { kind: 'toggle', x: 40, y: 300, w: 220, h: 44, bind: { out: 'Termik' }, props: { text: 'Termik OK' } },
        ]),
      },
      alarms: alarms([
        { variable: 'Termik', condition: 'false', text: 'Zabezpieczenie termiczne — silnik zatrzymany', priority: 'critical', ackRequired: true },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'tank-level',
    name: 'Napełnianie zbiornika',
    category: 'Procesy',
    glyph: '🛢️',
    description:
      'Automatyczne utrzymanie poziomu w zbiorniku: pompa z histerezą, zawór spustowy, ' +
      'alarmy poziomu skrajnego oraz model procesu (poziom zmienia się w zależności od pracy pompy).',
    build: () => project({
      name: 'Napełnianie zbiornika',
      description: 'Regulacja dwupołożeniowa z histerezą i modelem procesu',
      scanTime: 20,
      vars: V([
        { name: 'Auto', addr: '%IX0.0', init: 'TRUE', comment: 'Tryb automatyczny' },
        { name: 'PompaRecznie', addr: '%IX0.1', comment: 'Załączenie ręczne pompy' },
        { name: 'ZawórSpust', addr: '%QX0.1', comment: 'Zawór spustowy' },
        { name: 'Pompa', addr: '%QX0.0', comment: 'Pompa napełniająca' },
        { name: 'Poziom', type: 'REAL', addr: '%IW0', init: '20', comment: 'Poziom w zbiorniku [%]' },
        { name: 'PoziomZal', type: 'REAL', init: '30', comment: 'Próg załączenia pompy' },
        { name: 'PoziomWyl', type: 'REAL', init: '85', comment: 'Próg wyłączenia pompy' },
        { name: 'AlarmHi', comment: 'Poziom maksymalny' },
        { name: 'AlarmLo', comment: 'Poziom minimalny (suchobieg)' },
        { name: 'Sterowanie', fb: 'HYST', comment: 'Komparator z histerezą' },
        { name: 'Model', fb: 'PT1', comment: 'Model bezwładności procesu' },
        { name: 'Doplyw', type: 'REAL', comment: 'Chwilowy bilans napełniania' },
      ]),
      code: `
(* Regulacja dwupołożeniowa: pompa załącza się poniżej PoziomZal, wyłącza powyżej PoziomWyl *)
Sterowanie(IN := Poziom, ON_LEVEL := PoziomZal, OFF_LEVEL := PoziomWyl);
Pompa := (Auto AND Sterowanie.Q) OR (NOT Auto AND PompaRecznie);

(* Alarmy poziomu skrajnego *)
AlarmHi := Poziom > 95.0;
AlarmLo := Poziom < 5.0;

(* Uproszczony model procesu — dopływ z pompy minus wypływ przez zawór *)
IF Pompa THEN
  Doplyw := 12.0;
ELSE
  Doplyw := 0.0;
END_IF;
IF ZawórSpust THEN
  Doplyw := Doplyw - 8.0;
ELSE
  Doplyw := Doplyw - 1.0;
END_IF;
Poziom := LIMIT(0.0, Poziom + Doplyw * 0.02, 100.0);
`.trim(),
      screen: {
        name: 'Instalacja zbiornikowa', width: 900, height: 520,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 460, h: 32, props: { text: 'Stacja napełniania zbiornika', size: 19, bold: true } },
          { kind: 'toggle', x: 30, y: 70, w: 220, h: 44, bind: { out: 'Auto' }, props: { text: 'Tryb automatyczny' } },
          { kind: 'toggle', x: 30, y: 120, w: 220, h: 44, bind: { out: 'PompaRecznie' }, props: { text: 'Pompa (ręcznie)' } },
          { kind: 'slider', x: 30, y: 175, w: 240, h: 60, bind: { out: 'PoziomZal' }, props: { label: 'Próg załączenia', min: 0, max: 100, unit: '%' } },
          { kind: 'slider', x: 30, y: 240, w: 240, h: 60, bind: { out: 'PoziomWyl' }, props: { label: 'Próg wyłączenia', min: 0, max: 100, unit: '%' } },
          { kind: 'pump', x: 310, y: 150, w: 110, h: 110, bind: { run: 'Pompa' }, props: { label: 'P1' } },
          { kind: 'pipe', x: 420, y: 185, w: 60, h: 30, bind: { flow: 'Pompa' }, props: {} },
          { kind: 'tank', x: 480, y: 70, w: 190, h: 280, bind: { level: 'Poziom', alarmHi: 'AlarmHi', alarmLo: 'AlarmLo' }, props: { label: 'Z1', unit: '%' } },
          { kind: 'pipe', x: 665, y: 290, w: 60, h: 30, bind: { flow: 'ZawórSpust' }, props: { color: '#8fa3b8' } },
          { kind: 'valve', x: 720, y: 268, w: 100, h: 76, bind: { open: 'ZawórSpust', cmd: 'ZawórSpust' }, props: { label: 'V1' } },
          { kind: 'gauge', x: 700, y: 70, w: 170, h: 150, bind: { in: 'Poziom' }, props: { min: 0, max: 100, unit: '%', label: 'poziom' } },
          { kind: 'alarms', x: 30, y: 320, w: 290, h: 170, props: {} },
          { kind: 'trend', x: 340, y: 370, w: 530, h: 130, bind: { in: 'Poziom', in2: 'PoziomZal' }, props: { label: 'Poziom w czasie', min: 0, max: 100 } },
        ]),
      },
      alarms: alarms([
        { variable: 'Poziom', condition: '>', limit: 95, text: 'Poziom maksymalny w zbiorniku Z1', priority: 'critical', ackRequired: true },
        { variable: 'Poziom', condition: '<', limit: 5, text: 'Poziom minimalny — ryzyko suchobiegu pompy', priority: 'warning', ackRequired: true },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'pid-temp',
    name: 'Regulacja temperatury PID',
    category: 'Procesy',
    glyph: '🌡️',
    description:
      'Pętla regulacji z regulatorem PID, trybem ręcznym/automatycznym, ograniczeniem mocy grzałki ' +
      'i modelem cieplnym obiektu. Dobre miejsce, by poćwiczyć dobór nastaw.',
    build: () => project({
      name: 'Regulacja temperatury PID',
      description: 'Pętla PID z modelem cieplnym i trybem ręcznym',
      scanTime: 50,
      vars: V([
        { name: 'Auto', init: 'TRUE', comment: 'Tryb automatyczny' },
        { name: 'Zadana', type: 'REAL', init: '65', comment: 'Temperatura zadana [°C]' },
        { name: 'Temperatura', type: 'REAL', init: '20', comment: 'Temperatura mierzona [°C]' },
        { name: 'Moc', type: 'REAL', comment: 'Moc grzałki [%]' },
        { name: 'MocReczna', type: 'REAL', init: '0', comment: 'Moc w trybie ręcznym [%]' },
        { name: 'Kp', type: 'REAL', init: '4.0', comment: 'Wzmocnienie' },
        { name: 'Uchyb', type: 'REAL', comment: 'Uchyb regulacji' },
        { name: 'Nasycenie', comment: 'Wyjście na ograniczeniu' },
        { name: 'AlarmTemp', comment: 'Przekroczenie temperatury' },
        { name: 'Grzalka', addr: '%QX0.0', comment: 'Załączenie grzałki' },
        { name: 'Regulator', fb: 'PID' },
        { name: 'Obiekt', fb: 'PT1', comment: 'Model cieplny' },
      ]),
      code: `
Regulator(SP := Zadana, PV := Temperatura, KP := Kp, TI := T#25s, TD := T#3s,
          OUT_MIN := 0.0, OUT_MAX := 100.0, MAN := NOT Auto, MAN_VAL := MocReczna);
Moc := Regulator.OUT;
Uchyb := Regulator.ERR;
Nasycenie := Regulator.SAT;
Grzalka := Moc > 2.0;

(* Model cieplny: grzanie proporcjonalne do mocy, stygnięcie do otoczenia *)
Obiekt(IN := 20.0 + Moc * 0.85, T := T#40s);
Temperatura := Obiekt.OUT;
AlarmTemp := Temperatura > 90.0;
`.trim(),
      screen: {
        name: 'Regulacja temperatury', width: 960, height: 540,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 500, h: 32, props: { text: 'Pętla regulacji temperatury', size: 19, bold: true } },
          { kind: 'gauge', x: 40, y: 70, w: 200, h: 180, bind: { in: 'Temperatura', sp: 'Zadana' }, props: { min: 0, max: 120, unit: '°C', label: 'PV', warn: 70, alarm: 85 } },
          { kind: 'input', x: 270, y: 80, w: 160, h: 60, bind: { out: 'Zadana' }, props: { label: 'Zadana', unit: '°C', decimals: 1 } },
          { kind: 'input', x: 270, y: 150, w: 160, h: 60, bind: { out: 'Kp' }, props: { label: 'Wzmocnienie Kp', unit: '', decimals: 2 } },
          { kind: 'toggle', x: 270, y: 220, w: 200, h: 44, bind: { out: 'Auto' }, props: { text: 'Tryb AUTO' } },
          { kind: 'slider', x: 270, y: 270, w: 220, h: 60, bind: { out: 'MocReczna' }, props: { label: 'Moc ręczna', min: 0, max: 100, unit: '%' } },
          { kind: 'bar', x: 500, y: 70, w: 80, h: 200, bind: { in: 'Moc' }, props: { min: 0, max: 100, unit: '%', color: '#f5a524' } },
          { kind: 'heater', x: 600, y: 90, w: 140, h: 90, bind: { on: 'Grzalka', power: 'Moc' }, props: { label: 'H1' } },
          { kind: 'lamp', x: 770, y: 80, w: 80, h: 90, bind: { in: 'Nasycenie' }, props: { color: '#f5a524', text: 'NASYCENIE' } },
          { kind: 'lamp', x: 860, y: 80, w: 80, h: 90, bind: { in: 'AlarmTemp' }, props: { color: '#f4586a', text: 'ALARM', blink: true } },
          { kind: 'numeric', x: 600, y: 195, w: 170, h: 64, bind: { in: 'Uchyb' }, props: { label: 'Uchyb', unit: '°C', decimals: 2 } },
          { kind: 'trend', x: 40, y: 350, w: 890, h: 170, bind: { in: 'Temperatura', in2: 'Zadana', in3: 'Moc' }, props: { label: 'PV / SP / moc', min: 0, max: 120, points: 240 } },
        ]),
      },
      alarms: alarms([
        { variable: 'Temperatura', condition: '>', limit: 90, text: 'Przekroczona temperatura maksymalna', priority: 'critical', ackRequired: true },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'traffic-light',
    name: 'Sygnalizacja świetlna',
    category: 'Sekwencje',
    glyph: '🚦',
    description:
      'Cykliczna sekwencja świateł dla skrzyżowania dwóch kierunków, sterowana licznikiem kroków ' +
      'i timerami. Świetny przykład automatu sekwencyjnego w drabince.',
    build: () => project({
      name: 'Sygnalizacja świetlna',
      description: 'Automat sekwencyjny czterech faz z timerami',
      scanTime: 50,
      vars: V([
        { name: 'Praca', init: 'TRUE', comment: 'Sygnalizacja czynna' },
        { name: 'Krok', type: 'INT', init: '0', comment: 'Numer fazy 0..3' },
        { name: 'CzasFazy', type: 'TIME' },
        { name: 'NastepnaFaza', comment: 'Impuls przejścia do kolejnej fazy' },
        { name: 'A_Czerwone', addr: '%QX0.0' }, { name: 'A_Zolte', addr: '%QX0.1' }, { name: 'A_Zielone', addr: '%QX0.2' },
        { name: 'B_Czerwone', addr: '%QX0.3' }, { name: 'B_Zolte', addr: '%QX0.4' }, { name: 'B_Zielone', addr: '%QX0.5' },
        { name: 'T_Faza', fb: 'TON' },
        { name: 'Sekwencer', fb: 'SEQ' },
      ]),
      code: `
T_Faza(IN := Praca AND NOT T_Faza.Q, PT := T#4s);
NastepnaFaza := T_Faza.Q;
CzasFazy := T_Faza.ET;

IF NastepnaFaza THEN
  Krok := Krok + 1;
END_IF;
IF Krok > 3 THEN
  Krok := 0;
END_IF;
IF NOT Praca THEN
  Krok := 0;
END_IF;

(* Faza 0: A jedzie, 1: A żółte, 2: B jedzie, 3: B żółte *)
A_Zielone := Praca AND (Krok = 0);
A_Zolte   := Praca AND (Krok = 1);
A_Czerwone := NOT Praca OR (Krok >= 2);
B_Zielone := Praca AND (Krok = 2);
B_Zolte   := Praca AND (Krok = 3);
B_Czerwone := NOT Praca OR (Krok <= 1);
`.trim(),
      screen: {
        name: 'Skrzyżowanie', width: 800, height: 480,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 400, h: 32, props: { text: 'Sygnalizacja skrzyżowania', size: 19, bold: true } },
          { kind: 'traffic', x: 200, y: 90, w: 90, h: 200, bind: { red: 'A_Czerwone', yellow: 'A_Zolte', green: 'A_Zielone' } },
          { kind: 'label', x: 195, y: 300, w: 100, h: 26, props: { text: 'Kierunek A', align: 'center' } },
          { kind: 'traffic', x: 450, y: 90, w: 90, h: 200, bind: { red: 'B_Czerwone', yellow: 'B_Zolte', green: 'B_Zielone' } },
          { kind: 'label', x: 445, y: 300, w: 100, h: 26, props: { text: 'Kierunek B', align: 'center' } },
          { kind: 'toggle', x: 30, y: 90, w: 160, h: 44, bind: { out: 'Praca' }, props: { text: 'Sygnalizacja czynna' } },
          { kind: 'seg7', x: 620, y: 90, w: 140, h: 70, bind: { in: 'Krok' }, props: { digits: 1, color: '#3ddc84' } },
          { kind: 'label', x: 620, y: 165, w: 140, h: 24, props: { text: 'numer fazy', align: 'center', size: 11 } },
          { kind: 'bar', x: 620, y: 200, w: 90, h: 160, bind: { in: 'CzasFazy' }, props: { min: 0, max: 4000, unit: 'ms', color: '#4c9aff' } },
        ]),
      },
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'conveyor-sort',
    name: 'Przenośnik z sortowaniem',
    category: 'Sekwencje',
    glyph: '📦',
    description:
      'Taśma transportowa z fotokomórką zliczającą detale, wypychaczem pneumatycznym sterowanym ' +
      'na podstawie czujnika jakości i licznikiem produkcji z resetem zmianowym.',
    build: () => project({
      name: 'Przenośnik z sortowaniem',
      description: 'Zliczanie detali i wypychanie braków',
      vars: V([
        { name: 'Start', addr: '%IX0.0' },
        { name: 'Stop', addr: '%IX0.1', init: 'TRUE' },
        { name: 'Fotokomorka', addr: '%IX0.2', comment: 'Wykrycie detalu' },
        { name: 'CzujnikBraku', addr: '%IX0.3', comment: 'Detal wadliwy' },
        { name: 'Kasuj', addr: '%IX0.4', comment: 'Kasowanie liczników' },
        { name: 'Tasma', addr: '%QX0.0', comment: 'Napęd taśmy' },
        { name: 'Wypychacz', addr: '%QX0.1', comment: 'Siłownik wypychacza' },
        { name: 'LiczbaDetali', type: 'INT', comment: 'Detale ogółem' },
        { name: 'LiczbaBrakow', type: 'INT', comment: 'Detale odrzucone' },
        { name: 'PelnaPaleta', comment: 'Osiągnięto wielkość partii' },
        { name: 'Licznik', fb: 'CTU' },
        { name: 'LicznikBrakow', fb: 'CTU' },
        { name: 'T_Wypych', fb: 'TP', comment: 'Impuls wypychacza' },
      ]),
      code: `
Tasma := (Start OR Tasma) AND Stop;

(* Zliczanie wszystkich detali na fotokomórce *)
Licznik(CU := Fotokomorka, RESET := Kasuj, PV := 50);
LiczbaDetali := Licznik.CV;
PelnaPaleta := Licznik.Q;

(* Detal wadliwy — impuls na wypychacz *)
T_Wypych(IN := Fotokomorka AND CzujnikBraku, PT := T#600ms);
Wypychacz := T_Wypych.Q;

LicznikBrakow(CU := Fotokomorka AND CzujnikBraku, RESET := Kasuj, PV := 9999);
LiczbaBrakow := LicznikBrakow.CV;
`.trim(),
      screen: {
        name: 'Linia transportowa', width: 940, height: 500,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 460, h: 32, props: { text: 'Linia sortowania detali', size: 19, bold: true } },
          { kind: 'conveyor', x: 240, y: 150, w: 420, h: 110, bind: { run: 'Tasma' }, props: { label: 'T1' } },
          { kind: 'sensor', x: 430, y: 70, w: 90, h: 80, bind: { in: 'Fotokomorka' }, props: { label: 'B1', type: 'photo' } },
          { kind: 'sensor', x: 530, y: 70, w: 90, h: 80, bind: { in: 'CzujnikBraku' }, props: { label: 'B2', type: 'prox' } },
          { kind: 'cylinder', x: 660, y: 260, w: 200, h: 70, bind: { extend: 'Wypychacz' }, props: { label: 'C1' } },
          { kind: 'button', x: 40, y: 80, w: 110, h: 60, bind: { out: 'Start' }, props: { text: 'START', color: '#2f9e5b' } },
          { kind: 'button', x: 160, y: 80, w: 110, h: 60, bind: { out: 'Stop' }, props: { text: 'STOP', color: '#c0392b' } },
          { kind: 'button', x: 40, y: 150, w: 110, h: 50, bind: { out: 'Fotokomorka' }, props: { text: 'DETAL', color: '#4c9aff' } },
          { kind: 'toggle', x: 40, y: 210, w: 190, h: 44, bind: { out: 'CzujnikBraku' }, props: { text: 'Detal wadliwy' } },
          { kind: 'button', x: 40, y: 260, w: 110, h: 46, bind: { out: 'Kasuj' }, props: { text: 'KASUJ', color: '#7a8797' } },
          { kind: 'seg7', x: 250, y: 320, w: 170, h: 70, bind: { in: 'LiczbaDetali' }, props: { digits: 4, color: '#3ddc84' } },
          { kind: 'label', x: 250, y: 392, w: 170, h: 22, props: { text: 'detale ogółem', align: 'center', size: 11 } },
          { kind: 'seg7', x: 440, y: 320, w: 170, h: 70, bind: { in: 'LiczbaBrakow' }, props: { digits: 4, color: '#f4586a' } },
          { kind: 'label', x: 440, y: 392, w: 170, h: 22, props: { text: 'odrzucone', align: 'center', size: 11 } },
          { kind: 'lamp', x: 660, y: 330, w: 90, h: 90, bind: { in: 'PelnaPaleta' }, props: { color: '#f5a524', text: 'PARTIA GOTOWA' } },
        ]),
      },
      alarms: alarms([
        { variable: 'PelnaPaleta', condition: 'true', text: 'Partia 50 sztuk skompletowana', priority: 'info', ackRequired: false },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'pump-alternation',
    name: 'Przepompownia — praca naprzemienna',
    category: 'Procesy',
    glyph: '💧',
    description:
      'Dwie pompy pracujące naprzemiennie dla równomiernego zużycia, z załączeniem drugiej pompy ' +
      'przy wysokim poziomie i osobnymi licznikami motogodzin.',
    build: () => project({
      name: 'Przepompownia',
      description: 'Naprzemienna praca pomp z rezerwą',
      scanTime: 20,
      vars: V([
        { name: 'Poziom', type: 'REAL', init: '30', addr: '%IW0', comment: 'Poziom w studni [%]' },
        { name: 'Zapotrzebowanie', comment: 'Żądanie pompowania' },
        { name: 'DrugaPompa', comment: 'Żądanie pompy szczytowej' },
        { name: 'Pompa1', addr: '%QX0.0' },
        { name: 'Pompa2', addr: '%QX0.1' },
        { name: 'Przelacz', comment: 'Wymuszenie zmiany kolejności' },
        { name: 'Godziny1', type: 'REAL' },
        { name: 'Godziny2', type: 'REAL' },
        { name: 'AlarmPrzelew', comment: 'Poziom przelewowy' },
        { name: 'Sterowanie', fb: 'HYST' },
        { name: 'Rotacja', fb: 'ALTERNATE' },
        { name: 'Motogodziny1', fb: 'RUNTIME' },
        { name: 'Motogodziny2', fb: 'RUNTIME' },
      ]),
      code: `
Sterowanie(IN := Poziom, ON_LEVEL := 70.0, OFF_LEVEL := 25.0);
Zapotrzebowanie := Sterowanie.Q;
DrugaPompa := Poziom > 88.0;

Rotacja(REQ := Zapotrzebowanie, SWAP := Przelacz);
Pompa1 := Rotacja.A OR DrugaPompa;
Pompa2 := Rotacja.B OR (DrugaPompa AND Zapotrzebowanie);

Motogodziny1(RUN := Pompa1, RESET := FALSE);
Motogodziny2(RUN := Pompa2, RESET := FALSE);
Godziny1 := Motogodziny1.HOURS;
Godziny2 := Motogodziny2.HOURS;

AlarmPrzelew := Poziom > 95.0;

(* Model dopływu i wypompowywania *)
IF Pompa1 AND Pompa2 THEN
  Poziom := Poziom - 0.22;
ELSIF Pompa1 OR Pompa2 THEN
  Poziom := Poziom - 0.12;
ELSE
  Poziom := Poziom + 0.06;
END_IF;
Poziom := LIMIT(0.0, Poziom, 100.0);
`.trim(),
      screen: {
        name: 'Przepompownia', width: 900, height: 520,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 460, h: 32, props: { text: 'Przepompownia ścieków', size: 19, bold: true } },
          { kind: 'tank', x: 60, y: 70, w: 200, h: 290, bind: { level: 'Poziom', alarmHi: 'AlarmPrzelew' }, props: { label: 'Studnia', color: '#5a7f5a' } },
          { kind: 'pump', x: 320, y: 110, w: 120, h: 120, bind: { run: 'Pompa1' }, props: { label: 'P1' } },
          { kind: 'pump', x: 320, y: 250, w: 120, h: 120, bind: { run: 'Pompa2' }, props: { label: 'P2' } },
          { kind: 'pipe', x: 265, y: 155, w: 60, h: 30, bind: { flow: 'Pompa1' }, props: {} },
          { kind: 'pipe', x: 265, y: 295, w: 60, h: 30, bind: { flow: 'Pompa2' }, props: {} },
          { kind: 'numeric', x: 470, y: 120, w: 180, h: 66, bind: { in: 'Godziny1' }, props: { label: 'Motogodziny P1', unit: 'h', decimals: 4 } },
          { kind: 'numeric', x: 470, y: 260, w: 180, h: 66, bind: { in: 'Godziny2' }, props: { label: 'Motogodziny P2', unit: 'h', decimals: 4 } },
          { kind: 'button', x: 680, y: 120, w: 150, h: 60, bind: { out: 'Przelacz' }, props: { text: 'ZAMIEŃ', color: '#4c9aff' } },
          { kind: 'lamp', x: 680, y: 200, w: 90, h: 96, bind: { in: 'AlarmPrzelew' }, props: { color: '#f4586a', text: 'PRZELEW', blink: true } },
          { kind: 'trend', x: 60, y: 380, w: 780, h: 120, bind: { in: 'Poziom' }, props: { label: 'Poziom w studni', min: 0, max: 100, points: 240 } },
        ]),
      },
      alarms: alarms([
        { variable: 'Poziom', condition: '>', limit: 95, text: 'Poziom przelewowy w studni', priority: 'critical', ackRequired: true },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'batch-mixer',
    name: 'Mieszalnik wsadowy',
    category: 'Sekwencje',
    glyph: '🧪',
    description:
      'Sekwencja wsadowa: dozowanie dwóch składników, mieszanie przez zadany czas, opróżnianie ' +
      'i powrót do stanu gotowości. Klasyczny automat krokowy z kontrolą warunków przejścia.',
    build: () => project({
      name: 'Mieszalnik wsadowy',
      description: 'Automat krokowy procesu wsadowego',
      scanTime: 20,
      vars: V([
        { name: 'StartCyklu', comment: 'Rozpoczęcie wsadu' },
        { name: 'Zatrzymaj', comment: 'Przerwanie cyklu' },
        { name: 'Krok', type: 'INT', init: '0', comment: '0 gotowość, 1 skł.A, 2 skł.B, 3 mieszanie, 4 spust' },
        { name: 'ZaworA', addr: '%QX0.0' },
        { name: 'ZaworB', addr: '%QX0.1' },
        { name: 'ZaworSpust', addr: '%QX0.2' },
        { name: 'Mieszadlo', addr: '%QX0.3' },
        { name: 'Masa', type: 'REAL', init: '0', comment: 'Masa w zbiorniku [kg]' },
        { name: 'ZadanaA', type: 'REAL', init: '40', comment: 'Dawka składnika A [kg]' },
        { name: 'ZadanaB', type: 'REAL', init: '70', comment: 'Masa łączna po dodaniu B [kg]' },
        { name: 'CzasMieszania', type: 'TIME' },
        { name: 'CyklGotowy', comment: 'Wsad zakończony' },
        { name: 'T_Mieszanie', fb: 'TON' },
        { name: 'LicznikWsadow', fb: 'CTU' },
        { name: 'LiczbaWsadow', type: 'INT' },
      ]),
      code: `
IF Zatrzymaj THEN
  Krok := 0;
END_IF;

CASE Krok OF
  0:
    IF StartCyklu THEN
      Krok := 1;
    END_IF;
  1:
    IF Masa >= ZadanaA THEN
      Krok := 2;
    END_IF;
  2:
    IF Masa >= ZadanaB THEN
      Krok := 3;
    END_IF;
  3:
    IF T_Mieszanie.Q THEN
      Krok := 4;
    END_IF;
  4:
    IF Masa <= 0.5 THEN
      Krok := 0;
    END_IF;
END_CASE;

ZaworA := Krok = 1;
ZaworB := Krok = 2;
Mieszadlo := Krok = 3;
ZaworSpust := Krok = 4;

T_Mieszanie(IN := Krok = 3, PT := T#8s);
CzasMieszania := T_Mieszanie.ET;
CyklGotowy := T_Mieszanie.Q;

LicznikWsadow(CU := Krok = 4 AND Masa <= 0.5, RESET := FALSE, PV := 999);
LiczbaWsadow := LicznikWsadow.CV;

(* Model napełniania i opróżniania *)
IF ZaworA OR ZaworB THEN
  Masa := Masa + 0.5;
ELSIF ZaworSpust THEN
  Masa := Masa - 1.2;
END_IF;
Masa := LIMIT(0.0, Masa, 120.0);
`.trim(),
      screen: {
        name: 'Mieszalnik', width: 940, height: 520,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 460, h: 32, props: { text: 'Węzeł mieszania wsadowego', size: 19, bold: true } },
          { kind: 'silo', x: 300, y: 60, w: 100, h: 120, bind: {}, props: { label: 'Skł. A', color: '#c98b3f' } },
          { kind: 'silo', x: 430, y: 60, w: 100, h: 120, bind: {}, props: { label: 'Skł. B', color: '#7f9fc9' } },
          { kind: 'valve', x: 300, y: 185, w: 100, h: 70, bind: { open: 'ZaworA' }, props: { label: 'V-A' } },
          { kind: 'valve', x: 430, y: 185, w: 100, h: 70, bind: { open: 'ZaworB' }, props: { label: 'V-B' } },
          { kind: 'tank', x: 340, y: 255, w: 160, h: 190, bind: { level: 'Masa' }, props: { label: 'Mieszalnik', min: 0, max: 120, unit: 'kg', color: '#8b6f47' } },
          { kind: 'motor', x: 520, y: 270, w: 110, h: 110, bind: { run: 'Mieszadlo' }, props: { label: 'MIX' } },
          { kind: 'valve', x: 350, y: 450, w: 100, h: 60, bind: { open: 'ZaworSpust' }, props: { label: 'V-S' } },
          { kind: 'button', x: 40, y: 80, w: 130, h: 60, bind: { out: 'StartCyklu' }, props: { text: 'START', color: '#2f9e5b' } },
          { kind: 'button', x: 40, y: 150, w: 130, h: 60, bind: { out: 'Zatrzymaj' }, props: { text: 'PRZERWIJ', color: '#c0392b' } },
          { kind: 'input', x: 40, y: 220, w: 150, h: 60, bind: { out: 'ZadanaA' }, props: { label: 'Dawka A', unit: 'kg', decimals: 1 } },
          { kind: 'input', x: 40, y: 290, w: 150, h: 60, bind: { out: 'ZadanaB' }, props: { label: 'Suma A+B', unit: 'kg', decimals: 1 } },
          { kind: 'seg7', x: 40, y: 360, w: 150, h: 64, bind: { in: 'Krok' }, props: { digits: 1, color: '#4c9aff' } },
          { kind: 'label', x: 40, y: 426, w: 150, h: 22, props: { text: 'krok sekwencji', align: 'center', size: 11 } },
          { kind: 'bar', x: 660, y: 90, w: 80, h: 180, bind: { in: 'CzasMieszania' }, props: { min: 0, max: 8000, unit: 'ms', color: '#3ddc84' } },
          { kind: 'numeric', x: 760, y: 90, w: 160, h: 66, bind: { in: 'LiczbaWsadow' }, props: { label: 'Wykonane wsady', unit: 'szt', decimals: 0 } },
          { kind: 'alarms', x: 660, y: 300, w: 260, h: 150, props: {} },
        ]),
      },
      alarms: alarms([
        { variable: 'Masa', condition: '>', limit: 110, text: 'Przepełnienie mieszalnika', priority: 'critical', ackRequired: true },
      ]),
    }),
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'gate',
    name: 'Brama automatyczna',
    category: 'Sekwencje',
    glyph: '🚪',
    description:
      'Sterowanie bramą przesuwną: otwieranie, zamykanie, krańcówki, fotokomórka bezpieczeństwa ' +
      'i automatyczne zamykanie po zadanym czasie.',
    build: () => project({
      name: 'Brama automatyczna',
      description: 'Napęd bramy z blokadami bezpieczeństwa',
      scanTime: 20,
      vars: V([
        { name: 'PrzyciskOtworz', addr: '%IX0.0' },
        { name: 'PrzyciskZamknij', addr: '%IX0.1' },
        { name: 'Fotokomorka', addr: '%IX0.2', comment: 'Przeszkoda w świetle bramy' },
        { name: 'KrancowkaOtw', addr: '%IX0.3' },
        { name: 'KrancowkaZam', addr: '%IX0.4' },
        { name: 'Otwieranie', addr: '%QX0.0' },
        { name: 'Zamykanie', addr: '%QX0.1' },
        { name: 'Lampa', addr: '%QX0.2', comment: 'Lampa ostrzegawcza' },
        { name: 'Pozycja', type: 'REAL', init: '0', comment: 'Położenie bramy [%]' },
        { name: 'CzasOtwarcia', type: 'TIME' },
        { name: 'T_AutoZamk', fb: 'TON' },
        { name: 'Migacz', fb: 'BLINK' },
      ]),
      code: `
KrancowkaOtw := Pozycja >= 99.0;
KrancowkaZam := Pozycja <= 1.0;

IF PrzyciskOtworz THEN
  Otwieranie := TRUE;
  Zamykanie := FALSE;
END_IF;
IF PrzyciskZamknij AND NOT Fotokomorka THEN
  Zamykanie := TRUE;
  Otwieranie := FALSE;
END_IF;
IF KrancowkaOtw THEN
  Otwieranie := FALSE;
END_IF;
IF KrancowkaZam OR Fotokomorka THEN
  Zamykanie := FALSE;
END_IF;

(* Automatyczne zamykanie po 6 s postoju w pozycji otwartej *)
T_AutoZamk(IN := KrancowkaOtw AND NOT Fotokomorka, PT := T#6s);
CzasOtwarcia := T_AutoZamk.ET;
IF T_AutoZamk.Q THEN
  Zamykanie := TRUE;
END_IF;

Migacz(EN := Otwieranie OR Zamykanie, T_ON := T#300ms, T_OFF := T#300ms);
Lampa := Migacz.Q;

IF Otwieranie THEN
  Pozycja := Pozycja + 0.6;
END_IF;
IF Zamykanie THEN
  Pozycja := Pozycja - 0.6;
END_IF;
Pozycja := LIMIT(0.0, Pozycja, 100.0);
`.trim(),
      screen: {
        name: 'Brama', width: 820, height: 460,
        widgets: widgets([
          { kind: 'label', x: 30, y: 16, w: 400, h: 32, props: { text: 'Brama przesuwna', size: 19, bold: true } },
          { kind: 'button', x: 40, y: 80, w: 130, h: 60, bind: { out: 'PrzyciskOtworz' }, props: { text: 'OTWÓRZ', color: '#2f9e5b' } },
          { kind: 'button', x: 40, y: 150, w: 130, h: 60, bind: { out: 'PrzyciskZamknij' }, props: { text: 'ZAMKNIJ', color: '#4c9aff' } },
          { kind: 'toggle', x: 40, y: 220, w: 210, h: 44, bind: { out: 'Fotokomorka' }, props: { text: 'Przeszkoda w bramie' } },
          { kind: 'cylinder', x: 300, y: 110, w: 300, h: 90, bind: { pos: 'Pozycja' }, props: { label: 'Brama' } },
          { kind: 'bar', x: 300, y: 220, w: 300, h: 60, bind: { in: 'Pozycja' }, props: { min: 0, max: 100, unit: '%', horizontal: true, color: '#4c9aff' } },
          { kind: 'lamp', x: 640, y: 90, w: 80, h: 90, bind: { in: 'Lampa' }, props: { color: '#f5a524', text: 'RUCH' } },
          { kind: 'lamp', x: 730, y: 90, w: 80, h: 90, bind: { in: 'KrancowkaOtw' }, props: { color: '#3ddc84', text: 'OTWARTA' } },
          { kind: 'lamp', x: 640, y: 190, w: 80, h: 90, bind: { in: 'KrancowkaZam' }, props: { color: '#4c9aff', text: 'ZAMKNIĘTA' } },
          { kind: 'numeric', x: 300, y: 300, w: 200, h: 66, bind: { in: 'CzasOtwarcia' }, props: { label: 'Do autozamknięcia', unit: 'ms', decimals: 0 } },
        ]),
      },
    }),
  },
]

export const TEMPLATE_CATEGORIES = Array.from(new Set(TEMPLATES.map((t) => t.category)))
