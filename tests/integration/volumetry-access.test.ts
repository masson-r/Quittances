import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld, createAuthUser } from './personas'

/**
 * L6-02. Historique de dix ans pour trois baux en parallèle (environ 360 échéances), chargé par la fonction d'import,
 * puis : temps de réponse des vues du tableau de bord et des listes (moins de 500 ms) et cloisonnement complet entre
 * structures et vis-à-vis d'un locataire rattaché. Aujourd'hui = 15 mars 2026.
 */
const TODAY = '2026-03-15'
const pad = (n: number) => String(n).padStart(2, '0')

function tenYears() {
  const payload: Record<string, Record<string, unknown>[]> = { properties: [], tenants: [], leases: [], charges: [], payments: [], expenses: [], settlements: [] }
  let line = 2
  for (const [i, label] of ['A', 'B', 'C'].entries()) {
    payload.properties.push({ line: i + 2, ref: `BIEN-${label}`, label: `Bien ${label}`, address_line1: `${i + 1} rue des Tests`, postal_code: '75001', city: 'Paris' })
    payload.tenants.push({ line: i + 2, ref: `LOC-${label}`, last_name: `Locataire${label}`, first_name: 'Test' })
    payload.leases.push({
      line: i + 2, ref: `BAIL-${label}`, property_ref: `BIEN-${label}`, start_date: '2016-03-01', end_date: null, due_day: 5,
      terms: [{ effective_from: '2016-03-01', rent_cents: 50000 + i * 10000, charges_cents: 5000 }, { effective_from: '2021-03-01', rent_cents: 55000 + i * 10000, charges_cents: 6000 }],
      tenants: [{ tenant_ref: `LOC-${label}` }],
    })
    for (let y = 2016; y <= 2026; y++) {
      for (let m = 1; m <= 12; m++) {
        if ((y === 2016 && m < 3) || (y === 2026 && m > 3)) continue
        const total = y > 2021 || (y === 2021 && m >= 3) ? 61000 + i * 10000 : 55000 + i * 10000
        payload.payments.push({ line: line++, ref: `PAI-${label}-${y}-${pad(m)}`, lease_ref: `BAIL-${label}`, amount_cents: total, received_on: `${y}-${pad(m)}-0${3 + (m % 2)}`, mode: 'transfer', period_start: `${y}-${pad(m)}-01` })
      }
    }
    for (let y = 2016; y <= 2025; y++) {
      payload.expenses.push({ line: line++, ref: `DEP-${label}-${y}`, property_ref: `BIEN-${label}`, category: 'Taxe foncière', expense_date: `${y}-10-01`, description: `Taxe ${y}`, amount_cents: 80000 })
    }
  }
  return payload
}

const world = (fn: (c: pg.Client, ids: { batch: string }) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', $1, true)", [TODAY])
    const report = (await c.query('select app.import_history($1, $2::jsonb, repeat(\'b\', 64), false) as r', [E.A, JSON.stringify(tenYears())])).rows[0].r
    expect(report.errors).toEqual([])
    await fn(c, { batch: report.batch_id })
  })

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now()
  const value = await fn()
  return { ms: performance.now() - start, value }
}

describe('volumétrie : dix ans, trois baux', () => {
  it('charge environ 360 échéances et ses paiements', async () => {
    await world(async (c) => {
      const { rows } = await c.query('select count(*)::int as n from public.rent_charges where entity_id = $1', [E.A])
      expect(rows[0].n).toBe(3 * 121)
      expect((await c.query('select count(*)::int as n from public.payment_allocations where reversed_at is null')).rows[0].n).toBe(3 * 121)
    })
  })

  it('les vues du tableau de bord et les listes répondent en moins de 500 ms', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const params = [[E.A], null, '2016-03-16', TODAY]
      const calls: [string, () => Promise<unknown>][] = [
        ['dashboard_summary 10 ans', () => c.query('select * from public.dashboard_summary($1, $2, $3, $4)', params)],
        ['dashboard_monthly 10 ans', () => c.query('select * from public.dashboard_monthly($1, $2, $3, $4)', [[E.A], null, '2016-03-01', TODAY])],
        ['dashboard_by_property 10 ans', () => c.query('select * from public.dashboard_by_property($1, $2, $3, $4)', params)],
        ['dashboard_summary consolidé', () => c.query('select * from public.dashboard_summary(null, null, $1, $2)', ['2016-03-16', TODAY])],
        ['échéances et soldes', () => c.query('select * from public.rent_charge_balances where entity_id = $1 order by due_on desc', [E.A])],
        ['échéances en retard', () => c.query("select * from public.rent_charge_balances where entity_id = $1 and status = 'late'", [E.A])],
        ['paiements', () => c.query('select * from public.payments where entity_id = $1 order by received_on desc', [E.A])],
        ['dépenses', () => c.query('select * from public.expenses where entity_id = $1 order by expense_date desc', [E.A])],
        ['quittances à émettre (échéances soldées)', () => c.query("select id from public.rent_charge_balances where entity_id = $1 and status = 'paid'", [E.A])],
      ]
      for (const [label, call] of calls) {
        await call() // échauffement du plan
        const { ms } = await timed(call)
        expect(ms, `${label} : ${ms.toFixed(0)} ms`).toBeLessThan(500)
      }
    })
  })

  it('émission d\'une quittance sur une échéance ancienne soldée, et liste du locataire, en moins de 500 ms', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const charge = (await c.query("select id from public.rent_charges where period_start = '2017-06-01' and lease_id = (select id from public.leases where external_ref = 'BAIL-A')")).rows[0].id
      const issued = await timed(() => c.query("select * from public.issue_receipt('quittance', $1, null, null, null)", [charge]))
      expect(issued.ms).toBeLessThan(500)
      expect((issued.value as pg.QueryResult).rows[0].number).toMatch(/^QUI-2026-03-0001$/)
    })
  })
})

describe('cloisonnement complet', () => {
  const entityTables = async (c: pg.Client) =>
    (
      await c.query(
        `select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'entity_id'
           and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type in ('BASE TABLE', 'VIEW'))
         order by 1`,
      )
    ).rows.map((r) => r.table_name as string)

  it('un administrateur d\'une autre structure ne lit aucune ligne de la structure A, dans aucune table ni vue', async () => {
    await world(async (c) => {
      const tables = await entityTables(c)
      expect(tables.length).toBeGreaterThan(20)
      await asUser(c, U.adminB)
      for (const table of tables) {
        await c.query('savepoint s')
        const res = await c.query(`select count(*)::int as n from public.${table} where entity_id = $1`, [E.A]).catch(() => ({ rows: [{ n: 0 }] }))
        await c.query('rollback to savepoint s')
        expect(res.rows[0].n, `${table} visible depuis une autre structure`).toBe(0)
      }
    })
  })

  it('un membre sans droit sur la structure, un membre suspendu et un profil désactivé ne lisent rien non plus', async () => {
    await world(async (c) => {
      const tables = (await entityTables(c)).filter((t) => t !== 'audit_logs')
      for (const user of [U.outsider, U.suspendedA, U.disabled]) {
        await asUser(c, user)
        for (const table of tables) {
          await c.query('savepoint s')
          const res = await c.query(`select count(*)::int as n from public.${table} where entity_id = $1`, [E.A]).catch(() => ({ rows: [{ n: 0 }] }))
          await c.query('rollback to savepoint s')
          expect(res.rows[0].n, `${table} visible par ${user}`).toBe(0)
        }
      }
    })
  })

  it('un locataire rattaché ne lit aucune table de gestion : ni échéances, paiements, soldes, ni dossiers, ni autres baux', async () => {
    await world(async (c) => {
      const ACCOUNT = '00000000-0000-4000-8000-0000000000f3'
      await asOwner(c)
      await createAuthUser(c, ACCOUNT, 'locataire@example.test')
      await c.query('update auth.users set email_confirmed_at = now() where id = $1', [ACCOUNT])
      const tenant = (await c.query("select id from public.tenants where external_ref = 'LOC-A'")).rows[0].id
      await asUser(c, U.adminA)
      const inv = (await c.query('select * from public.create_tenant_invitation($1)', [tenant])).rows[0]
      await asUser(c, ACCOUNT, 'aal1')
      const request = (await c.query("select request_id from public.consume_tenant_invitation($1, null, true, 'v1')", [inv.token])).rows[0].request_id
      await asUser(c, U.adminA)
      await c.query('select public.decide_tenant_access($1, true)', [request])

      await asUser(c, ACCOUNT, 'aal1')
      for (const table of await entityTables(c)) {
        await c.query('savepoint s')
        const res = await c.query(`select count(*)::int as n from public.${table}`).catch(() => ({ rows: [{ n: 0 }] }))
        await c.query('rollback to savepoint s')
        expect(res.rows[0].n, `${table} visible par un locataire`).toBe(0)
      }
      // Seules ses propres lectures « locataire » répondent, et seulement pour son dossier et son bail.
      expect((await c.query('select tenant_id from public.my_tenant_dossiers()')).rows.map((r) => r.tenant_id)).toEqual([tenant])
      const leases = (await c.query('select lease_id from public.my_tenant_leases()')).rows
      expect(leases).toHaveLength(1)
      // Il ne peut pas non plus utiliser les fonctions des propriétaires ni de l'opérateur.
      for (const sql of [
        "select * from public.dashboard_summary(null, null, '2016-01-01', '2026-03-15')",
        'select * from public.tenant_access_overview($1)',
      ]) {
        await c.query('savepoint s')
        const rows = await c.query(sql, sql.includes('$1') ? [E.A] : []).then(
          (r) => r.rows,
          () => [],
        )
        await c.query('rollback to savepoint s')
        if (sql.includes('dashboard_summary')) expect(Number(rows[0]?.called_cents ?? 0)).toBe(0)
        else expect(rows).toEqual([])
      }
    })
  })

  it('aucune écriture directe sur les tables financières ni documentaires pour un membre : seules les fonctions écrivent', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      for (const sql of [
        'delete from public.rent_charges',
        'delete from public.payments',
        'delete from public.payment_allocations',
        'delete from public.receipts',
        'delete from public.documents',
        'delete from public.audit_logs',
        'update public.payments set amount_cents = 1',
        'update public.audit_logs set action = x',
        'insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) select entity_id, id, \'2030-01-01\', \'2030-01-31\', \'2030-01-05\', 1, 1 from public.leases limit 1',
      ]) {
        await c.query('savepoint s')
        const outcome = await c.query(sql).then(
          (r) => r.rowCount ?? 0,
          () => -1,
        )
        await c.query('rollback to savepoint s')
        expect(outcome <= 0, sql).toBe(true)
      }
      await asOwner(c)
      expect((await c.query('select count(*)::int as n from public.rent_charges')).rows[0].n).toBe(3 * 121)
    })
  })
})
