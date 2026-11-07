import { describe, expect, it } from 'vitest'
import { zodFieldErrors } from '@/lib/form-state'
import { privateDetailsSchema, tenantSchema } from './schemas'

const valid = {
  lastName: ' Martin ',
  firstName: 'Alice',
  email: ' Alice@Example.Test ',
  phone: '01 02 03 04 05',
  addressLine1: '',
  postalCode: '',
  city: '',
  paperDeliveryRequested: false,
}

describe('tenantSchema', () => {
  it('accepte un dossier minimal et normalise e-mail et champs vides', () => {
    const r = tenantSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data).toEqual({
        lastName: 'Martin',
        firstName: 'Alice',
        email: 'alice@example.test',
        phone: '01 02 03 04 05',
        addressLine1: null,
        postalCode: null,
        city: null,
        paperDeliveryRequested: false,
      })
    }
  })

  it('seul le nom est obligatoire', () => {
    const r = tenantSchema.safeParse({ lastName: 'Durand', firstName: '', email: '', phone: '', addressLine1: '', postalCode: '', city: '', paperDeliveryRequested: true })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toMatchObject({ lastName: 'Durand', firstName: '', email: null, paperDeliveryRequested: true })
    expect(tenantSchema.safeParse({ ...valid, lastName: '  ' }).success).toBe(false)
  })

  it('refuse un e-mail ou un code postal invalide, en français', () => {
    const r = tenantSchema.safeParse({ ...valid, email: 'pas-un-email', postalCode: '12' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const errors = zodFieldErrors(r.error)
      expect(errors.email?.[0]).toMatch(/adresse e-mail/i)
      expect(errors.postalCode?.[0]).toMatch(/code postal/i)
    }
  })
})

describe('privateDetailsSchema', () => {
  const base = { birthDate: '', guarantorKind: 'none', guarantorName: '', guarantorContact: '', housingAid: 'none', note: '' }

  it('tout est facultatif, valeurs par défaut « aucun »', () => {
    const r = privateDetailsSchema.safeParse(base)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ birthDate: null, guarantorKind: 'none', guarantorName: null, guarantorContact: null, housingAid: 'none', note: null })
  })

  it('accepte une date de naissance passée', () => {
    expect(privateDetailsSchema.safeParse({ ...base, birthDate: '1985-04-12' }).data?.birthDate).toBe('1985-04-12')
  })

  it.each(['2999-01-01', '1850-01-01', '12/04/1985', '1985-02-30', 'abc'])('refuse la date de naissance %j', (birthDate) => {
    const r = privateDetailsSchema.safeParse({ ...base, birthDate })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).birthDate?.[0]).toMatch(/date de naissance/i)
  })

  it('refuse un type de garant ou d\'aide inconnu', () => {
    expect(privateDetailsSchema.safeParse({ ...base, guarantorKind: 'cousin' }).success).toBe(false)
    expect(privateDetailsSchema.safeParse({ ...base, housingAid: 'beaucoup' }).success).toBe(false)
    for (const kind of ['none', 'person', 'visale', 'bank', 'other']) expect(privateDetailsSchema.safeParse({ ...base, guarantorKind: kind }).success).toBe(true)
    for (const aid of ['none', 'to_tenant', 'to_landlord']) expect(privateDetailsSchema.safeParse({ ...base, housingAid: aid }).success).toBe(true)
  })
})
