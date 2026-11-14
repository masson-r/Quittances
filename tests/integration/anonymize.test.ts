import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld, createAuthUser } from './personas'

const T = '00000000-0000-4000-8000-0000000000f1'
const PROPERTY = '00000000-0000-4000-8000-0000000000c1'
const LEASE = '00000000-0000-4000-8000-0000000000a1'

/** Aujourd'hui = 15 mars 2026 ; bail terminé le 28 février 2023 (plus de trois ans), apurement final en option. */
const world = (fn: (c: pg.Client) => Promise<void>, opts: { end?: string | null; final?: boolean } = {}) =>
  inRollback(async (c) => {
    const end = opts.end === undefined ? '2023-02-28' : opts.end
    await buildWorld(c)
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-03-15', true)")
    await c.query("insert into public.tenants (id, entity_id, last_name, first_name, email, phone, address_line1, city) values ($1, $2, 'Durand', 'Alice', 'alice@example.test', '0102030405', '1 rue X', 'Paris')", [T, E.A])
    await c.query("insert into public.tenant_private_details (tenant_id, entity_id, guarantor_name, housing_aid) values ($1, $2, 'Garant', 'to_tenant')", [T, E.A])
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $2, 'Bien')", [PROPERTY, E.A])
    await c.query('insert into public.leases (id, entity_id, property_id, start_date, end_date, due_day) values ($1, $2, $3, $4, $5, 5)', [LEASE, E.A, PROPERTY, '2021-01-01', end])
    await c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date) values ($1, $2, $3, '2021-01-01', $4)", [E.A, LEASE, T, end])
    await c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2021-01-01', 50000, 0)", [E.A, LEASE])
    if (opts.final !== false) {
      await c.query("insert into public.charge_settlements (entity_id, lease_id, settled_on, amount_cents, mode, reason, is_final) values ($1, $2, '2023-03-10', 0, 'transfer', 'Apurement final', true)", [E.A, LEASE])
    }
    await fn(c)
  })

const refuses = async (c: pg.Client, message: RegExp, sql: string, params?: unknown[]) => {
  await c.query('savepoint refus')
  const error = await c.query(sql, params).then(() => null, (e: Error) => e)
  await c.query('rollback to savepoint refus')
  expect(error, 'la requête devait être refusée').not.toBeNull()
  expect(error!.message).toMatch(message)
}

describe('anonymize_tenant', () => {
  it('efface l\'identité et les données sensibles, conserve baux, finances et trace sans donnée personnelle', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query('select public.anonymize_tenant($1)', [T])
      await asOwner(c)
      const t = (await c.query('select last_name, first_name, email, phone, address_line1, city, anonymized_at is not null as done, archived_at is not null as archived from public.tenants where id = $1', [T])).rows[0]
      expect(t).toEqual({ last_name: 'Dossier anonymisé', first_name: '', email: null, phone: null, address_line1: null, city: null, done: true, archived: true })
      expect((await c.query('select count(*)::int as n from public.tenant_private_details where tenant_id = $1', [T])).rows[0].n).toBe(0)
      expect((await c.query('select count(*)::int as n from public.lease_tenants where tenant_id = $1', [T])).rows[0].n).toBe(1)
      expect((await c.query('select count(*)::int as n from public.leases where id = $1', [LEASE])).rows[0].n).toBe(1)
      const audit = (await c.query("select action, details from public.audit_logs where action = 'tenant.anonymized'")).rows
      expect(audit).toHaveLength(1)
      expect(JSON.stringify(audit)).not.toMatch(/Durand|alice/)
    })
  })

  it('révoque le rattachement et les invitations du dossier', async () => {
    await world(async (c) => {
      await createAuthUser(c, '00000000-0000-4000-8000-0000000000f3', 'compte@example.test')
      await c.query("update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000000f3'")
      await asUser(c, U.adminA)
      const inv = (await c.query('select * from public.create_tenant_invitation($1)', [T])).rows[0]
      await asUser(c, '00000000-0000-4000-8000-0000000000f3', 'aal1')
      const request = (await c.query("select request_id from public.consume_tenant_invitation($1, null, true, 'v1')", [inv.token])).rows[0].request_id
      await asUser(c, U.adminA)
      await c.query('select public.decide_tenant_access($1, true)', [request])
      await c.query('select public.anonymize_tenant($1)', [T])
      await asOwner(c)
      expect((await c.query('select status from public.tenant_access where id = $1', [request])).rows[0].status).toBe('revoked')
    })
  })

  it('refusée sans apurement final sur un bail terminé', async () => {
    await world(
      async (c) => {
        await asUser(c, U.adminA)
        await refuses(c, /apurement final/, 'select public.anonymize_tenant($1)', [T])
        await asOwner(c)
        await c.query("insert into public.charge_settlements (entity_id, lease_id, settled_on, amount_cents, mode, reason, is_final) values ($1, $2, '2023-03-10', 0, 'transfer', 'Final', true)", [E.A, LEASE])
        await asUser(c, U.adminA)
        await c.query('select public.anonymize_tenant($1)', [T])
      },
      { final: false },
    )
  })

  it('un apurement final annulé ne compte pas', async () => {
    await world(async (c) => {
      await asOwner(c)
      await c.query("update public.charge_settlements set cancelled_at = now(), cancellation_reason = 'erreur' where lease_id = $1", [LEASE])
      await asUser(c, U.adminA)
      await refuses(c, /apurement final/, 'select public.anonymize_tenant($1)', [T])
    })
  })

  it('refusée avant trois ans après la fin du dernier bail, ou si un bail est en cours', async () => {
    await world(
      async (c) => {
        await asUser(c, U.adminA)
        await refuses(c, /trois ans après la fin du dernier bail \(le 28\/02\/2026\)|trois ans/, 'select public.anonymize_tenant($1)', [T])
      },
      { end: '2023-03-16' },
    )
    await world(
      async (c) => {
        await asUser(c, U.adminA)
        await refuses(c, /en cours/, 'select public.anonymize_tenant($1)', [T])
      },
      { end: null, final: false },
    )
  })

  it('la limite est inclusive : exactement trois ans après la fin', async () => {
    await world(
      async (c) => {
        await asUser(c, U.adminA)
        await c.query('select public.anonymize_tenant($1)', [T])
      },
      { end: '2023-03-15' },
    )
  })

  it('réservée à l\'administrateur ; déjà anonymisé refusé', async () => {
    await world(async (c) => {
      for (const [user, aal] of [[U.managerA, 'aal2'], [U.readerA, 'aal2'], [U.adminB, 'aal2'], [U.adminA, 'aal1']] as const) {
        await asUser(c, user, aal)
        await refuses(c, /Droit insuffisant/, 'select public.anonymize_tenant($1)', [T])
      }
      await asUser(c, U.adminA)
      await c.query('select public.anonymize_tenant($1)', [T])
      await refuses(c, /déjà anonymisé/, 'select public.anonymize_tenant($1)', [T])
    })
  })
})
