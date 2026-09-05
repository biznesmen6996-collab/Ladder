import { create } from 'zustand'
import type {
  AlarmDef, Cell, HmiScreen, HmiWidget, IoPoint, LibraryEntry, PlcValue,
  Pou, Project, Rung, Variable,
} from '../core/types'
import type { SimSnapshot } from '../core/simulator'
import { emptyProject, makePou, makeScreen, makeVariable } from '../core/factory'
import {
  addColumn, addParallelBranch, addRow, cloneRung, colCount, makeRung,
  removeColumn, removeRow, rowCount, setCell as gridSetCell, toggleLink, uid,
} from '../core/grid'
import * as rt from './runtime'
import { bus, simulator } from './runtime'

export type ViewId =
  | 'ladder' | 'fbd' | 'code' | 'variables' | 'hmi' | 'hmi-run'
  | 'io' | 'alarms' | 'library' | 'templates' | 'export' | 'settings'

export type ThemeMode = 'dark' | 'light' | 'auto'

export interface CellRef { pouId: string; rungId: string; r: number; c: number }

export interface Toast { id: string; text: string; kind: 'info' | 'ok' | 'warn' | 'error' }

interface AppState {
  project: Project
  activePouId: string
  activeScreenId: string
  view: ViewId
  selection: CellRef | null
  selectedRungId: string | null
  clipboardRung: Rung | null
  clipboardWidgets: HmiWidget[]
  selectedWidgetIds: string[]

  snapshot: SimSnapshot
  running: boolean
  speed: number
  watch: string[]

  theme: ThemeMode
  sidebarOpen: boolean
  inspectorOpen: boolean
  zoom: number
  satellite: boolean

  past: Project[]
  future: Project[]
  toasts: Toast[]
  dirty: boolean
}

interface AppActions {
  /* projekt */
  commit(fn: (p: Project) => void, label?: string): void
  replaceProject(p: Project, resetHistory?: boolean): void
  newProject(): void
  undo(): void
  redo(): void

  /* POU */
  setActivePou(id: string): void
  addPou(kind: Pou['kind'], language: Pou['language']): void
  updatePou(id: string, patch: Partial<Pou>): void
  deletePou(id: string): void

  /* drabinka */
  activePou(): Pou
  updateRung(rungId: string, fn: (r: Rung) => Rung): void
  addRung(afterId?: string): void
  deleteRung(rungId: string): void
  moveRung(rungId: string, delta: number): void
  duplicateRung(rungId: string): void
  select(ref: CellRef | null): void
  setCell(ref: CellRef, cell: Cell): void
  clearCell(ref: CellRef): void
  toggleCellLink(ref: CellRef): void
  addBranch(ref: CellRef): void
  insertColumn(ref: CellRef): void
  deleteColumn(ref: CellRef): void
  addRungRow(rungId: string): void
  deleteRungRow(rungId: string, row: number): void
  copyRung(rungId: string): void
  pasteRung(): void

  /* zmienne */
  addVariable(v: Partial<Variable> & { name: string }, pouId?: string): void
  updateVariable(id: string, patch: Partial<Variable>, pouId?: string): void
  deleteVariable(id: string, pouId?: string): void

  /* wejścia/wyjścia, alarmy, biblioteka */
  addIo(io: Partial<IoPoint>): void
  updateIo(id: string, patch: Partial<IoPoint>): void
  deleteIo(id: string): void
  addAlarm(a: Partial<AlarmDef>): void
  updateAlarm(id: string, patch: Partial<AlarmDef>): void
  deleteAlarm(id: string): void
  addLibraryEntry(e: LibraryEntry): void
  deleteLibraryEntry(id: string): void

  /* HMI */
  setActiveScreen(id: string): void
  addScreen(): void
  updateScreen(id: string, patch: Partial<HmiScreen>): void
  deleteScreen(id: string): void
  addWidget(w: HmiWidget): void
  updateWidget(id: string, patch: Partial<HmiWidget>): void
  deleteWidgets(ids: string[]): void
  selectWidgets(ids: string[]): void
  copyWidgets(): void
  pasteWidgets(): void

  /* symulacja */
  simStart(): void
  simStop(): void
  simReset(): void
  simStepScan(): void
  simStepRung(): void
  setSpeed(v: number): void
  poke(key: string, v: PlcValue): void
  toggleForce(key: string): void
  setForce(key: string, v: PlcValue): void
  toggleWatch(key: string): void
  toggleBreakpoint(rungId: string): void
  ackAlarms(): void
  applySnapshot(s: SimSnapshot, running: boolean): void

  /* interfejs */
  setView(v: ViewId): void
  setTheme(t: ThemeMode): void
  setZoom(z: number): void
  toggleSidebar(): void
  toggleInspector(): void
  toast(text: string, kind?: Toast['kind']): void
  dismissToast(id: string): void
  setSatellite(v: boolean): void
}

export type Store = AppState & AppActions

const HISTORY_LIMIT = 60

function syncSimulator(project: Project, keepValues = true) {
  simulator.setProject(project, keepValues)
  rt.markDirty()
}

const initialProject = emptyProject()

/** Na wąskich ekranach panele boczne startują zwinięte i wykluczają się wzajemnie. */
const isNarrow = () => typeof window !== 'undefined' && window.innerWidth <= 900

export const useStore = create<Store>()((set, get) => ({
  project: initialProject,
  activePouId: initialProject.pous[0].id,
  activeScreenId: initialProject.hmi[0].id,
  view: 'ladder',
  selection: null,
  selectedRungId: initialProject.pous[0].rungs[0]?.id ?? null,
  clipboardRung: null,
  clipboardWidgets: [],
  selectedWidgetIds: [],

  snapshot: simulator.snapshot(),
  running: false,
  speed: 1,
  watch: [],

  theme: 'dark',
  sidebarOpen: !isNarrow(),
  inspectorOpen: !isNarrow(),
  zoom: 1,
  satellite: false,

  past: [],
  future: [],
  toasts: [],
  dirty: false,

  /* ---------------------------------------------------------------- */

  commit(fn) {
    const { project, past } = get()
    const next: Project = structuredClone(project)
    fn(next)
    next.modifiedAt = Date.now()
    set({
      project: next,
      past: [...past.slice(-HISTORY_LIMIT + 1), project],
      future: [],
      dirty: true,
    })
    syncSimulator(next)
    bus.post({ type: 'project', project: next })
  },

  replaceProject(p, resetHistory = true) {
    const pou = p.pous.find((x) => x.kind === 'PROGRAM') ?? p.pous[0]
    set({
      project: p,
      activePouId: pou?.id ?? '',
      activeScreenId: p.hmi[0]?.id ?? '',
      selectedRungId: pou?.rungs[0]?.id ?? null,
      selection: null,
      selectedWidgetIds: [],
      past: resetHistory ? [] : get().past,
      future: [],
      dirty: false,
    })
    simulator.setProject(p, false)
    simulator.reset()
    rt.markDirty()
    bus.post({ type: 'project', project: p })
  },

  newProject() {
    get().replaceProject(emptyProject())
    get().toast('Utworzono nowy projekt', 'ok')
  },

  undo() {
    const { past, project, future } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future].slice(0, HISTORY_LIMIT) })
    syncSimulator(prev)
    bus.post({ type: 'project', project: prev })
  },

  redo() {
    const { past, project, future } = get()
    if (!future.length) return
    const next = future[0]
    set({ project: next, past: [...past, project], future: future.slice(1) })
    syncSimulator(next)
    bus.post({ type: 'project', project: next })
  },

  /* ------------------------------- POU ---------------------------- */

  activePou() {
    const { project, activePouId } = get()
    return project.pous.find((p) => p.id === activePouId) ?? project.pous[0]
  },

  setActivePou(id) {
    const pou = get().project.pous.find((p) => p.id === id)
    set({
      activePouId: id,
      selection: null,
      selectedRungId: pou?.rungs[0]?.id ?? null,
      view: pou?.language === 'ST' ? 'code' : pou?.language === 'FBD' ? 'fbd' : 'ladder',
    })
  },

  addPou(kind, language) {
    const base = kind === 'PROGRAM' ? 'Program' : kind === 'FUNCTION_BLOCK' ? 'Blok' : 'Funkcja'
    let n = 1
    const names = new Set(get().project.pous.map((p) => p.name))
    while (names.has(`${base}${n}`)) n++
    const pou = makePou({ name: `${base}${n}`, kind, language })
    get().commit((p) => {
      p.pous.push(pou)
      if (kind === 'PROGRAM') p.tasks[0]?.programs.push(pou.name)
    })
    set({ activePouId: pou.id, selectedRungId: pou.rungs[0]?.id ?? null,
      view: language === 'ST' ? 'code' : language === 'FBD' ? 'fbd' : 'ladder' })
  },

  updatePou(id, patch) {
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === id)
      if (!pou) return
      const oldName = pou.name
      Object.assign(pou, patch)
      if (patch.name && patch.name !== oldName) {
        for (const t of p.tasks) t.programs = t.programs.map((n) => (n === oldName ? patch.name! : n))
      }
    })
  },

  deletePou(id) {
    const { project } = get()
    if (project.pous.filter((p) => p.kind === 'PROGRAM').length <= 1) {
      const target = project.pous.find((p) => p.id === id)
      if (target?.kind === 'PROGRAM') { get().toast('Projekt musi zawierać co najmniej jeden program', 'warn'); return }
    }
    const name = project.pous.find((p) => p.id === id)?.name
    get().commit((p) => {
      p.pous = p.pous.filter((x) => x.id !== id)
      for (const t of p.tasks) t.programs = t.programs.filter((n) => n !== name)
    })
    if (get().activePouId === id) set({ activePouId: get().project.pous[0]?.id ?? '' })
  },

  /* ----------------------------- drabinka -------------------------- */

  updateRung(rungId, fn) {
    const pouId = get().activePouId
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === pouId)
      if (!pou) return
      const idx = pou.rungs.findIndex((r) => r.id === rungId)
      if (idx < 0) return
      pou.rungs[idx] = fn(pou.rungs[idx])
    })
  },

  addRung(afterId) {
    const pouId = get().activePouId
    const rung = makeRung()
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === pouId)
      if (!pou) return
      const idx = afterId ? pou.rungs.findIndex((r) => r.id === afterId) : pou.rungs.length - 1
      pou.rungs.splice(idx + 1, 0, rung)
    })
    set({ selectedRungId: rung.id, selection: { pouId, rungId: rung.id, r: 0, c: 0 } })
  },

  deleteRung(rungId) {
    const pouId = get().activePouId
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === pouId)
      if (!pou || pou.rungs.length <= 1) return
      pou.rungs = pou.rungs.filter((r) => r.id !== rungId)
    })
    if (get().selectedRungId === rungId) set({ selectedRungId: get().activePou().rungs[0]?.id ?? null, selection: null })
  },

  moveRung(rungId, delta) {
    const pouId = get().activePouId
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === pouId)
      if (!pou) return
      const i = pou.rungs.findIndex((r) => r.id === rungId)
      const j = i + delta
      if (i < 0 || j < 0 || j >= pou.rungs.length) return
      const [r] = pou.rungs.splice(i, 1)
      pou.rungs.splice(j, 0, r)
    })
  },

  duplicateRung(rungId) {
    const pouId = get().activePouId
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === pouId)
      if (!pou) return
      const i = pou.rungs.findIndex((r) => r.id === rungId)
      if (i < 0) return
      pou.rungs.splice(i + 1, 0, cloneRung(pou.rungs[i], true))
    })
  },

  select(ref) { set({ selection: ref, selectedRungId: ref?.rungId ?? get().selectedRungId }) },

  setCell(ref, cell) {
    get().updateRung(ref.rungId, (r) => {
      const prev = r.cells[ref.r]?.[ref.c]
      return gridSetCell(r, ref.r, ref.c, { ...cell, linkDown: cell.linkDown ?? prev?.linkDown })
    })
  },

  clearCell(ref) {
    get().updateRung(ref.rungId, (r) => {
      const prev = r.cells[ref.r]?.[ref.c]
      // w pierwszym wierszu pozostaje przewód, w gałęziach kasujemy połączenie
      const type = ref.r === 0 ? 'wire' : 'empty'
      return gridSetCell(r, ref.r, ref.c, { type, linkDown: prev?.linkDown })
    })
  },

  toggleCellLink(ref) { get().updateRung(ref.rungId, (r) => toggleLink(r, ref.r, ref.c)) },

  addBranch(ref) {
    get().updateRung(ref.rungId, (r) => addParallelBranch(r, ref.r, ref.c, ref.c))
  },

  insertColumn(ref) { get().updateRung(ref.rungId, (r) => addColumn(r, ref.c)) },

  deleteColumn(ref) {
    get().updateRung(ref.rungId, (r) => (colCount(r) > 2 ? removeColumn(r, ref.c) : r))
  },

  addRungRow(rungId) { get().updateRung(rungId, (r) => addRow(r)) },

  deleteRungRow(rungId, row) {
    get().updateRung(rungId, (r) => (rowCount(r) > 1 ? removeRow(r, row) : r))
  },

  copyRung(rungId) {
    const rung = get().activePou().rungs.find((r) => r.id === rungId)
    if (rung) { set({ clipboardRung: cloneRung(rung) }); get().toast('Skopiowano szczebel', 'ok') }
  },

  pasteRung() {
    const { clipboardRung, selectedRungId } = get()
    if (!clipboardRung) return
    const pouId = get().activePouId
    const copy = cloneRung(clipboardRung, true)
    get().commit((p) => {
      const pou = p.pous.find((x) => x.id === pouId)
      if (!pou) return
      const i = pou.rungs.findIndex((r) => r.id === selectedRungId)
      pou.rungs.splice(i < 0 ? pou.rungs.length : i + 1, 0, copy)
    })
    set({ selectedRungId: copy.id })
  },

  /* ----------------------------- zmienne --------------------------- */

  addVariable(v, pouId) {
    const variable = makeVariable(v)
    get().commit((p) => {
      if (pouId) p.pous.find((x) => x.id === pouId)?.vars.push(variable)
      else p.globals.push({ ...variable, varClass: 'VAR_GLOBAL' })
    })
  },

  updateVariable(id, patch, pouId) {
    get().commit((p) => {
      const list = pouId ? p.pous.find((x) => x.id === pouId)?.vars : p.globals
      const v = list?.find((x) => x.id === id)
      if (v) Object.assign(v, patch)
    })
  },

  deleteVariable(id, pouId) {
    get().commit((p) => {
      if (pouId) {
        const pou = p.pous.find((x) => x.id === pouId)
        if (pou) pou.vars = pou.vars.filter((v) => v.id !== id)
      } else p.globals = p.globals.filter((v) => v.id !== id)
    })
  },

  /* -------------------- wejścia/wyjścia, alarmy -------------------- */

  addIo(io) {
    get().commit((p) => p.io.push({
      id: uid('io'), address: '%IX0.0', variable: '', direction: 'IN',
      sim: 'manual', period: 1000, min: 0, max: 100, ...io,
    }))
  },
  updateIo(id, patch) {
    get().commit((p) => { const io = p.io.find((x) => x.id === id); if (io) Object.assign(io, patch) })
  },
  deleteIo(id) { get().commit((p) => { p.io = p.io.filter((x) => x.id !== id) }) },

  addAlarm(a) {
    get().commit((p) => p.alarms.push({
      id: uid('alm'), variable: '', condition: 'true', text: 'Nowy alarm',
      priority: 'warning', ackRequired: true, ...a,
    }))
  },
  updateAlarm(id, patch) {
    get().commit((p) => { const al = p.alarms.find((x) => x.id === id); if (al) Object.assign(al, patch) })
  },
  deleteAlarm(id) { get().commit((p) => { p.alarms = p.alarms.filter((x) => x.id !== id) }) },

  addLibraryEntry(e) { get().commit((p) => p.library.push(e)) },
  deleteLibraryEntry(id) { get().commit((p) => { p.library = p.library.filter((x) => x.id !== id) }) },

  /* ------------------------------- HMI ----------------------------- */

  setActiveScreen(id) { set({ activeScreenId: id, selectedWidgetIds: [] }) },

  addScreen() {
    const scr = makeScreen({ name: `Ekran ${get().project.hmi.length + 1}` })
    get().commit((p) => p.hmi.push(scr))
    set({ activeScreenId: scr.id })
  },

  updateScreen(id, patch) {
    get().commit((p) => { const s = p.hmi.find((x) => x.id === id); if (s) Object.assign(s, patch) })
  },

  deleteScreen(id) {
    if (get().project.hmi.length <= 1) { get().toast('Musi pozostać co najmniej jeden ekran', 'warn'); return }
    get().commit((p) => { p.hmi = p.hmi.filter((x) => x.id !== id) })
    set({ activeScreenId: get().project.hmi[0].id })
  },

  addWidget(w) {
    const screenId = get().activeScreenId
    get().commit((p) => p.hmi.find((s) => s.id === screenId)?.widgets.push(w))
    set({ selectedWidgetIds: [w.id] })
  },

  updateWidget(id, patch) {
    const screenId = get().activeScreenId
    get().commit((p) => {
      const w = p.hmi.find((s) => s.id === screenId)?.widgets.find((x) => x.id === id)
      if (w) Object.assign(w, patch)
    })
  },

  deleteWidgets(ids) {
    const screenId = get().activeScreenId
    get().commit((p) => {
      const s = p.hmi.find((x) => x.id === screenId)
      if (s) s.widgets = s.widgets.filter((w) => !ids.includes(w.id))
    })
    set({ selectedWidgetIds: [] })
  },

  selectWidgets(ids) { set({ selectedWidgetIds: ids }) },

  copyWidgets() {
    const { project, activeScreenId, selectedWidgetIds } = get()
    const screen = project.hmi.find((s) => s.id === activeScreenId)
    const widgets = screen?.widgets.filter((w) => selectedWidgetIds.includes(w.id)) ?? []
    set({ clipboardWidgets: structuredClone(widgets) })
    if (widgets.length) get().toast(`Skopiowano ${widgets.length} element(y)`, 'ok')
  },

  pasteWidgets() {
    const { clipboardWidgets, activeScreenId } = get()
    if (!clipboardWidgets.length) return
    const copies = clipboardWidgets.map((w) => ({ ...structuredClone(w), id: uid('w'), x: w.x + 24, y: w.y + 24 }))
    get().commit((p) => p.hmi.find((s) => s.id === activeScreenId)?.widgets.push(...copies))
    set({ selectedWidgetIds: copies.map((c) => c.id) })
  },

  /* --------------------------- symulacja --------------------------- */

  simStart() {
    if (get().satellite) { bus.post({ type: 'command', name: 'start' }); return }
    rt.start(); set({ running: true })
  },
  simStop() {
    if (get().satellite) { bus.post({ type: 'command', name: 'stop' }); return }
    rt.stop(); set({ running: false })
  },
  simReset() {
    if (get().satellite) { bus.post({ type: 'command', name: 'reset' }); return }
    rt.stop(); rt.resetSim()
    set({ running: false, snapshot: simulator.snapshot() })
  },
  simStepScan() {
    if (get().satellite) { bus.post({ type: 'command', name: 'step' }); return }
    rt.stop(); rt.stepScan()
    set({ running: false, snapshot: simulator.snapshot() })
  },
  simStepRung() {
    if (get().satellite) { bus.post({ type: 'command', name: 'stepRung' }); return }
    rt.stop(); rt.stepRung()
    set({ running: false, snapshot: simulator.snapshot() })
  },

  setSpeed(v) { rt.setSpeed(v); set({ speed: v }) },

  poke(key, v) {
    if (get().satellite) { bus.post({ type: 'poke', key, value: v }); return }
    simulator.poke(key, v)
    rt.markDirty()
    set({ snapshot: simulator.snapshot() })
  },

  toggleForce(key) {
    if (simulator.isForced(key)) simulator.unforce(key)
    else simulator.force(key, simulator.readVar(key))
    set({ snapshot: simulator.snapshot() })
  },

  setForce(key, v) { simulator.force(key, v); set({ snapshot: simulator.snapshot() }) },

  toggleWatch(key) {
    const watch = get().watch.includes(key) ? get().watch.filter((k) => k !== key) : [...get().watch, key]
    simulator.setWatched(watch)
    set({ watch })
  },

  toggleBreakpoint(rungId) {
    get().updateRung(rungId, (r) => ({ ...r, breakpoint: !r.breakpoint }))
  },

  ackAlarms() { simulator.ackAllAlarms(); set({ snapshot: simulator.snapshot() }) },

  applySnapshot(s, running) { set({ snapshot: s, running }) },

  /* --------------------------- interfejs --------------------------- */

  setView(v) { set({ view: v, ...(isNarrow() ? { sidebarOpen: false, inspectorOpen: false } : {}) }) },
  setTheme(t) { set({ theme: t }); bus.post({ type: 'theme', theme: t }) },
  setZoom(z) { set({ zoom: Math.max(0.4, Math.min(2.5, z)) }) },
  toggleSidebar() {
    const open = !get().sidebarOpen
    set({ sidebarOpen: open, inspectorOpen: open && isNarrow() ? false : get().inspectorOpen })
  },
  toggleInspector() {
    const open = !get().inspectorOpen
    set({ inspectorOpen: open, sidebarOpen: open && isNarrow() ? false : get().sidebarOpen })
  },
  setSatellite(v) { set({ satellite: v }) },

  toast(text, kind = 'info') {
    const t: Toast = { id: uid('t'), text, kind }
    set({ toasts: [...get().toasts, t] })
    setTimeout(() => get().dismissToast(t.id), 4000)
  },
  dismissToast(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }) },
}))

/* ------------------------------------------------------------------ */
/* Podpięcie pętli symulacji i magistrali okien                         */
/* ------------------------------------------------------------------ */

export function initRuntime(satellite: boolean) {
  const store = useStore.getState()
  store.setSatellite(satellite)

  if (!satellite) {
    simulator.setProject(store.project, false)
    rt.setCallbacks(
      (snap, running) => useStore.getState().applySnapshot(snap, running),
      (rungId) => {
        useStore.getState().simStop()
        useStore.getState().toast(`Zatrzymano na pułapce (szczebel ${rungId.slice(-4)})`, 'warn')
      },
    )
    rt.ensureLoop()
  }

  return bus.on((m) => {
    const s = useStore.getState()
    if (satellite) {
      if (m.type === 'project') s.replaceProject(m.project, true)
      if (m.type === 'snapshot') s.applySnapshot(m.snapshot, m.running)
      if (m.type === 'theme') useStore.setState({ theme: m.theme as ThemeMode })
    } else {
      if (m.type === 'poke') s.poke(m.key, m.value)
      if (m.type === 'hello') bus.post({ type: 'project', project: s.project })
      if (m.type === 'command') {
        if (m.name === 'start') s.simStart()
        if (m.name === 'stop') s.simStop()
        if (m.name === 'reset') s.simReset()
        if (m.name === 'step') s.simStepScan()
        if (m.name === 'stepRung') s.simStepRung()
        if (m.name === 'ackAlarms') s.ackAlarms()
      }
    }
  })
}
