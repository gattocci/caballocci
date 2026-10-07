import { useCallback, useRef, useState } from 'react'

export function useSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchor = useRef<string | null>(null)
  const toggle = useCallback((id: string, range = false, order: string[] = []) => {
    const previous = anchor.current
    setSelected(current => {
      const next = new Set(current)
      const start = previous ? order.indexOf(previous) : -1
      const end = order.indexOf(id)
      if (range && start >= 0 && end >= 0) order.slice(Math.min(start, end), Math.max(start, end) + 1).forEach(item => next.add(item))
      else if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    anchor.current = id
  }, [])
  const set = useCallback((ids: string[]) => setSelected(new Set(ids)), [])
  const clear = useCallback(() => { setSelected(new Set()); anchor.current = null }, [])
  return { selected, toggle, set, clear }
}
