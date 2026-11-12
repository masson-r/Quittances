import { describe, expect, it } from 'vitest'
import { categoryNameSchema, expenseSchema, sniffDocumentType } from './schemas'

const valid = {
  propertyId: '00000000-0000-4000-8000-0000000000c1',
  categoryId: '00000000-0000-4000-8000-0000000000c2',
  expenseDate: '2026-03-01',
  description: 'Plomberie',
  amount: '120,50',
  recoverable: false,
}

describe('expenseSchema', () => {
  it('convertit le montant en centimes', () => {
    expect(expenseSchema.parse(valid).amount).toBe(12050)
  })

  it.each(['0', '0,00', '-5', 'abc', '', '12,345'])('refuse le montant « %s »', (amount) => {
    expect(expenseSchema.safeParse({ ...valid, amount }).success).toBe(false)
  })

  it('refuse une date invalide, une description vide ou trop longue, un bien inconnu', () => {
    expect(expenseSchema.safeParse({ ...valid, expenseDate: '2026-02-30' }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...valid, description: '   ' }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...valid, description: 'x'.repeat(501) }).success).toBe(false)
    expect(expenseSchema.safeParse({ ...valid, propertyId: 'x' }).success).toBe(false)
  })
})

describe('categoryNameSchema', () => {
  it('rogne les espaces et refuse le vide', () => {
    expect(categoryNameSchema.parse('  Jardinage ')).toBe('Jardinage')
    expect(categoryNameSchema.safeParse('  ').success).toBe(false)
  })
})

describe('sniffDocumentType', () => {
  it('reconnaît PDF, PNG et JPEG à l\'en-tête', () => {
    expect(sniffDocumentType(Uint8Array.from(Buffer.from('%PDF-1.7 ...')))).toBe('application/pdf')
    expect(sniffDocumentType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png')
    expect(sniffDocumentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
  })

  it('refuse le reste (SVG, HTML, GIF, exécutable)', () => {
    for (const text of ['<svg/>', '<html>', 'GIF89a', 'MZ\x90\x00']) expect(sniffDocumentType(Uint8Array.from(Buffer.from(text)))).toBeNull()
  })
})
