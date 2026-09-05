import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { highlightSt } from './highlight'
import { pouBodyToSt, pouToSt } from '../core/st/codegen'
import { stToLadder } from '../core/st/toladder'
import { parseSt } from '../core/st/parser'
import { Icon, Modal } from './common'

export function CodeEditor() {
  const pou = useStore((s) => s.activePou())
  const project = useStore((s) => s.project)
  const st = useStore()

  const isTextPou = pou.language === 'ST'
  const generated = useMemo(
    () => (isTextPou ? pou.st : pouToSt(pou).code),
    [pou, isTextPou],
  )
  const [text, setText] = useState(generated)
  const [confirmConvert, setConfirmConvert] = useState<null | { rungs: number; warnings: string[]; residual: string[] }>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => { setText(generated) }, [generated])

  const error = useMemo(() => {
    try { parseSt(text); return null } catch (e) { return (e as Error).message }
  }, [text])

  const lineCount = text.split('\n').length
  const tokens = useMemo(() => highlightSt(text), [text])

  const syncScroll = () => {
    if (taRef.current && preRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop
      preRef.current.scrollLeft = taRef.current.scrollLeft
    }
  }

  const save = () => {
    if (!isTextPou) { st.toast('Ten POU jest w języku graficznym — użyj konwersji na drabinkę', 'warn'); return }
    st.updatePou(pou.id, { st: text })
    st.toast('Zapisano kod', 'ok')
  }

  const convert = () => {
    const scope = [...project.globals, ...pou.vars]
    return stToLadder(text, {
      resolveInstance: (n) => scope.find((v) => v.name === n)?.fbType,
      resolveVarType: (n) => scope.find((v) => v.name === n)?.type,
    })
  }

  const toLadder = () => {
    const result = convert()
    if (!result.rungs.length) {
      st.toast(result.warnings[0] ?? 'Nie udało się zamienić kodu na drabinkę', 'error')
      return
    }
    setConfirmConvert({ rungs: result.rungs.length, warnings: result.warnings, residual: result.residual })
  }

  const applyToLadder = () => {
    const result = convert()
    st.updatePou(pou.id, { language: 'LD', rungs: result.rungs, st: text })
    st.setView('ladder')
    setConfirmConvert(null)
    st.toast(`Utworzono ${result.rungs.length} szczebli`, 'ok')
  }

  const fromLadder = () => {
    setText(pouBodyToSt(pou, [], []))
    st.toast('Wygenerowano kod z drabinki', 'ok')
  }

  const handleTab = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return
    e.preventDefault()
    const el = e.currentTarget
    const s = el.selectionStart, en = el.selectionEnd
    const next = text.slice(0, s) + '  ' + text.slice(en)
    setText(next)
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 2 })
  }

  return (
    <div className="code-wrap">
      <div className="row" style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', flex: 'none' }}>
        <span className="chip accent">{pou.name}</span>
        <span className="chip">{isTextPou ? 'edycja kodu' : 'podgląd wygenerowany z grafiki'}</span>
        {isTextPou && <button className="sm primary" onClick={save}><Icon name="save" size={14} /> Zapisz</button>}
        {!isTextPou && <button className="sm" onClick={fromLadder}><Icon name="reset" size={14} /> Odśwież z drabinki</button>}
        <button className="sm" onClick={toLadder}><Icon name="ladder" size={14} /> Zamień kod na drabinkę</button>
        <div className="spacer" />
        {error
          ? <span className="chip err" title={error}><Icon name="warn" size={12} /> {error}</span>
          : <span className="chip ok"><Icon name="check" size={12} /> składnia poprawna</span>}
      </div>

      <div className="code-area" onScroll={syncScroll}>
        <div className="code-gutter" style={{ height: '100%' }}>
          {Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <pre ref={preRef} className="code-layer" aria-hidden>
          {tokens.map((t, i) => (t.cls ? <span key={i} className={t.cls}>{t.text}</span> : t.text))}
          {'\n'}
        </pre>
        <textarea
          ref={taRef}
          className="code-layer code-input"
          value={text}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          onKeyDown={handleTab}
          onScroll={syncScroll}
          onChange={(e) => setText(e.target.value)}
          aria-label="Edytor kodu Structured Text"
        />
      </div>

      {confirmConvert && (
        <Modal
          title="Zamiana kodu na drabinkę"
          onClose={() => setConfirmConvert(null)}
          footer={
            <>
              <button onClick={() => setConfirmConvert(null)}>Anuluj</button>
              <button className="primary" onClick={applyToLadder}>Zamień na drabinkę</button>
            </>
          }
        >
          <p>Z kodu powstanie <b>{confirmConvert.rungs}</b> szczebli drabinki. Dotychczasowa zawartość graficzna POU
            „{pou.name}” zostanie zastąpiona.</p>
          {confirmConvert.warnings.length > 0 && (
            <>
              <div className="section-title">Uwagi</div>
              <ul className="hint">{confirmConvert.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </>
          )}
          {confirmConvert.residual.length > 0 && (
            <div className="hint">
              Instrukcje bez odpowiednika graficznego ({confirmConvert.residual.join(', ')}) pozostaną tylko w kodzie —
              rozważ wydzielenie ich do osobnego POU w języku ST.
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
