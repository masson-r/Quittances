import { describe, expect, it } from 'vitest'
import { ROLES, isInvitationToken, roleLabel, statusLabel } from './roles'
import { fieldErrors, inviteMemberSchema, memberRoleSchema } from './schemas'

describe('libellés', () => {
  it('traduit les rôles et statuts de la base', () => {
    expect(roleLabel('administrator')).toBe('Administrateur')
    expect(roleLabel('manager')).toBe('Gestionnaire')
    expect(roleLabel('reader')).toBe('Lecteur')
    expect(statusLabel('active')).toBe('Actif')
    expect(statusLabel('suspended')).toBe('Suspendu')
  })

  it('liste les trois rôles dans l\'ordre d\'étendue des droits', () => {
    expect(ROLES).toEqual(['administrator', 'manager', 'reader'])
  })
})

describe('isInvitationToken', () => {
  it('accepte 64 caractères hexadécimaux en minuscules', () => {
    expect(isInvitationToken('a'.repeat(64))).toBe(true)
    expect(isInvitationToken('0123456789abcdef'.repeat(4))).toBe(true)
  })
  it.each(['', 'a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64), `${'a'.repeat(63)}/`])('refuse %j', (v) => {
    expect(isInvitationToken(v)).toBe(false)
  })
})

describe('inviteMemberSchema', () => {
  it('normalise l\'e-mail et valide le rôle', () => {
    const r = inviteMemberSchema.safeParse({ email: ' Marie@Example.Test ', role: 'manager' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data).toEqual({ email: 'marie@example.test', role: 'manager' })
  })
  it('refuse un rôle inconnu et un e-mail invalide, en français', () => {
    const r = inviteMemberSchema.safeParse({ email: 'x', role: 'proprietaire' })
    expect(r.success).toBe(false)
    if (!r.success) {
      const errors = fieldErrors(r.error)
      expect(errors.email?.[0]).toMatch(/adresse e-mail/i)
      expect(errors.role?.[0]).toMatch(/rôle/i)
    }
  })
})

describe('memberRoleSchema', () => {
  it('accepte les trois rôles seulement', () => {
    for (const role of ROLES) expect(memberRoleSchema.safeParse(role).success).toBe(true)
    expect(memberRoleSchema.safeParse('root').success).toBe(false)
  })
})
