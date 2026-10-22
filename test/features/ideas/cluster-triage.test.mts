import assert from 'node:assert/strict'
import test from 'node:test'
import { buildClusterReview, developSelectedClusterIdeas, ideaCorpusSignature } from '../../../src/features/ideas/cluster-triage.ts'
import type { Idea, IdeaCluster } from '../../../src/shared/types.ts'

function createIdea(id: string, status: Idea['status'] = 'inbox'): Idea {
  return {
    id,
    space: 'Ideas',
    title: `Idea ${id}`,
    body: `Texto ${id}`,
    tags: [],
    media: [],
    status,
    priority: 'normal',
    dueDate: null,
    postId: null,
    combinedPostId: null,
    combinedPostIds: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

test('maps each affinity to its idea and identifies the least aligned member', () => {
  const ideas = [createIdea('a'), createIdea('b'), createIdea('c')]
  const cluster: IdeaCluster = {
    id: 'group',
    name: 'Tema',
    ideaIds: ['b', 'a', 'c'],
    memberScores: [0.6, 0.8, 0.9],
    memberComparisons: [[{ ideaId: 'c', score: 0.6 }, { ideaId: 'a', score: 0.6 }], [{ ideaId: 'c', score: 0.8 }, { ideaId: 'b', score: 0.8 }], [{ ideaId: 'a', score: 0.9 }, { ideaId: 'b', score: 0.9 }]],
  }

  const review = buildClusterReview(cluster, ideas)

  assert.deepEqual(review.members.map(member => [member.idea.id, member.score]), [['b', 0.6], ['a', 0.8], ['c', 0.9]])
  assert.equal(review.meanScore, (0.6 + 0.8 + 0.9) / 3)
  assert.equal(review.leastAligned?.idea.id, 'b')
  assert.equal(review.mostAligned?.idea.id, 'c')
  assert.deepEqual(review.members[0].comparisons.map(comparison => comparison.ideaId), ['c', 'a'])
})

test('does not flag a least-aligned idea when the score difference is below the review threshold', () => {
  const cluster: IdeaCluster = { id: 'group', name: 'Tema', ideaIds: ['a', 'b'], memberScores: [0.7, 0.74] }

  assert.equal(buildClusterReview(cluster, [createIdea('a'), createIdea('b')]).leastAligned, null)
})

test('corpus signature ignores status changes but changes when the content changes', () => {
  const original = [createIdea('a'), createIdea('b')]
  const statusChanged = [createIdea('a', 'developing'), createIdea('b', 'ready')]

  assert.equal(ideaCorpusSignature(original), ideaCorpusSignature(statusChanged))
  assert.notEqual(ideaCorpusSignature(original), ideaCorpusSignature([{ ...original[0], title: 'Título editado' }, original[1]]))
  assert.notEqual(ideaCorpusSignature(original), ideaCorpusSignature([{ ...original[0], body: 'Texto editado' }, original[1]]))
  assert.equal(ideaCorpusSignature(original), ideaCorpusSignature([...original].reverse()))
})

test('moves only selected cluster members that are not already developing', async () => {
  const ideas = [createIdea('a'), createIdea('b', 'developing'), createIdea('c')]
  const cluster: IdeaCluster = { id: 'group', name: 'Tema', ideaIds: ['a', 'b', 'c', 'missing'] }
  const saved: Idea[] = []

  const count = await developSelectedClusterIdeas(cluster, ideas, ['b', 'c'], async idea => {
    const result: Idea = { ...createIdea(idea.id || 'new'), ...idea, updatedAt: '2026-01-02T00:00:00.000Z' }
    saved.push(result)
    return result
  })

  assert.equal(count, 1)
  assert.deepEqual(saved.map(idea => idea.id), ['c'])
  assert.equal(saved[0].status, 'developing')
})

test('surfaces failures while updating a selected cluster member', async () => {
  const cluster: IdeaCluster = { id: 'group', name: 'Tema', ideaIds: ['a'] }

  await assert.rejects(
    developSelectedClusterIdeas(cluster, [createIdea('a')], ['a'], async () => { throw new Error('save failed') }),
    /save failed/,
  )
})
