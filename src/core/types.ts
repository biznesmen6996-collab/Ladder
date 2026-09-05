/**
 * Model danych projektu PLC — zgodny ideowo z IEC 61131-3.
 * Cały projekt jest serializowalny do JSON (zapis/odczyt, undo, sync między oknami).
 */

export type DataType =
  | 'BOOL' | 'BYTE' | 'WORD' | 'DWORD'
  | 'SINT' | 'INT' | 'DINT' | 'LINT'
  | 'USINT' | 'UINT' | 'UDINT'
  | 'REAL' | 'LREAL'
  | 'TIME' | 'STRING'

export const NUMERIC_TYPES: DataType[] = [
  'BYTE', 'WORD', 'DWORD', 'SINT', 'INT', 'DINT', 'LINT',
  'USINT', 'UINT', 'UDINT', 'REAL', 'LREAL', 'TIME',
]

export type VarClass = 'VAR' | 'VAR_INPUT' | 'VAR_OUTPUT' | 'VAR_IN_OUT' | 'VAR_GLOBAL' | 'VAR_TEMP'

/** Wartość runtime: BOOL->boolean, liczby/TIME->number(ms), STRING->string */
export type PlcValue = boolean | number | string

export interface Variable {
  id: string
  name: string
  type: DataType
  /** dla zmiennych będących instancją bloku funkcyjnego, np. "TON" */
  fbType?: string
  varClass: VarClass
  /** adres bezpośredni IEC, np. %IX0.0, %QX0.1, %MW10 */
  address?: string
  initial?: string
  retain?: boolean
  constant?: boolean
  comment?: string
  /** grupa/hierarchia w tabeli zmiennych, np. "Napędy/Przenośnik 1" */
  group?: string
}

/* ------------------------------------------------------------------ */
/* Drabinka (LD)                                                       */
/* ------------------------------------------------------------------ */

export type ContactKind = 'NO' | 'NC' | 'P' | 'N'
export type CoilKind = 'COIL' | 'COIL_NEG' | 'SET' | 'RESET' | 'PULSE_P' | 'PULSE_N'
export type CompareOp = '>' | '>=' | '<' | '<=' | '=' | '<>'

export type CellType =
  | 'empty'      // puste pole (przerwa)
  | 'wire'       // zwykły przewód poziomy
  | 'contact'    // styk
  | 'coil'       // cewka (kolumna wyjściowa)
  | 'compare'    // styk porównania [A > B]
  | 'block'      // blok funkcyjny / funkcja

export interface BlockPin {
  /** nazwa pinu wg definicji bloku, np. "PT", "IN", "Q" */
  name: string
  /** wyrażenie/zmienna podpięta do pinu (dla wejść) albo zmienna docelowa (dla wyjść) */
  expr: string
}

export interface Cell {
  type: CellType
  /** styk / cewka: nazwa zmiennej */
  operand?: string
  contactKind?: ContactKind
  coilKind?: CoilKind
  /** porównanie */
  cmpOp?: CompareOp
  cmpA?: string
  cmpB?: string
  /** blok funkcyjny */
  blockType?: string       // np. TON, CTU, ADD, albo nazwa własnego FB
  instance?: string        // nazwa instancji (dla FB ze stanem)
  pins?: BlockPin[]
  /** pionowe połączenie z wierszem poniżej, po LEWEJ stronie tej komórki */
  linkDown?: boolean
  /** negacja wejścia EN bloku */
  negEn?: boolean
  /** który pin wyjściowy bloku podaje napięcie dalej w szynie (domyślnie pierwsze wyjście BOOL) */
  enoPin?: string
  comment?: string
}

export interface Rung {
  id: string
  label?: string
  comment?: string
  enabled: boolean
  /** siatka [wiersz][kolumna] */
  cells: Cell[][]
  /** punkt przerwania dla debugera */
  breakpoint?: boolean
}

/* ------------------------------------------------------------------ */
/* FBD — edytor blokowy                                                */
/* ------------------------------------------------------------------ */

export interface FbdNode {
  id: string
  /** typ bloku z biblioteki, 'VAR_IN' / 'VAR_OUT' / 'CONST' dla terminali */
  kind: string
  x: number
  y: number
  /** dla terminali — nazwa zmiennej lub literał */
  operand?: string
  instance?: string
  /** negacje pinów wejściowych */
  negIn?: Record<string, boolean>
  /** stałe wpisane bezpośrednio na piny */
  literals?: Record<string, string>
}

export interface FbdLink {
  id: string
  from: { node: string; pin: string }
  to: { node: string; pin: string }
}

export interface FbdNetwork {
  nodes: FbdNode[]
  links: FbdLink[]
}

/* ------------------------------------------------------------------ */
/* POU                                                                 */
/* ------------------------------------------------------------------ */

export type PouKind = 'PROGRAM' | 'FUNCTION_BLOCK' | 'FUNCTION'
export type Language = 'LD' | 'FBD' | 'ST'

export interface Pou {
  id: string
  name: string
  kind: PouKind
  language: Language
  /** typ zwracany dla FUNCTION */
  returnType?: DataType
  vars: Variable[]
  rungs: Rung[]
  fbd: FbdNetwork
  st: string
  comment?: string
}

/* ------------------------------------------------------------------ */
/* Zadania / konfiguracja sterownika                                   */
/* ------------------------------------------------------------------ */

export interface Task {
  id: string
  name: string
  /** czas cyklu zadania w ms */
  interval: number
  priority: number
  /** nazwy POU wykonywanych w tym zadaniu */
  programs: string[]
  enabled: boolean
}

/* ------------------------------------------------------------------ */
/* HMI                                                                 */
/* ------------------------------------------------------------------ */

export type WidgetKind =
  | 'label' | 'button' | 'toggle' | 'lamp' | 'numeric' | 'input'
  | 'slider' | 'gauge' | 'bar' | 'tank' | 'motor' | 'pump' | 'valve'
  | 'conveyor' | 'pipe' | 'trend' | 'alarms' | 'seg7' | 'led-bar'
  | 'selector' | 'panel' | 'image' | 'silo' | 'cylinder' | 'heater'
  | 'sensor' | 'traffic' | 'stack-light'

export interface HmiWidget {
  id: string
  kind: WidgetKind
  x: number
  y: number
  w: number
  h: number
  rotation?: number
  /** podpięcie zmiennych: rola -> nazwa zmiennej */
  bind: Record<string, string>
  props: Record<string, unknown>
  z?: number
  locked?: boolean
}

export interface HmiScreen {
  id: string
  name: string
  width: number
  height: number
  background?: string
  widgets: HmiWidget[]
}

/* ------------------------------------------------------------------ */
/* Alarmy                                                              */
/* ------------------------------------------------------------------ */

export interface AlarmDef {
  id: string
  variable: string
  /** warunek: zmienna BOOL true / porównanie liczby */
  condition: 'true' | 'false' | '>' | '<' | '>=' | '<='
  limit?: number
  text: string
  priority: 'info' | 'warning' | 'critical'
  ackRequired: boolean
}

export interface AlarmEvent {
  id: string
  defId: string
  text: string
  priority: AlarmDef['priority']
  raisedAt: number
  clearedAt?: number
  ackAt?: number
}

/* ------------------------------------------------------------------ */
/* Symulacja I/O                                                       */
/* ------------------------------------------------------------------ */

export interface IoPoint {
  id: string
  address: string
  variable: string
  direction: 'IN' | 'OUT'
  /** generator sygnału dla wejść */
  sim?: 'manual' | 'toggle' | 'pulse' | 'ramp' | 'sine' | 'random' | 'noise'
  period?: number
  min?: number
  max?: number
}

/* ------------------------------------------------------------------ */
/* Biblioteka użytkownika                                              */
/* ------------------------------------------------------------------ */

export interface LibraryEntry {
  id: string
  name: string
  category: string
  description: string
  /** POU realizujące blok (FUNCTION_BLOCK / FUNCTION) */
  pou: Pou
  author?: string
  version?: string
  /** wbudowany (tylko do odczytu) czy własny */
  builtin?: boolean
}

/* ------------------------------------------------------------------ */
/* Projekt                                                             */
/* ------------------------------------------------------------------ */

export interface Project {
  id: string
  name: string
  description: string
  createdAt: number
  modifiedAt: number
  globals: Variable[]
  pous: Pou[]
  tasks: Task[]
  hmi: HmiScreen[]
  alarms: AlarmDef[]
  io: IoPoint[]
  library: LibraryEntry[]
  config: {
    /** docelowy czas cyklu w ms */
    scanTime: number
    vendor: string
    plcModel: string
  }
}

/* ------------------------------------------------------------------ */
/* Definicje bloków (metadane biblioteki standardowej)                 */
/* ------------------------------------------------------------------ */

export interface PinDef {
  name: string
  type: DataType | 'ANY' | 'ANY_NUM'
  /** wartość domyślna wpisywana przy wstawianiu bloku */
  default?: string
  comment?: string
}

export interface BlockDef {
  type: string
  category: string
  /** blok funkcyjny ze stanem (wymaga instancji) czy czysta funkcja */
  stateful: boolean
  inputs: PinDef[]
  outputs: PinDef[]
  description: string
  /** czy blok ma wejście EN / wyjście ENO w drabince */
  en?: boolean
}
