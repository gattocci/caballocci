import { useEffect, useState } from 'react'
import { runWithErrorReporting } from '../../app/errors'
import { usePlanner } from '../../app/store'
import type { Post, WorkGroup } from '../../shared/types'

type PendingGroupAction = { type: 'archive' | 'restore' | 'delete'; group: WorkGroup }
type PendingMediaCompression = { target: 'group' | 'post'; id: string; name: string; mediaCount: number }

type UseBoardWorkGroupsOptions = {
  allPosts: Post[]
  workGroups: WorkGroup[]
  activeSpace: string | null
  selectedWorkGroup: WorkGroup | null
  selected: Set<string>
  clear(): void
}

export function useBoardWorkGroups({ allPosts, workGroups, activeSpace, selectedWorkGroup, selected, clear }: UseBoardWorkGroupsOptions) {
  const saveWorkGroup = usePlanner(state => state.saveWorkGroup)
  const setWorkGroupPosts = usePlanner(state => state.setWorkGroupPosts)
  const setWorkGroupArchived = usePlanner(state => state.setWorkGroupArchived)
  const removeWorkGroup = usePlanner(state => state.removeWorkGroup)
  const setActiveWorkGroup = usePlanner(state => state.setActiveWorkGroup)
  const [membershipTargetGroupId, setMembershipTargetGroupId] = useState('')
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [groupName, setGroupName] = useState('')
  const [groupDescription, setGroupDescription] = useState('')
  const [savingGroup, setSavingGroup] = useState(false)
  const [pendingGroupAction, setPendingGroupAction] = useState<PendingGroupAction | null>(null)
  const [groupDeleteMode, setGroupDeleteMode] = useState<'group' | 'all-posts' | 'selected-posts'>('group')
  const [groupPostsToDelete, setGroupPostsToDelete] = useState<string[]>([])
  const [pendingMediaCompression, setPendingMediaCompression] = useState<PendingMediaCompression | null>(null)
  const [workingOnGroup, setWorkingOnGroup] = useState(false)
  const [mediaCompressionMessage, setMediaCompressionMessage] = useState('')

  useEffect(() => {
    setGroupDeleteMode('group')
    setGroupPostsToDelete([])
  }, [pendingGroupAction?.group.id])

  const openGroupForm = (group?: WorkGroup | null) => {
    setEditingGroupId(group?.id || null)
    setGroupName(group?.name || '')
    setGroupDescription(group?.description || '')
    setGroupFormOpen(true)
  }

  const submitGroupForm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!groupName.trim() || savingGroup) return
    void runWithErrorReporting(async () => {
      setSavingGroup(true)
      try {
        const existingGroup = editingGroupId ? workGroups.find(item => item.id === editingGroupId) : null
        const selectedProjects = new Set([...selected].map(id => allPosts.find(post => post.id === id)?.project).filter((project): project is string => project !== undefined))
        const groupSpace = existingGroup?.space ?? activeSpace ?? (selectedProjects.size === 1 ? [...selectedProjects][0] : '')
        const group = await saveWorkGroup({
          ...(editingGroupId ? { id: editingGroupId } : {}),
          name: groupName.trim(),
          description: groupDescription.trim(),
          space: groupSpace,
        })
        if (!editingGroupId && selected.size) await setWorkGroupPosts(group.id, [...selected], { recordHistory: false })
        setActiveWorkGroup(group.id)
        setMembershipTargetGroupId(group.id)
        setGroupFormOpen(false)
        clear()
      } finally {
        setSavingGroup(false)
      }
    }, editingGroupId ? 'No se pudo actualizar la colección' : 'No se pudo crear la colección')
  }

  const updateGroupMembership = (groupId: string, add: boolean) => runWithErrorReporting(async () => {
    const group = workGroups.find(item => item.id === groupId)
    if (!group || group.archivedAt || !selected.size) return
    const selectedIds = [...selected].filter(id => {
      if (!add || !group.space) return true
      return allPosts.find(post => post.id === id)?.project === group.space
    })
    if (add && !selectedIds.length) return
    const nextIds = add
      ? [...new Set([...group.postIds, ...selectedIds])]
      : group.postIds.filter(id => !selected.has(id))
    await setWorkGroupPosts(group.id, nextIds)
    clear()
  }, add ? 'No se pudieron añadir publicaciones a la colección' : 'No se pudieron quitar publicaciones de la colección')

  const confirmGroupAction = () => {
    if (!pendingGroupAction || workingOnGroup) return
    void runWithErrorReporting(async () => {
      setWorkingOnGroup(true)
      try {
        const { type, group } = pendingGroupAction
        if (type === 'delete') {
          const postIds = groupDeleteMode === 'all-posts' ? group.postIds : groupDeleteMode === 'selected-posts' ? groupPostsToDelete : []
          for (const id of postIds) {
            const post = allPosts.find(item => item.id === id)
            if (post?.media.some(asset => asset.compressed)) await window.planner.workGroups.restorePostMedia(id)
            await usePlanner.getState().remove(id)
          }
          if (!postIds.length && group.compressedMediaCount) await window.planner.workGroups.restoreMedia(group.id)
          await removeWorkGroup(group.id, { recordHistory: postIds.length === 0 })
          await usePlanner.getState().load()
          setActiveWorkGroup(null)
          if (membershipTargetGroupId === group.id) setMembershipTargetGroupId('')
        } else {
          const restoring = type === 'restore'
          await setWorkGroupArchived(group.id, !restoring)
          if (!restoring) {
            setActiveWorkGroup(null)
            if (membershipTargetGroupId === group.id) setMembershipTargetGroupId('')
          } else {
            setMembershipTargetGroupId(group.id)
          }
        }
        setPendingGroupAction(null)
      } finally {
        setWorkingOnGroup(false)
      }
    }, pendingGroupAction.type === 'delete' ? 'No se pudo eliminar la colección' : 'No se pudo actualizar el estado de la colección')
  }

  const compressGroupMedia = () => runWithErrorReporting(async () => {
    if (!selectedWorkGroup) return
    setMediaCompressionMessage('')
    const result = await window.planner.workGroups.compressMedia(selectedWorkGroup.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(result.compressed
      ? `${result.compressed} archivos comprimidos; se liberaron ${(result.releasedBytes / 1024 / 1024).toFixed(1)} MB.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o sin ahorro neto.` : ''}`
      : `No había medios con compresión segura y ahorro neto.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o que no reducían el espacio.` : ''}`)
  }, 'No se pudieron comprimir los medios de la colección')

  const restoreGroupMedia = () => runWithErrorReporting(async () => {
    if (!selectedWorkGroup) return
    const result = await window.planner.workGroups.restoreMedia(selectedWorkGroup.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(`${result.restored} archivos restaurados a sus rutas originales.`)
  }, 'No se pudieron restaurar los medios de la colección')

  const compressPostMedia = (post: Post) => runWithErrorReporting(async () => {
    const result = await window.planner.workGroups.compressPostMedia(post.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(result.compressed
      ? `${post.title || 'Publicación'}: ${result.compressed} archivos comprimidos; se liberaron ${(result.releasedBytes / 1024 / 1024).toFixed(1)} MB.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o sin ahorro neto.` : ''}`
      : `No había medios con compresión segura y ahorro neto en “${post.title || 'Publicación'}”.${result.skipped ? ` Se omitieron ${result.skipped} medios compartidos, externos, ya comprimidos o que no reducían el espacio.` : ''}`)
  }, 'No se pudieron comprimir los medios de la publicación')

  const restorePostMedia = (post: Post) => runWithErrorReporting(async () => {
    const result = await window.planner.workGroups.restorePostMedia(post.id)
    await usePlanner.getState().load()
    setMediaCompressionMessage(`${result.restored} archivos restaurados a sus rutas originales.`)
  }, 'No se pudieron restaurar los medios de la publicación')

  const confirmMediaCompression = () => {
    if (!pendingMediaCompression) return
    const pending = pendingMediaCompression
    setPendingMediaCompression(null)
    if (pending.target === 'group') void compressGroupMedia()
    else {
      const post = allPosts.find(item => item.id === pending.id)
      if (post) void compressPostMedia(post)
    }
  }

  return {
    membershipTargetGroupId, setMembershipTargetGroupId,
    groupFormOpen, setGroupFormOpen, editingGroupId,
    groupName, setGroupName, groupDescription, setGroupDescription,
    savingGroup, pendingGroupAction, setPendingGroupAction,
    groupDeleteMode, setGroupDeleteMode, groupPostsToDelete, setGroupPostsToDelete,
    pendingMediaCompression, setPendingMediaCompression, workingOnGroup,
    mediaCompressionMessage, setMediaCompressionMessage,
    openGroupForm, submitGroupForm, updateGroupMembership, confirmGroupAction,
    compressGroupMedia, restoreGroupMedia, restorePostMedia, confirmMediaCompression,
  }
}
