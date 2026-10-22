import type { Idea, IdeaCluster, IdeaClusterComparison, IdeaInput } from '../../shared/types'

export interface ClusterReviewMember {
  idea: Idea
  score: number | undefined
  comparisons: IdeaClusterComparison[]
}

type ScoredClusterReviewMember = ClusterReviewMember & { score: number }

export interface ClusterReview {
  members: ClusterReviewMember[]
  meanScore: number | null
  leastAligned: ScoredClusterReviewMember | null
  mostAligned: ScoredClusterReviewMember | null
}

export function buildClusterReview(cluster: IdeaCluster, ideas: Idea[]): ClusterReview {
  const members = cluster.ideaIds
    .flatMap((id, index) => {
      const idea = ideas.find(item => item.id === id)
      return idea ? [{ idea, score: cluster.memberScores?.[index], comparisons: cluster.memberComparisons?.[index] || [] }] : []
    })
  const scoredMembers = members.filter((member): member is ScoredClusterReviewMember => typeof member.score === 'number' && Number.isFinite(member.score))
  const meanScore = scoredMembers.length ? scoredMembers.reduce((sum, member) => sum + member.score, 0) / scoredMembers.length : null
  const leastAligned = [...scoredMembers].sort((a, b) => a.score - b.score)[0] || null
  const mostAligned = [...scoredMembers].sort((a, b) => b.score - a.score)[0] || null

  return {
    members,
    meanScore,
    leastAligned: leastAligned && meanScore !== null && meanScore - leastAligned.score >= 0.05 ? leastAligned : null,
    mostAligned,
  }
}

export function ideaCorpusSignature(ideas: Array<Pick<Idea, 'id' | 'title' | 'body'>>): string {
  return JSON.stringify(ideas
    .map(({ id, title, body }) => ({ id, title, body }))
    .sort((a, b) => a.id.localeCompare(b.id)))
}

export async function developSelectedClusterIdeas(
  cluster: IdeaCluster,
  ideas: Idea[],
  selectedIds: string[],
  saveIdea: (idea: IdeaInput) => Promise<Idea>,
): Promise<number> {
  const selected = new Set(selectedIds)
  const toDevelop = cluster.ideaIds
    .filter(id => selected.has(id))
    .flatMap(id => {
      const idea = ideas.find(item => item.id === id)
      return idea && idea.status !== 'developing' ? [idea] : []
    })

  for (const idea of toDevelop) await saveIdea({ ...idea, status: 'developing' })
  return toDevelop.length
}
