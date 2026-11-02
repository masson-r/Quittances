import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { formatCents } from './money'

const norm = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatCents', () => {
  it('formate des centimes en euros à la française', () => {
    expect(norm(formatCents(0))).toBe('0,00 €')
    expect(norm(formatCents(5))).toBe('0,05 €')
    expect(norm(formatCents(85000))).toBe('850,00 €')
    expect(norm(formatCents(123456789))).toBe('1 234 567,89 €')
  })

  it('gère les montants négatifs (apurement, annulation)', () => {
    expect(norm(formatCents(-1050))).toBe('-10,50 €')
  })

  it('refuse un montant qui n\'est pas un entier de centimes', () => {
    expect(() => formatCents(10.5)).toThrow()
    expect(() => formatCents(Number.NaN)).toThrow()
  })

  it('propriété : le texte relu redonne les centimes d\'origine', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1_000_000_000, max: 1_000_000_000 }), (cents) => {
        const text = norm(formatCents(cents)).replace(/[^\d,-]/g, '').replace(',', '.')
        expect(Math.round(Number(text) * 100)).toBe(cents)
      }),
    )
  })
})
