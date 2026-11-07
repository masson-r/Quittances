import { describe, expect, it } from 'vitest'
import { zodFieldErrors } from '@/lib/form-state'
import { accessCodeSchema, maintenanceNoteSchema, propertySchema } from './schemas'

const valid = {
  label: ' Appartement T3 ',
  addressLine1: '12 rue des Lilas',
  addressLine2: '',
  postalCode: '75011',
  city: 'Paris',
  description: '',
}

describe('propertySchema', () => {
  it('accepte un bien valide, nettoie les espaces et transforme les champs vides en null', () => {
    const r = propertySchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ ...valid, label: 'Appartement T3', addressLine2: null, description: null })
  })

  it('exige libellé, adresse et ville', () => {
    const r = propertySchema.safeParse({ ...valid, label: ' ', addressLine1: '', city: '' })
    expect(r.success).toBe(false)
    if (!r.success) expect(Object.keys(zodFieldErrors(r.error)).sort()).toEqual(['addressLine1', 'city', 'label'])
  })

  it.each(['7501', '750111', 'abcde', '75 011', ''])('refuse le code postal %j', (postalCode) => {
    const r = propertySchema.safeParse({ ...valid, postalCode })
    expect(r.success).toBe(false)
    if (!r.success) expect(zodFieldErrors(r.error).postalCode?.[0]).toMatch(/code postal/i)
  })

  it('refuse les textes trop longs', () => {
    expect(propertySchema.safeParse({ ...valid, label: 'x'.repeat(121) }).success).toBe(false)
    expect(propertySchema.safeParse({ ...valid, description: 'x'.repeat(2001) }).success).toBe(false)
  })
})

describe('maintenanceNoteSchema', () => {
  it('exige un texte non vide', () => {
    expect(maintenanceNoteSchema.safeParse({ body: '  Chaudière révisée ' }).data).toEqual({ body: 'Chaudière révisée' })
    expect(maintenanceNoteSchema.safeParse({ body: '   ' }).success).toBe(false)
  })
})

describe('accessCodeSchema', () => {
  it('exige un libellé et un code, la note est facultative', () => {
    expect(accessCodeSchema.safeParse({ label: 'Portail', code: '4821', note: '' }).data).toEqual({ label: 'Portail', code: '4821', note: null })
    expect(accessCodeSchema.safeParse({ label: '', code: '1', note: '' }).success).toBe(false)
    expect(accessCodeSchema.safeParse({ label: 'x', code: ' ', note: '' }).success).toBe(false)
  })
})
