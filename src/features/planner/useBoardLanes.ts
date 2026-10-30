import { useEffect, useState } from 'react'
import type { BoardLane } from './BoardLanes'
import type { Post, WorkGroup } from '../../shared/types'

type UseBoardLanesOptions = {
  activeSpace: string | null
  posts: Post[]
  workGroups: WorkGroup[]
  selectedWorkGroup: WorkGroup | null
}

function readStoredList(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) || '[]') as string[] } catch { return [] }
}

export function useBoardLanes({ activeSpace, posts, workGroups, selectedWorkGroup }: UseBoardLanesOptions) {
  const lanePreferenceKey = `caballocci.board-lanes.${activeSpace || 'all'}`
  const [collapsedLanes, setCollapsedLanes] = useState<Set<string>>(() => new Set(readStoredList(`${lanePreferenceKey}.collapsed`)))
  const [laneOrder, setLaneOrder] = useState<string[]>(() => readStoredList(`${lanePreferenceKey}.order`))
  const activeGroups = workGroups.filter(group => !group.archivedAt)
  const defaultLanes: BoardLane[] = selectedWorkGroup
    ? [{ id: selectedWorkGroup.id, name: selectedWorkGroup.name, postIds: selectedWorkGroup.postIds, group: selectedWorkGroup }]
    : [{ id: '__unassigned__', name: 'Sin colección', postIds: posts.filter(post => !activeGroups.some(group => group.postIds.includes(post.id))).map(post => post.id), group: null }]
  const boardLanes = [...defaultLanes].sort((a, b) => {
    const aIndex = laneOrder.indexOf(a.id), bIndex = laneOrder.indexOf(b.id)
    if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? Number.MAX_SAFE_INTEGER : aIndex) - (bIndex < 0 ? Number.MAX_SAFE_INTEGER : bIndex)
    return a.id === '__unassigned__' ? 1 : b.id === '__unassigned__' ? -1 : a.name.localeCompare(b.name, 'es')
  })

  useEffect(() => {
    setCollapsedLanes(new Set(readStoredList(`${lanePreferenceKey}.collapsed`)))
    setLaneOrder(readStoredList(`${lanePreferenceKey}.order`))
  }, [lanePreferenceKey])

  const toggleLane = (id: string) => setCollapsedLanes(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id); else next.add(id)
    try { localStorage.setItem(`${lanePreferenceKey}.collapsed`, JSON.stringify([...next])) } catch { /* Preferences are optional. */ }
    return next
  })

  const reorderLane = (id: string, delta: number) => {
    const ids = boardLanes.map(lane => lane.id)
    const index = ids.indexOf(id), target = Math.max(0, Math.min(ids.length - 1, index + delta))
    if (index < 0 || index === target) return
    ids.splice(index, 1); ids.splice(target, 0, id)
    setLaneOrder(ids)
    try { localStorage.setItem(`${lanePreferenceKey}.order`, JSON.stringify(ids)) } catch { /* Preferences are optional. */ }
  }

  const toggleAllLanes = () => {
    const next = boardLanes.length > 0 && boardLanes.every(lane => collapsedLanes.has(lane.id))
      ? new Set<string>()
      : new Set(boardLanes.map(lane => lane.id))
    setCollapsedLanes(next)
    try { localStorage.setItem(`${lanePreferenceKey}.collapsed`, JSON.stringify([...next])) } catch { /* Preferences are optional. */ }
  }

  return { activeGroups, boardLanes, collapsedLanes, toggleLane, reorderLane, toggleAllLanes }
}
