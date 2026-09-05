import { useState } from 'react'
import { useStore, type ViewId } from '../state/store'
import type { Language, PouKind } from '../core/types'
import { Icon, Modal, Field } from './common'

export function Sidebar() {
  const project = useStore((s) => s.project)
  const activePouId = useStore((s) => s.activePouId)
  const st = useStore()
  const [adding, setAdding] = useState(false)
  const [kind, setKind] = useState<PouKind>('PROGRAM')
  const [lang, setLang] = useState<Language>('LD')

  const langIcon = (l: Language) => (l === 'LD' ? 'ladder' : l === 'FBD' ? 'block' : 'code')
  const viewFor = (l: Language): ViewId => (l === 'LD' ? 'ladder' : l === 'FBD' ? 'fbd' : 'code')

  return (
    <>
      <div className="panel-head">
        <Icon name="template" size={14} /> Projekt
      </div>
      <div className="panel-scroll">
        <div className="section">
          <div className="section-title">
            Jednostki programowe
            <button className="ghost icon sm" title="Dodaj POU" onClick={() => setAdding(true)}>
              <Icon name="plus" size={13} />
            </button>
          </div>
          {project.pous.map((pou) => (
            <div key={pou.id}
              className={`tree-item${pou.id === activePouId ? ' sel' : ''}`}
              onClick={() => { st.setActivePou(pou.id); st.setView(viewFor(pou.language)) }}>
              <Icon name={langIcon(pou.language)} size={14} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{pou.name}</span>
              <span className="tag">{pou.kind === 'PROGRAM' ? 'PRG' : pou.kind === 'FUNCTION_BLOCK' ? 'FB' : 'FUN'}</span>
            </div>
          ))}
        </div>

        <div className="section">
          <div className="section-title">
            Ekrany HMI
            <button className="ghost icon sm" title="Dodaj ekran" onClick={st.addScreen}><Icon name="plus" size={13} /></button>
          </div>
          {project.hmi.map((s) => (
            <div key={s.id} className="tree-item" onClick={() => { st.setActiveScreen(s.id); st.setView('hmi') }}>
              <Icon name="hmi" size={14} />
              <span>{s.name}</span>
              <span className="tag">{s.widgets.length}</span>
            </div>
          ))}
        </div>

        <div className="section">
          <div className="section-title">Konfiguracja</div>
          <NavItem view="variables" icon="vars" label="Zmienne" badge={project.globals.length} />
          <NavItem view="io" icon="io" label="Wejścia / wyjścia" badge={project.io.length} />
          <NavItem view="alarms" icon="alarm" label="Alarmy" badge={project.alarms.length} />
          <NavItem view="library" icon="lib" label="Biblioteka bloków" />
          <NavItem view="templates" icon="template" label="Szablony przemysłowe" />
          <NavItem view="export" icon="export" label="Eksport / import" />
          <NavItem view="settings" icon="gear" label="Ustawienia" />
        </div>

        <div className="hint" style={{ marginTop: 10 }}>
          <b>{project.name}</b><br />
          {project.config.vendor} • cykl {project.config.scanTime} ms
        </div>
      </div>

      {adding && (
        <Modal title="Nowa jednostka programowa" onClose={() => setAdding(false)}
          footer={
            <>
              <button onClick={() => setAdding(false)}>Anuluj</button>
              <button className="primary" onClick={() => { st.addPou(kind, lang); setAdding(false) }}>Utwórz</button>
            </>
          }>
          <Field label="Rodzaj" hint={
            kind === 'PROGRAM' ? 'Program wykonywany cyklicznie przez zadanie sterownika.'
              : kind === 'FUNCTION_BLOCK' ? 'Blok funkcyjny z własną pamięcią — używany przez instancje, np. własny timer procesu.'
                : 'Funkcja bez pamięci — zwraca wynik na podstawie samych argumentów.'}>
            <select value={kind} onChange={(e) => setKind(e.target.value as PouKind)}>
              <option value="PROGRAM">Program (PRG)</option>
              <option value="FUNCTION_BLOCK">Blok funkcyjny (FB)</option>
              <option value="FUNCTION">Funkcja (FUN)</option>
            </select>
          </Field>
          <Field label="Język" hint={
            lang === 'LD' ? 'Drabinka — schemat stykowy, najczytelniejszy dla układów logicznych.'
              : lang === 'FBD' ? 'Schemat blokowy — wygodny przy przetwarzaniu sygnałów analogowych.'
                : 'Structured Text — tekst, najlepszy do obliczeń i sekwencji.'}>
            <select value={lang} onChange={(e) => setLang(e.target.value as Language)}>
              <option value="LD">Drabinka (LD)</option>
              <option value="FBD">Schemat blokowy (FBD)</option>
              <option value="ST">Structured Text (ST)</option>
            </select>
          </Field>
        </Modal>
      )}
    </>
  )
}

function NavItem({ view, icon, label, badge }: { view: ViewId; icon: string; label: string; badge?: number }) {
  const current = useStore((s) => s.view)
  const st = useStore()
  return (
    <div className={`tree-item${current === view ? ' sel' : ''}`} onClick={() => st.setView(view)}>
      <Icon name={icon} size={14} />
      <span>{label}</span>
      {badge !== undefined && badge > 0 && <span className="tag">{badge}</span>}
    </div>
  )
}
