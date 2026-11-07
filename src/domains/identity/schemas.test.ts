import { describe, expect, it } from 'vitest'
import { fieldErrors, forgotPasswordSchema, newPasswordSchema, recoveryCodeSchema, signInSchema, signUpSchema, totpCodeSchema } from './schemas'

const valid = {
  firstName: 'Alice',
  lastName: 'Martin',
  email: '  Alice.Martin@Example.Test ',
  password: 'MotDePasse2026!',
  confirmPassword: 'MotDePasse2026!',
}

describe('signUpSchema', () => {
  it('accepte une inscription valide et normalise l\'e-mail', () => {
    const r = signUpSchema.safeParse(valid)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.email).toBe('alice.martin@example.test')
      expect(r.data.firstName).toBe('Alice')
    }
  })

  it('exige prénom et nom non vides', () => {
    const r = signUpSchema.safeParse({ ...valid, firstName: '   ', lastName: '' })
    expect(r.success).toBe(false)
    if (!r.success) expect(Object.keys(fieldErrors(r.error))).toEqual(expect.arrayContaining(['firstName', 'lastName']))
  })

  it.each([
    ['trop court', 'Court1A'],
    ['sans majuscule', 'motdepasse2026!'],
    ['sans minuscule', 'MOTDEPASSE2026!'],
    ['sans chiffre', 'MotDePasseLong!'],
  ])('refuse un mot de passe %s', (_label, password) => {
    const r = signUpSchema.safeParse({ ...valid, password, confirmPassword: password })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error).password?.[0]).toMatch(/mot de passe/i)
  })

  it('refuse un mot de passe de plus de 72 caractères', () => {
    const password = 'Aa1' + 'x'.repeat(70)
    expect(signUpSchema.safeParse({ ...valid, password, confirmPassword: password }).success).toBe(false)
  })

  it('refuse une confirmation différente', () => {
    const r = signUpSchema.safeParse({ ...valid, confirmPassword: 'Autre2026Motdepasse' })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error).confirmPassword?.[0]).toMatch(/identiques/)
  })

  it('refuse un e-mail invalide, en français', () => {
    const r = signUpSchema.safeParse({ ...valid, email: 'pas-un-email' })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error).email?.[0]).toMatch(/adresse e-mail/i)
  })
})

describe('signInSchema', () => {
  it('accepte e-mail et mot de passe, sans règle de complexité à la connexion', () => {
    expect(signInSchema.safeParse({ email: 'a@example.test', password: 'x' }).success).toBe(true)
  })
  it('refuse un mot de passe vide', () => {
    expect(signInSchema.safeParse({ email: 'a@example.test', password: '' }).success).toBe(false)
  })
})

describe('forgotPasswordSchema', () => {
  it('exige un e-mail valide', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'a@example.test' }).success).toBe(true)
    expect(forgotPasswordSchema.safeParse({ email: '' }).success).toBe(false)
  })
})

describe('newPasswordSchema', () => {
  it('applique les mêmes règles que l\'inscription', () => {
    expect(newPasswordSchema.safeParse({ password: 'MotDePasse2026!', confirmPassword: 'MotDePasse2026!' }).success).toBe(true)
    expect(newPasswordSchema.safeParse({ password: 'court', confirmPassword: 'court' }).success).toBe(false)
    expect(newPasswordSchema.safeParse({ password: 'MotDePasse2026!', confirmPassword: 'MotDePasse2027!' }).success).toBe(false)
  })
})

describe('totpCodeSchema', () => {
  it.each([['123456', '123456'], [' 123 456 ', '123456'], ['000000', '000000']])('accepte %j', (input, expected) => {
    const r = totpCodeSchema.safeParse({ code: input })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.code).toBe(expected)
  })

  it.each(['12345', '1234567', 'abcdef', '12 34 5a', ''])('refuse %j', (input) => {
    const r = totpCodeSchema.safeParse({ code: input })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error).code?.[0]).toMatch(/6 chiffres/)
  })
})

describe('recoveryCodeSchema', () => {
  it.each([
    ['a1b2-c3d4-e5f6-0789', 'a1b2-c3d4-e5f6-0789'],
    [' A1B2 C3D4 E5F6 0789 ', 'a1b2-c3d4-e5f6-0789'],
    ['a1b2c3d4e5f60789', 'a1b2-c3d4-e5f6-0789'],
  ])('normalise %j', (input, expected) => {
    const r = recoveryCodeSchema.safeParse({ code: input })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.code).toBe(expected)
  })

  it.each(['a1b2-c3d4-e5f6', 'g1b2-c3d4-e5f6-0789', 'a1b2-c3d4-e5f6-0789-aaaa', ''])('refuse %j', (input) => {
    const r = recoveryCodeSchema.safeParse({ code: input })
    expect(r.success).toBe(false)
    if (!r.success) expect(fieldErrors(r.error).code?.[0]).toMatch(/code de secours/)
  })
})
