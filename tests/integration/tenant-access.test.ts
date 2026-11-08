import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld, createAuthUser } from './personas'

const TENANT = '00000000-0000-4000-8000-0000000000f1'
const TENANT_2 = '00000000-0000-4000-8000-0000000000f2'
const ACCOUNT = '00000000-0000-4000-8000-0000000000f3'
const ACCOUNT_2 = '00000000-0000-4000-8000-0000000000f4'
const ACCOUNT_EMAIL = 'compte.locataire@example.test'

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query(
      "insert into public.tenants (id, entity_id, last_name, first_name, email) values ($1, $3, 'Durand', 'Alice', 'alice.durand@example.test'), ($2, $3, 'Martin', 'Bob', null)",
      [TENANT, TENANT_2, E.A],
    )
    await createAuthUser(c, ACCOUNT, ACCOUNT_EMAIL)
    await c.query('update auth.users set email_confirmed_at = now() where id = $1', [ACCOUNT])
    await createAuthUser(c, ACCOUNT_2, 'autre.compte@example.test')
    await c.query('update auth.users set email_confirmed_at = now() where id = $1', [ACCOUNT_2])
    await fn(c)
  })

const invite = async (c: pg.Client, tenant = TENANT) =>
  (await c.query('select * from public.create_tenant_invitation($1)', [tenant])).rows[0] as { invitation_id: string; token: string }

const consume = async (c: pg.Client, token: string, consent = true, key: string | null = null) =>
  (await c.query('select * from public.consume_tenant_invitation($1, $2, $3, $4)', [token, key, consent, 'v1'])).rows[0] as {
    status: string
    request_id: string | null
    entity_name: string | null
  }

/** Invitation, demande du compte, puis retour à l'administrateur. */
const request = async (c: pg.Client, account = ACCOUNT, tenant = TENANT) => {
  await asUser(c, U.adminA)
  const inv = await invite(c, tenant)
  await asUser(c, account, 'aal1')
  const res = await consume(c, inv.token)
  await asUser(c, U.adminA)
  return { inv, id: res.request_id as string }
}

/** Une requête refusée par la base, sans abandonner la transaction du test. */
const refuses = async (c: pg.Client, message: RegExp | undefined, sql: string, params?: unknown[]) => {
  await c.query('savepoint refus')
  const error = await c.query(sql, params).then(
    () => null,
    (e: Error) => e,
  )
  await c.query('rollback to savepoint refus')
  expect(error, 'la requête devait être refusée').not.toBeNull()
  if (message) expect(error!.message).toMatch(message)
}

const status = async (c: pg.Client, id: string) => {
  await asOwner(c)
  return (await c.query('select status, consent_withdrawn_at is not null as withdrawn from public.tenant_access where id = $1', [id])).rows[0]
}

describe('create_tenant_invitation', () => {
  it('l\'administrateur et le gestionnaire créent un lien de 14 jours, jeton stocké haché', async () => {
    for (const user of [U.adminA, U.managerA]) {
      await world(async (c) => {
        await asUser(c, user)
        const inv = await invite(c)
        expect(inv.token).toMatch(/^[0-9a-f]{64}$/)
        await asOwner(c)
        const row = (
          await c.query(
            "select kind, tenant_id, email, expires_at - created_at as validity, token_hash = encode(sha256(convert_to($2, 'UTF8')), 'hex') as hashed from public.invitations where id = $1",
            [inv.invitation_id, inv.token],
          )
        ).rows[0]
        expect(row).toEqual({ kind: 'tenant', tenant_id: TENANT, email: null, validity: { days: 14 }, hashed: true })
      })
    }
  })

  it.each([
    ['lecteur', U.readerA, 'aal2'],
    ['gestionnaire sans second facteur', U.managerA, 'aal1'],
    ['administrateur d\'une autre structure', U.adminB, 'aal2'],
    ['membre suspendu', U.suspendedA, 'aal2'],
  ] as const)('refuse : %s', async (_label, user, aal) => {
    await world(async (c) => {
      await asUser(c, user, aal)
      await expect(invite(c)).rejects.toThrow(/Droit insuffisant/)
    })
  })

  it('une nouvelle invitation révoque la précédente ; refusée pour un dossier archivé ou déjà rattaché', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const first = await invite(c)
      const second = await invite(c)
      await asOwner(c)
      const { rows } = await c.query('select id, revoked_at is not null as revoked from public.invitations where tenant_id = $1', [TENANT])
      expect(rows.find((r) => r.id === first.invitation_id).revoked).toBe(true)
      expect(rows.find((r) => r.id === second.invitation_id).revoked).toBe(false)

      await c.query('update public.tenants set archived_at = now() where id = $1', [TENANT_2])
      await asUser(c, U.adminA)
      await expect(invite(c, TENANT_2)).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      const { id } = await request(c)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await expect(invite(c)).rejects.toThrow(/déjà rattaché/)
    })
  })
})

describe('consume_tenant_invitation', () => {
  it('crée une demande en attente avec le consentement, sans rien accorder', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asUser(c, ACCOUNT, 'aal1')
      const res = await consume(c, inv.token)
      expect(res).toMatchObject({ status: 'ok', entity_name: 'Structure A' })
      await asOwner(c)
      const row = (
        await c.query('select status, profile_id, tenant_id, consent_version, consent_at is not null as consented from public.tenant_access where id = $1', [res.request_id]))
        .rows[0]
      expect(row).toEqual({ status: 'pending', profile_id: ACCOUNT, tenant_id: TENANT, consent_version: 'v1', consented: true })
      expect((await c.query('select used_by from public.invitations where id = $1', [inv.invitation_id])).rows[0].used_by).toBe(ACCOUNT)
    })
  })

  it('sans consentement : rien n\'est consommé, quel que soit le jeton', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, inv.token, false)).status).toBe('consent_required')
      expect((await consume(c, 'jeton-inconnu', false)).status).toBe('consent_required')
      expect((await consume(c, inv.token)).status).toBe('ok')
    })
  })

  it('message unique pour tout lien invalide : inconnu, déjà utilisé, révoqué, expiré, compte non vérifié', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const used = await invite(c, TENANT)
      const revoked = await invite(c, TENANT_2)
      await c.query('select public.revoke_invitation($1)', [revoked.invitation_id])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, used.token)).status).toBe('ok')
      await asUser(c, ACCOUNT_2, 'aal1')
      expect((await consume(c, used.token)).status).toBe('invalid')
      expect((await consume(c, revoked.token)).status).toBe('invalid')
      expect((await consume(c, 'a'.repeat(64))).status).toBe('invalid')

      await asOwner(c)
      await c.query("update public.invitations set expires_at = now() - interval '1 second' where tenant_id = $1", [TENANT_2])
      await asUser(c, U.adminA)
      const expired = await invite(c, TENANT_2)
      await asOwner(c)
      await c.query("update public.invitations set expires_at = now() - interval '1 second' where id = $1", [expired.invitation_id])
      await c.query('update auth.users set email_confirmed_at = null where id = $1', [ACCOUNT_2])
      await asUser(c, ACCOUNT_2, 'aal1')
      expect((await consume(c, expired.token)).status).toBe('invalid')
    })
  })

  it('un compte à l\'e-mail non vérifié ne peut pas faire de demande, même avec un lien valable', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const inv = await invite(c)
      await asOwner(c)
      await c.query('update auth.users set email_confirmed_at = null where id = $1', [ACCOUNT])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, inv.token)).status).toBe('invalid')
    })
  })

  it('un lien de membre ne sert pas pour un locataire, et inversement', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const member = (await c.query("select * from public.create_member_invitation($1, $2, 'reader')", [E.A, ACCOUNT_EMAIL])).rows[0]
      const tenant = await invite(c)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, member.token)).status).toBe('invalid')
      expect((await c.query('select * from public.consume_invitation($1, null)', [tenant.token])).rows[0].status).toBe('invalid')
    })
  })

  it('jamais de rattachement par l\'e-mail seul : l\'e-mail du compte identique à celui du dossier ne donne rien', async () => {
    await world(async (c) => {
      await asOwner(c)
      await c.query('update public.tenants set email = $1 where id = $2', [ACCOUNT_EMAIL, TENANT])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select * from public.my_tenant_access()')).rows).toEqual([])
      expect((await c.query('select * from public.tenants')).rows).toEqual([])
    })
  })

  it('verrouille après 10 essais ratés en une heure', async () => {
    await world(async (c) => {
      await asUser(c, ACCOUNT, 'aal1')
      for (let i = 0; i < 10; i++) expect((await consume(c, `faux-${i}`)).status).toBe('invalid')
      expect((await consume(c, 'faux-final')).status).toBe('locked')
    })
  })

  it('refuse un dossier déjà rattaché, et une seule demande en attente par compte et dossier', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      const again = await invite(c)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, again.token)).status).toBe('invalid')
      await asUser(c, U.adminA)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await expect(invite(c)).rejects.toThrow(/déjà rattaché/)
    })
  })
})

describe('validation, refus, révocation', () => {
  it('le propriétaire voit les deux e-mails avec un avertissement en cas d\'écart', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      const { rows } = await c.query('select * from public.tenant_access_overview($1)', [E.A])
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        id, tenant_name: 'Alice Durand', tenant_email: 'alice.durand@example.test', account_email: ACCOUNT_EMAIL, email_mismatch: true, status: 'pending',
      })
    })
  })

  it('valide : la demande devient active ; trace sans donnée personnelle', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      expect((await status(c, id)).status).toBe('active')
      const { rows } = await c.query("select action, details from public.audit_logs where subject_table = 'tenant_access'")
      expect(rows.map((r) => r.action).sort()).toEqual(['tenant_access.approved', 'tenant_access.requested'])
      expect(JSON.stringify(rows)).not.toMatch(/example\.test|Durand/)
    })
  })

  it('refuse : la demande est refusée et un nouveau lien est possible', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await c.query('select public.decide_tenant_access($1, false)', [id])
      expect((await status(c, id)).status).toBe('refused')
      await asUser(c, U.adminA)
      const again = await invite(c)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, again.token)).status).toBe('ok')
    })
  })

  it.each([
    ['lecteur', U.readerA],
    ['administrateur d\'une autre structure', U.adminB],
  ] as const)('refuse la décision d\'un %s', async (_label, user) => {
    await world(async (c) => {
      const { id } = await request(c)
      await asUser(c, user)
      await refuses(c, /Droit insuffisant/, 'select public.decide_tenant_access($1, true)', [id])
      await refuses(c, /Droit insuffisant/, 'select * from public.tenant_access_overview($1)', [E.A])
    })
  })

  it('le locataire ne peut pas valider sa propre demande', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await asUser(c, ACCOUNT, 'aal1')
      await refuses(c, /Droit insuffisant/, 'select public.decide_tenant_access($1, true)', [id])
      await refuses(c, undefined, "update public.tenant_access set status = 'active'")
      expect((await c.query('select * from public.tenant_access')).rows).toEqual([])
    })
  })

  it('une demande déjà traitée ne se traite pas deux fois ; deux comptes pour un dossier : le second est refusé à la validation', async () => {
    await world(async (c) => {
      const first = await request(c)
      const second = await request(c, ACCOUNT_2)
      await c.query('select public.decide_tenant_access($1, true)', [first.id])
      await refuses(c, /déjà été traitée/, 'select public.decide_tenant_access($1, true)', [first.id])
      await refuses(c, /déjà rattaché/, 'select public.decide_tenant_access($1, true)', [second.id])
    })
  })

  it('le propriétaire révoque : effet immédiat, historique conservé, nouveau lien possible', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await c.query('select public.revoke_tenant_access($1)', [id])
      expect((await status(c, id)).status).toBe('revoked')
      await asUser(c, U.adminA)
      const again = await invite(c)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await consume(c, again.token)).status).toBe('ok')
      const mine = (await c.query('select status from public.my_tenant_access() order by requested_at')).rows.map((r) => r.status)
      expect(mine.sort()).toEqual(['pending', 'revoked'])
    })
  })

  it('le locataire se détache lui-même ; un autre compte ne le peut pas', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await asUser(c, ACCOUNT_2, 'aal1')
      await refuses(c, /Droit insuffisant/, 'select public.revoke_tenant_access($1)', [id])
      await asUser(c, ACCOUNT, 'aal1')
      await c.query('select public.revoke_tenant_access($1)', [id])
      expect((await status(c, id)).status).toBe('revoked')
      await asUser(c, U.adminA)
      await refuses(c, /n'est pas actif/, 'select public.revoke_tenant_access($1)', [id])
    })
  })
})

describe('retrait du consentement', () => {
  it('pose « remise papier demandée » sur le dossier sans révoquer le rattachement', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await asUser(c, ACCOUNT, 'aal1')
      await c.query('select public.withdraw_tenant_consent($1)', [id])
      await c.query('select public.withdraw_tenant_consent($1)', [id])
      expect(await status(c, id)).toEqual({ status: 'active', withdrawn: true })
      expect((await c.query('select paper_delivery_requested from public.tenants where id = $1', [TENANT])).rows[0].paper_delivery_requested).toBe(true)
      expect((await c.query("select count(*)::int as n from public.audit_logs where action = 'tenant_access.consent_withdrawn'")).rows[0].n).toBe(1)
    })
  })

  it('réservé au locataire concerné, et à un rattachement actif', async () => {
    await world(async (c) => {
      const { id } = await request(c)
      await asUser(c, ACCOUNT, 'aal1')
      await refuses(c, /n'est pas actif/, 'select public.withdraw_tenant_consent($1)', [id])
      await asUser(c, U.adminA)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await refuses(c, /introuvable/, 'select public.withdraw_tenant_consent($1)', [id])
    })
  })
})

describe('lectures et expiration', () => {
  it('le locataire ne voit que ses demandes (statut et nom de structure) ; l\'autre compte ne voit rien', async () => {
    await world(async (c) => {
      await request(c)
      await asUser(c, ACCOUNT, 'aal1')
      const mine = (await c.query('select * from public.my_tenant_access()')).rows
      expect(mine).toHaveLength(1)
      expect(mine[0]).toMatchObject({ entity_name: 'Structure A', status: 'pending' })
      await asUser(c, ACCOUNT_2, 'aal1')
      expect((await c.query('select * from public.my_tenant_access()')).rows).toEqual([])
    })
  })

  it('le propriétaire lit les demandes de sa structure seulement', async () => {
    await world(async (c) => {
      await request(c)
      expect((await c.query('select id from public.tenant_access')).rows).toHaveLength(1)
      await asUser(c, U.adminB)
      expect((await c.query('select id from public.tenant_access')).rows).toEqual([])
    })
  })

  it('expire les demandes en attente depuis plus de 30 jours, de façon idempotente', async () => {
    await world(async (c) => {
      const old = await request(c)
      const recent = await request(c, ACCOUNT_2, TENANT_2)
      await asOwner(c)
      await c.query("update public.tenant_access set requested_at = now() - interval '31 days' where id = $1", [old.id])
      expect((await c.query('select app.expire_tenant_access() as n')).rows[0].n).toBe(1)
      expect((await c.query('select app.expire_tenant_access() as n')).rows[0].n).toBe(0)
      expect((await status(c, old.id)).status).toBe('expired')
      expect((await status(c, recent.id)).status).toBe('pending')
      await asUser(c, U.adminA)
      await refuses(c, /déjà été traitée|expiré/, 'select public.decide_tenant_access($1, true)', [old.id])
    })
  })

  it('la tâche quotidienne est planifiée', async () => {
    await inRollback(async (c) => {
      const { rows } = await c.query("select schedule from cron.job where jobname = 'expire-tenant-access'")
      expect(rows).toHaveLength(1)
    })
  })
})
