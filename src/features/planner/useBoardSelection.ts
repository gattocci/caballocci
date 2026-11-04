import { useEffect, useState } from 'react'
import { reportAppError, runWithErrorReporting } from '../../app/errors'
import { usePlanner } from '../../app/store'
import { useSelection } from '../../app/useSelection'
import { statusMeta } from '../../shared/constants'
import type { ContentType, Post } from '../../shared/types'
import type { MobilePublicationState } from './BoardCardDecorations'

type UseBoardSelectionOptions = {
  allPosts: Post[]
  query: string
  activeSpace: string | null
  selectedWorkGroupId: string | null
  listFilterKey: string
  setListPage(page: number): void
  move(id: string, status: Post['status']): Promise<unknown>
}

export function useBoardSelection({ allPosts, query, activeSpace, selectedWorkGroupId, listFilterKey, setListPage, move }: UseBoardSelectionOptions) {
  const { selected, toggle, clear, set: setSelected } = useSelection()
  const [bulkScheduleAt, setBulkScheduleAt] = useState('')
  const [bulkScheduleWarning, setBulkScheduleWarning] = useState('')
  const [mobileExportBusy, setMobileExportBusy] = useState(false)
  const [mobileExportMessage, setMobileExportMessage] = useState('')
  const [mobileExportSkipped, setMobileExportSkipped] = useState<string[]>([])
  const [mobilePublicationState, setMobilePublicationState] = useState<MobilePublicationState | null>(null)

  const refreshMobilePublicationState = async () => {
    try {
      setMobilePublicationState(await window.planner.mobileSync.publicationState())
    } catch (error) {
      reportAppError(error, 'No se pudo consultar el estado de envíos al celular')
    }
  }

  useEffect(() => { void refreshMobilePublicationState() }, [])
  useEffect(() => { clear() }, [query, activeSpace, selectedWorkGroupId, clear])
  useEffect(() => { setListPage(0); clear() }, [listFilterKey, clear, setListPage])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') clear() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [clear])

  const toggleStatusSelection = (ids: string[]) => {
    const allSelected = ids.length > 0 && ids.every(id => selected.has(id))
    const next = new Set(selected)
    ids.forEach(id => allSelected ? next.delete(id) : next.add(id))
    setSelected([...next])
  }

  const bulkMove = (status: Post['status'], postIds: string[] = [...selected]) => runWithErrorReporting(async () => {
    const targets = postIds.filter(id => allPosts.some(item => item.id === id && item.status !== status))
    for (const id of targets) await move(id, status)
    if (targets.length) usePlanner.getState().groupRecentUndoActions(targets.length, `Mover ${targets.length} publicaciones a ${statusMeta[status].label}`)
    clear()
  }, 'No se pudieron actualizar las publicaciones seleccionadas')

  const bulkSchedule = (postIds: string[] = [...selected]) => {
    if (!bulkScheduleAt || !postIds.length) {
      setBulkScheduleWarning('Elige fecha y hora para programar las publicaciones seleccionadas.')
      return
    }
    const date = new Date(bulkScheduleAt)
    if (Number.isNaN(date.getTime())) {
      setBulkScheduleWarning('Elige fecha y hora para programar las publicaciones seleccionadas.')
      return
    }
    const scheduledAt = date.toISOString()
    void runWithErrorReporting(async () => {
      const targets = postIds.map(id => allPosts.find(post => post.id === id)).filter((post): post is Post => Boolean(post))
      const changed = targets.filter(post => post.scheduledAt !== scheduledAt || post.status !== 'scheduled')
      for (const post of changed) await usePlanner.getState().save({ ...post, scheduledAt, status: 'scheduled' })
      if (changed.length) usePlanner.getState().groupRecentUndoActions(changed.length, `Programar ${changed.length} publicaciones`)
      setBulkScheduleAt('')
      setBulkScheduleWarning('')
      clear()
    }, 'No se pudieron programar las publicaciones seleccionadas')
  }

  const bulkFormat = (contentType: ContentType, postIds: string[]) => runWithErrorReporting(async () => {
    const targets = postIds.map(id => allPosts.find(post => post.id === id)).filter((post): post is Post => Boolean(post))
    const changed = targets.filter(post => post.contentType !== contentType)
    for (const post of changed) await usePlanner.getState().save({ ...post, contentType })
    if (changed.length) usePlanner.getState().groupRecentUndoActions(changed.length, `Cambiar formato de ${changed.length} publicaciones`)
    clear()
  }, 'No se pudo cambiar el formato de las publicaciones seleccionadas')

  const bulkClearSchedule = (postIds: string[]) => runWithErrorReporting(async () => {
    const targets = postIds.map(id => allPosts.find(post => post.id === id)).filter((post): post is Post => Boolean(post && post.scheduledAt))
    for (const post of targets) {
      await usePlanner.getState().save({
        ...post,
        scheduledAt: null,
        ...(post.status === 'scheduled' ? { status: 'approved' as const } : {}),
      })
    }
    if (targets.length) usePlanner.getState().groupRecentUndoActions(targets.length, `Quitar fecha de ${targets.length} publicaciones`)
    clear()
  }, 'No se pudo quitar la fecha de las publicaciones seleccionadas')

  const exportSelectedToMobile = () => runWithErrorReporting(async () => {
    const postIds = [...selected].filter(id => allPosts.some(post => post.id === id))
    if (!postIds.length) return
    setMobileExportBusy(true)
    setMobileExportMessage('')
    setMobileExportSkipped([])
    try {
      const report = await window.planner.mobileSync.exportSelected(postIds)
      if (!report) return
      await refreshMobilePublicationState()
      setMobileExportMessage(`Lote ${report.batch}: ${report.publications} ${report.publications === 1 ? 'publicación' : 'publicaciones'} y ${report.destinations} ${report.destinations === 1 ? 'destino' : 'destinos'} añadidos al catálogo.`)
      if (report.missingAlbums.length) setMobileExportMessage(value => value + ` Se retiraron ${report.missingAlbums.length} referencias a carpetas ausentes.`)
      setMobileExportSkipped(report.skipped.map(item => `${item.title || item.postId}: ${item.reason}`))
    } finally {
      setMobileExportBusy(false)
    }
  }, 'No se pudo enviar la selección al celular')

  return {
    selected, toggle, clear, set: setSelected, toggleStatusSelection,
    bulkScheduleAt, setBulkScheduleAt, bulkScheduleWarning, setBulkScheduleWarning,
    mobileExportBusy, mobileExportMessage, mobileExportSkipped, mobilePublicationState,
    bulkMove, bulkSchedule, bulkFormat, bulkClearSchedule, exportSelectedToMobile,
  }
}
