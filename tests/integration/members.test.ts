import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asAnon, asOwner, asUser, buildWorld, createAuthUser } from './personas'

const INVITEE_EMAIL = 'nouvelle.personne@example.test'
const INVITEE = '00000000-0000-4000-8000-0000000000e3'

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await fn(c)
  })

interface Invite {
  invitation_id: string
  token: string
  expires_at: string
}

const invite = async (c: pg.Client, email = INVITEE_EMAIL, role = 'reader', entity = E.A) =>
  (await c.query('select * from public.create_member_invitation($1, $2, $3)', [entity, email, role])).rows[0] as Invite

const consume = async (c: pg.Client, token: string, key: string | null = null) =>
  (await c.query('select * from public.consume_invitation($1, $2)', [token, key])).rows[0] as { status: string; entity_id: string | null }

/** Compte de l'invité, adresse vérifiée (ou non). */
const createInvitee = async (c: pg.Client, id: string = INVITEE, email = INVITEE_EMAIL, verified = true) => {
  await createAuthUser(c, id, email)
  if (verified) await c.query('update auth.users set email_confirmed_at = now() where id = $1', [id])
}

const membership = async (c: pg.Client, profile: string, entity = E.A) =>
  (await c.query('select role, status from public.entity_memberships where entity_id = $1 and profile_id = $2', [entity, profile])).rows[0]

describe('create_member_invitation', () => {
  it('l\'administrateur crée une invitation liée à l\'e-mail ; le jeton n\'est stocké que haché', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c, '  Nouvelle.Personne@Example.Test ', 'manager')
      expect(inv.token).toMatch(/^[0-9a-f]{64}$/)
      await asOwner(c)
      const row = (
        await c.query(
          "select kind, email, role, created_by, expires_at - created_at as validity, token_hash = encode(sha256(convert_to($2, 'UTF8')), 'hex') as hashed from public.invitations where id = $1",
          [inv.invitation_id, inv.token],
        )
      ).rows[0]
      expect(row).toEqual({ kind: 'member', email: INVITEE_EMAIL, role: 'manager', created_by: U.adminA, validity: { days: 14 }, hashed: true })
    })
  })

  it.each([
    ['gestionnaire', U.managerA, 'aal2'],
    ['lecteur', U.readerA, 'aal2'],
    ['administrateur sans second facteur', U.adminA, 'aal1'],
    ['administrateur d\'une autre structure', U.adminB, 'aal2'],
    ['membre suspendu', U.suspendedA, 'aal2'],
  ] as const)('refuse : %s', async (_label, user, aal) => {
    await world(async (c) => {
      await asUser(c, user, aal)
      await expect(invite(c)).rejects.toThrow(/Droit insuffisant/)
    })
  })

  it('refuse une adresse invalide, un rôle inconnu et une personne déjà membre', async () => {
    for (const [email, role, message] of [
      ['pas-un-email', 'reader', /Adresse e-mail/],
      [INVITEE_EMAIL, 'proprietaire', /Rôle/],
      ['manager.a@example.test', 'reader', /déjà membre/],
    ] as const) {
      await world(async (c) => {
        await asUser(c, U.adminA)
        await expect(invite(c, email, role)).rejects.toThrow(message)
      })
    }
  })

  it('une nouvelle invitation pour la même adresse révoque la précédente', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const first = await invite(c)
      const second = await invite(c, INVITEE_EMAIL, 'manager')
      await asOwner(c)
      const { rows } = await c.query('select id, revoked_at is not null as revoked from public.invitations where email = $1 order by created_at, id', [INVITEE_EMAIL])
      expect(rows.find((r) => r.id === first.invitation_id).revoked).toBe(true)
      expect(rows.find((r) => r.id === second.invitation_id).revoked).toBe(false)
    })
  })

  it('trace la création et la révocation sans e-mail', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await invite(c)
      await invite(c)
      const { rows } = await c.query("select action, details from public.audit_logs where subject_table = 'invitations' and entity_id = $1", [E.A])
      expect(rows.map((r) => r.action).sort()).toEqual(['invitation.created', 'invitation.created', 'invitation.revoked'])
      expect(JSON.stringify(rows)).not.toContain('example.test')
    })
  })
})

describe('revoke_invitation', () => {
  it('l\'administrateur révoque une invitation en attente ; le jeton ne fonctionne plus', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await c.query('select public.revoke_invitation($1)', [inv.invitation_id])
      await asOwner(c)
      await createInvitee(c)
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, inv.token)).status).toBe('invalid')
    })
  })

  it('refuse un gestionnaire, et une invitation déjà révoquée', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await c.query('select public.revoke_invitation($1)', [inv.invitation_id])
      await expect(c.query('select public.revoke_invitation($1)', [inv.invitation_id])).rejects.toThrow(/introuvable/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asUser(c, U.managerA)
      await expect(c.query('select public.revoke_invitation($1)', [inv.invitation_id])).rejects.toThrow(/introuvable/)
    })
  })
})

describe('consume_invitation', () => {
  it('crée le membre avec le rôle invité, consomme le lien et trace', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c, INVITEE_EMAIL, 'manager')
      await asOwner(c)
      await createInvitee(c)

      await asUser(c, INVITEE, 'aal1')
      expect(await consume(c, inv.token)).toEqual({ status: 'ok', entity_id: E.A })

      await asOwner(c)
      expect(await membership(c, INVITEE)).toEqual({ role: 'manager', status: 'active' })
      const used = (await c.query('select used_at is not null as used, used_by from public.invitations where id = $1', [inv.invitation_id])).rows[0]
      expect(used).toEqual({ used: true, used_by: INVITEE })
      const actions = (await c.query('select action from public.audit_logs where entity_id = $1 and actor_id = $2', [E.A, INVITEE])).rows.map((r) => r.action)
      expect(actions.sort()).toEqual(['invitation.used', 'member.created'])
    })
  })

  it('un lien ne sert qu\'une fois', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asOwner(c)
      await createInvitee(c)
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, inv.token)).status).toBe('ok')
      expect((await consume(c, inv.token)).status).toBe('invalid')
    })
  })

  it('refuse si l\'adresse vérifiée diffère de celle de l\'invitation', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asOwner(c)
      await createInvitee(c, INVITEE, 'quelquun.dautre@example.test')
      await asUser(c, INVITEE, 'aal1')
      expect(await consume(c, inv.token)).toEqual({ status: 'invalid', entity_id: null })
      await asOwner(c)
      expect(await membership(c, INVITEE)).toBeUndefined()
      const row = (await c.query('select used_at from public.invitations where id = $1', [inv.invitation_id])).rows[0]
      expect(row.used_at).toBeNull()
    })
  })

  it('refuse si l\'adresse du compte n\'est pas vérifiée', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asOwner(c)
      await createInvitee(c, INVITEE, INVITEE_EMAIL, false)
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, inv.token)).status).toBe('invalid')
    })
  })

  it('refuse un lien expiré, inconnu, mal formé ou d\'un autre genre', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const expired = await invite(c, INVITEE_EMAIL)
      await asOwner(c)
      await c.query("update public.invitations set expires_at = now() - interval '1 second' where id = $1", [expired.invitation_id])
      await c.query(
        "insert into public.invitations (entity_id, kind, tenant_id, token_hash, created_by) values ($1, 'tenant', gen_random_uuid(), encode(sha256(convert_to('jeton-locataire', 'UTF8')), 'hex'), $2)",
        [E.A, U.adminA],
      )
      await createInvitee(c)
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, expired.token)).status).toBe('invalid')
      expect((await consume(c, 'f'.repeat(64))).status).toBe('invalid')
      expect((await consume(c, 'pas un jeton')).status).toBe('invalid')
      expect((await consume(c, 'jeton-locataire')).status).toBe('invalid')
    })
  })

  it('refuse un profil désactivé et une personne déjà membre', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c, 'reader.a@example.test').catch(() => null)
      expect(inv).toBeNull() // déjà membre : l'invitation n'a même pas pu être créée
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asOwner(c)
      await createInvitee(c)
      await c.query("update public.profiles set status = 'disabled' where id = $1", [INVITEE])
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, inv.token)).status).toBe('invalid')
    })
  })

  it('un membre suspendu ne se réactive pas avec une invitation', async () => {
    await world(async (c) => {
      await asOwner(c)
      await c.query("update auth.users set email_confirmed_at = now() where id = $1", [U.suspendedA])
      await c.query(
        "insert into public.invitations (entity_id, kind, email, role, token_hash, created_by) values ($1, 'member', 'suspended.a@example.test', 'reader', encode(sha256(convert_to('jeton-suspendu', 'UTF8')), 'hex'), $2)",
        [E.A, U.adminA],
      )
      await asUser(c, U.suspendedA, 'aal1')
      expect((await consume(c, 'jeton-suspendu')).status).toBe('invalid')
      await asOwner(c)
      expect((await membership(c, U.suspendedA))?.status).toBe('suspended')
    })
  })

  it('bloque après 10 essais ratés par profil, même avec le bon jeton', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asOwner(c)
      await createInvitee(c)
      await asUser(c, INVITEE, 'aal1')
      for (let i = 0; i < 10; i++) expect((await consume(c, 'e'.repeat(64))).status).toBe('invalid')
      expect((await consume(c, inv.token)).status).toBe('locked')

      await asOwner(c)
      await c.query("update public.invitation_attempts set attempted_at = now() - interval '61 minutes'")
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, inv.token)).status).toBe('ok')
    })
  })

  it('bloque aussi par adresse réseau, quel que soit le compte', async () => {
    await world(async (c) => {
      await asOwner(c)
      await createInvitee(c, INVITEE, INVITEE_EMAIL)
      await createInvitee(c, '00000000-0000-4000-8000-0000000000e2', 'autre@example.test')
      await asUser(c, '00000000-0000-4000-8000-0000000000e2', 'aal1')
      for (let i = 0; i < 10; i++) await consume(c, 'd'.repeat(64), 'cle-reseau')
      await asUser(c, INVITEE, 'aal1')
      expect((await consume(c, 'c'.repeat(64), 'cle-reseau')).status).toBe('locked')
      expect((await consume(c, 'c'.repeat(64), 'autre-cle')).status).toBe('invalid')
    })
  })

  it('exige une session ouverte', async () => {
    await world(async (c) => {
      await asAnon(c)
      await expect(consume(c, 'a'.repeat(64))).rejects.toThrow(/permission denied/)
    })
  })

  it('un utilisateur ne lit jamais le journal des essais', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(c.query('select * from public.invitation_attempts')).rejects.toThrow(/permission denied/)
    })
  })
})

describe('has_permission exposée à l\'application', () => {
  it('reprend la règle de la base pour l\'utilisateur connecté', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect((await c.query("select public.has_permission($1, 'member:write') as ok", [E.A])).rows[0].ok).toBe(true)
      await asUser(c, U.readerA)
      expect((await c.query("select public.has_permission($1, 'member:write') as ok", [E.A])).rows[0].ok).toBe(false)
      await asUser(c, U.adminA, 'aal1')
      expect((await c.query("select public.has_permission($1, 'member:write') as ok", [E.A])).rows[0].ok).toBe(false)
    })
  })
})

describe('rôles et suspension', () => {
  it('un membre suspendu perd ses droits, la réactivation les rend', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query("update public.entity_memberships set status = 'suspended' where profile_id = $1", [U.managerA])
      await asUser(c, U.managerA)
      expect((await c.query("select public.has_permission($1, 'payment:write') as ok", [E.A])).rows[0].ok).toBe(false)
      await asUser(c, U.adminA)
      await c.query("update public.entity_memberships set status = 'active' where profile_id = $1", [U.managerA])
      await asUser(c, U.managerA)
      expect((await c.query("select public.has_permission($1, 'payment:write') as ok", [E.A])).rows[0].ok).toBe(true)
    })
  })
})
