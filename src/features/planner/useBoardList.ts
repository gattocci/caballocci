import { useMemo } from 'react'
import { stages } from '../../shared/constants'
import type { Post, WorkGroup } from '../../shared/types'
import type { BoardListSort } from './BoardListView'

type BoardListOptions = {
  posts: Post[]
  workGroups: WorkGroup[]
  status: string
  format: string
  group: string
  from: string
  to: string
  sort: BoardListSort
  direction: 'asc' | 'desc'
  page: number
  pageSize?: number
}

function sortValue(post: Post, sort: BoardListSort, workGroups: WorkGroup[]) {
  if (sort === 'title') return post.title.toLocaleLowerCase()
  if (sort === 'status') return [...stages, 'archived' as Post['status']].indexOf(post.status)
  if (sort === 'format') return post.contentType
  if (sort === 'collection') return workGroups.filter(group => group.postIds.includes(post.id)).map(group => group.name).join(', ').toLocaleLowerCase()
  return post.scheduledAt || '9999'
}

export function useBoardList({ posts, workGroups, status, format, group, from, to, sort, direction, page, pageSize = 75 }: BoardListOptions) {
  const listPosts = useMemo(() => posts.filter(post =>
    (!status || post.status === status) &&
    (!format || post.contentType === format) &&
    (!group || workGroups.some(item => item.id === group && item.postIds.includes(post.id))) &&
    (!from || Boolean(post.scheduledAt && post.scheduledAt.slice(0, 10) >= from)) &&
    (!to || Boolean(post.scheduledAt && post.scheduledAt.slice(0, 10) <= to)),
  ).sort((a, b) => {
    const left = sortValue(a, sort, workGroups)
    const right = sortValue(b, sort, workGroups)
    const compared = left < right ? -1 : left > right ? 1 : 0
    return compared * (direction === 'asc' ? 1 : -1)
  }), [posts, status, format, group, from, to, sort, direction, workGroups])

  const pageCount = Math.max(1, Math.ceil(listPosts.length / pageSize))
  return {
    listPosts,
    listPageCount: pageCount,
    visibleListPosts: listPosts.slice(page * pageSize, (page + 1) * pageSize),
  }
}
