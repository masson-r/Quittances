import { describe, expect, it } from 'vitest'
import { zodFieldErrors } from '@/lib/form-state'
import { recordSettlementSchema, updateSettlementSchema } from './schemas'

const LEASE = '00000000-0000-4000-8000-0000000000a9'
const PAYMENT = '00000000-0000-4000-8000-0000000000f1'

const base = {
  leaseId: LEASE,
  kind: 'charges_adjustment',
  settledOn: '2026-06-01',
  amount: '120,50',
  mode: 'transfer',
  reason: ' Régularisation 2025 ',
  periodStart: '',
  periodEnd: '',
  paymentId: '',
  isFinal: false,
  reference: '',
  comment: '',
}
const today = '2026-06-15'

describe('recordSettlementSchema', () => {
  it('accepte un remboursement positif et un complément reçu négatif', () => {
    const refund = recordSettlementSchema(today).safeParse(base)
    expect(refund.success).toBe(true)
    if (refund.success) expect(refund.data).toMatchObject({ amountCents: 12050, kind: 'charges_adjustment', reason: 'Régularisation 2025', paymentId: null, periodStart: null, isFinal: false })
    const received = recordSettlementSchema(today).safeParse({ ...base, amount: '-80' })
    expect(received.success).toBe(true)
    if (received.success) expect(received.data.amountCents).toBe(-8000)
  })

  it('le montant zéro n\'est permis que pour l\'apurement final', () => {
    const r = recordSettlementSchema(today).safeParse({ ...base, amount: '0' })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).amount?.[0]).toMatch(/apurement final/i)
    expect(recordSettlementSchema(today).safeParse({ ...base, amount: '0', isFinal: true }).success).toBe(true)
  })

  it('refuse un montant illisible, une date future ou invalide, un motif vide', () => {
    expect(recordSettlementSchema(today).safeParse({ ...base, amount: 'beaucoup' }).success).toBe(false)
    const future = recordSettlementSchema(today).safeParse({ ...base, settledOn: '2026-06-16' })
    expect(future.success).toBe(false)
    if (!future.success) expect(zodFieldErrors(future.error).settledOn?.[0]).toMatch(/futur/)
    expect(recordSettlementSchema(today).safeParse({ ...base, settledOn: '2026-02-30' }).success).toBe(false)
    expect(recordSettlementSchema(today).safeParse({ ...base, reason: '  ' }).success).toBe(false)
  })

  it('la période régularisée est facultative mais complète, début avant fin', () => {
    expect(recordSettlementSchema(today).safeParse({ ...base, periodStart: '2025-01-01', periodEnd: '2025-12-31' }).data).toMatchObject({ periodStart: '2025-01-01', periodEnd: '2025-12-31' })
    expect(recordSettlementSchema(today).safeParse({ ...base, periodStart: '2025-01-01' }).success).toBe(false)
    expect(recordSettlementSchema(today).safeParse({ ...base, periodStart: '2025-12-31', periodEnd: '2025-01-01' }).success).toBe(false)
  })

  it('remboursement du non affecté : positif, adossé à un paiement, jamais final', () => {
    const refund = { ...base, kind: 'unallocated_refund', paymentId: PAYMENT }
    expect(recordSettlementSchema(today).safeParse(refund).success).toBe(true)
    expect(recordSettlementSchema(today).safeParse({ ...refund, amount: '-5' }).success).toBe(false)
    const noPayment = recordSettlementSchema(today).safeParse({ ...refund, paymentId: '' })
    expect(noPayment.success).toBe(false)
    if (!noPayment.success) expect(zodFieldErrors(noPayment.error).paymentId?.[0]).toMatch(/paiement/i)
    expect(recordSettlementSchema(today).safeParse({ ...refund, isFinal: true }).success).toBe(false)
  })

  it('un ajustement de charges n\'est pas rattaché à un paiement', () => {
    const r = recordSettlementSchema(today).safeParse({ ...base, paymentId: PAYMENT })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.paymentId).toBeNull()
  })

  it('mode et genre inconnus refusés', () => {
    expect(recordSettlementSchema(today).safeParse({ ...base, mode: 'troc' }).success).toBe(false)
    expect(recordSettlementSchema(today).safeParse({ ...base, kind: 'cadeau' }).success).toBe(false)
  })
})

describe('updateSettlementSchema', () => {
  it('lit date, mode, référence et commentaire', () => {
    expect(updateSettlementSchema(today).safeParse({ settledOn: '2026-06-05', mode: 'cheque', reference: ' CHQ ', comment: '' }).data).toEqual({
      settledOn: '2026-06-05',
      mode: 'cheque',
      reference: 'CHQ',
      comment: null,
    })
    expect(updateSettlementSchema(today).safeParse({ settledOn: '2026-06-16', mode: 'cheque', reference: '', comment: '' }).success).toBe(false)
  })
})
