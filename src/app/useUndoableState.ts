import { useCallback, useRef, useState } from 'react'

const HISTORY_LIMIT = 100
const TYPING_GROUP_MS = 900

export type UndoableChange = { label: string; groupKey?: string }
type HistoryEntry<T> = { value: T; label: string }

/** Bounded, in-memory undo history for one editor document. */
export function useUndoableState<T>(initialValue: T) {
  const [value, setValue] = useState(initialValue)
  const valueRef = useRef(value)
  const past = useRef<HistoryEntry<T>[]>([])
  const future = useRef<HistoryEntry<T>[]>([])
  const lastGroup = useRef<{ key: string; label: string; at: number } | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const update = useCallback((nextValue: T | ((current: T) => T), change: UndoableChange) => {
    const next = typeof nextValue === 'function' ? (nextValue as (current: T) => T)(valueRef.current) : nextValue
    if (Object.is(next, valueRef.current)) return
    const now = Date.now()
    const grouped = change.groupKey && lastGroup.current?.key === change.groupKey && now - lastGroup.current.at < TYPING_GROUP_MS
    if (!grouped) past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), { value: valueRef.current, label: change.label }]
    lastGroup.current = change.groupKey ? { key: change.groupKey, label: change.label, at: now } : null
    future.current = []
    valueRef.current = next
    setValue(next)
    setCanUndo(past.current.length > 0)
    setCanRedo(false)
  }, [])

  const undo = useCallback((): HistoryEntry<T> | undefined => {
    const previous = past.current.pop()
    if (!previous) return undefined
    future.current = [...future.current, { value: valueRef.current, label: previous.label }]
    valueRef.current = previous.value
    setValue(previous.value)
    lastGroup.current = null
    setCanUndo(past.current.length > 0)
    setCanRedo(true)
    return previous
  }, [])

  const redo = useCallback((): HistoryEntry<T> | undefined => {
    const next = future.current.pop()
    if (!next) return undefined
    past.current = [...past.current, { value: valueRef.current, label: next.label }].slice(-HISTORY_LIMIT)
    valueRef.current = next.value
    setValue(next.value)
    lastGroup.current = null
    setCanUndo(true)
    setCanRedo(future.current.length > 0)
    return next
  }, [])

  return { value, setValue: update, undo, redo, canUndo, canRedo }
}
