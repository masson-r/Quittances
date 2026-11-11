import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type pg from 'pg'
import { chargeAmounts, periodsDue, termForPeriod } from '../../src/domains/finance/rules'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = { a: '00000000-0000-4000-8000-0000000000c1', b: '00000000-0000-4000-8000-0000000000c2', a2: '00000000-0000-4000-8000-0000000000c5' }
const T = { a: '00000000-0000-4000-8000-0000000000c3', b: '00000000-0000-4000-8000-0000000000c4' }

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $4, 'Bien A'), ($2, $5, 'Bien B'), ($3, $4, 'Bien A2')", [P.a, P.b, P.a2, E.A, E.B])
    await c.query("insert into public.tenants (id, entity_id, last_name) values ($1, $3, 'Martin'), ($2, $4, 'Durand')", [T.a, T.b, E.A, E.B])
    await fn(c)
  })

const today = (c: pg.Client, date: string) => c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', $1, true)", [date])

async function lease(c: pg.Client, o: { property?: string; start: string; end?: string | null; dueDay?: number; rent?: number; charges?: number }) {
  const id = (
    await c.query('insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, $3, $4, $5) returning id', [E.A, o.property ?? P.a, o.start, o.end ?? null, o.dueDay ?? 5])
  ).rows[0].id as string
  await c.query('insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, $3, $4, $5)', [E.A, id, o.start, o.rent ?? 85000, o.charges ?? 5000])
  return id
}

const run = async (c: pg.Client, leaseId: string | null = null) => (await c.query('select app.create_due_rent_charges($1) as n', [leaseId])).rows[0].n as number
const charges = async (c: pg.Client, leaseId: string) =>
  (await c.query('select period_start::text as p, due_on::text as due, rent_cents, charges_cents, total_cents from public.rent_charges where lease_id = $1 order by period_start', [leaseId])).rows

describe('create_due_rent_charges', () => {
  it("rattrape toutes les échéances échues d'un bail ancien, avec prorata de la première période", async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-15', dueDay: 5 })
      await today(c, '2026-04-10')
      expect(await run(c)).toBe(4)
      const rows = await charges(c, id)
      expect(rows.map((r) => r.p)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
      expect(rows.map((r) => r.due)).toEqual(['2026-01-15', '2026-02-05', '2026-03-05', '2026-04-05'])
      const jan = chargeAmounts(85000, 5000, 17, 31)
      expect(rows[0]).toMatchObject({ rent_cents: jan.rentCents, charges_cents: jan.chargesCents, total_cents: jan.totalCents })
      expect(rows[1]).toMatchObject({ rent_cents: 85000, charges_cents: 5000, total_cents: 90000 })
    })
  })

  it('est idempotente : un rejeu ne crée aucun doublon', async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01' })
      await today(c, '2026-03-10')
      expect(await run(c)).toBe(3)
      expect(await run(c)).toBe(0)
      expect(await run(c, id)).toBe(0)
      expect(await charges(c, id)).toHaveLength(3)
    })
  })

  it("aucune génération à l'avance : l'échéance naît le jour de sa date", async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01', dueDay: 5 })
      await today(c, '2026-04-04')
      expect(await run(c)).toBe(3)
      await today(c, '2026-04-05')
      expect(await run(c)).toBe(1)
      expect((await charges(c, id)).map((r) => r.p)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01'])
    })
  })

  it("un bail qui n'a pas commencé n'a aucune échéance ; un bail qui commence aujourd'hui a la sienne", async () => {
    await world(async (c) => {
      await lease(c, { start: '2026-06-01', dueDay: 1 })
      await today(c, '2026-05-31')
      expect(await run(c)).toBe(0)
      await today(c, '2026-06-01')
      expect(await run(c)).toBe(1)
    })
    await world(async (c) => {
      const id = await lease(c, { start: '2026-04-10', dueDay: 5 })
      await today(c, '2026-04-10')
      expect(await run(c)).toBe(1)
      expect((await charges(c, id))[0].due).toBe('2026-04-10')
    })
  })

  it("un bail terminé s'arrête à son mois de fin, dernière échéance au prorata", async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01', end: '2026-03-10', dueDay: 28 })
      await today(c, '2027-01-01')
      expect(await run(c)).toBe(3)
      const rows = await charges(c, id)
      expect(rows[2]).toMatchObject({ p: '2026-03-01', due: '2026-03-10' })
      expect(rows[2].total_cents).toBe(chargeAmounts(85000, 5000, 10, 31).totalCents)
    })
  })

  it('utilise la version des conditions applicable à chaque période, sans découper une période', async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01', rent: 80000, charges: 5000 })
      await c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-03-15', 90000, 6000)", [E.A, id])
      await today(c, '2026-05-10')
      await run(c)
      const rows = await charges(c, id)
      expect(rows.map((r) => r.total_cents)).toEqual([85000, 85000, 85000, 96000, 96000])
    })
  })

  it('ne recrée jamais une échéance annulée', async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01' })
      await today(c, '2026-03-10')
      await run(c)
      await c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'erreur' where lease_id = $1 and period_start = '2026-02-01'", [id])
      expect(await run(c)).toBe(0)
      expect((await c.query('select count(*)::int as n from public.rent_charges where lease_id = $1 and cancelled_at is null', [id])).rows[0].n).toBe(2)
    })
  })

  it('trace chaque création au nom du système quand la tâche tourne seule', async () => {
    await world(async (c) => {
      await lease(c, { start: '2026-01-01' })
      await today(c, '2026-02-10')
      await run(c)
      const rows = (await c.query("select actor_kind, actor_id, details from public.audit_logs where action = 'rent_charge.created' and entity_id = $1", [E.A])).rows
      expect(rows).toHaveLength(2)
      for (const r of rows) expect(r).toMatchObject({ actor_kind: 'system', actor_id: null })
      expect(rows[0].details).toHaveProperty('total_cents')
    })
  })

  it('propriété : les périodes créées sont exactement celles de la fonction pure periodsDue', async () => {
    await world(async (c) => {
      let n = 0
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            startOffset: fc.integer({ min: 0, max: 700 }),
            length: fc.option(fc.integer({ min: 0, max: 500 }), { nil: null }),
            dueDay: fc.integer({ min: 1, max: 31 }),
            todayOffset: fc.integer({ min: 0, max: 1200 }),
          }),
          async (s) => {
            const day = (base: string, k: number) => new Date(new Date(`${base}T00:00:00Z`).getTime() + k * 86_400_000).toISOString().slice(0, 10)
            const start = day('2024-01-01', s.startOffset)
            const end = s.length === null ? null : day(start, s.length)
            const now = day('2024-01-01', s.todayOffset)
            await c.query('savepoint run')
            const property = (await c.query('insert into public.properties (entity_id, label) values ($1, $2) returning id', [E.A, `Bien ${n++}`])).rows[0].id
            const id = await lease(c, { property, start, end, dueDay: s.dueDay })
            await today(c, now)
            await run(c, id)
            const created = (await charges(c, id)).map((r) => ({ key: r.p.slice(0, 7), due: r.due, total: r.total_cents }))
            const expected = periodsDue({ start, end, dueDay: s.dueDay, today: now }).map((p) => {
              const term = termForPeriod([{ effectiveFrom: start, rentCents: 85000, chargesCents: 5000 }], p, start)!
              return { key: p.key, due: p.dueDate, total: chargeAmounts(term.rentCents, term.chargesCents, p.occupiedDays, p.daysInMonth).totalCents }
            })
            expect(created).toEqual(expected)
            await c.query('rollback to savepoint run')
          },
        ),
        { numRuns: 40 },
      )
    })
  })
})

describe("rattrapage à la création d'un bail et fin de bail", () => {
  it("create_lease crée aussitôt les échéances échues, au nom de l'utilisateur", async () => {
    await world(async (c) => {
      await today(c, '2026-03-10')
      await asUser(c, U.managerA)
      const id = (await c.query("select public.create_lease($1, $2, '2026-01-10', null, 5, 85000, 5000, $3) as id", [E.A, P.a, [T.a]])).rows[0].id
      await asOwner(c)
      expect(await charges(c, id)).toHaveLength(3)
      const kinds = (await c.query("select distinct actor_kind from public.audit_logs where action = 'rent_charge.created' and entity_id = $1", [E.A])).rows
      expect(kinds).toEqual([{ actor_kind: 'user' }])
    })
  })

  it("catch_up_lease : réservé à ceux qui peuvent modifier le bail", async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01' })
      await today(c, '2026-02-10')
      await asUser(c, U.readerA)
      await expect(c.query('select public.catch_up_lease($1)', [id])).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01' })
      await today(c, '2026-02-10')
      await asUser(c, U.adminB)
      await expect(c.query('select public.catch_up_lease($1)', [id])).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01' })
      await today(c, '2026-02-10')
      await asUser(c, U.managerA)
      expect((await c.query('select public.catch_up_lease($1) as n', [id])).rows[0].n).toBe(2)
    })
  })

  it('une fin de bail ne peut pas précéder une échéance déjà créée', async () => {
    await world(async (c) => {
      const id = await lease(c, { start: '2026-01-01' })
      await c.query('insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, $4)', [E.A, id, T.a, '2026-01-01'])
      await today(c, '2026-03-10')
      await run(c)
      await asUser(c, U.managerA)
      await c.query('savepoint s')
      await expect(c.query("select public.end_lease($1, '2026-02-15')", [id])).rejects.toThrow(/échéance déjà créée/)
      await c.query('rollback to savepoint s')
      await asOwner(c)
      await c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'bail terminé' where lease_id = $1 and period_start = '2026-03-01'", [id])
      await asUser(c, U.managerA)
      await c.query("select public.end_lease($1, '2026-02-15')", [id])
    })
  })
})

describe('tâches planifiées', () => {
  it('pg_cron planifie la création des échéances et la purge du journal', async () => {
    await world(async (c) => {
      const { rows } = await c.query('select jobname, command from cron.job order by jobname')
      expect(rows.map((r) => r.jobname)).toEqual(['create-due-rent-charges', 'expire-tenant-access', 'purge-audit-logs'])
      expect(rows[1].command).toContain('app.expire_tenant_access')
      expect(rows[2].command).toContain('app.purge_audit_logs')
      expect(rows[1].command).toContain('app.purge_audit_logs')
    })
  })
})
