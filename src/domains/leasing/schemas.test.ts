import { describe, expect, it } from 'vitest'
import { zodFieldErrors } from '@/lib/form-state'
import { addTermSchema, coTenantSchema, createLeaseSchema, endLeaseSchema } from './schemas'

const PROPERTY = '00000000-0000-4000-8000-0000000000c1'
const TENANT = '00000000-0000-4000-8000-0000000000c3'
const TENANT_2 = '00000000-0000-4000-8000-0000000000c6'

const lease = {
  propertyId: PROPERTY,
  tenantIds: [TENANT],
  startDate: '2026-03-10',
  endDate: '',
  dueDay: '5',
  rent: '850,50',
  charges: '50',
  deposit: '',
  depositReceivedOn: '',
}

describe('createLeaseSchema', () => {
  it('accepte un bail valide, convertit les montants en centimes et les champs vides en null', () => {
    const r = createLeaseSchema.safeParse(lease)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toEqual({
        propertyId: PROPERTY,
        tenantIds: [TENANT],
        startDate: '2026-03-10',
        endDate: null,
        dueDay: 5,
        rentCents: 85050,
        chargesCents: 5000,
        depositCents: null,
        depositReceivedOn: null,
      })
    }
  })

  it('accepte plusieurs colocataires, sans doublon', () => {
    const r = createLeaseSchema.safeParse({ ...lease, tenantIds: [TENANT, TENANT_2, TENANT] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.tenantIds).toEqual([TENANT, TENANT_2])
  })

  it('exige un bien, au moins un locataire et une date de début valide', () => {
    const r = createLeaseSchema.safeParse({ ...lease, propertyId: '', tenantIds: [], startDate: '2026-02-30' })
    expect(r.success).toBe(false)
    if (!r.success) expect(Object.keys(zodFieldErrors(r.error)).sort()).toEqual(['propertyId', 'startDate', 'tenantIds'])
  })

  it.each(['0', '32', '5,5', 'abc', ''])('refuse le jour d\'échéance %j', (dueDay) => {
    const r = createLeaseSchema.safeParse({ ...lease, dueDay })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).dueDay?.[0]).toMatch(/jour d'échéance/i)
  })

  it('refuse un loyer ou des charges invalides ; les charges peuvent être nulles', () => {
    const bad = createLeaseSchema.safeParse({ ...lease, rent: 'abc', charges: '-5' })
    expect(bad.success).toBe(false)
    if (!bad.success) {
      expect(zodFieldErrors(bad.error).rent?.[0]).toMatch(/loyer/i)
      expect(zodFieldErrors(bad.error).charges?.[0]).toMatch(/charges/i)
    }
    expect(createLeaseSchema.safeParse({ ...lease, charges: '0' }).success).toBe(true)
  })

  it('refuse une date de fin antérieure au début', () => {
    const r = createLeaseSchema.safeParse({ ...lease, endDate: '2026-03-09' })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).endDate?.[0]).toMatch(/fin/i)
    expect(createLeaseSchema.safeParse({ ...lease, endDate: '2026-03-10' }).success).toBe(true)
  })

  it('dépôt de garantie facultatif, mais valide quand il est saisi', () => {
    const r = createLeaseSchema.safeParse({ ...lease, deposit: '850', depositReceivedOn: '2026-03-01' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toMatchObject({ depositCents: 85000, depositReceivedOn: '2026-03-01' })
    expect(createLeaseSchema.safeParse({ ...lease, deposit: 'beaucoup' }).success).toBe(false)
    expect(createLeaseSchema.safeParse({ ...lease, depositReceivedOn: '2026-13-01' }).success).toBe(false)
  })
})

describe('addTermSchema', () => {
  it('lit la date d\'effet, les montants et le motif facultatif', () => {
    const r = addTermSchema.safeParse({ effectiveFrom: '2026-09-01', rent: '870', charges: '52,5', reason: ' Révision ' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ effectiveFrom: '2026-09-01', rentCents: 87000, chargesCents: 5250, reason: 'Révision' })
    expect(addTermSchema.safeParse({ effectiveFrom: '2026-09-01', rent: '870', charges: '0', reason: '' }).data?.reason).toBeNull()
  })
  it('exige une date et des montants valides', () => {
    expect(addTermSchema.safeParse({ effectiveFrom: '', rent: '870', charges: '0', reason: '' }).success).toBe(false)
    expect(addTermSchema.safeParse({ effectiveFrom: '2026-09-01', rent: '', charges: '0', reason: '' }).success).toBe(false)
  })
})

describe('coTenantSchema', () => {
  it('dossier et date d\'entrée obligatoires, sortie facultative', () => {
    expect(coTenantSchema.safeParse({ tenantId: TENANT_2, startDate: '2026-04-01', endDate: '' }).data).toEqual({ tenantId: TENANT_2, startDate: '2026-04-01', endDate: null })
    expect(coTenantSchema.safeParse({ tenantId: '', startDate: '2026-04-01', endDate: '' }).success).toBe(false)
    expect(coTenantSchema.safeParse({ tenantId: TENANT_2, startDate: '2026-04-01', endDate: '2026-03-01' }).success).toBe(false)
  })
})

describe('endLeaseSchema', () => {
  it('exige une date de fin valide', () => {
    expect(endLeaseSchema.safeParse({ endDate: '2026-12-31' }).data).toEqual({ endDate: '2026-12-31' })
    expect(endLeaseSchema.safeParse({ endDate: '' }).success).toBe(false)
  })
})
