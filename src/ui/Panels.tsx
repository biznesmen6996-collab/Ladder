import { useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import type { AlarmDef, IoPoint, LibraryEntry } from '../core/types'
import { uid } from '../core/grid'
import { makePou, makeVariable } from '../core/factory'
import {
  exportIl, exportJson, exportMarkdown, exportPlcOpenXml, exportSt, exportTagsCsv,
} from '../core/exporters'
import { importAny } from '../core/importers'
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../data/templates'
import { COMPONENTS, COMPONENT_CATEGORIES } from '../data/components'
import { Icon, Field, Empty, Modal } from './common'
import { useVariableKeys } from './HmiView'

/* ================================================================== */
/* Wejścia / wyjścia                                                   */
/* ================================================================== */

const SIM_MODES: { v: NonNullable<IoPoint['sim']>; label: string }[] = [
  { v: 'manual', label: 'ręcznie' },
  { v: 'toggle', label: 'przełączanie' },
  { v: 'pulse', label: 'impuls' },
  { v: 'ramp', label: 'narastanie' },
  { v: 'sine', label: 'sinusoida' },
  { v: 'random', label: 'losowo' },
  { v: 'noise', label: 'szum' },
]

export function IoPanel() {
  const project = useStore((s) => s.project)
  const st = useStore()
  const vars = useVariableKeys()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span className="hint" style={{ flex: 1 }}>
          Lista punktów wejść/wyjść sterownika. Dla wejść możesz włączyć generator sygnału —
          symulator będzie zmieniał wartość automatycznie, bez klikania.
        </span>
        <button className="sm primary" onClick={() => st.addIo({})}><Icon name="plus" size={14} /> Dodaj punkt</button>
      </div>
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {project.io.length === 0 ? (
          <Empty icon="io" title="Brak zdefiniowanych wejść/wyjść"
            hint="Punkty I/O opisują fizyczne sygnały sterownika i pozwalają symulować czujniki bez podłączonego sprzętu."
            action={<button className="primary" onClick={() => st.addIo({})}><Icon name="plus" /> Dodaj punkt</button>} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 110 }}>Adres</th>
                <th style={{ width: 90 }}>Kierunek</th>
                <th style={{ minWidth: 150 }}>Zmienna</th>
                <th style={{ width: 130 }}>Symulacja</th>
                <th style={{ width: 90 }}>Okres [ms]</th>
                <th style={{ width: 80 }}>Min</th>
                <th style={{ width: 80 }}>Maks</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {project.io.map((p) => (
                <tr key={p.id}>
                  <td><input className="mono" value={p.address} onChange={(e) => st.updateIo(p.id, { address: e.target.value })} /></td>
                  <td>
                    <select value={p.direction} onChange={(e) => st.updateIo(p.id, { direction: e.target.value as 'IN' | 'OUT' })}>
                      <option value="IN">wejście</option>
                      <option value="OUT">wyjście</option>
                    </select>
                  </td>
                  <td>
                    <select value={p.variable} onChange={(e) => st.updateIo(p.id, { variable: e.target.value })}>
                      <option value="">— wybierz —</option>
                      {vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={p.sim ?? 'manual'} disabled={p.direction === 'OUT'}
                      onChange={(e) => st.updateIo(p.id, { sim: e.target.value as IoPoint['sim'] })}>
                      {SIM_MODES.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                    </select>
                  </td>
                  <td><input type="number" value={p.period ?? 1000} onChange={(e) => st.updateIo(p.id, { period: Number(e.target.value) })} /></td>
                  <td><input type="number" value={p.min ?? 0} onChange={(e) => st.updateIo(p.id, { min: Number(e.target.value) })} /></td>
                  <td><input type="number" value={p.max ?? 100} onChange={(e) => st.updateIo(p.id, { max: Number(e.target.value) })} /></td>
                  <td><button className="ghost icon sm danger" onClick={() => st.deleteIo(p.id)}><Icon name="trash" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Alarmy                                                              */
/* ================================================================== */

export function AlarmsPanel() {
  const project = useStore((s) => s.project)
  const st = useStore()
  const vars = useVariableKeys()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flex: 'none' }}>
        <span className="hint" style={{ flex: 1 }}>
          Alarm powstaje, gdy warunek jest spełniony. Historia zdarzeń pojawia się w panelu symulacji
          oraz w komponencie „Lista alarmów” na ekranie HMI.
        </span>
        <button className="sm primary" onClick={() => st.addAlarm({})}><Icon name="plus" size={14} /> Dodaj alarm</button>
      </div>
      <div style={{ overflow: 'auto', flex: 1, minHeight: 0 }}>
        {project.alarms.length === 0 ? (
          <Empty icon="alarm" title="Brak zdefiniowanych alarmów"
            hint="Alarmy informują operatora o stanach wymagających reakcji — awarii, przekroczeniu poziomu czy temperatury."
            action={<button className="primary" onClick={() => st.addAlarm({})}><Icon name="plus" /> Dodaj alarm</button>} />
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th style={{ minWidth: 150 }}>Zmienna</th>
                <th style={{ width: 130 }}>Warunek</th>
                <th style={{ width: 90 }}>Próg</th>
                <th>Treść komunikatu</th>
                <th style={{ width: 130 }}>Priorytet</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {project.alarms.map((a) => (
                <tr key={a.id}>
                  <td>
                    <select value={a.variable} onChange={(e) => st.updateAlarm(a.id, { variable: e.target.value })}>
                      <option value="">— wybierz —</option>
                      {vars.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={a.condition} onChange={(e) => st.updateAlarm(a.id, { condition: e.target.value as AlarmDef['condition'] })}>
                      <option value="true">jest TRUE</option>
                      <option value="false">jest FALSE</option>
                      <option value=">">większa niż</option>
                      <option value=">=">nie mniejsza niż</option>
                      <option value="<">mniejsza niż</option>
                      <option value="<=">nie większa niż</option>
                    </select>
                  </td>
                  <td>
                    <input type="number" value={a.limit ?? 0} disabled={a.condition === 'true' || a.condition === 'false'}
                      onChange={(e) => st.updateAlarm(a.id, { limit: Number(e.target.value) })} />
                  </td>
                  <td><input value={a.text} onChange={(e) => st.updateAlarm(a.id, { text: e.target.value })} /></td>
                  <td>
                    <select value={a.priority} onChange={(e) => st.updateAlarm(a.id, { priority: e.target.value as AlarmDef['priority'] })}>
                      <option value="info">informacja</option>
                      <option value="warning">ostrzeżenie</option>
                      <option value="critical">krytyczny</option>
                    </select>
                  </td>
                  <td><button className="ghost icon sm danger" onClick={() => st.deleteAlarm(a.id)}><Icon name="trash" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ================================================================== */
/* Biblioteka bloków własnych i komponentów                            */
/* ================================================================== */

export function LibraryPanel() {
  const project = useStore((s) => s.project)
  const st = useStore()
  const [tab, setTab] = useState<'blocks' | 'components'>('blocks')
  const fileRef = useRef<HTMLInputElement>(null)

  const userBlocks = project.pous.filter((p) => p.kind !== 'PROGRAM')

  const addBlock = () => {
    let n = 1
    while (project.pous.some((p) => p.name === `MójBlok${n}`)) n++
    const pou = makePou({
      name: `MójBlok${n}`, kind: 'FUNCTION_BLOCK', language: 'LD',
      comment: 'Własny blok funkcyjny',
      vars: [
        makeVariable({ name: 'IN', type: 'BOOL', varClass: 'VAR_INPUT', comment: 'wejście' }),
        makeVariable({ name: 'Q', type: 'BOOL', varClass: 'VAR_OUTPUT', comment: 'wyjście' }),
      ],
    })
    st.commit((p) => p.pous.push(pou))
    st.setActivePou(pou.id)
  }

  const publish = (pouId: string) => {
    const pou = project.pous.find((p) => p.id === pouId)
    if (!pou) return
    const entry: LibraryEntry = {
      id: uid('lib'), name: pou.name, category: 'Własne',
      description: pou.comment ?? 'Blok użytkownika',
      pou: structuredClone(pou), version: '1.0',
    }
    st.addLibraryEntry(entry)
    st.toast(`Dodano „${pou.name}" do biblioteki projektu`, 'ok')
  }

  const exportLibrary = () => {
    download(`biblioteka-${project.name}.json`, JSON.stringify({
      format: 'ladder-studio-library', version: 1, entries: project.library,
    }, null, 2), 'application/json')
  }

  const importLibrary = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      const entries: LibraryEntry[] = data.entries ?? []
      st.commit((p) => { p.library = [...p.library, ...entries.map((e) => ({ ...e, id: uid('lib') }))] })
      st.toast(`Zaimportowano ${entries.length} bloków`, 'ok')
    } catch (e) {
      st.toast(`Nie udało się wczytać biblioteki: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flex: 'none' }}>
        <button className={tab === 'blocks' ? 'sm active' : 'sm'} onClick={() => setTab('blocks')}>Bloki funkcyjne</button>
        <button className={tab === 'components' ? 'sm active' : 'sm'} onClick={() => setTab('components')}>Katalog aparatury</button>
        <div className="spacer" />
        {tab === 'blocks' && (
          <>
            <button className="sm" onClick={exportLibrary} disabled={!project.library.length}>
              <Icon name="export" size={14} /> Eksportuj bibliotekę
            </button>
            <button className="sm" onClick={() => fileRef.current?.click()}><Icon name="open" size={14} /> Importuj</button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importLibrary(f); e.target.value = '' }} />
            <button className="sm primary" onClick={addBlock}><Icon name="plus" size={14} /> Nowy blok</button>
          </>
        )}
      </div>

      <div style={{ overflow: 'auto', flex: 1, minHeight: 0, padding: 12 }}>
        {tab === 'blocks' ? (
          <>
            <div className="section-title">Bloki zdefiniowane w projekcie</div>
            {userBlocks.length === 0 ? (
              <div className="hint" style={{ marginBottom: 16 }}>
                Własny blok funkcyjny pozwala zamknąć powtarzalny fragment logiki (np. sterowanie jednym napędem)
                i używać go wielokrotnie jak gotowego elementu. Utwórz pierwszy blok przyciskiem „Nowy blok”.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10, marginBottom: 18 }}>
                {userBlocks.map((pou) => (
                  <div key={pou.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg-panel)' }}>
                    <div className="row">
                      <span className="mono" style={{ fontWeight: 700 }}>{pou.name}</span>
                      <span className="chip">{pou.language}</span>
                    </div>
                    <div className="hint" style={{ margin: '6px 0' }}>{pou.comment}</div>
                    <div className="small dim">
                      Wejścia: {pou.vars.filter((v) => v.varClass === 'VAR_INPUT').map((v) => v.name).join(', ') || '—'}<br />
                      Wyjścia: {pou.vars.filter((v) => v.varClass === 'VAR_OUTPUT').map((v) => v.name).join(', ') || '—'}
                    </div>
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="sm" onClick={() => st.setActivePou(pou.id)}>Edytuj</button>
                      <button className="sm" onClick={() => publish(pou.id)}>Do biblioteki</button>
                      <button className="sm danger icon" onClick={() => st.deletePou(pou.id)}><Icon name="trash" size={13} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="section-title">Biblioteka projektu</div>
            {project.library.length === 0 ? (
              <div className="hint">
                Biblioteka przechowuje gotowe bloki, które możesz przenosić między projektami przez plik JSON.
              </div>
            ) : (
              <table className="data">
                <thead><tr><th>Nazwa</th><th>Kategoria</th><th>Opis</th><th style={{ width: 120 }} /></tr></thead>
                <tbody>
                  {project.library.map((e) => (
                    <tr key={e.id}>
                      <td className="mono">{e.name}</td>
                      <td>{e.category}</td>
                      <td className="small dim">{e.description}</td>
                      <td>
                        <div className="row" style={{ gap: 2 }}>
                          <button className="sm" onClick={() => {
                            st.commit((p) => p.pous.push({ ...structuredClone(e.pou), id: uid('pou') }))
                            st.toast(`Wstawiono „${e.name}" do projektu`, 'ok')
                          }}>Wstaw</button>
                          <button className="sm danger icon" onClick={() => st.deleteLibraryEntry(e.id)}><Icon name="trash" size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <ComponentCatalog />
        )}
      </div>
    </div>
  )
}

function ComponentCatalog() {
  const st = useStore()
  const project = useStore((s) => s.project)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string>('')

  const items = useMemo(() => COMPONENTS.filter((c) =>
    (!cat || c.category === cat) &&
    (!q.trim() || c.name.toLowerCase().includes(q.toLowerCase()) || c.description.toLowerCase().includes(q.toLowerCase()))
  ), [q, cat])

  const addTags = (componentId: string) => {
    const comp = COMPONENTS.find((c) => c.id === componentId)
    if (!comp) return
    let added = 0
    st.commit((p) => {
      for (const sig of comp.signals) {
        let name = `${comp.prefix}_${sig.name}`
        let n = 1
        while (p.globals.some((v) => v.name === name)) { name = `${comp.prefix}${n}_${sig.name}`; n++ }
        p.globals.push(makeVariable({
          name, type: sig.type, varClass: 'VAR_GLOBAL',
          comment: `${comp.name} — ${sig.comment}`,
          group: comp.category,
        }))
        added++
      }
    })
    st.toast(`Dodano ${added} zmiennych dla: ${comp.name}`, 'ok')
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 10, flexWrap: 'wrap' }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Szukaj aparatu…" style={{ maxWidth: 260 }} />
        <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ maxWidth: 220 }}>
          <option value="">wszystkie kategorie</option>
          {COMPONENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="hint">Wybór aparatu tworzy komplet zmiennych z opisami — gotowych do użycia w drabince.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {items.map((c) => (
          <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 10, background: 'var(--bg-panel)' }}>
            <div className="row">
              <span style={{ fontSize: 20 }}>{c.glyph}</span>
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <span className="spacer" />
              <span className="chip mono">{c.prefix}</span>
            </div>
            <div className="hint" style={{ margin: '6px 0' }}>{c.description}</div>
            <div className="small dim" style={{ marginBottom: 8 }}>
              Sygnały: {c.signals.map((s) => `${s.name} (${s.type})`).join(', ')}
            </div>
            <button className="sm" onClick={() => addTags(c.id)}>
              <Icon name="plus" size={13} /> Dodaj zmienne do projektu
            </button>
          </div>
        ))}
      </div>
      {items.length === 0 && <div className="hint">Brak aparatów spełniających kryteria.</div>}
      <div className="hint" style={{ marginTop: 14 }}>
        W projekcie jest obecnie {project.globals.length} zmiennych globalnych.
      </div>
    </>
  )
}

/* ================================================================== */
/* Szablony                                                            */
/* ================================================================== */

export function TemplatesPanel() {
  const st = useStore()
  const [confirm, setConfirm] = useState<string | null>(null)
  const [cat, setCat] = useState('')

  const items = TEMPLATES.filter((t) => !cat || t.category === cat)
  const chosen = TEMPLATES.find((t) => t.id === confirm)

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: 14 }}>
      <div className="row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={!cat ? 'sm active' : 'sm'} onClick={() => setCat('')}>Wszystkie</button>
        {TEMPLATE_CATEGORIES.map((c) => (
          <button key={c} className={cat === c ? 'sm active' : 'sm'} onClick={() => setCat(c)}>{c}</button>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
        {items.map((t) => (
          <div key={t.id} style={{
            border: '1px solid var(--border)', borderRadius: 10, padding: 14,
            background: 'var(--bg-elev)', display: 'flex', flexDirection: 'column',
          }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span style={{ fontSize: 26 }}>{t.glyph}</span>
              <div>
                <div style={{ fontWeight: 650 }}>{t.name}</div>
                <div className="small faint">{t.category}</div>
              </div>
            </div>
            <div className="hint" style={{ flex: 1, marginBottom: 10 }}>{t.description}</div>
            <button className="primary" onClick={() => setConfirm(t.id)}>Otwórz szablon</button>
          </div>
        ))}
      </div>

      {chosen && (
        <Modal
          title={`Otworzyć szablon „${chosen.name}"?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button onClick={() => setConfirm(null)}>Anuluj</button>
              <button className="primary" onClick={() => {
                st.replaceProject(chosen.build())
                st.setView('ladder')
                setConfirm(null)
                st.toast(`Wczytano szablon „${chosen.name}"`, 'ok')
              }}>Otwórz</button>
            </>
          }
        >
          <p>Bieżący projekt zostanie zastąpiony. Jeśli chcesz go zachować, najpierw zapisz go do pliku
            w zakładce <b>Eksport</b>.</p>
          <div className="hint">{chosen.description}</div>
        </Modal>
      )}
    </div>
  )
}

/* ================================================================== */
/* Eksport i import                                                    */
/* ================================================================== */

function download(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function ExportPanel() {
  const project = useStore((s) => s.project)
  const st = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ title: string; text: string } | null>(null)

  const slug = project.name.replace(/[^\w\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]+/g, '_')

  const formats = [
    {
      id: 'plcopen', name: 'PLCopen XML', ext: 'xml', mime: 'application/xml',
      desc: 'Standard wymiany projektów IEC 61131-3 — drabinka, bloki i zmienne w postaci, którą przyjmują środowiska producentów sterowników.',
      make: () => exportPlcOpenXml(project),
    },
    {
      id: 'st', name: 'Structured Text', ext: 'st', mime: 'text/plain',
      desc: 'Kod źródłowy całego projektu w języku ST wraz z deklaracjami zmiennych i konfiguracją zadań.',
      make: () => exportSt(project),
    },
    {
      id: 'il', name: 'Lista instrukcji (IL)', ext: 'il', mime: 'text/plain',
      desc: 'Klasyczna lista instrukcji — format bliski językowi maszynowemu sterowników.',
      make: () => exportIl(project),
    },
    {
      id: 'json', name: 'Projekt Ladder Studio', ext: 'json', mime: 'application/json',
      desc: 'Pełny zapis projektu razem z ekranami HMI, alarmami i konfiguracją I/O. Ten format wczytasz z powrotem bez strat.',
      make: () => exportJson(project),
    },
    {
      id: 'csv', name: 'Lista tagów (CSV)', ext: 'csv', mime: 'text/csv',
      desc: 'Zestawienie wszystkich zmiennych z adresami i opisami — do importu w systemach SCADA lub do dokumentacji.',
      make: () => exportTagsCsv(project),
    },
    {
      id: 'md', name: 'Dokumentacja (Markdown)', ext: 'md', mime: 'text/markdown',
      desc: 'Opis programu szczebel po szczeblu, lista zmiennych i alarmów — gotowy materiał do teczki maszyny.',
      make: () => exportMarkdown(project),
    },
  ]

  const doImport = async (file: File) => {
    try {
      const text = await file.text()
      const { project: imported, warnings } = importAny(text, file.name)
      st.replaceProject(imported)
      st.toast(`Wczytano projekt „${imported.name}"`, 'ok')
      for (const w of warnings.slice(0, 3)) st.toast(w, 'warn')
    } catch (e) {
      st.toast(`Błąd importu: ${(e as Error).message}`, 'error')
    }
  }

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: 14 }}>
      <div className="section">
        <div className="section-title">Import projektu</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="primary" onClick={() => fileRef.current?.click()}>
            <Icon name="open" /> Wczytaj plik
          </button>
          <input ref={fileRef} type="file" accept=".json,.xml,.st,.txt,.plcopen" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) doImport(f); e.target.value = '' }} />
          <span className="hint">
            Obsługiwane formaty: projekt Ladder Studio (JSON), PLCopen XML oraz kod Structured Text (.st).
            Kod ST zostanie automatycznie zamieniony na drabinkę.
          </span>
        </div>
      </div>

      <div className="section">
        <div className="section-title">Eksport</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {formats.map((f) => (
            <div key={f.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, background: 'var(--bg-elev)' }}>
              <div className="row" style={{ marginBottom: 6 }}>
                <span style={{ fontWeight: 650 }}>{f.name}</span>
                <span className="chip mono">.{f.ext}</span>
              </div>
              <div className="hint" style={{ marginBottom: 10, minHeight: 52 }}>{f.desc}</div>
              <div className="row">
                <button className="sm primary" onClick={() => {
                  try { download(`${slug}.${f.ext}`, f.make(), f.mime); st.toast(`Zapisano ${f.name}`, 'ok') }
                  catch (e) { st.toast(`Błąd eksportu: ${(e as Error).message}`, 'error') }
                }}>
                  <Icon name="export" size={14} /> Pobierz
                </button>
                <button className="sm" onClick={() => {
                  try { setPreview({ title: f.name, text: f.make() }) }
                  catch (e) { st.toast(`Błąd: ${(e as Error).message}`, 'error') }
                }}>Podgląd</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {preview && (
        <Modal title={preview.title} wide onClose={() => setPreview(null)}
          footer={
            <>
              <button onClick={() => {
                navigator.clipboard?.writeText(preview.text)
                st.toast('Skopiowano do schowka', 'ok')
              }}><Icon name="copy" size={14} /> Kopiuj</button>
              <button className="primary" onClick={() => setPreview(null)}>Zamknij</button>
            </>
          }>
          <pre className="mono" style={{
            maxHeight: '60vh', overflow: 'auto', background: 'var(--bg-input)',
            padding: 12, borderRadius: 6, fontSize: 11.5, lineHeight: 1.5, margin: 0,
          }}>{preview.text}</pre>
        </Modal>
      )}
    </div>
  )
}

/* ================================================================== */
/* Ustawienia                                                          */
/* ================================================================== */

declare const __BUILD_TIME__: string
const BUILD_TIME = typeof __BUILD_TIME__ === 'string' ? __BUILD_TIME__ : 'wersja deweloperska'

/** Usuwa service workera i pamięć podręczną, po czym przeładowuje aplikację. */
async function forceUpdate() {
  try {
    const regs = await navigator.serviceWorker?.getRegistrations?.() ?? []
    await Promise.all(regs.map((r) => r.unregister()))
    const keys = await caches?.keys?.() ?? []
    await Promise.all(keys.map((k) => caches.delete(k)))
  } catch { /* brak service workera — wystarczy przeładowanie */ }
  location.reload()
}

export function SettingsPanel() {
  const project = useStore((s) => s.project)
  const theme = useStore((s) => s.theme)
  const st = useStore()

  return (
    <div style={{ overflow: 'auto', height: '100%', padding: 14, maxWidth: 720 }}>
      <div className="section">
        <div className="section-title">Projekt</div>
        <Field label="Nazwa projektu">
          <input value={project.name} onChange={(e) => st.commit((p) => { p.name = e.target.value })} />
        </Field>
        <Field label="Opis">
          <textarea rows={3} value={project.description}
            onChange={(e) => st.commit((p) => { p.description = e.target.value })} />
        </Field>
        <div className="grid2">
          <Field label="Producent sterownika">
            <input value={project.config.vendor} onChange={(e) => st.commit((p) => { p.config.vendor = e.target.value })} />
          </Field>
          <Field label="Model">
            <input value={project.config.plcModel} onChange={(e) => st.commit((p) => { p.config.plcModel = e.target.value })} />
          </Field>
        </div>
        <Field label="Czas cyklu [ms]" hint="Krok czasowy symulacji. Mniejsza wartość = dokładniejsze odwzorowanie timerów, większe obciążenie.">
          <input type="number" min={1} max={1000} value={project.config.scanTime}
            onChange={(e) => st.commit((p) => { p.config.scanTime = Math.max(1, Number(e.target.value) || 10) })} />
        </Field>
      </div>

      <div className="section">
        <div className="section-title">Zadania</div>
        {project.tasks.map((t) => (
          <div key={t.id} className="row" style={{ marginBottom: 6 }}>
            <input value={t.name} style={{ maxWidth: 160 }}
              onChange={(e) => st.commit((p) => { const x = p.tasks.find((y) => y.id === t.id); if (x) x.name = e.target.value })} />
            <input type="number" value={t.interval} style={{ maxWidth: 100 }}
              onChange={(e) => st.commit((p) => { const x = p.tasks.find((y) => y.id === t.id); if (x) x.interval = Number(e.target.value) })} />
            <span className="small dim">ms</span>
            <select multiple value={t.programs} style={{ maxWidth: 220, minHeight: 60 }}
              onChange={(e) => st.commit((p) => {
                const x = p.tasks.find((y) => y.id === t.id)
                if (x) x.programs = Array.from(e.target.selectedOptions).map((o) => o.value)
              })}>
              {project.pous.filter((p) => p.kind === 'PROGRAM').map((p) => (
                <option key={p.id} value={p.name}>{p.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="section">
        <div className="section-title">Wygląd</div>
        <Field label="Motyw">
          <select value={theme} onChange={(e) => st.setTheme(e.target.value as 'dark' | 'light' | 'auto')}>
            <option value="dark">ciemny</option>
            <option value="light">jasny</option>
            <option value="auto">jak w systemie</option>
          </select>
        </Field>
      </div>

      <div className="section">
        <div className="section-title">Wiele monitorów</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          Każdy widok możesz otworzyć w osobnym oknie i przenieść na drugi monitor.
          Okna synchronizują się na bieżąco: symulacja działa w oknie głównym, pozostałe pokazują
          jej stan i mogą wysyłać polecenia.
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {([['hmi-run', 'Panel HMI'], ['ladder', 'Drabinka'], ['code', 'Kod ST'], ['variables', 'Zmienne']] as const).map(([v, label]) => (
            <button key={v} className="sm" onClick={() => window.open(`${location.pathname}?view=${v}`, '_blank', 'width=1280,height=800')}>
              <Icon name="monitor" size={14} /> {label}
            </button>
          ))}
        </div>
      </div>

      <div className="section">
        <div className="section-title">Wersja aplikacji</div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <span className="chip mono">wydanie {BUILD_TIME}</span>
          <button className="sm" onClick={forceUpdate}>
            <Icon name="reset" size={14} /> Pobierz najnowszą wersję
          </button>
        </div>
        <div className="hint" style={{ marginTop: 6 }}>
          Aplikacja działa offline, więc trzyma swoją kopię w pamięci przeglądarki.
          Jeśli po aktualizacji widzisz stare zachowanie, użyj przycisku powyżej —
          wyczyści pamięć podręczną i przeładuje stronę.
        </div>
      </div>

      <div className="section">
        <div className="section-title">Instalacja na telefonie i komputerze</div>
        <div className="hint">
          Ladder Studio działa jako aplikacja instalowalna (PWA). W przeglądarce na komputerze użyj ikony
          instalacji w pasku adresu, na Androidzie „Dodaj do ekranu głównego”, a na iPhonie w menu
          Udostępnij wybierz „Dodaj do ekranu początkowego”. Po instalacji projekt działa również bez internetu.
        </div>
      </div>
    </div>
  )
}
