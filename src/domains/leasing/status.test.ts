import { describe, expect, it } from 'vitest'
import { currentTerm, leaseStatus } from './status'

describe('leaseStatus', () => {
  it('à venir, en cours, terminé, bornes incluses', () => {
    expect(leaseStatus('2026-03-10', null, '2026-03-09')).toBe('upcoming')
    expect(leaseStatus('2026-03-10', null, '2026-03-10')).toBe('ongoing')
    expect(leaseStatus('2026-03-10', '2026-06-30', '2026-06-30')).toBe('ongoing')
    expect(leaseStatus('2026-03-10', '2026-06-30', '2026-07-01')).toBe('ended')
    expect(leaseStatus('2026-03-10', null, '2030-01-01')).toBe('ongoing')
  })
})

describe('currentTerm', () => {
  const terms = [
    { effectiveFrom: '2026-09-01', rentCents: 87000, chargesCents: 5200 },
    { effectiveFrom: '2026-01-01', rentCents: 85000, chargesCents: 5000 },
  ]
  it('prend la version la plus récente déjà effective', () => {
    expect(currentTerm(terms, '2026-08-31')?.rentCents).toBe(85000)
    expect(currentTerm(terms, '2026-09-01')?.rentCents).toBe(87000)
    expect(currentTerm(terms, '2027-01-01')?.rentCents).toBe(87000)
  })
  it('avant toute version : la première ; sans version : rien', () => {
    expect(currentTerm(terms, '2025-01-01')?.rentCents).toBe(85000)
    expect(currentTerm([], '2026-01-01')).toBeUndefined()
  })
})
