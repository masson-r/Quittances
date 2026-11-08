export type LeaseStatus = 'upcoming' | 'ongoing' | 'ended'

export const LEASE_STATUS_LABELS: Record<LeaseStatus, string> = { upcoming: 'À venir', ongoing: 'En cours', ended: 'Terminé' }

/** État d'un bail à une date donnée (bornes incluses), dates au format AAAA-MM-JJ. */
export function leaseStatus(start: string, end: string | null, today: string): LeaseStatus {
  if (today < start) return 'upcoming'
  return end !== null && today > end ? 'ended' : 'ongoing'
}

export interface TermLike {
  effectiveFrom: string
  rentCents: number
  chargesCents: number
}

/** Conditions en vigueur à une date : la plus récente version déjà effective, sinon la première. */
export function currentTerm<T extends TermLike>(terms: readonly T[], today: string): T | undefined {
  const sorted = [...terms].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? -1 : 1))
  let current: T | undefined = sorted[0]
  for (const term of sorted) if (term.effectiveFrom <= today) current = term
  return current
}
