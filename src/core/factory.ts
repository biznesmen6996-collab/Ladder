import type { DataType, HmiScreen, Pou, Project, Variable } from './types'
import { makeRung, uid } from './grid'

export function makeVariable(partial: Partial<Variable> & { name: string }): Variable {
  return {
    id: uid('var'),
    type: 'BOOL' as DataType,
    varClass: 'VAR',
    ...partial,
  }
}

export function makePou(partial: Partial<Pou> & { name: string }): Pou {
  return {
    id: uid('pou'),
    kind: 'PROGRAM',
    language: 'LD',
    vars: [],
    rungs: [makeRung()],
    fbd: { nodes: [], links: [] },
    st: '',
    ...partial,
  }
}

export function makeScreen(partial: Partial<HmiScreen> = {}): HmiScreen {
  return {
    id: uid('scr'),
    name: 'Ekran 1',
    width: 1280,
    height: 720,
    widgets: [],
    ...partial,
  }
}

export function emptyProject(name = 'Nowy projekt'): Project {
  const main = makePou({ name: 'Main' })
  return {
    id: uid('proj'),
    name,
    description: '',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
    globals: [],
    pous: [main],
    tasks: [{ id: uid('task'), name: 'MainTask', interval: 10, priority: 1, programs: ['Main'], enabled: true }],
    hmi: [makeScreen()],
    alarms: [],
    io: [],
    library: [],
    config: { scanTime: 10, vendor: 'Generic', plcModel: 'IEC 61131-3 Soft PLC' },
  }
}
