import { useCallback, useEffect, useState } from 'react'
import type { WorkGroup } from '../../shared/types'

const storageKey = 'caballocci.work-group-order'
const changeEvent = 'caballocci-work-group-order-change'

function readOrder(): string[] {
  try {
    const saved = localStorage.getItem(storageKey)
    if (!saved) return []
    const parsed: unknown = JSON.parse(saved)
    return Array.isArray(parsed) && parsed.every(id => typeof id === 'string') ? parsed : []
  } catch {
    return []
  }
}

export function useWorkGroupOrder() {
  const [order, setOrder] = useState(readOrder)

  useEffect(() => {
    const sync = () => setOrder(readOrder())
    window.addEventListener(changeEvent, sync)
    return () => window.removeEventListener(changeEvent, sync)
  }, [])

  const orderedGroups = useCallback((groups: WorkGroup[]) => {
    const rank = new Map(order.map((id, index) => [id, index]))
    return [...groups].sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER))
  }, [order])

  const moveGroup = useCallback((groups: WorkGroup[], draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const visibleIds = orderedGroups(groups).map(group => group.id)
    const from = visibleIds.indexOf(draggedId)
    const to = visibleIds.indexOf(targetId)
    if (from < 0 || to < 0) return

    visibleIds.splice(to, 0, visibleIds.splice(from, 1)[0])
    const nextOrder = [...order]
    for (const group of groups) if (!nextOrder.includes(group.id)) nextOrder.push(group.id)
    const visibleSet = new Set(groups.map(group => group.id))
    let visibleIndex = 0
    const reordered = nextOrder.map(id => visibleSet.has(id) ? visibleIds[visibleIndex++] : id)
    try {
      localStorage.setItem(storageKey, JSON.stringify(reordered))
    } catch {
      return
    }
    setOrder(reordered)
    window.dispatchEvent(new Event(changeEvent))
  }, [order, orderedGroups])

  return { orderedGroups, moveGroup }
}
