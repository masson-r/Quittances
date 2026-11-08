import { describe, expect, it } from 'vitest'
import { zodFieldErrors } from '@/lib/form-state'
import { moveAllocationSchema, reasonSchema, recordPaymentSchema, updatePaymentSchema } from './schemas'

const LEASE = '00000000-0000-4000-8000-0000000000a9'
const C1 = '00000000-0000-4000-8000-0000000000e1'
const C2 = '00000000-0000-4000-8000-0000000000e2'

const valid = {
  leaseId: LEASE,
  amount: '850,50',
  receivedOn: '2026-03-01',
  mode: 'transfer',
  reference: ' VIR-1 ',
  comment: '',
  confirmCash: false,
  allocations: [{ rentChargeId: C1, amount: '500' }],
}

describe('recordPaymentSchema', () => {
  it('accepte un paiement valide, convertit les montants en centimes', () => {
    const r = recordPaymentSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toEqual({
        leaseId: LEASE,
        amountCents: 85050,
        receivedOn: '2026-03-01',
        mode: 'transfer',
        reference: 'VIR-1',
        comment: null,
        confirmCash: false,
        allocations: [{ rentChargeId: C1, amountCents: 50000 }],
      })
    }
  })

  it('ignore les affectations vides ou nulles et accepte un paiement sans affectation (paiement en avance)', () => {
    const r = recordPaymentSchema.safeParse({ ...valid, allocations: [{ rentChargeId: C1, amount: '' }, { rentChargeId: C2, amount: '0' }] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.allocations).toEqual([])
  })

  it('refuse un montant nul ou invalide', () => {
    for (const amount of ['', '0', '0,00', 'abc', '-5']) {
      const r = recordPaymentSchema.safeParse({ ...valid, amount, allocations: [] })
      expect(r.success, amount).toBe(false)
      if (!r.success) expect(zodFieldErrors(r.error).amount?.[0]).toMatch(/montant/i)
    }
  })

  it('refuse une date invalide, un mode inconnu et une affectation illisible', () => {
    expect(recordPaymentSchema.safeParse({ ...valid, receivedOn: '2026-02-30' }).success).toBe(false)
    expect(recordPaymentSchema.safeParse({ ...valid, mode: 'troc' }).success).toBe(false)
    const r = recordPaymentSchema.safeParse({ ...valid, allocations: [{ rentChargeId: C1, amount: 'beaucoup' }] })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).allocations?.[0]).toMatch(/affect/i)
  })

  it('refuse des affectations dont la somme dépasse le paiement', () => {
    const r = recordPaymentSchema.safeParse({ ...valid, amount: '100', allocations: [{ rentChargeId: C1, amount: '60' }, { rentChargeId: C2, amount: '40,01' }] })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).allocations?.[0]).toMatch(/dépass/i)
    expect(recordPaymentSchema.safeParse({ ...valid, amount: '100', allocations: [{ rentChargeId: C1, amount: '60' }, { rentChargeId: C2, amount: '40' }] }).success).toBe(true)
  })

  it('espèces à partir de 1 000 € : confirmation obligatoire', () => {
    const cash = { ...valid, mode: 'cash', allocations: [] }
    expect(recordPaymentSchema.safeParse({ ...cash, amount: '999,99' }).success).toBe(true)
    const r = recordPaymentSchema.safeParse({ ...cash, amount: '1000' })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).confirmCash?.[0]).toMatch(/espèces/i)
    expect(recordPaymentSchema.safeParse({ ...cash, amount: '1000', confirmCash: true }).success).toBe(true)
    expect(recordPaymentSchema.safeParse({ ...valid, mode: 'transfer', amount: '5000', allocations: [] }).success).toBe(true)
  })
})

describe('updatePaymentSchema', () => {
  it('lit les champs corrigeables', () => {
    expect(updatePaymentSchema.safeParse({ reference: ' X ', comment: '', mode: 'cheque', receivedOn: '2026-03-02' }).data).toEqual({
      reference: 'X',
      comment: null,
      mode: 'cheque',
      receivedOn: '2026-03-02',
    })
    expect(updatePaymentSchema.safeParse({ reference: '', comment: '', mode: 'x', receivedOn: '2026-03-02' }).success).toBe(false)
  })
})

describe('reasonSchema', () => {
  it('motif obligatoire', () => {
    expect(reasonSchema.safeParse({ reason: ' Doublon ' }).data).toEqual({ reason: 'Doublon' })
    expect(reasonSchema.safeParse({ reason: '   ' }).success).toBe(false)
    expect(reasonSchema.safeParse({ reason: 'x'.repeat(301) }).success).toBe(false)
  })
})

describe('moveAllocationSchema', () => {
  it('échéance de destination et motif obligatoires', () => {
    expect(moveAllocationSchema.safeParse({ chargeId: C2, reason: 'Mauvaise échéance' }).success).toBe(true)
    expect(moveAllocationSchema.safeParse({ chargeId: '', reason: 'x' }).success).toBe(false)
    expect(moveAllocationSchema.safeParse({ chargeId: C2, reason: '' }).success).toBe(false)
  })
})
