import { useEffect, useRef, useState } from 'react'
import { CalendarDays, Clock3, History, Minus, Plus, Trash2 } from 'lucide-react'
import { toLocalDateTimeInput } from './editor-utils'

const TIME_PRESETS = ['09:00', '12:00', '15:00', '18:00', '20:00']
const STEP_MINUTES = 15
const CTRL_STEP_MINUTES = 30

type ScheduleHistoryEntry = { id: string; scheduledAt: string; confirmedAt: string }

const pad = (n: number) => String(n).padStart(2, '0')
const toDateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c }
const nextWeekday = (from: Date, weekday: number) => addDays(from, ((weekday - from.getDay() + 7) % 7) || 7)

/** Acepta "18", "1830", "18:30", "9.15", "6pm", "6:30 pm", "18h". Devuelve "HH:mm" o null. */
export function parseTimeInput(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '').replace('.', ':').replace('h', ':').replace(/:$/, '')
  const m = s.match(/^(\d{1,2})(?::?(\d{2}))?(a|p|am|pm)?$/)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] ? Number(m[2]) : 0
  const suffix = m[3]
  if (min > 59) return null
  if (suffix) { if (h < 1 || h > 12) return null; h = (h % 12) + (suffix.startsWith('p') ? 12 : 0) }
  if (h > 23) return null
  return `${pad(h)}:${pad(min)}`
}

const formatMinutes = (total: number) => { const day = ((total % 1440) + 1440) % 1440; return `${pad(Math.floor(day / 60))}:${pad(day % 60)}` }
const toMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }

/** Mueve la hora a la siguiente (delta > 0) o anterior (delta < 0) marca de |delta| minutos.
 *  Desde una hora "suelta" se alinea: 15:37 + 15 → 15:45, 15:37 − 15 → 15:30; luego 16:00, 16:15…
 *  Da la vuelta dentro del mismo día (23:45 + 15 → 00:00). */
function shiftTime(time: string, delta: number) {
  const step = Math.abs(delta)
  const total = toMinutes(time)
  return formatMinutes(delta > 0 ? (Math.floor(total / step) + 1) * step : (Math.ceil(total / step) - 1) * step)
}

function TimeInput({ value, onCommit }: { value: string; onCommit(time: string): void }) {
  const [text, setText] = useState(value)
  const [invalid, setInvalid] = useState(false)
  const focused = useRef(false)
  // Mientras el usuario escribe no se pisa el texto (la hora "actual" se actualiza sola cada minuto).
  useEffect(() => { if (!focused.current) { setText(value); setInvalid(false) } }, [value])

  const commit = () => {
    const parsed = parseTimeInput(text)
    if (!parsed) { setInvalid(true); return }
    setInvalid(false); setText(parsed)
    if (parsed !== value) onCommit(parsed)
  }

  const isPm = Number(value.slice(0, 2)) >= 12
  return (
    <div className="time-row">
    <div className="time-stepper">
      <button type="button" aria-label={`Restar ${STEP_MINUTES} minutos; con Ctrl, ${CTRL_STEP_MINUTES}`} title={`−${STEP_MINUTES} min · Ctrl: −${CTRL_STEP_MINUTES} min`} onClick={event => onCommit(shiftTime(value, -(event.ctrlKey || event.metaKey ? CTRL_STEP_MINUTES : STEP_MINUTES)))}><Minus size={12} /></button>
      <input
        data-undo-control
        inputMode="numeric"
        autoComplete="off"
        placeholder="18:30"
        value={text}
        aria-label="Hora de publicación"
        aria-invalid={invalid}
        onFocus={event => { focused.current = true; event.currentTarget.select() }}
        onChange={event => { setText(event.target.value); setInvalid(false) }}
        onBlur={() => { focused.current = false; commit() }}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit() }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            const step = event.ctrlKey || event.metaKey ? CTRL_STEP_MINUTES : STEP_MINUTES
            const next = shiftTime(parseTimeInput(text) ?? value, event.key === 'ArrowUp' ? step : -step)
            setText(next); setInvalid(false); onCommit(next)
          }
        }}
      />
      <button type="button" aria-label={`Sumar ${STEP_MINUTES} minutos; con Ctrl, ${CTRL_STEP_MINUTES}`} title={`+${STEP_MINUTES} min · Ctrl: +${CTRL_STEP_MINUTES} min`} onClick={event => onCommit(shiftTime(value, event.ctrlKey || event.metaKey ? CTRL_STEP_MINUTES : STEP_MINUTES))}><Plus size={12} /></button>
    </div>
      <button type="button" className="time-period" aria-label={`${isPm ? 'PM' : 'AM'}: pulsa para cambiar a ${isPm ? 'AM' : 'PM'}`} title={`Cambiar a ${isPm ? 'AM' : 'PM'}`} onClick={() => onCommit(formatMinutes(toMinutes(value) + 720))}>{isPm ? 'PM' : 'AM'}</button>
    </div>
  )
}

function historyStorageKey(historyKey: string) { return `caballocci.schedule-history.${historyKey}` }

function loadHistory(historyKey: string): ScheduleHistoryEntry[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(historyStorageKey(historyKey)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.scheduledAt === 'string' && typeof item.confirmedAt === 'string') : []
  } catch { return [] }
}

export function recordScheduleHistory(historyKey: string, scheduledAt: string | null) {
  if (!scheduledAt || Number.isNaN(new Date(scheduledAt).getTime())) return false
  const current = loadHistory(historyKey)
  // Un mismo horario no se repite: si ya estaba, sube al principio con la nueva confirmación.
  const others = current.filter(item => item.scheduledAt !== scheduledAt)
  if (current[0]?.scheduledAt === scheduledAt && others.length === current.length - 1) return false
  const next = [{ id: crypto.randomUUID(), scheduledAt, confirmedAt: new Date().toISOString() }, ...others].slice(0, 20)
  try { localStorage.setItem(historyStorageKey(historyKey), JSON.stringify(next)); return true } catch { return false }
}

export function EditorSchedule({ historyKey, historyVersion, scheduledAt, onChange }: { historyKey: string; historyVersion: number; scheduledAt: string | null; onChange(date: string, time: string, label: string): void }) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<ScheduleHistoryEntry[]>(() => loadHistory(historyKey))
  const local = toLocalDateTimeInput(scheduledAt)
  const date = local.slice(0, 10)
  const hasDate = Boolean(date)
  const [, setTick] = useState(0)
  useEffect(() => {
    if (hasDate) return
    const timer = window.setInterval(() => setTick(n => n + 1), 15000)
    return () => window.clearInterval(timer)
  }, [hasDate])

  const now = new Date()
  const today = toDateKey(now)
  const tomorrow = toDateKey(addDays(now, 1))
  const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`
  // Sin programación (o tras quitarla), la hora propuesta es la hora actual del usuario.
  const time = local.slice(11, 16) || nowTime

  const quickDates = [
    { label: 'Hoy', day: now },
    { label: 'Mañana', day: addDays(now, 1) },
    { label: 'Sábado', day: nextWeekday(now, 6) },
    { label: 'Lunes', day: nextWeekday(now, 1) },
  ]
    .map(item => ({ ...item, value: toDateKey(item.day) }))
    .filter((item, index, all) => all.findIndex(other => other.value === item.value) === index)

  useEffect(() => { setHistory(loadHistory(historyKey)); setHistoryOpen(false) }, [historyKey])
  useEffect(() => { setHistory(loadHistory(historyKey)) }, [historyKey, historyVersion])

  const removeHistory = (id: string) => setHistory(current => {
    const next = current.filter(item => item.id !== id)
    try { localStorage.setItem(historyStorageKey(historyKey), JSON.stringify(next)) } catch { /* Historial opcional. */ }
    return next
  })

  const commit = (nextDate: string, nextTime: string, label: string) => {
    if (nextDate === date && nextTime === time) return
    onChange(nextDate, nextTime, label)
  }
  const applyHistory = (item: ScheduleHistoryEntry) => {
    const value = toLocalDateTimeInput(item.scheduledAt)
    if (!value) return
    commit(value.slice(0, 10), value.slice(11, 16), 'Elegir fecha de publicación')
    setHistoryOpen(false)
  }
  // Sin fecha, elegir una hora ya programa: hoy si la hora aún no pasó, si no mañana.
  const pickTime = (nextTime: string) => commit(hasDate ? date : nextTime > nowTime ? today : tomorrow, nextTime, 'Cambiar hora de publicación')

  const parsed = scheduledAt ? new Date(scheduledAt) : null
  const valid = Boolean(parsed && !Number.isNaN(parsed.getTime()))
  const isPast = valid && parsed!.getTime() < now.getTime()
  const relative = date === today ? 'Hoy · ' : date === tomorrow ? 'Mañana · ' : ''
  const summary = valid
    ? relative + new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(parsed!)
    : 'Todavía no está programada'

  return (
    <section className="schedule-field" aria-label="Programación de la publicación">
      <header>
        <span><CalendarDays size={14} /> Programación</span>
        {hasDate && <button type="button" onClick={() => commit('', time, 'Quitar fecha')}>Quitar</button>}
      </header>

      <div className="schedule-quick" role="group" aria-label="Fechas rápidas">
        <div className="schedule-quick-dates">{quickDates.map(item => (
          <button type="button" key={item.value} aria-pressed={date === item.value} title={new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(item.day)} onClick={() => commit(item.value, time, 'Elegir fecha de publicación')}>
            {item.label}
          </button>
        ))}</div>
        <button type="button" className="schedule-history-trigger" aria-expanded={historyOpen} onClick={() => setHistoryOpen(open => !open)}><History size={12} /> Historial{history.length ? ` (${history.length})` : ''}</button>
      </div>

      {historyOpen && <section className="schedule-history" aria-label="Historial de programaciones"><header><strong>Programaciones confirmadas</strong><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Cerrar historial">×</button></header>{history.length ? <ol>{history.filter(item => !Number.isNaN(new Date(item.scheduledAt).getTime())).map(item => <li key={item.id}><button type="button" className="schedule-history-apply" title="Usar esta programación" onClick={() => applyHistory(item)}>{new Intl.DateTimeFormat('es', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(item.scheduledAt))}</button><button type="button" className="schedule-history-remove" aria-label="Borrar esta programación del historial" title="Borrar del historial" onClick={() => removeHistory(item.id)}><Trash2 size={12} /></button></li>)}</ol> : <p>Aún no hay programaciones confirmadas.</p>}</section>}

      <div className="schedule-inputs">
        <label>Fecha
          <input data-undo-control type="date" lang="es-AR" value={date} onClick={event => { try { event.currentTarget.showPicker?.() } catch { /* showPicker needs a user gesture. */ } }} onChange={event => commit(event.target.value, time, event.target.value ? 'Elegir fecha de publicación' : 'Quitar fecha')} />
        </label>
        <label>Hora
          <TimeInput value={time} onCommit={pickTime} />
        </label>
      </div>

      <div className="schedule-presets" role="group" aria-label="Horas sugeridas">
        {TIME_PRESETS.map(preset => (
          <button type="button" key={preset} aria-pressed={hasDate && time === preset} onClick={() => pickTime(preset)}>{preset}</button>
        ))}
      </div>

      <p className={`schedule-summary${hasDate ? '' : ' empty'}${isPast ? ' past' : ''}`} role="status">
        <Clock3 size={13} />{summary}{isPast && ' · ya pasó'}
      </p>
    </section>
  )
}