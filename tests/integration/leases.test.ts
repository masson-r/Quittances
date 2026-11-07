import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = { a: '00000000-0000-4000-8000-0000000000c1', a2: '00000000-0000-4000-8000-0000000000c5', b: '00000000-0000-4000-8000-0000000000c2' }
const T = { a: '00000000-0000-4000-8000-0000000000c3', a2: '00000000-0000-4000-8000-0000000000c6', b: '00000000-0000-4000-8000-0000000000c4' }

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $4, 'Bien A'), ($2, $4, 'Bien A2'), ($3, $5, 'Bien B')", [P.a, P.a2, P.b, E.A, E.B])
    await c.query("insert into public.tenants (id, entity_id, last_name) values ($1, $4, 'Martin'), ($2, $4, 'Dupont'), ($3, $5, 'Durand')", [T.a, T.a2, T.b, E.A, E.B])
    await fn(c)
  })

const blocked = async (c: pg.Client, sql: string, params: unknown[] = []) => {
  await c.query('savepoint essai')
  try {
    const res = await c.query(sql, params)
    await c.query('release savepoint essai')
    return res.rowCount === 0
  } catch {
    await c.query('rollback to savepoint essai')
    return true
  }
}

const createLease = async (c: pg.Client, o: { property?: string; start?: string; end?: string | null; dueDay?: number; rent?: number; charges?: number; tenants?: string[]; entity?: string } = {}) =>
  (
    await c.query('select public.create_lease($1, $2, $3, $4, $5, $6, $7, $8) as id', [
      o.entity ?? E.A,
      o.property ?? P.a,
      o.start ?? '2026-01-01',
      o.end === undefined ? null : o.end,
      o.dueDay ?? 5,
      o.rent ?? 85000,
      o.charges ?? 5000,
      o.tenants ?? [T.a],
    ])
  ).rows[0].id as string

describe('create_lease', () => {
  it('crée le bail, la première version des conditions et les colocataires présents dès le début, en une transaction', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await createLease(c, { tenants: [T.a, T.a2], start: '2026-03-10' })
      const lease = (await c.query('select property_id, start_date::text as start, end_date, due_day from public.leases where id = $1', [id])).rows[0]
      expect(lease).toEqual({ property_id: P.a, start: '2026-03-10', end_date: null, due_day: 5 })
      const terms = (await c.query('select effective_from::text as from, rent_cents, charges_cents from public.rental_terms where lease_id = $1', [id])).rows
      expect(terms).toEqual([{ from: '2026-03-10', rent_cents: 85000, charges_cents: 5000 }])
      const presence = (await c.query('select tenant_id, start_date::text as start from public.lease_tenants where lease_id = $1 order by tenant_id', [id])).rows
      expect(presence).toEqual([
        { tenant_id: T.a, start: '2026-03-10' },
        { tenant_id: T.a2, start: '2026-03-10' },
      ])
    })
  })

  it('refuse sans le droit, sans locataire, et ne laisse rien derrière en cas d\'échec', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      await expect(createLease(c)).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(createLease(c, { tenants: [] })).rejects.toThrow(/au moins un locataire/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      await createLease(c)
      await c.query('savepoint essai')
      await expect(createLease(c, { start: '2026-06-01', tenants: [T.a2] })).rejects.toThrow(/leases_no_overlap/)
      await c.query('rollback to savepoint essai')
      expect(Number((await c.query('select count(*) as n from public.leases')).rows[0].n)).toBe(1)
      expect(Number((await c.query('select count(*) as n from public.lease_tenants')).rows[0].n)).toBe(1)
    })
  })

  it('ne lie jamais deux structures : bien ou locataire d\'une autre structure refusés', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(createLease(c, { property: P.b })).rejects.toThrow(/foreign key|violates/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(createLease(c, { tenants: [T.b] })).rejects.toThrow(/foreign key|violates/)
    })
    await world(async (c) => {
      await asUser(c, U.adminB)
      await expect(createLease(c, { entity: E.A })).rejects.toThrow(/Droit insuffisant/)
    })
  })

  it('refuse un jour d\'échéance ou des dates invalides', async () => {
    for (const o of [{ dueDay: 0 }, { dueDay: 32 }, { start: '2026-05-01', end: '2026-04-30' }, { rent: -1 }]) {
      await world(async (c) => {
        await asUser(c, U.adminA)
        await expect(createLease(c, o)).rejects.toThrow()
      })
    }
  })

  it('trace la création sans coordonnées', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const id = await createLease(c)
      await asOwner(c)
      const { rows } = await c.query("select action, details from public.audit_logs where subject_id = $1", [id])
      expect(rows.map((r) => r.action)).toEqual(['lease.created'])
      expect(JSON.stringify(rows)).not.toMatch(/Martin/)
      const all = (await c.query("select action from public.audit_logs where action like 'lease.%' and entity_id = $1", [E.A])).rows.map((r) => r.action).sort()
      expect(all).toEqual(['lease.created', 'lease.tenant_added', 'lease.terms_added'])
    })
  })
})

describe('chevauchement de baux sur un même bien', () => {
  it('interdit deux baux qui se chevauchent, jours de début et de fin compris', async () => {
    await world(async (c) => {
      await c.query("insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, '2026-01-01', '2026-06-30', 5)", [E.A, P.a])
      for (const [start, end] of [['2026-06-30', '2026-12-31'], ['2026-03-01', '2026-03-31'], ['2025-12-01', '2026-01-01'], ['2025-01-01', null]] as const) {
        await c.query('savepoint s')
        await expect(
          c.query('insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, $3, $4, 5)', [E.A, P.a, start, end]),
          `${start} → ${end}`,
        ).rejects.toThrow(/leases_no_overlap/)
        await c.query('rollback to savepoint s')
      }
    })
  })

  it('autorise des baux successifs et des baux sur des biens différents', async () => {
    await world(async (c) => {
      await c.query("insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, '2026-01-01', '2026-06-30', 5)", [E.A, P.a])
      await c.query("insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, '2026-07-01', null, 5)", [E.A, P.a])
      await c.query("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, '2026-01-01', 5)", [E.A, P.a2])
      expect(Number((await c.query('select count(*) as n from public.leases')).rows[0].n)).toBe(3)
    })
  })
})

describe('colocataires et périodes de présence', () => {
  it('un colocataire entre et sort sans nouveau bail', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const lease = await createLease(c)
      expect((await c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2026-04-01')", [E.A, lease, T.a2])).rowCount).toBe(1)
      expect((await c.query("update public.lease_tenants set end_date = '2026-08-31' where lease_id = $1 and tenant_id = $2", [lease, T.a2])).rowCount).toBe(1)
    })
  })

  it('refuse deux présences simultanées du même colocataire, accepte un retour après une sortie', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const lease = await createLease(c)
      await c.query("update public.lease_tenants set end_date = '2026-03-31' where lease_id = $1", [lease])
      await c.query('savepoint s')
      await expect(
        c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2026-03-15')", [E.A, lease, T.a]),
      ).rejects.toThrow(/lease_tenants_no_overlap/)
      await c.query('rollback to savepoint s')
      expect((await c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2026-06-01')", [E.A, lease, T.a])).rowCount).toBe(1)
    })
  })

  it('une présence reste dans la période du bail', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const lease = await createLease(c, { start: '2026-03-01', end: '2026-12-31', tenants: [T.a] })
      await c.query('savepoint s')
      await expect(
        c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date) values ($1, $2, $3, '2026-02-01', '2026-06-30')", [E.A, lease, T.a2]),
      ).rejects.toThrow(/période du bail/)
      await c.query('rollback to savepoint s')
      await expect(
        c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date) values ($1, $2, $3, '2026-05-01', '2027-02-01')", [E.A, lease, T.a2]),
      ).rejects.toThrow(/période du bail/)
    })
  })
})

describe('conditions de loyer', () => {
  it('une version par date d\'effet', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const lease = await createLease(c, { start: '2026-01-01' })
      await c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents, reason) values ($1, $2, '2026-09-01', 87000, 5200, 'Révision annuelle')", [E.A, lease])
      await c.query('savepoint s')
      await expect(
        c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-09-01', 1, 1)", [E.A, lease]),
      ).rejects.toThrow(/unique/)
      await c.query('rollback to savepoint s')
      const { rows } = await c.query('select effective_from::text as d from public.rental_terms where lease_id = $1 order by effective_from', [lease])
      expect(rows.map((r) => r.d)).toEqual(['2026-01-01', '2026-09-01'])
    })
  })

  it('refuse une date d\'effet avant le début du bail, et des montants négatifs', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const lease = await createLease(c, { start: '2026-03-01' })
      await c.query('savepoint s')
      await expect(c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-02-01', 1, 1)", [E.A, lease])).rejects.toThrow(/date d'effet/)
      await c.query('rollback to savepoint s')
      await expect(c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-04-01', -1, 1)", [E.A, lease])).rejects.toThrow(/check/)
    })
  })

  it('une modification est tracée avec les montants avant et après', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const lease = await createLease(c)
      await c.query('update public.rental_terms set rent_cents = 86000 where lease_id = $1', [lease])
      const { rows } = await c.query("select details from public.audit_logs where action = 'lease.terms_changed'")
      expect(rows).toHaveLength(1)
      expect(rows[0].details.from.rent_cents).toBe(85000)
      expect(rows[0].details.to.rent_cents).toBe(86000)
    })
  })
})

describe('fin de bail', () => {
  it('end_lease ferme les présences ouvertes et fixe la date de fin', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const lease = await createLease(c, { tenants: [T.a, T.a2] })
      await c.query("select public.end_lease($1, '2026-08-31')", [lease])
      const l = (await c.query('select end_date::text as d from public.leases where id = $1', [lease])).rows[0]
      expect(l.d).toBe('2026-08-31')
      const open = (await c.query('select 1 from public.lease_tenants where lease_id = $1 and (end_date is null or end_date <> $2)', [lease, '2026-08-31'])).rows
      expect(open).toEqual([])
      await asOwner(c)
      const actions = (await c.query("select action from public.audit_logs where action = 'lease.end_date_changed'")).rows
      expect(actions).toHaveLength(1)
    })
  })

  it('refuse une fin avant le début, et à un lecteur', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const lease = await createLease(c, { start: '2026-03-01' })
      await expect(c.query("select public.end_lease($1, '2026-02-01')", [lease])).rejects.toThrow(/précède le début/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      const lease = await createLease(c)
      await asUser(c, U.readerA)
      await expect(c.query("select public.end_lease($1, '2026-08-31')", [lease])).rejects.toThrow(/Droit insuffisant/)
    })
  })

  it('la fin du bail ne peut pas exclure une présence existante par un simple changement de date', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const lease = await createLease(c)
      await expect(c.query("update public.leases set end_date = '2026-08-31' where id = $1", [lease])).rejects.toThrow(/dépasse les nouvelles dates/)
    })
  })
})

describe('droits et cloisonnement', () => {
  it('lecture pour le lecteur, écriture pour administrateur et gestionnaire, rien pour une autre structure ni sans second facteur', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const lease = await createLease(c)

      await asUser(c, U.readerA)
      expect((await c.query('select 1 from public.leases')).rows).toHaveLength(1)
      expect((await c.query('select 1 from public.rental_terms')).rows).toHaveLength(1)
      expect(await blocked(c, 'update public.leases set deposit_cents = 100 where id = $1', [lease])).toBe(true)
      expect(await blocked(c, 'delete from public.leases where id = $1', [lease])).toBe(true)

      await asUser(c, U.adminB)
      expect((await c.query('select 1 from public.leases')).rows).toEqual([])
      expect((await c.query('select 1 from public.lease_tenants')).rows).toEqual([])
      expect(await blocked(c, 'update public.leases set deposit_cents = 100 where id = $1', [lease])).toBe(true)

      await asUser(c, U.adminA, 'aal1')
      expect((await c.query('select 1 from public.leases')).rows).toEqual([])
    })
  })
})
