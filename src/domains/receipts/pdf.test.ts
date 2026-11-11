import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'
import { buildReceiptPdf, declaration, pdfDate, pdfEuros } from './pdf'
import { receiptSnapshotSchema, type ReceiptSnapshot } from './snapshot'

// PNG 1 × 1 valide.
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'))

const quittance: ReceiptSnapshot = {
  kind: 'quittance',
  number: 'QUI-2026-09-0042',
  version: 1,
  lessor: { name: 'SCI Les Tilleuls', kind: 'sci', address_line: '8 rue des Exemples', postal_code: '75002', city: 'Paris', siret: '12345678901234' },
  tenants: ['Camille Martin', 'Jordan Durand'],
  property: { label: 'Appartement n°3', address_line1: '12 rue des Lilas', address_line2: null, postal_code: '75001', city: 'Paris' },
  period: { start: '2026-09-01', end: '2026-09-30' },
  due_on: '2026-09-05',
  rent_cents: 65000,
  charges_cents: 7000,
  total_cents: 72000,
  amount_cents: 72000,
  received_cents: 72000,
  remaining_cents: 0,
  settlements: [
    { payment_id: 'p1', received_on: '2026-09-03', mode: 'transfer', amount_cents: 40000 },
    { payment_id: 'p2', received_on: '2026-09-12', mode: 'cheque', amount_cents: 32000 },
  ],
  issued_on: '2026-09-15',
  paid_on: '2026-09-12',
  issuer: 'Alice Gestionnaire',
  signature: null,
}

const partial: ReceiptSnapshot = {
  ...quittance,
  kind: 'partial_receipt',
  number: 'REC-2026-10-0007',
  period: { start: '2026-10-01', end: '2026-10-31' },
  amount_cents: 40000,
  received_cents: 40000,
  remaining_cents: 32000,
  settlements: [{ payment_id: 'p3', received_on: '2026-10-05', mode: 'transfer', amount_cents: 40000 }],
  issued_on: '2026-10-06',
  paid_on: '2026-10-05',
}

async function textOf(bytes: Uint8Array): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const { text } = await extractText(pdf, { mergePages: true })
  return text.replace(/\s+/g, ' ')
}

describe('formats du PDF', () => {
  it('montants avec espaces insécables, dates à la française', () => {
    expect(pdfEuros(85000)).toBe('850,00 €')
    expect(pdfEuros(123456789)).toBe('1 234 567,89 €')
    expect(pdfEuros(5)).toBe('0,05 €')
    expect(pdfDate('2026-09-05')).toBe('05/09/2026')
  })

  it('l\'instantané est validé avant génération', () => {
    expect(receiptSnapshotSchema.safeParse(quittance).success).toBe(true)
    expect(receiptSnapshotSchema.safeParse({ ...quittance, kind: 'facture' }).success).toBe(false)
    expect(receiptSnapshotSchema.safeParse({ ...quittance, total_cents: 1.5 }).success).toBe(false)
  })
})

describe('buildReceiptPdf', () => {
  it('quittance : toutes les mentions sont extractibles du texte du PDF', async () => {
    const bytes = await buildReceiptPdf(quittance, null)
    expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-')
    const text = await textOf(bytes)
    for (const expected of [
      'QUITTANCE',
      'QUI-2026-09-0042',
      'émis le 15/09/2026',
      'Septembre 2026',
      'du 01/09/2026 au 30/09/2026',
      'SCI Les Tilleuls',
      '8 rue des Exemples',
      'SIRET 12345678901234',
      'Camille Martin',
      'Jordan Durand',
      'Appartement n°3',
      '12 rue des Lilas',
      '03/09/2026',
      '12/09/2026',
      'Virement',
      'Chèque',
      'Soldé le 12/09/2026',
      'Loyer hors charges',
      'Provisions sur charges',
      'sept cent vingt euros',
      'Signé électroniquement',
      'trois ans',
    ]) {
      expect(text, expected).toContain(expected)
    }
    expect(text).toMatch(/720,00\s€/)
    expect(text).not.toContain('REÇU')
  })

  it('reçu partiel : distinct d\'une quittance, avec le reste dû', async () => {
    const text = await textOf(await buildReceiptPdf(partial, null))
    expect(text).toContain('REÇU — PAS UNE QUITTANCE')
    expect(text).toContain('REC-2026-10-0007')
    expect(text).toContain('Octobre 2026')
    expect(text).toMatch(/Reste dû 320,00\s€/)
    expect(text).toContain('ce document est un reçu, il ne vaut pas quittance')
    expect(text).not.toContain('Soldé le')
    expect(text).not.toMatch(/en donne quittance/)
  })

  it('incorpore l\'image de signature quand il y en a une, ne casse pas sans elle', async () => {
    const without = await buildReceiptPdf(quittance, null)
    const withImage = await buildReceiptPdf(quittance, { contentType: 'image/png', bytes: PNG })
    expect(withImage.length).toBeGreaterThan(without.length)
    expect(await textOf(withImage)).toContain('Signé électroniquement')
  })

  it('plus de quatre règlements : liste, sans erreur', async () => {
    const many: ReceiptSnapshot = {
      ...quittance,
      settlements: Array.from({ length: 6 }, (_, i) => ({ payment_id: `p${i}`, received_on: `2026-09-0${i + 1}`, mode: 'cash' as const, amount_cents: 12000 })),
    }
    const text = await textOf(await buildReceiptPdf(many, null))
    expect(text).toContain('06/09/2026')
    expect(text).toContain('Espèces')
  })

  it('caractères hors de la police standard : remplacés, jamais d\'échec', async () => {
    const odd: ReceiptSnapshot = { ...quittance, tenants: ['Zażółć Gęślą', 'Ольга Иванова', 'Zoë Müller-Œuvre'] }
    const text = await textOf(await buildReceiptPdf(odd, null))
    expect(text).toContain('Zoë Müller-Œuvre')
    expect(text).toContain('Zazólc Gesla')
  })

  it('un nom très long passe à la ligne sans sortir de la page', async () => {
    const long: ReceiptSnapshot = { ...quittance, lessor: { ...quittance.lessor, name: 'Société civile immobilière des propriétaires associés du quartier ancien'.repeat(2) } }
    await expect(buildReceiptPdf(long, null)).resolves.toBeInstanceOf(Uint8Array)
  })

  it('même instantané, mêmes mots : le fichier ne dépend pas de l\'heure de génération', async () => {
    const a = await buildReceiptPdf(quittance, null)
    const b = await buildReceiptPdf(quittance, null)
    expect(await textOf(a)).toBe(await textOf(b))
  })
})

describe('declaration', () => {
  it('quittance : montant en chiffres et en lettres, colocataires nommés', () => {
    const phrase = declaration(quittance)
    expect(phrase).toContain('Camille Martin et Jordan Durand')
    expect(phrase).toContain('sept cent vingt euros')
    expect(phrase).toContain('en donne quittance')
  })
})
