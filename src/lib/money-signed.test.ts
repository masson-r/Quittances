import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { parseSignedEuros } from './money-signed'

describe('parseSignedEuros', () => {
  it.each([
    ['120,50', 12050],
    ['+120,50', 12050],
    ['-80', -8000],
    ['−80,5', -8050],
    ['– 1 250,00', -125000],
    ['0', 0],
    ['-0', 0],
    [' 12 ', 1200],
  ])('lit %j comme %i centimes', (input, cents) => expect(parseSignedEuros(input)).toBe(cents))

  it.each(['', '-', '--5', '+-5', 'abc', '5-', '12,345', '-12,345'])('refuse %j', (input) => expect(parseSignedEuros(input)).toBeNull())

  it('propriété : le signe est conservé', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 99_999_999 }), (cents) => {
        const text = `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, '0')}`
        expect(parseSignedEuros(text)).toBe(cents)
        expect(parseSignedEuros(`-${text}`)).toBe(-cents)
      }),
    )
  })
})
