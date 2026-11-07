import { describe, expect, it } from 'vitest'
import { buildInvitationLink, isLocalUrl, parseArgs, UsageError } from './create-structure-lib'

const base = ['--nom', 'SCI Les Tilleuls', '--genre', 'sci', '--admin', 'Marie.Dupont@Example.Test']

describe('parseArgs', () => {
  it('lit le nom, le genre et l\'e-mail de l\'administrateur', () => {
    expect(parseArgs(base)).toEqual({ name: 'SCI Les Tilleuls', kind: 'sci', adminEmail: 'marie.dupont@example.test', yes: false })
  })

  it('traduit le genre français vers l\'identifiant de la base', () => {
    expect(parseArgs(['--nom', 'Martin', '--genre', 'personne-physique', '--admin', 'a@example.test']).kind).toBe('natural_person')
    expect(parseArgs(['--nom', 'X', '--genre', 'autre', '--admin', 'a@example.test']).kind).toBe('other')
  })

  it('accepte --oui pour confirmer une base distante', () => {
    expect(parseArgs([...base, '--oui']).yes).toBe(true)
  })

  it.each([
    [['--genre', 'sci', '--admin', 'a@example.test'], /--nom/],
    [['--nom', 'X', '--admin', 'a@example.test'], /--genre/],
    [['--nom', 'X', '--genre', 'sci'], /--admin/],
    [['--nom', 'X', '--genre', 'banque', '--admin', 'a@example.test'], /Genre inconnu/],
    [['--nom', 'X', '--genre', 'sci', '--admin', 'pas-un-email'], /e-mail/],
    [['--nom', '   ', '--genre', 'sci', '--admin', 'a@example.test'], /--nom/],
    [[...base, '--inconnu', 'x'], /--inconnu/],
  ])('refuse %j', (argv, message) => {
    expect(() => parseArgs(argv as string[])).toThrow(UsageError)
    expect(() => parseArgs(argv as string[])).toThrow(message)
  })
})

describe('buildInvitationLink', () => {
  it('assemble l\'adresse du site et le jeton', () => {
    expect(buildInvitationLink('https://loyo-reg.example.fr/', 'abc123')).toBe('https://loyo-reg.example.fr/invitation/abc123')
    expect(buildInvitationLink('http://127.0.0.1:3000', 'abc123')).toBe('http://127.0.0.1:3000/invitation/abc123')
  })
})

describe('isLocalUrl', () => {
  it.each(['http://127.0.0.1:54321', 'http://localhost:54321'])('%s est locale', (u) => expect(isLocalUrl(u)).toBe(true))
  it.each(['https://abcd.supabase.co', 'http://192.168.1.10:54321', 'http://127.0.0.1.evil.example'])('%s ne l\'est pas', (u) => expect(isLocalUrl(u)).toBe(false))
})
