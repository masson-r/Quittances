import { describe, expect, it } from 'vitest'
import { centsInWords, numberInWords } from './words'

describe('numberInWords', () => {
  it.each([
    [0, 'zéro'],
    [1, 'un'],
    [16, 'seize'],
    [17, 'dix-sept'],
    [21, 'vingt et un'],
    [22, 'vingt-deux'],
    [71, 'soixante et onze'],
    [77, 'soixante-dix-sept'],
    [80, 'quatre-vingts'],
    [81, 'quatre-vingt-un'],
    [91, 'quatre-vingt-onze'],
    [97, 'quatre-vingt-dix-sept'],
    [100, 'cent'],
    [101, 'cent un'],
    [200, 'deux cents'],
    [320, 'trois cent vingt'],
    [400, 'quatre cents'],
    [720, 'sept cent vingt'],
    [1000, 'mille'],
    [1250, 'mille deux cent cinquante'],
    [2000, 'deux mille'],
    [80_000, 'quatre-vingt mille'],
    [999_999, 'neuf cent quatre-vingt-dix-neuf mille neuf cent quatre-vingt-dix-neuf'],
  ])('%d', (n, words) => expect(numberInWords(n)).toBe(words))

  it('refuse les valeurs hors limites', () => {
    expect(() => numberInWords(-1)).toThrow(RangeError)
    expect(() => numberInWords(1_000_000)).toThrow(RangeError)
    expect(() => numberInWords(1.5)).toThrow(RangeError)
  })
})

describe('centsInWords', () => {
  it.each([
    [85_000, 'huit cent cinquante euros'],
    [100, 'un euro'],
    [101, 'un euro et un centime'],
    [72_050, 'sept cent vingt euros et cinquante centimes'],
    [5, 'zéro euro et cinq centimes'],
  ])('%d', (cents, words) => expect(centsInWords(cents)).toBe(words))
})
