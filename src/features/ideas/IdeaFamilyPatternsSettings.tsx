import { useEffect, useMemo, useRef, useState } from 'react'
import { familyPatternError, testFamilyPattern } from './idea-utils'

export function IdeaFamilyPatternsSettings() {
  const [familyPatternsText, setFamilyPatternsText] = useState(() => { try { return localStorage.getItem('caballocci.ideas.family-patterns') || '{}' } catch { return '{}' } })
  const [familyTestSource, setFamilyTestSource] = useState('')
  const [familyTestTitle, setFamilyTestTitle] = useState('')
  const [familyTestResult, setFamilyTestResult] = useState<{ ok: boolean; message: string; title?: string } | null>(null)
  const familyPatternsState = useMemo(() => {
    try {
      const parsed = JSON.parse(familyPatternsText)
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return { valid: false, message: 'Debe ser un objeto JSON con fuente y patrón.' }
      Object.entries(parsed).forEach(([source, pattern]) => { if (typeof source !== 'string' || typeof pattern !== 'string') throw new Error('Cada fuente y patrón debe ser texto.') ; new RegExp(pattern) })
      return { valid: true, message: 'Configuración válida. Se aplicará por nombre de fuente.' }
    } catch (error) { return { valid: false, message: familyPatternError(familyPatternsText) || (error instanceof Error ? error.message : 'JSON no válido.') } }
  }, [familyPatternsText])
  const familyPatternsRef = useRef<HTMLTextAreaElement>(null)
  const insertFamilyPair = (open: string, close: string) => {
    const el = familyPatternsRef.current
    const start = el?.selectionStart ?? familyPatternsText.length
    const end = el?.selectionEnd ?? start
    const selected = familyPatternsText.slice(start, end)
    setFamilyPatternsText(familyPatternsText.slice(0, start) + open + selected + close + familyPatternsText.slice(end))
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      const cursor = start + open.length + (selected ? selected.length + close.length : 0)
      el.setSelectionRange(cursor, cursor)
    })
  }
  const formatFamilyPatterns = () => {
    try { setFamilyPatternsText(JSON.stringify(JSON.parse(familyPatternsText), null, 2)) } catch { /* Invalid JSON: nothing to format. */ }
  }
  useEffect(() => { if (familyPatternsState.valid) { try { localStorage.setItem('caballocci.ideas.family-patterns', familyPatternsText) } catch { /* Optional local preference. */ } } }, [familyPatternsState.valid, familyPatternsText])
  return (
    <details className="family-pattern-advanced"><summary>Avanzado · patrones de familia por fuente</summary><div className="family-pattern-field"><span>Configuración JSON</span><div className={`family-pattern-editor ${familyPatternsState.valid ? 'valid' : 'invalid'}`}><div className="family-pattern-tools"><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertFamilyPair('[', ']')} title="Insertar corchetes">{'[ ]'}</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => insertFamilyPair('{', '}')} title="Insertar llaves">{'{ }'}</button><button type="button" onMouseDown={event => event.preventDefault()} onClick={formatFamilyPatterns} disabled={!familyPatternsState.valid} title="Dar formato al JSON">Formatear</button></div><textarea aria-label="Configuración JSON" ref={familyPatternsRef} value={familyPatternsText} onChange={event => setFamilyPatternsText(event.target.value)} placeholder={'{\n  "TikTok": "^(HOOK|CTA)\\s*:",\n  "Newsletter": "^\\[\\w+\\]"\n}'} /><span className={familyPatternsState.valid ? 'family-pattern-badge valid' : 'family-pattern-badge invalid'}>{familyPatternsState.valid ? '✓ JSON válido' : '✕ JSON inválido'}</span></div><small>La clave es el nombre exacto de la fuente.</small><small>El valor es una regex; se retira del título lo que coincida.</small>{!familyPatternsState.valid && <small className="family-pattern-status invalid">{familyPatternsState.message}</small>}</div><div className="family-pattern-tester"><strong>Probar patrón</strong><div><input value={familyTestSource} onChange={event => { setFamilyTestSource(event.target.value); setFamilyTestResult(null) }} placeholder="Fuente" /><input value={familyTestTitle} onChange={event => { setFamilyTestTitle(event.target.value); setFamilyTestResult(null) }} placeholder="Pega un título de ejemplo" /><button type="button" className="settings-button" onClick={() => setFamilyTestResult(testFamilyPattern(familyTestTitle, familyTestSource, familyPatternsText))}>Probar</button></div>{familyTestResult && <small className={familyTestResult.ok ? 'family-test-result valid' : 'family-test-result invalid'}>{familyTestResult.message}{familyTestResult.title !== undefined && <><br /><strong>{familyTestResult.title}</strong></>}</small>}</div></details>
  )
}

