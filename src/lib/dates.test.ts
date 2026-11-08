import { describe, expect, it } from 'vitest'
import { formatDateFr, isValidIsoDate, todayInParis } from './dates'

describe('isValidIsoDate', () => {
  it.each(['2026-02-28', '2024-02-29', '1900-01-01', '2200-12-31'])('accepte %s', (v) => expect(isValidIsoDate(v)).toBe(true))
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '', 'abc', '1899-12-31', '2201-01-01'])('refuse %j', (v) => expect(isValidIsoDate(v)).toBe(false))
})

describe('todayInParis', () => {
  it('passe au jour suivant à minuit heure de Paris (été et hiver)', () => {
    expect(todayInParis(new Date('2026-06-30T21:59:00Z'))).toBe('2026-06-30')
    expect(todayInParis(new Date('2026-06-30T22:00:00Z'))).toBe('2026-07-01')
    expect(todayInParis(new Date('2026-01-31T22:59:00Z'))).toBe('2026-01-31')
    expect(todayInParis(new Date('2026-01-31T23:00:00Z'))).toBe('2026-02-01')
  })
})

describe('formatDateFr', () => {
  it('écrit la date en toutes lettres, sans décalage de fuseau', () => {
    expect(formatDateFr('2026-03-05')).toBe('5 mars 2026')
    expect(formatDateFr('2026-12-31')).toBe('31 décembre 2026')
    expect(formatDateFr('2026-01-01')).toBe('1 janvier 2026')
  })
})
