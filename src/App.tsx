import { useEffect, useMemo } from 'react'
import { useStore, initRuntime, type ViewId } from './state/store'
import { bus } from './state/runtime'
import { importJson } from './core/importers'
import { exportJson } from './core/exporters'
import { Icon } from './ui/common'
import { Sidebar } from './ui/Sidebar'
import { LadderEditor } from './ui/LadderEditor'
import { LadderInspector } from './ui/LadderInspector'
import { CodeEditor } from './ui/CodeEditor'
import { FbdEditor } from './ui/FbdEditor'
import { VariableTable } from './ui/VariableTable'
import { HmiView } from './ui/HmiView'
import { SimPanel, SimToolbar } from './ui/SimPanel'
import { AlarmsPanel, ExportPanel, IoPanel, LibraryPanel, SettingsPanel, TemplatesPanel } from './ui/Panels'

const STORAGE_KEY = 'ladder-studio-project'

const TABS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'ladder', label: 'Drabinka', icon: 'ladder' },
  { id: 'fbd', label: 'Bloki', icon: 'block' },
  { id: 'code', label: 'Kod ST', icon: 'code' },
  { id: 'variables', label: 'Zmienne', icon: 'vars' },
  { id: 'hmi', label: 'HMI', icon: 'hmi' },
  { id: 'hmi-run', label: 'Panel', icon: 'play' },
]

const MOBILE_NAV: { id: ViewId; label: string; icon: string }[] = [
  { id: 'ladder', label: 'Drabinka', icon: 'ladder' },
  { id: 'code', label: 'Kod', icon: 'code' },
  { id: 'variables', label: 'Zmienne', icon: 'vars' },
  { id: 'hmi-run', label: 'Panel', icon: 'hmi' },
  { id: 'templates', label: 'Szablony', icon: 'template' },
]

/** Widoki wymagające dolnego panelu symulacji. */
const WITH_SIM: ViewId[] = ['ladder', 'fbd', 'code', 'variables', 'hmi', 'hmi-run']

export default function App() {
  const view = useStore((s) => s.view)
  const theme = useStore((s) => s.theme)
  const satellite = useStore((s) => s.satellite)
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const inspectorOpen = useStore((s) => s.inspectorOpen)
  const toasts = useStore((s) => s.toasts)
  const project = useStore((s) => s.project)
  const st = useStore()

  const params = useMemo(() => new URLSearchParams(location.search), [])
  const satelliteView = params.get('view') as ViewId | null

  /* --------- inicjalizacja: tryb okna satelickiego lub głównego ------- */
  useEffect(() => {
    const isSatellite = Boolean(satelliteView)
    const off = initRuntime(isSatellite)
    if (isSatellite) {
      useStore.setState({ view: satelliteView!, satellite: true })
      bus.post({ type: 'hello' })
      const screen = params.get('screen')
      if (screen) useStore.setState({ activeScreenId: screen })
    } else {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        try { st.replaceProject(importJson(saved).project) } catch { /* uszkodzony zapis — start od nowa */ }
      }
    }
    return off
  }, [])

  /* ------------------------- motyw kolorystyczny ---------------------- */
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' ||
        (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches)
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])

  /* --------------------------- zapis lokalny -------------------------- */
  useEffect(() => {
    if (satellite) return
    const id = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY, exportJson(project)) } catch { /* brak miejsca */ }
    }, 800)
    return () => clearTimeout(id)
  }, [project, satellite])

  /* ------------------------- skróty klawiszowe ------------------------ */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); st.undo() }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); st.redo() }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveProject(project.name, exportJson(project)); st.toast('Zapisano plik projektu', 'ok') }
      else if (!inField && e.key === 'F5') { e.preventDefault(); useStore.getState().running ? st.simStop() : st.simStart() }
      else if (!inField && e.key === 'F10') { e.preventDefault(); st.simStepRung() }
      else if (!inField && e.key === 'F11') { e.preventDefault(); st.simStepScan() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [project, st])

  const showSim = WITH_SIM.includes(view)
  const showInspector = inspectorOpen && !satellite && (view === 'ladder')

  return (
    <div className="app">
      <header className="topbar">
        {!satellite && (
          <button className="ghost icon" onClick={st.toggleSidebar} title="Pokaż/ukryj panel projektu">
            <Icon name="menu" />
          </button>
        )}
        <div className="brand">
          <svg viewBox="0 0 64 64" aria-hidden>
            <g stroke="var(--accent)" strokeWidth="4" fill="none" strokeLinecap="round">
              <path d="M10 8v48M54 8v48" />
              <path d="M10 22h14M32 22h22M10 42h14M32 42h22" />
              <path d="M24 15v14M28 15v14" />
            </g>
            <circle cx="43" cy="42" r="8" fill="none" stroke="var(--accent)" strokeWidth="4" />
          </svg>
          <span>Ladder Studio</span>
          <span className="brand-sub">{satellite ? '• okno zewnętrzne' : `• ${project.name}`}</span>
        </div>

        <div className="spacer" />

        {!satellite && (
          <>
            <button className="ghost icon" onClick={st.undo} title="Cofnij (Ctrl+Z)"><Icon name="undo" /></button>
            <button className="ghost icon" onClick={st.redo} title="Ponów (Ctrl+Y)"><Icon name="redo" /></button>
            <button className="ghost icon" title="Zapisz projekt do pliku (Ctrl+S)"
              onClick={() => { saveProject(project.name, exportJson(project)); st.toast('Zapisano plik projektu', 'ok') }}>
              <Icon name="save" />
            </button>
            <button className="ghost icon" title="Nowy projekt" onClick={() => st.newProject()}><Icon name="plus" /></button>
          </>
        )}
        <button className="ghost icon" title="Zmień motyw"
          onClick={() => st.setTheme(theme === 'dark' ? 'light' : 'dark')}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        {!satellite && view === 'ladder' && (
          <button className="ghost icon" onClick={st.toggleInspector} title="Pokaż/ukryj paletę">
            <Icon name="block" />
          </button>
        )}
      </header>

      <div className="workspace">
        {!satellite && (
          <>
            <aside className={`sidebar${sidebarOpen ? '' : ' hidden'}`}><Sidebar /></aside>
            {(sidebarOpen || showInspector) && (
              <div className="drawer-backdrop"
                onClick={() => { if (sidebarOpen) st.toggleSidebar(); else st.toggleInspector() }} />
            )}
          </>
        )}

        <main className="main-col">
          {!satellite && (
            <div className="tabbar">
              {TABS.map((t) => (
                <button key={t.id} className={`tab${view === t.id ? ' sel' : ''}`} onClick={() => st.setView(t.id)}>
                  <Icon name={t.icon} size={14} /> {t.label}
                </button>
              ))}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <ViewSwitch view={view} />
          </div>

          {showSim && <SimToolbar />}
          {showSim && !satellite && <SimPanel />}

          {!satellite && (
            <nav className="mobile-nav">
              {MOBILE_NAV.map((t) => (
                <button key={t.id} className={view === t.id ? 'sel' : ''} onClick={() => st.setView(t.id)}>
                  <Icon name={t.icon} size={18} />
                  {t.label}
                </button>
              ))}
            </nav>
          )}
        </main>

        {showInspector && <aside className="inspector"><LadderInspector /></aside>}
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => st.dismissToast(t.id)}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}

function ViewSwitch({ view }: { view: ViewId }) {
  switch (view) {
    case 'ladder': return <LadderEditor />
    case 'fbd': return <FbdEditor />
    case 'code': return <CodeEditor />
    case 'variables': return <VariableTable />
    case 'hmi': return <HmiView runtime={false} />
    case 'hmi-run': return <HmiView runtime />
    case 'io': return <IoPanel />
    case 'alarms': return <AlarmsPanel />
    case 'library': return <LibraryPanel />
    case 'templates': return <TemplatesPanel />
    case 'export': return <ExportPanel />
    case 'settings': return <SettingsPanel />
  }
}

function saveProject(name: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name.replace(/[^\w\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, '_')}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
