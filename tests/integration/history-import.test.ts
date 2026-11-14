import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'
import { buildFixture } from './history-fixtures'

type Report = {
  status: string
  batch_id: string | null
  errors: { file: string; line: number; message: string }[]
  counts: Record<string, number>
  totals: { lease: string; year: number; called_cents: number; collected_cents: number; refunds_net_cents: number; expenses_cents: number; remaining_due_cents: number }[]
  unpaid: { lease: string; period: string; balance_cents: number }[]
  imposed_differences: { lease: string; period: string; imposed_cents: number; computed_cents: number }[]
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex')

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-03-15', true)")
    await fn(c)
  })

const run = async (c: pg.Client, payload: unknown, hash: string, dryRun = false, entity = E.A): Promise<Report> =>
  (await c.query('select app.import_history($1, $2::jsonb, $3, $4) as r', [entity, JSON.stringify(payload), hash, dryRun])).rows[0].r as Report

const count = async (c: pg.Client, table: string) => (await c.query(`select count(*)::int as n from public.${table} where entity_id = $1`, [E.A])).rows[0].n as number

const TABLES = ['properties', 'tenants', 'leases', 'rent_charges', 'payments', 'payment_allocations', 'expenses', 'charge_settlements', 'import_batches']
const snapshot = async (c: pg.Client) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await count(c, t)])))

describe('import_history : cinq ans pour trois baux', () => {
  it('importe tout le lot, crée les échéances échues, affecte les paiements et rapporte des totaux exacts', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const report = await run(c, fixture.payload, sha('lot-1'))
      expect(report.errors).toEqual([])
      expect(report.status).toBe('imported')
      expect(report.counts).toMatchObject({ properties: 3, tenants: 4, leases: 3, payments: fixture.expected.payments, expenses: 3, settlements: 1 })
      expect(report.counts.charges_calculated).toBe(fixture.expected.charges)
      expect(await count(c, 'rent_charges')).toBe(fixture.expected.charges)

      // Totaux par bail et par année conformes au calcul indépendant des fixtures.
      for (const t of report.totals) {
        const key = `${t.lease}:${t.year}`
        expect(t.called_cents, `appelé ${key}`).toBe(fixture.expected.calledByLeaseYear[key] ?? 0)
        expect(t.collected_cents, `encaissé ${key}`).toBe(fixture.expected.collectedByLeaseYear[key] ?? 0)
      }
      expect(report.totals.find((t) => t.lease === 'BAIL-B' && t.year === 2024)).toMatchObject({ refunds_net_cents: 12000 })
      expect(report.totals.find((t) => t.lease === 'BAIL-A' && t.year === 2022)).toMatchObject({ expenses_cents: 120000 })

      // Les échéances restées impayées sont listées, et seulement elles.
      expect(report.unpaid.map((u) => [u.lease, u.period, u.balance_cents])).toEqual(
        fixture.expected.unpaid.map((u) => [u.lease, u.period, u.balance]).sort((a, b) => (String(a[0]) + a[1] < String(b[0]) + b[1] ? -1 : 1)),
      )
    })
  })

  it('les statuts restent calculés : l\'impayé ancien apparaît réellement en retard, le reste est payé', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      await run(c, fixture.payload, sha('lot-1'))
      const { rows } = await c.query(
        "select l.external_ref as lease, b.status, count(*)::int as n from public.rent_charge_balances b join public.leases l on l.id = b.lease_id where b.entity_id = $1 group by 1, 2 order by 1, 2",
        [E.A],
      )
      const late = rows.filter((r) => r.status === 'late').reduce((n, r) => n + r.n, 0)
      expect(late).toBe(fixture.expected.unpaid.length)
      expect(rows.filter((r) => r.status === 'paid').reduce((n, r) => n + r.n, 0)).toBe(fixture.expected.charges - late)
    })
  })

  it('le paiement sans période est affecté à l\'échéance impayée la plus ancienne', async () => {
    await world(async (c) => {
      await run(c, buildFixture().payload, sha('lot-1'))
      const { rows } = await c.query(
        "select to_char(c.period_start, 'YYYY-MM') as p from public.payment_allocations a join public.payments p on p.id = a.payment_id join public.rent_charges c on c.id = a.rent_charge_id where p.external_ref = 'PAI-BAIL-C-2024-01'",
      )
      expect(rows).toEqual([{ p: '2024-01' }])
    })
  })

  it('n\'écrit pas de ligne future, marque les lignes du lot, trace une seule entrée d\'audit', async () => {
    await world(async (c) => {
      const report = await run(c, buildFixture().payload, sha('lot-1'))
      expect((await c.query("select count(*)::int as n from public.rent_charges where due_on > '2026-03-15'")).rows[0].n).toBe(0)
      expect((await c.query('select count(*)::int as n from public.payments where import_batch_id is distinct from $1', [report.batch_id])).rows[0].n).toBe(0)
      const audit = (await c.query("select action, actor_kind, details from public.audit_logs where entity_id = $1 and (action like 'history_import%' or subject_table not in ('entity_memberships', 'ownership_entities'))", [E.A])).rows
      expect(audit).toHaveLength(1)
      expect(audit[0]).toMatchObject({ action: 'history_import.completed', actor_kind: 'operator' })
      expect(audit[0].details).toMatchObject({ payments: report.counts.payments })
      expect(JSON.stringify(audit)).not.toMatch(/Durand|Martin/)
      const batch = (await c.query('select status, files_sha256, counts from public.import_batches where id = $1', [report.batch_id])).rows[0]
      expect(batch).toMatchObject({ status: 'imported', files_sha256: sha('lot-1') })
    })
  })

  it('le mode essai rapporte les mêmes totaux sans rien écrire', async () => {
    await world(async (c) => {
      const before = await snapshot(c)
      const auditBefore = (await c.query('select count(*)::int as n from public.audit_logs where entity_id = $1', [E.A])).rows[0].n
      const dry = await run(c, buildFixture().payload, sha('lot-1'), true)
      expect(dry.status).toBe('dry_run')
      expect(dry.errors).toEqual([])
      expect(await snapshot(c)).toEqual(before)
      expect((await c.query('select count(*)::int as n from public.audit_logs where entity_id = $1', [E.A])).rows[0].n).toBe(auditBefore)
      const real = await run(c, buildFixture().payload, sha('lot-1'))
      expect(real.totals).toEqual(dry.totals)
      expect(real.unpaid).toEqual(dry.unpaid)
    })
  })

  it('tout ou rien : une seule ligne invalide rejette le lot entier et chaque erreur est localisée', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const bad = structuredClone(fixture.payload) as Record<string, Record<string, unknown>[]>
      bad.payments[3].lease_ref = 'BAIL-INCONNU'
      bad.payments[5].received_on = '2026-12-31'
      bad.expenses[1].category = 'Catégorie fantaisiste'
      bad.expenses[2].amount_cents = 0
      const before = await snapshot(c)
      const report = await run(c, bad, sha('lot-mauvais'))
      expect(report.status).toBe('rejected')
      expect(report.errors).toHaveLength(4)
      expect(report.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ file: 'paiements', line: bad.payments[3].line, message: expect.stringContaining('Bail introuvable') }),
          expect.objectContaining({ file: 'paiements', line: bad.payments[5].line, message: expect.stringContaining('futur') }),
          expect.objectContaining({ file: 'depenses', line: bad.expenses[1].line, message: expect.stringContaining('Catégorie') }),
          expect.objectContaining({ file: 'depenses', line: bad.expenses[2].line }),
        ]),
      )
      expect(await snapshot(c)).toEqual(before)
    })
  })

  it('rejette les chevauchements de baux, les présences hors bail et les dates futures de bail', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const bad = structuredClone(fixture.payload) as Record<string, Record<string, unknown>[]>
      bad.leases.push({
        line: 9, ref: 'BAIL-CHEV', property_ref: 'BIEN-A', start_date: '2022-01-01', end_date: '2022-12-31', due_day: 5,
        terms: [{ effective_from: '2022-01-01', rent_cents: 1, charges_cents: 0 }], tenants: [{ tenant_ref: 'LOC-1' }],
      })
      bad.leases.push({
        line: 10, ref: 'BAIL-SANS', property_ref: 'BIEN-C', start_date: '2019-01-01', end_date: '2019-12-31', due_day: 5, terms: [], tenants: [{ tenant_ref: 'LOC-1' }],
      })
      const report = await run(c, bad, sha('lot-chev'))
      expect(report.status).toBe('rejected')
      expect(report.errors.map((e) => [e.file, e.line])).toEqual([['baux', 9], ['baux', 10]])
      expect(await count(c, 'leases')).toBe(0)
    })
  })

  it('rejeu d\'un fichier identique : sans effet ; même référence avec un contenu différent : conflit refusé', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const first = await run(c, fixture.payload, sha('lot-1'))
      const after = await snapshot(c)
      const replay = await run(c, fixture.payload, sha('lot-1'))
      expect(replay).toMatchObject({ status: 'already_imported', batch_id: first.batch_id })
      expect(await snapshot(c)).toEqual(after)

      const changed = structuredClone(fixture.payload) as Record<string, Record<string, unknown>[]>
      changed.payments[0].amount_cents = 1
      const conflict = await run(c, changed, sha('lot-1-modifié'))
      expect(conflict.status).toBe('rejected')
      // Toutes les références déjà actives sont en conflit : le lot est refusé en entier, rien n'est écrit.
      expect(conflict.errors).toHaveLength(fixture.expected.payments + 4)
      expect(conflict.errors).toContainEqual(expect.objectContaining({ file: 'paiements', line: changed.payments[0].line, message: expect.stringContaining('déjà utilisée') }))
      expect(await snapshot(c)).toEqual(after)
    })
  })

  it('échéance imposée : montants et date retenus, écart avec le calcul rapporté', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const payload = structuredClone(fixture.payload) as Record<string, Record<string, unknown>[]>
      payload.charges = [{ line: 2, ref: 'ECH-1', lease_ref: 'BAIL-A', period_start: '2022-04-01', rent_cents: 61000, charges_cents: 5000, due_on: '2022-04-07' }]
      const report = await run(c, payload, sha('lot-imposé'))
      expect(report.errors).toEqual([])
      expect(report.imposed_differences).toEqual([{ lease: 'BAIL-A', period: '2022-04', imposed_cents: 66000, computed_cents: 65000 }])
      const charge = (await c.query("select total_cents, due_on::text as due from public.rent_charges where external_ref = 'ECH-1'")).rows[0]
      expect(charge).toEqual({ total_cents: 66000, due: '2022-04-07' })
      expect(await count(c, 'rent_charges')).toBe(fixture.expected.charges)
    })
  })

  it('les lignes importées comptent normalement dans le tableau de bord sur cinq ans', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      await run(c, fixture.payload, sha('lot-1'))
      await asOwner(c)
      await c.query("insert into public.entity_memberships (entity_id, profile_id, role) values ($1, $2, 'reader') on conflict do nothing", [E.A, U.outsider])
      await asUser(c, U.outsider)
      const s = (await c.query("select * from public.dashboard_summary($1, null, '2021-03-16', '2026-03-15')", [[E.A]])).rows[0]
      expect(Number(s.collected_cents)).toBeGreaterThan(0)
      const raw = (await c.query("select coalesce(sum(amount_cents), 0)::bigint as v from public.payments where cancelled_at is null and received_on between '2021-03-16' and '2026-03-15'")).rows[0].v
      expect(Number(s.collected_cents)).toBe(Number(raw))
      expect(s).toMatchObject({ running_leases: 2, active_tenants: 3, final_settlements_pending: 0, overdue_count: fixture.expected.unpaid.length })
    })
  })
})

describe('cancel_import_batch', () => {
  it('annule en bloc les lignes financières du lot avec motif, sans rien supprimer ; les soldes sont restaurés', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const report = await run(c, fixture.payload, sha('lot-1'))
      const result = (await c.query("select app.cancel_import_batch($1, 'Mauvais fichier') as r", [report.batch_id])).rows[0].r
      expect(result).toMatchObject({ payments: fixture.expected.payments, charges: fixture.expected.charges, expenses: 3, settlements: 1 })
      expect((await c.query('select count(*)::int as n from public.payments where cancelled_at is null')).rows[0].n).toBe(0)
      expect((await c.query('select count(*)::int as n from public.payment_allocations where reversed_at is null')).rows[0].n).toBe(0)
      expect((await c.query('select count(*)::int as n from public.rent_charges where cancelled_at is null')).rows[0].n).toBe(0)
      expect(await count(c, 'payments')).toBe(fixture.expected.payments) // conservés
      expect((await c.query('select status from public.import_batches where id = $1', [report.batch_id])).rows[0].status).toBe('cancelled')
      const audit = (await c.query("select action from public.audit_logs where action = 'import_batch.cancelled'")).rows
      expect(audit).toHaveLength(1)
    })
  })

  it('motif obligatoire, lot inconnu ou déjà annulé refusés', async () => {
    await world(async (c) => {
      const report = await run(c, buildFixture().payload, sha('lot-1'))
      for (const [id, reason, message] of [
        [report.batch_id, ' ', /motif/],
        ['00000000-0000-4000-8000-0000000000ee', 'x', /introuvable/],
      ] as const) {
        await c.query('savepoint s')
        await expect(c.query('select app.cancel_import_batch($1, $2)', [id, reason])).rejects.toThrow(message)
        await c.query('rollback to savepoint s')
      }
      await c.query("select app.cancel_import_batch($1, 'ok')", [report.batch_id])
      await expect(c.query("select app.cancel_import_batch($1, 'encore')", [report.batch_id])).rejects.toThrow(/déjà annulé/)
    })
  })

  it('après annulation, le fichier corrigé se réimporte avec les mêmes références', async () => {
    await world(async (c) => {
      const fixture = buildFixture()
      const first = await run(c, fixture.payload, sha('lot-1'))
      await c.query("select app.cancel_import_batch($1, 'Erreur de montant')", [first.batch_id])
      const corrected = structuredClone(fixture.payload) as Record<string, Record<string, unknown>[]>
      corrected.payments[0].amount_cents = 65000
      const second = await run(c, corrected, sha('lot-1-corrigé'))
      expect(second.errors).toEqual([])
      expect(second.status).toBe('imported')
      // Biens, dossiers et baux sont réutilisés ; les lignes financières sont recréées.
      expect(second.counts).toMatchObject({ properties: 0, properties_reused: 3, leases: 0, leases_reused: 3, payments: fixture.expected.payments })
      expect((await c.query('select count(*)::int as n from public.payments where cancelled_at is null')).rows[0].n).toBe(fixture.expected.payments)
    })
  })

  it('refusée tant qu\'une quittance émise dépend d\'une échéance du lot', async () => {
    await world(async (c) => {
      const report = await run(c, buildFixture().payload, sha('lot-1'))
      const charge = (await c.query("select c.id, c.entity_id, c.lease_id from public.rent_charges c where c.period_start = '2025-05-01' and c.lease_id = (select id from public.leases where external_ref = 'BAIL-A')")).rows[0]
      await asUser(c, U.managerA)
      await c.query('select * from public.issue_receipt($1, $2, null, null, null)', ['quittance', charge.id])
      await asOwner(c)
      await expect(c.query("select app.cancel_import_batch($1, 'Erreur')", [report.batch_id])).rejects.toThrow(/annulez-le d'abord/)
    })
  })
})

describe('droits', () => {
  it('seul service_role exécute les fonctions d\'import : ni anon, ni utilisateur connecté, ni administrateur', async () => {
    await world(async (c) => {
      for (const user of [null, U.adminA]) {
        if (user) await asUser(c, user)
        else await c.query('reset role').then(() => c.query('set local role anon'))
        for (const [sql, params] of [
          ["select public.import_history($1, '{}'::jsonb, $2, true)", [E.A, sha('x')]],
          ["select public.cancel_import_batch($1, 'x')", [E.A]],
        ] as const) {
          await c.query('savepoint s')
          await expect(c.query(sql, [...params])).rejects.toThrow(/permission denied/)
          await c.query('rollback to savepoint s')
        }
      }
      await c.query('reset role')
      await c.query('set local role service_role')
      const r = (await c.query("select public.import_history($1, '{}'::jsonb, $2, true) as r", [E.A, sha('vide')])).rows[0].r
      expect(r.status).toBe('dry_run')
    })
  })
})
