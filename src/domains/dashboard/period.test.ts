import { describe, expect, it } from 'vitest'
import { collectionRate, monthlyRange, resolvePeriod } from './period'

describe('resolvePeriod', () => {
  const today = '2026-03-15'

  it('mois, trimestre et année en cours jusqu\'à leur dernier jour', () => {
    expect(resolvePeriod('mois', today)).toEqual({ key: 'mois', from: '2026-03-01', to: '2026-03-31' })
    expect(resolvePeriod('trimestre', today)).toEqual({ key: 'trimestre', from: '2026-01-01', to: '2026-03-31' })
    expect(resolvePeriod('trimestre', '2026-11-08')).toEqual({ key: 'trimestre', from: '2026-10-01', to: '2026-12-31' })
    expect(resolvePeriod('annee', today)).toEqual({ key: 'annee', from: '2026-01-01', to: '2026-12-31' })
  })

  it('février d\'une année bissextile', () => {
    expect(resolvePeriod('mois', '2028-02-10').to).toBe('2028-02-29')
  })

  it.each([
    ['1an', '2025-03-16'],
    ['2ans', '2024-03-16'],
    ['3ans', '2023-03-16'],
    ['5ans', '2021-03-16'],
  ])('%s glissant se termine aujourd\'hui', (key, from) => {
    expect(resolvePeriod(key, today)).toEqual({ key, from, to: today })
  })

  it('un 29 février ramène au 28 février de l\'année non bissextile', () => {
    expect(resolvePeriod('1an', '2028-02-29')).toEqual({ key: '1an', from: '2027-03-01', to: '2028-02-29' })
  })

  it('dates personnalisées valides, sinon retour au mois en cours', () => {
    expect(resolvePeriod('perso', today, { from: '2025-06-01', to: '2025-06-30' })).toEqual({ key: 'perso', from: '2025-06-01', to: '2025-06-30' })
    expect(resolvePeriod('perso', today, { from: '2025-06-30', to: '2025-06-01' }).key).toBe('mois')
    expect(resolvePeriod('perso', today, { from: '2025-02-30', to: '2025-06-01' }).key).toBe('mois')
    expect(resolvePeriod('perso', today).key).toBe('mois')
  })

  it('clé inconnue ou absente : mois en cours', () => {
    expect(resolvePeriod('nimporte', today).key).toBe('mois')
    expect(resolvePeriod(undefined, today).key).toBe('mois')
  })
})

describe('monthlyRange', () => {
  it('douze mois qui finissent avec une période courte', () => {
    expect(monthlyRange({ key: 'mois', from: '2026-03-01', to: '2026-03-31' })).toEqual({ from: '2025-04-01', to: '2026-03-31' })
  })

  it('la période elle-même quand elle couvre au moins douze mois', () => {
    const period = { key: '5ans' as const, from: '2021-03-16', to: '2026-03-15' }
    expect(monthlyRange(period)).toEqual({ from: period.from, to: period.to })
  })
})

describe('collectionRate', () => {
  it('encaissé ÷ appelé, arrondi, null sans appelé', () => {
    expect(collectionRate(85000, 85000)).toBe(100)
    expect(collectionRate(30000, 85000)).toBe(35)
    expect(collectionRate(0, 0)).toBeNull()
    expect(collectionRate(100000, 85000)).toBe(118)
  })
})
