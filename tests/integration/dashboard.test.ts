import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = { a1: '00000000-0000-4000-8000-0000000000c1', a2: '00000000-0000-4000-8000-0000000000c2', b1: '00000000-0000-4000-8000-0000000000c3' }
const L = { a1: '00000000-0000-4000-8000-0000000000a1', a2: '00000000-0000-4000-8000-0000000000a2', b1: '00000000-0000-4000-8000-0000000000a3' }
const T = '00000000-0000-4000-8000-0000000000f1'

/**
 * Scénario (aujourd'hui = 15 mars 2026) :
 * - Structure A : bien 1 (bail en cours depuis janvier, 850 € par mois), bien 2 (bail terminé le 28 février, sans apurement final).
 * - Structure B : bien 1 (bail en cours, 500 €).
 */
const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-03-15', true)")
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $4, 'A1'), ($2, $4, 'A2'), ($3, $5, 'B1')", [P.a1, P.a2, P.b1, E.A, E.B])
    await c.query(
      `insert into public.leases (id, entity_id, property_id, start_date, end_date, due_day) values
         ($1, $4, $5, '2026-01-01', null, 5), ($2, $4, $6, '2025-11-01', '2026-02-28', 5), ($3, $7, $8, '2026-01-01', null, 5)`,
      [L.a1, L.a2, L.b1, E.A, P.a1, P.a2, E.B, P.b1],
    )
    await c.query("insert into public.tenants (id, entity_id, last_name) values ($1, $2, 'Durand')", [T, E.A])
    await c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values ($1, $2, $3, '2026-01-01')", [E.A, L.a1, T])
    await c.query(
      `insert into public.rent_charges (id, entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values
         ('00000000-0000-4000-8000-0000000000e1', $1, $2, '2026-01-01', '2026-01-31', '2026-01-05', 80000, 5000),
         ('00000000-0000-4000-8000-0000000000e2', $1, $2, '2026-02-01', '2026-02-28', '2026-02-05', 80000, 5000),
         ('00000000-0000-4000-8000-0000000000e3', $1, $2, '2026-03-01', '2026-03-31', '2026-03-05', 80000, 5000),
         ('00000000-0000-4000-8000-0000000000e4', $1, $3, '2026-02-01', '2026-02-28', '2026-02-05', 60000, 0),
         ('00000000-0000-4000-8000-0000000000e5', $4, $5, '2026-03-01', '2026-03-31', '2026-03-05', 50000, 0)`,
      [E.A, L.a1, L.a2, E.B, L.b1],
    )
    // Échéance annulée : exclue de tout.
    await c.query(
      `insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents, cancelled_at, cancellation_reason)
         values ($1, $2, '2026-04-01', '2026-04-30', '2026-04-05', 99999, 0, now(), 'test')`,
      [E.A, L.a1],
    )
    // Janvier soldé, février partiel (30 000 sur 85 000), mars rien. Un paiement de 85 000 reçu en avril est impossible (futur) :
    // on teste le non affecté avec 10 000 reçus en mars sans affectation.
    await c.query(
      `insert into public.payments (id, entity_id, lease_id, amount_cents, received_on, mode) values
         ('00000000-0000-4000-8000-0000000000b1', $1, $2, 85000, '2026-01-04', 'transfer'),
         ('00000000-0000-4000-8000-0000000000b2', $1, $2, 30000, '2026-02-10', 'transfer'),
         ('00000000-0000-4000-8000-0000000000b3', $1, $2, 10000, '2026-03-02', 'cash'),
         ('00000000-0000-4000-8000-0000000000b4', $3, $4, 50000, '2026-03-03', 'transfer')`,
      [E.A, L.a1, E.B, L.b1],
    )
    await c.query(
      `insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode, cancelled_at, cancellation_reason) values ($1, $2, 77777, '2026-03-04', 'cheque', now(), 'annulé')`,
      [E.A, L.a1],
    )
    await c.query(
      `insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values
         ($1, $2, '00000000-0000-4000-8000-0000000000b1', '00000000-0000-4000-8000-0000000000e1', 85000),
         ($1, $2, '00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000e2', 30000),
         ($3, $4, '00000000-0000-4000-8000-0000000000b4', '00000000-0000-4000-8000-0000000000e5', 50000)`,
      [E.A, L.a1, E.B, L.b1],
    )
    const catA = (await c.query("select id from public.expense_categories where entity_id = $1 and name = 'Travaux'", [E.A])).rows[0].id
    const catB = (await c.query("select id from public.expense_categories where entity_id = $1 and name = 'Travaux'", [E.B])).rows[0].id
    await c.query(
      `insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents) values
         ($1, $3, $5, '2026-02-20', 'Plomberie', 12000), ($1, $4, $5, '2026-03-05', 'Peinture', 8000), ($2, $6, $7, '2026-03-06', 'Serrure', 3000)`,
      [E.A, E.B, P.a1, P.a2, catA, P.b1, catB],
    )
    await c.query(
      `insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, cancelled_at, cancellation_reason)
         values ($1, $2, $3, '2026-03-01', 'Annulée', 55555, now(), 'doublon')`,
      [E.A, P.a1, catA],
    )
    // Apurement : remboursement de 4 000 en mars, complément reçu de 1 500 en février (signé négatif).
    await c.query(
      `insert into public.charge_settlements (entity_id, lease_id, settled_on, amount_cents, mode, reason) values
         ($1, $2, '2026-03-08', 4000, 'transfer', 'Régularisation'), ($1, $2, '2026-02-12', -1500, 'transfer', 'Complément')`,
      [E.A, L.a1],
    )
    await asOwner(c)
    await fn(c)
  })

const summary = async (c: pg.Client, entities: string[] | null, props: string[] | null, from: string, to: string) =>
  (await c.query('select * from public.dashboard_summary($1, $2, $3, $4)', [entities, props, from, to])).rows[0]

describe('dashboard_summary', () => {
  it('recalcule chaque indicateur de mars 2026 pour la structure A', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const s = await summary(c, [E.A], null, '2026-03-01', '2026-03-31')
      expect(s).toMatchObject({
        active_properties: 2,
        running_leases: 1,
        active_tenants: 1,
        called_cents: '85000', // mars du bien 1 ; l'annulée d'avril est exclue
        collected_cents: '10000', // le paiement annulé de 77 777 est exclu
        expenses_cents: '8000', // la dépense annulée est exclue
        refunds_net_cents: '4000',
        estimated_balance_cents: '-2000', // 10 000 - 8 000 - 4 000
        remaining_due_cents: '200000', // fév. (55 000) et mars (85 000) du bien 1, fév. du bien 2 (60 000)
        overdue_count: 3,
      })
    })
  })

  it('restant dû, impayés échus et à affecter à ce jour', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const s = await summary(c, [E.A], null, '2026-03-01', '2026-03-31')
      // Échus au 15 mars : février bien 1 (55 000), mars bien 1 (85 000), février bien 2 (60 000) = 200 000.
      expect(s.overdue_cents).toBe('200000')
      expect(s.overdue_count).toBe(3)
      expect(s.overdue_max_days).toBe(38) // 5 février → 15 mars
      expect(s.to_allocate_cents).toBe('10000') // le paiement de mars n'est pas affecté ; l'annulé ne compte pas
      expect(s.final_settlements_pending).toBe(1) // bail terminé du bien 2 sans apurement final
    })
  })

  it('filtre par bien ; l\'échéance mars du bien 1 seul', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const s = await summary(c, [E.A], [P.a2], '2026-01-01', '2026-12-31')
      expect(s).toMatchObject({ active_properties: 1, running_leases: 0, called_cents: '60000', collected_cents: '0', expenses_cents: '8000', overdue_cents: '60000' })
    })
  })

  it('restant dû borné à aujourd\'hui même pour une période qui finit plus tard', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const s = await summary(c, [E.A], [P.a1], '2026-01-01', '2026-12-31')
      expect(s.remaining_due_cents).toBe('140000') // février 55 000 + mars 85 000 ; l'échéance annulée d'avril n'existe pas
      const early = await summary(c, [E.A], [P.a1], '2026-01-01', '2026-01-31')
      expect(early.remaining_due_cents).toBe('0') // seul janvier (soldé)
    })
  })

  it('vue consolidée : additionne les structures du membre, rien d\'une structure étrangère', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const own = await summary(c, null, null, '2026-03-01', '2026-03-31')
      expect(own.called_cents).toBe('85000') // la structure B n'est pas visible de l'administrateur A
      await asOwner(c)
      await c.query("insert into public.entity_memberships (entity_id, profile_id, role) values ($1, $2, 'reader')", [E.B, U.adminA])
      await asUser(c, U.adminA)
      const both = await summary(c, null, null, '2026-03-01', '2026-03-31')
      expect(both).toMatchObject({ called_cents: '135000', collected_cents: '60000', expenses_cents: '11000', active_properties: 3 })
    })
  })

  it('tous les rôles de membre, lecteur compris, lisent ; un non-membre voit des zéros', async () => {
    await world(async (c) => {
      for (const user of [U.managerA, U.readerA]) {
        await asUser(c, user)
        expect((await summary(c, [E.A], null, '2026-03-01', '2026-03-31')).called_cents).toBe('85000')
      }
      await asUser(c, U.outsider)
      expect(await summary(c, [E.A], null, '2026-03-01', '2026-03-31')).toMatchObject({ called_cents: '0', collected_cents: '0', active_properties: 0 })
    })
  })

  it('concorde avec un recalcul direct depuis les tables brutes', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const raw = async (sql: string) => Number((await c.query(sql)).rows[0].v)
      const from = '2026-01-01'
      const to = '2026-03-31'
      const s = await summary(c, [E.A], null, from, to)
      expect(Number(s.called_cents)).toBe(await raw(`select coalesce(sum(rent_cents + charges_cents), 0) as v from public.rent_charges where entity_id = '${E.A}' and cancelled_at is null and due_on between '${from}' and '${to}'`))
      expect(Number(s.collected_cents)).toBe(await raw(`select coalesce(sum(amount_cents), 0) as v from public.payments where entity_id = '${E.A}' and cancelled_at is null and received_on between '${from}' and '${to}'`))
      expect(Number(s.expenses_cents)).toBe(await raw(`select coalesce(sum(amount_cents), 0) as v from public.expenses where entity_id = '${E.A}' and cancelled_at is null and expense_date between '${from}' and '${to}'`))
      expect(Number(s.refunds_net_cents)).toBe(await raw(`select coalesce(sum(amount_cents), 0) as v from public.charge_settlements where entity_id = '${E.A}' and cancelled_at is null and settled_on between '${from}' and '${to}'`))
      expect(Number(s.estimated_balance_cents)).toBe(Number(s.collected_cents) - Number(s.expenses_cents) - Number(s.refunds_net_cents))
    })
  })
})

describe('dashboard_monthly', () => {
  it('une ligne par mois, sommes égales au résumé de la période', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const { rows } = await c.query('select * from public.dashboard_monthly($1, null, $2, $3)', [[E.A], '2026-01-01', '2026-03-31'])
      expect(rows.map((r) => new Date(r.month).getMonth())).toEqual([0, 1, 2])
      const byMonth = rows.map((r) => [Number(r.called_cents), Number(r.collected_cents), Number(r.expenses_cents)])
      expect(byMonth).toEqual([
        [85000, 85000, 0],
        [145000, 30000, 12000], // 85 000 + 60 000 appelés ; 30 000 encaissés ; 12 000 de dépenses
        [85000, 10000, 8000],
      ])
      const s = await summary(c, [E.A], null, '2026-01-01', '2026-03-31')
      expect(rows.reduce((n, r) => n + Number(r.called_cents), 0)).toBe(Number(s.called_cents))
      expect(rows.reduce((n, r) => n + Number(r.collected_cents), 0)).toBe(Number(s.collected_cents))
      expect(rows.reduce((n, r) => n + Number(r.expenses_cents), 0)).toBe(Number(s.expenses_cents))
    })
  })

  it('les bornes d\'une période en milieu de mois limitent le premier et le dernier mois', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const { rows } = await c.query('select * from public.dashboard_monthly($1, null, $2, $3)', [[E.A], '2026-02-06', '2026-03-04'])
      // Février : échéances du 5 hors période ; paiement du 10 inclus. Mars : échéance du 5 hors période ; paiement du 2 inclus.
      expect(rows.map((r) => [Number(r.called_cents), Number(r.collected_cents)])).toEqual([[0, 30000], [0, 10000]])
    })
  })
})

describe('dashboard_by_property', () => {
  it('comparaison par bien, somme égale au résumé, colonne structure', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await asOwner(c)
      await c.query("insert into public.entity_memberships (entity_id, profile_id, role) values ($1, $2, 'reader')", [E.B, U.adminA])
      await asUser(c, U.adminA)
      const { rows } = await c.query('select * from public.dashboard_by_property(null, null, $1, $2)', ['2026-01-01', '2026-03-31'])
      expect(rows.map((r) => [r.entity_name, r.property_label])).toEqual([['Structure A', 'A1'], ['Structure A', 'A2'], ['Structure B', 'B1']])
      const a1 = rows[0]
      expect(a1).toMatchObject({ called_cents: '255000', collected_cents: '125000', overdue_cents: '140000', expenses_cents: '12000', refunds_net_cents: '2500' })
      expect(Number(a1.estimated_balance_cents)).toBe(125000 - 12000 - 2500)
      const s = await summary(c, null, null, '2026-01-01', '2026-03-31')
      expect(rows.reduce((n, r) => n + Number(r.called_cents), 0)).toBe(Number(s.called_cents))
      expect(rows.reduce((n, r) => n + Number(r.estimated_balance_cents), 0)).toBe(Number(s.estimated_balance_cents))
    })
  })
})
