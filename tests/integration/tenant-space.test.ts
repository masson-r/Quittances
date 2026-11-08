import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld, createAuthUser } from './personas'

const TENANT = '00000000-0000-4000-8000-0000000000f1'
const ROOMMATE = '00000000-0000-4000-8000-0000000000f2'
const ACCOUNT = '00000000-0000-4000-8000-0000000000f3'
const ACCOUNT_2 = '00000000-0000-4000-8000-0000000000f4'
const PROPERTY = '00000000-0000-4000-8000-0000000000f5'
const LEASE = '00000000-0000-4000-8000-0000000000f6'

/** Locataire rattaché (ACCOUNT → TENANT), colocataire non rattaché, un bail avec deux conditions de loyer. */
const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query(
      `insert into public.tenants (id, entity_id, last_name, first_name, email) values
         ($1, $3, 'Durand', 'Alice', 'alice@example.test'), ($2, $3, 'Martin', 'Bob', 'bob@example.test')`,
      [TENANT, ROOMMATE, E.A],
    )
    await c.query("insert into public.tenant_private_details (tenant_id, entity_id, guarantor_name, housing_aid) values ($1, $2, 'Garant secret', 'to_tenant')", [TENANT, E.A])
    await c.query("insert into public.properties (id, entity_id, label, address_line1, postal_code, city) values ($1, $2, 'Appartement 3', '1 rue des Lilas', '75001', 'Paris')", [PROPERTY, E.A])
    await c.query("insert into public.leases (id, entity_id, property_id, start_date, due_day) values ($1, $2, $3, '2025-01-01', 5)", [LEASE, E.A, PROPERTY])
    await c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2025-01-01'), ($1, $2, $4, '2025-01-01')", [E.A, LEASE, TENANT, ROOMMATE])
    await c.query(
      "insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2025-01-01', 70000, 5000), ($1, $2, '2025-06-01', 72000, 6000)",
      [E.A, LEASE],
    )
    for (const [id, email] of [[ACCOUNT, 'compte@example.test'], [ACCOUNT_2, 'autre@example.test']] as const) {
      await createAuthUser(c, id, email)
      await c.query('update auth.users set email_confirmed_at = now() where id = $1', [id])
    }
    await fn(c)
  })

/** Rattache `account` au dossier `tenant` par le parcours complet. */
const attach = async (c: pg.Client, account: string, tenant: string, approve = true) => {
  await asUser(c, U.adminA)
  const inv = (await c.query('select * from public.create_tenant_invitation($1)', [tenant])).rows[0]
  await asUser(c, account, 'aal1')
  const id = (await c.query("select request_id from public.consume_tenant_invitation($1, null, true, 'v1')", [inv.token])).rows[0].request_id
  await asUser(c, U.adminA)
  if (approve) await c.query('select public.decide_tenant_access($1, true)', [id])
  return id as string
}

describe('espace du locataire rattaché', () => {
  it('voit ses coordonnées, sans garant ni aide au logement ni dossier du colocataire', async () => {
    await world(async (c) => {
      await attach(c, ACCOUNT, TENANT)
      await asUser(c, ACCOUNT, 'aal1')
      const { rows } = await c.query('select * from public.my_tenant_dossiers()')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ tenant_id: TENANT, entity_name: 'Structure A', first_name: 'Alice', last_name: 'Durand', email: 'alice@example.test' })
      expect(JSON.stringify(rows)).not.toMatch(/Garant|to_tenant|Martin|bob@/)
      expect((await c.query('select * from public.tenants')).rows).toEqual([])
      expect((await c.query('select * from public.tenant_private_details')).rows).toEqual([])
    })
  })

  it('voit le résumé de ses baux avec les conditions en vigueur, sans échéance, paiement ni solde', async () => {
    await world(async (c) => {
      await attach(c, ACCOUNT, TENANT)
      await asUser(c, ACCOUNT, 'aal1')
      const { rows } = await c.query('select * from public.my_tenant_leases()')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ property_label: 'Appartement 3', rent_cents: 72000, charges_cents: 6000 })
      for (const table of ['rent_charges', 'payments', 'payment_allocations', 'leases', 'rental_terms', 'charge_settlements']) {
        await c.query('savepoint s')
        const res = await c.query(`select * from public.${table}`).catch(() => ({ rows: [] }))
        await c.query('rollback to savepoint s')
        expect(res.rows, table).toEqual([])
      }
    })
  })

  it('rien avant validation, ni après révocation, ni pour un compte non rattaché', async () => {
    await world(async (c) => {
      const id = await attach(c, ACCOUNT, TENANT, false)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select * from public.my_tenant_dossiers()')).rows).toEqual([])
      expect((await c.query('select * from public.my_tenant_leases()')).rows).toEqual([])

      await asUser(c, U.adminA)
      await c.query('select public.decide_tenant_access($1, true)', [id])
      await asUser(c, ACCOUNT_2, 'aal1')
      expect((await c.query('select * from public.my_tenant_dossiers()')).rows).toEqual([])
      expect((await c.query('select * from public.my_tenant_leases()')).rows).toEqual([])

      await asUser(c, U.adminA)
      await c.query('select public.revoke_tenant_access($1)', [id])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select * from public.my_tenant_dossiers()')).rows).toEqual([])
      expect((await c.query('select * from public.my_tenant_leases()')).rows).toEqual([])
    })
  })

  it('en colocation, chaque colocataire ne voit que son dossier mais le même bail', async () => {
    await world(async (c) => {
      await attach(c, ACCOUNT, TENANT)
      await attach(c, ACCOUNT_2, ROOMMATE)
      for (const [account, expected] of [[ACCOUNT, TENANT], [ACCOUNT_2, ROOMMATE]] as const) {
        await asUser(c, account, 'aal1')
        expect((await c.query('select tenant_id from public.my_tenant_dossiers()')).rows).toEqual([{ tenant_id: expected }])
        expect((await c.query('select lease_id from public.my_tenant_leases() order by lease_id')).rows.map((r) => r.lease_id)).toContain(LEASE)
      }
    })
  })

  it('met à jour ses coordonnées de contact (pas l\'e-mail ni le nom), avec trace', async () => {
    await world(async (c) => {
      await attach(c, ACCOUNT, TENANT)
      await asUser(c, ACCOUNT, 'aal1')
      await c.query("select public.update_my_contact($1, ' 0612345678 ', '5 avenue Neuve', '69001', 'Lyon')", [TENANT])
      await asOwner(c)
      const row = (await c.query('select phone, address_line1, postal_code, city, email, last_name from public.tenants where id = $1', [TENANT])).rows[0]
      expect(row).toEqual({ phone: '0612345678', address_line1: '5 avenue Neuve', postal_code: '69001', city: 'Lyon', email: 'alice@example.test', last_name: 'Durand' })
      const audit = (await c.query("select details from public.audit_logs where action = 'tenant.contact_updated_by_tenant'")).rows
      expect(audit).toHaveLength(1)
      expect(JSON.stringify(audit)).not.toMatch(/0612|Lyon|Neuve/)
    })
  })

  it('ne modifie ni le dossier d\'un autre ni le sien sans rattachement actif', async () => {
    await world(async (c) => {
      await attach(c, ACCOUNT, TENANT)
      await asUser(c, ACCOUNT, 'aal1')
      await c.query('savepoint s')
      await expect(c.query("select public.update_my_contact($1, '1', null, null, null)", [ROOMMATE])).rejects.toThrow(/introuvable/)
      await c.query('rollback to savepoint s')
      await asUser(c, ACCOUNT_2, 'aal1')
      await expect(c.query("select public.update_my_contact($1, '1', null, null, null)", [TENANT])).rejects.toThrow(/introuvable/)
    })
  })
})
