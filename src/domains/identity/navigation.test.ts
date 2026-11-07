import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, sectionFromPath, sectionHref, visibleNav } from './navigation'

const ENTITY = '00000000-0000-4000-8000-00000000aaaa'

describe('visibleNav', () => {
  it('ne garde que les sections dont l\'utilisateur a la lecture, dans l\'ordre de la navigation', () => {
    const items = visibleNav(['structure:read', 'property:read', 'payment:read', 'member:read'])
    expect(items.map((i) => i.slug)).toEqual(['tableau-de-bord', 'biens', 'paiements', 'membres'])
  })

  it('un lecteur ne voit pas les membres', () => {
    const reader = ['structure:read', 'property:read', 'tenant:read', 'lease:read', 'rent_charge:read', 'payment:read', 'expense:read', 'receipt:read']
    const slugs = visibleNav(reader).map((i) => i.slug)
    expect(slugs).not.toContain('membres')
    expect(slugs).toContain('quittances')
  })

  it('sans aucune permission, la navigation est vide', () => {
    expect(visibleNav([])).toEqual([])
  })

  it('chaque section a un libellé français et un identifiant d\'adresse unique', () => {
    const slugs = NAV_ITEMS.map((i) => i.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const item of NAV_ITEMS) expect(item.label.length).toBeGreaterThan(2)
  })
})

describe('sectionHref', () => {
  it('construit l\'adresse d\'une section de la structure', () => {
    expect(sectionHref(ENTITY, 'biens')).toBe(`/espace/${ENTITY}/biens`)
  })
})

describe('sectionFromPath', () => {
  it('retrouve la section affichée', () => {
    expect(sectionFromPath(`/espace/${ENTITY}/membres`)).toBe('membres')
    expect(sectionFromPath(`/espace/${ENTITY}/biens/abc`)).toBe('biens')
  })
  it('revient au tableau de bord hors d\'une section connue', () => {
    expect(sectionFromPath(`/espace/${ENTITY}`)).toBe('tableau-de-bord')
    expect(sectionFromPath('/espace')).toBe('tableau-de-bord')
    expect(sectionFromPath(`/espace/${ENTITY}/inconnue`)).toBe('tableau-de-bord')
  })
})
