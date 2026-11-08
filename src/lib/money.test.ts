import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { formatCents, formatEurosInput, parseEuros } from './money'

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

describe('parseEuros', () => {
  it.each([
    ['850', 85000],
    ['850,5', 85050],
    ['850,50', 85050],
    ['850.50', 85050],
    ['0,05', 5],
    ['0', 0],
    ['1 250,00', 125000],
    [' 1 250 ', 125000],
    ['12,3', 1230],
  ])('lit %j comme %i centimes', (input, cents) => expect(parseEuros(input)).toBe(cents))

  it.each(['', 'abc', '-5', '12,345', '1,2,3', '12 €', '1e3', ',5', '.', '99999999999'])('refuse %j', (input) => expect(parseEuros(input)).toBeNull())

  it('propriété : relire le formatage donne les mêmes centimes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), (cents) => {
        const text = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
        expect(parseEuros(text)).toBe(cents)
      }),
    )
  })
})

describe('formatEurosInput', () => {
  it('écrit les centimes en euros avec deux décimales et une virgule', () => {
    expect(formatEurosInput(0)).toBe('0,00')
    expect(formatEurosInput(5)).toBe('0,05')
    expect(formatEurosInput(85050)).toBe('850,50')
    expect(formatEurosInput(123456789)).toBe('1234567,89')
  })
  it('refuse un montant invalide', () => {
    expect(() => formatEurosInput(-1)).toThrow()
    expect(() => formatEurosInput(1.5)).toThrow()
  })
  it('propriété : parseEuros relit ce que formatEurosInput écrit', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 99_999_999 }), (cents) => {
        expect(parseEuros(formatEurosInput(cents))).toBe(cents)
      }),
    )
  })
})
