import { Simulator, type SimSnapshot } from '../core/simulator'
import { emptyProject } from '../core/factory'
import type { PlcValue, Project } from '../core/types'

/* ------------------------------------------------------------------ */
/* Synchronizacja między oknami (obsługa wielu monitorów)              */
/* ------------------------------------------------------------------ */

export type SyncMessage =
  | { type: 'project'; project: Project }
  | { type: 'snapshot'; snapshot: SimSnapshot; running: boolean }
  | { type: 'poke'; key: string; value: PlcValue }
  | { type: 'command'; name: 'start' | 'stop' | 'reset' | 'step' | 'stepRung' | 'ackAlarms' }
  | { type: 'hello' }
  | { type: 'theme'; theme: string }

const CHANNEL = 'ladder-studio-sync'

class Bus {
  private ch: BroadcastChannel | null = null
  private listeners = new Set<(m: SyncMessage) => void>()

  constructor() {
    if (typeof BroadcastChannel !== 'undefined') {
      this.ch = new BroadcastChannel(CHANNEL)
      this.ch.onmessage = (e) => { for (const l of this.listeners) l(e.data as SyncMessage) }
    }
  }

  post(m: SyncMessage) { this.ch?.postMessage(m) }
  on(fn: (m: SyncMessage) => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
}

export const bus = new Bus()

/* ------------------------------------------------------------------ */
/* Silnik symulacji                                                     */
/* ------------------------------------------------------------------ */

export const simulator = new Simulator(emptyProject())

export type SimStatus = 'stopped' | 'running' | 'paused'

interface LoopState {
  running: boolean
  /** mnożnik czasu rzeczywistego; Infinity = tak szybko, jak się da */
  speed: number
  lastFrame: number
  debt: number
  onUpdate: ((snapshot: SimSnapshot, running: boolean) => void) | null
  onBreakpoint: ((rungId: string) => void) | null
  frame: number | null
  lastPublish: number
}

const loop: LoopState = {
  running: false, speed: 1, lastFrame: 0, debt: 0,
  onUpdate: null, onBreakpoint: null, frame: null, lastPublish: 0,
}

/** Maksymalna liczba cykli wykonanych w jednej klatce — chroni interfejs. */
const MAX_SCANS_PER_FRAME = 2000
/** Częstotliwość odświeżania podglądu stanu (ms). */
const PUBLISH_INTERVAL = 50

function tick(now: number) {
  loop.frame = requestAnimationFrame(tick)
  if (!loop.running) { publish(now, true); return }

  const scanTime = Math.max(1, simulator.project.config.scanTime)
  const dt = Math.min(250, now - loop.lastFrame)
  loop.lastFrame = now

  let scans: number
  if (!isFinite(loop.speed)) {
    scans = MAX_SCANS_PER_FRAME
  } else {
    loop.debt += (dt * loop.speed) / scanTime
    scans = Math.min(MAX_SCANS_PER_FRAME, Math.floor(loop.debt))
    loop.debt -= scans
  }

  for (let i = 0; i < scans; i++) {
    const hit = simulator.scan()
    if (hit) {
      stop()
      loop.onBreakpoint?.(hit)
      break
    }
  }
  publish(now, false)
}

function publish(now: number, idle: boolean) {
  if (now - loop.lastPublish < PUBLISH_INTERVAL) return
  if (idle && !loop.running && !dirty) return
  loop.lastPublish = now
  dirty = false
  const snap = simulator.snapshot()
  loop.onUpdate?.(snap, loop.running)
  bus.post({ type: 'snapshot', snapshot: snap, running: loop.running })
}

let dirty = false
/** Wymusza publikację stanu przy najbliższej klatce. */
export function markDirty() { dirty = true }

export function ensureLoop() {
  if (loop.frame === null && typeof requestAnimationFrame !== 'undefined') {
    loop.lastFrame = performance.now()
    loop.frame = requestAnimationFrame(tick)
  }
}

export function start() {
  loop.running = true
  loop.lastFrame = performance.now()
  loop.debt = 0
  markDirty()
  ensureLoop()
}

export function stop() {
  loop.running = false
  markDirty()
}

export function isRunning() { return loop.running }

export function setSpeed(speed: number) { loop.speed = speed; loop.debt = 0 }
export function getSpeed() { return loop.speed }

/** Jeden pełny cykl skanowania. */
export function stepScan() {
  simulator.scan()
  markDirty()
}

/** Jeden krok = jeden szczebel drabinki (lub jedno POU w ST/FBD). */
export function stepRung() {
  simulator.stepOnce()
  markDirty()
}

export function resetSim() {
  simulator.reset()
  markDirty()
}

export function setCallbacks(
  onUpdate: (s: SimSnapshot, running: boolean) => void,
  onBreakpoint: (rungId: string) => void,
) {
  loop.onUpdate = onUpdate
  loop.onBreakpoint = onBreakpoint
}
