import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type pg from 'pg'
import { chargeAmounts, dueDateFor, occupiedDays, termForPeriod } from '../../src/domains/finance/rules'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = { a: '00000000-0000-4000-8000-0000000000c1', b: '00000000-0000-4000-8000-0000000000c2' }
const L = { a: '00000000-0000-4000-8000-0000000000a9', b: '00000000-0000-4000-8000-0000000000b9' }
const C = { jan: '00000000-0000-4000-8000-0000000000e1', feb: '00000000-0000-4000-8000-0000000000e2', mar: '00000000-0000-4000-8000-0000000000e3', b: '00000000-0000-4000-8000-0000000000e9' }

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $3, 'Bien A'), ($2, $4, 'Bien B')", [P.a, P.b, E.A, E.B])
    await c.query("insert into public.leases (id, entity_id, property_id, start_date, due_day) values ($1, $3, $5, '2026-01-01', 5), ($2, $4, $6, '2026-01-01', 5)", [L.a, L.b, E.A, E.B, P.a, P.b])
    await c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $3, '2026-01-01', 80000, 5000), ($2, $4, '2026-01-01', 50000, 0)", [E.A, E.B, L.a, L.b])
    await c.query(
      `insert into public.rent_charges (id, entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values
         ($1, $5, $6, '2026-01-01', '2026-01-31', '2026-01-05', 80000, 5000),
         ($2, $5, $6, '2026-02-01', '2026-02-28', '2026-02-05', 80000, 5000),
         ($3, $5, $6, '2026-03-01', '2026-03-31', '2026-03-05', 80000, 5000),
         ($4, $7, $8, '2026-01-01', '2026-01-31', '2026-01-05', 50000, 0)`,
      [C.jan, C.feb, C.mar, C.b, E.A, L.a, E.B, L.b],
    )
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-03-10', true)")
    await fn(c)
  })

const record = async (c: pg.Client, o: { amount?: number; mode?: string; received?: string; allocations?: { rent_charge_id: string; amount_cents: number }[]; confirm?: boolean; lease?: string } = {}) =>
  (
    await c.query('select public.record_payment($1, $2, $3, $4, $5, $6, $7::jsonb, $8) as id', [
      o.lease ?? L.a,
      o.amount ?? 85000,
      o.received ?? '2026-03-01',
      o.mode ?? 'transfer',
      'VIR-1',
      null,
      JSON.stringify(o.allocations ?? []),
      o.confirm ?? false,
    ])
  ).rows[0].id as string

const balance = async (c: pg.Client, id: string) => (await c.query('select paid_cents, balance_cents, status from public.rent_charge_balances where id = $1', [id])).rows[0]
const audit = async (c: pg.Client, prefix: string) => {
  // Le journal se lit en propriétaire ; on revient ensuite à l'utilisateur connecté (les droits JWT restent posés).
  await c.query('reset role')
  const { rows } = await c.query('select action, details from public.audit_logs where entity_id = $1 and action like $2 order by occurred_at, id', [E.A, `${prefix}%`])
  await c.query('set local role authenticated')
  return rows
}

describe('record_payment', () => {
  it('saisit un paiement avec ses affectations de la plus ancienne à la plus récente, le reste demeure non affecté', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, {
        amount: 100000,
        allocations: [
          { rent_charge_id: C.jan, amount_cents: 85000 },
          { rent_charge_id: C.feb, amount_cents: 10000 },
        ],
      })
      expect(await balance(c, C.jan)).toMatchObject({ paid_cents: 85000, balance_cents: 0, status: 'paid' })
      expect(await balance(c, C.feb)).toMatchObject({ paid_cents: 10000, balance_cents: 75000, status: 'late' })
      expect(await balance(c, C.mar)).toMatchObject({ paid_cents: 0, status: 'late' })
      const { rows } = await c.query('select sum(amount_cents)::int as s from public.payment_allocations where payment_id = $1', [id])
      expect(rows[0].s).toBe(95000) // 5 000 restent non affectés
    })
  })

  it('un paiement en avance reste non affecté, puis s\'affecte quand l\'échéance existe', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { amount: 85000, received: '2026-03-02' })
      expect((await c.query('select 1 from public.payment_allocations where payment_id = $1', [id])).rows).toEqual([])
      expect(await c.query('select public.allocate_payment($1, $2::jsonb) as n', [id, JSON.stringify([{ rent_charge_id: C.mar, amount_cents: 85000 }])]).then((r) => r.rows[0].n)).toBe(1)
      expect((await balance(c, C.mar)).status).toBe('paid')
    })
  })

  it('refuse sans le droit, un montant nul, un mode inconnu, une date future', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      await expect(record(c)).rejects.toThrow(/Droit insuffisant/)
    })
    for (const [o, message] of [
      [{ amount: 0 }, /montant du paiement doit être positif/],
      [{ mode: 'bitcoin' }, /Mode de paiement inconnu/],
      [{ received: '2026-03-11' }, /dans le futur/],
    ] as const) {
      await world(async (c) => {
        await asUser(c, U.adminA)
        await expect(record(c, o)).rejects.toThrow(message)
      })
    }
  })

  it('refuse des affectations qui dépassent le paiement ou l\'échéance, ou visent un autre bail, et ne laisse rien derrière', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(record(c, { amount: 1000, allocations: [{ rent_charge_id: C.jan, amount_cents: 1001 }] })).rejects.toThrow(/dépassent le montant du paiement/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(record(c, { amount: 100000, allocations: [{ rent_charge_id: C.jan, amount_cents: 85001 }] })).rejects.toThrow(/dépassent le montant de l'échéance/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      await expect(record(c, { allocations: [{ rent_charge_id: C.b, amount_cents: 1000 }] })).rejects.toThrow(/introuvable pour ce bail/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query('savepoint s')
      await expect(record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 0 }] })).rejects.toThrow(/montant positif/)
      await c.query('rollback to savepoint s')
      expect((await c.query('select 1 from public.payments')).rows).toEqual([])
    })
  })

  it('espèces à partir de 1 000 € : confirmation exigée, puis tracée', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query('savepoint s')
      await expect(record(c, { mode: 'cash', amount: 100000 })).rejects.toThrow(/Confirmation requise/)
      await c.query('rollback to savepoint s')
      await record(c, { mode: 'cash', amount: 99999 })
      await record(c, { mode: 'cash', amount: 100000, confirm: true })
      expect((await audit(c, 'payment.cash_warning')).map((r) => r.action)).toEqual(['payment.cash_warning_confirmed'])
    })
  })

  it('trace la saisie et chaque affectation, sans référence ni commentaire', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await record(c, { amount: 85000, allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }] })
      const rows = await audit(c, 'payment.')
      expect(rows.map((r) => r.action)).toEqual(['payment.created'])
      expect(rows[0].details).toMatchObject({ amount_cents: 85000, mode: 'transfer' })
      expect(JSON.stringify(rows)).not.toContain('VIR-1')
      expect((await audit(c, 'allocation.')).map((r) => r.action)).toEqual(['allocation.created'])
    })
  })
})

describe('retrait et déplacement d\'une affectation', () => {
  it('retire une affectation avec un motif, sans annuler le paiement', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }] })
      const alloc = (await c.query('select id from public.payment_allocations where payment_id = $1', [id])).rows[0].id
      await expect(c.query("select public.reverse_allocation($1, '  ')", [alloc])).rejects.toThrow(/motif est obligatoire/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }] })
      const alloc = (await c.query('select id from public.payment_allocations where payment_id = $1', [id])).rows[0].id
      await c.query("select public.reverse_allocation($1, 'Mauvaise échéance')", [alloc])
      expect((await balance(c, C.jan)).status).toBe('late')
      expect((await c.query('select cancelled_at from public.payments where id = $1', [id])).rows[0].cancelled_at).toBeNull()
      await expect(c.query("select public.reverse_allocation($1, 'encore')", [alloc])).rejects.toThrow(/déjà retirée/)
    })
  })

  it('déplace une affectation vers une autre échéance du même bail, en une transaction', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }] })
      const alloc = (await c.query('select id from public.payment_allocations where payment_id = $1', [id])).rows[0].id
      await c.query("select public.move_allocation($1, $2, 'Réaffectation')", [alloc, C.feb])
      expect(await balance(c, C.jan)).toMatchObject({ paid_cents: 0 })
      expect(await balance(c, C.feb)).toMatchObject({ paid_cents: 85000, status: 'paid' })
      expect((await audit(c, 'allocation.moved'))[0].details).toMatchObject({ from_rent_charge_id: C.jan, to_rent_charge_id: C.feb, amount_cents: 85000 })
    })
  })

  it('refuse un déplacement vers une échéance saturée, d\'un autre bail, ou identique ; la source reste intacte', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const full = await record(c, { allocations: [{ rent_charge_id: C.feb, amount_cents: 85000 }] })
      void full
      const id = await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }] })
      const alloc = (await c.query('select id from public.payment_allocations where payment_id = $1', [id])).rows[0].id
      await c.query('savepoint s')
      await expect(c.query("select public.move_allocation($1, $2, 'x')", [alloc, C.feb])).rejects.toThrow(/dépassent le montant de l'échéance/)
      await c.query('rollback to savepoint s')
      await expect(c.query("select public.move_allocation($1, $2, 'x')", [alloc, C.jan])).rejects.toThrow(/la même/)
      await c.query('rollback to savepoint s').catch(() => {})
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }] })
      const alloc = (await c.query('select id from public.payment_allocations where payment_id = $1', [id])).rows[0].id
      await expect(c.query("select public.move_allocation($1, $2, 'x')", [alloc, C.b])).rejects.toThrow(/introuvable pour ce bail/)
    })
  })
})

describe('cancel_payment', () => {
  it('annule le paiement, conserve le motif, retire les affectations et restaure les soldes', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { amount: 100000, allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }, { rent_charge_id: C.feb, amount_cents: 15000 }] })
      await expect(c.query("select public.cancel_payment($1, '')", [id])).rejects.toThrow(/motif est obligatoire/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c, { amount: 100000, allocations: [{ rent_charge_id: C.jan, amount_cents: 85000 }, { rent_charge_id: C.feb, amount_cents: 15000 }] })
      await c.query("select public.cancel_payment($1, 'Chèque impayé')", [id])
      expect(await balance(c, C.jan)).toMatchObject({ paid_cents: 0, balance_cents: 85000 })
      expect(await balance(c, C.feb)).toMatchObject({ paid_cents: 0 })
      const p = (await c.query('select cancelled_at is not null as cancelled, cancellation_reason, cancelled_by from public.payments where id = $1', [id])).rows[0]
      expect(p).toEqual({ cancelled: true, cancellation_reason: 'Chèque impayé', cancelled_by: U.managerA })
      expect((await audit(c, 'payment.cancelled'))[0].details).toMatchObject({ reversed_allocations: 2, amount_cents: 100000, reason: 'Chèque impayé' })
      await expect(c.query("select public.cancel_payment($1, 'encore')", [id])).rejects.toThrow(/déjà annulé/)
    })
  })

  it('réservé à ceux qui ont le droit d\'annuler', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c)
      await asUser(c, U.readerA)
      await expect(c.query("select public.cancel_payment($1, 'x')", [id])).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c)
      await asUser(c, U.adminB)
      await expect(c.query("select public.cancel_payment($1, 'x')", [id])).rejects.toThrow(/Droit insuffisant/)
    })
  })
})

describe('update_payment_details', () => {
  it('corrige référence, commentaire, mode et date ; trace les champs modifiés sans leur contenu', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c)
      await c.query("select public.update_payment_details($1, 'VIR-2', 'Note privée', 'cheque', '2026-03-02')", [id])
      const p = (await c.query('select reference, comment, mode, received_on::text as d from public.payments where id = $1', [id])).rows[0]
      expect(p).toEqual({ reference: 'VIR-2', comment: 'Note privée', mode: 'cheque', d: '2026-03-02' })
      const rows = await audit(c, 'payment.updated')
      expect(rows).toHaveLength(1)
      expect(rows[0].details.changed.sort()).toEqual(['comment', 'mode', 'received_on', 'reference'])
      expect(rows[0].details.mode).toEqual({ from: 'transfer', to: 'cheque' })
      expect(JSON.stringify(rows)).not.toMatch(/Note privée|VIR-2/)
    })
  })

  it('ne trace rien si rien ne change, refuse un mode inconnu ou une date future', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c)
      await c.query("select public.update_payment_details($1, 'VIR-1', null, 'transfer', '2026-03-01')", [id])
      expect(await audit(c, 'payment.updated')).toEqual([])
      await c.query('savepoint s')
      await expect(c.query("select public.update_payment_details($1, null, null, 'troc', '2026-03-01')", [id])).rejects.toThrow(/Mode/)
      await c.query('rollback to savepoint s')
      await expect(c.query("select public.update_payment_details($1, null, null, 'cash', '2026-03-11')", [id])).rejects.toThrow(/futur/)
    })
  })

  it('le montant ne se modifie pas par cette voie', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await record(c)
      await expect(c.query('update public.payments set amount_cents = 1 where id = $1', [id])).rejects.toThrow(/ne se modifient pas|montant/)
    })
  })
})

describe('échéances : recalcul et annulation', () => {
  it('recalcule une échéance sans affectation d\'après les conditions de loyer', async () => {
    await world(async (c) => {
      await asOwner(c)
      await c.query("update public.rental_terms set rent_cents = 90000, charges_cents = 6000 where lease_id = $1", [L.a])
      await asUser(c, U.managerA)
      await c.query('select public.recalc_rent_charge($1)', [C.feb])
      expect((await c.query('select rent_cents, charges_cents, total_cents from public.rent_charges where id = $1', [C.feb])).rows[0]).toEqual({ rent_cents: 90000, charges_cents: 6000, total_cents: 96000 })
      const rows = await audit(c, 'rent_charge.recalculated')
      expect(rows[0].details).toEqual({ from: { rent_cents: 80000, charges_cents: 5000 }, to: { rent_cents: 90000, charges_cents: 6000 } })
    })
  })

  it('refuse le recalcul d\'une échéance avec affectation active ou annulée, et ne trace rien sans changement', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 1000 }] })
      await asOwner(c)
      await c.query('update public.rental_terms set rent_cents = 90000 where lease_id = $1', [L.a])
      await asUser(c, U.managerA)
      await expect(c.query('select public.recalc_rent_charge($1)', [C.jan])).rejects.toThrow(/affectations actives/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await c.query('select public.recalc_rent_charge($1)', [C.feb]) // montants déjà à jour
      expect(await audit(c, 'rent_charge.recalculated')).toEqual([])
    })
  })

  it('annule une échéance sans affectation, avec motif ; refuse sinon', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await expect(c.query("select public.cancel_rent_charge($1, ' ')", [C.feb])).rejects.toThrow(/motif est obligatoire/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await c.query("select public.cancel_rent_charge($1, 'Bail annulé')", [C.feb])
      expect((await balance(c, C.feb)).status).toBe('cancelled')
      expect((await audit(c, 'rent_charge.cancelled'))[0].details).toMatchObject({ total_cents: 85000, reason: 'Bail annulé' })
      await expect(c.query("select public.cancel_rent_charge($1, 'x')", [C.feb])).rejects.toThrow(/déjà annulée/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await record(c, { allocations: [{ rent_charge_id: C.jan, amount_cents: 1000 }] })
      await expect(c.query("select public.cancel_rent_charge($1, 'x')", [C.jan])).rejects.toThrow(/affectations actives/)
    })
  })

  it('un lecteur ne recalcule ni n\'annule', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      await expect(c.query('select public.recalc_rent_charge($1)', [C.jan])).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      await asUser(c, U.readerA)
      await expect(c.query("select public.cancel_rent_charge($1, 'x')", [C.jan])).rejects.toThrow(/Droit insuffisant/)
    })
  })
})

describe('rent_charge_amounts : mêmes résultats que les fonctions pures', () => {
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const addDays = (date: string, n: number) => iso(new Date(new Date(`${date}T00:00:00Z`).getTime() + n * 86_400_000))

  it('propriété : échéance, jours occupés et montants identiques pour des baux et des conditions aléatoires', async () => {
    await world(async (c) => {
      let n = 0
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            startOffset: fc.integer({ min: 0, max: 900 }),
            length: fc.option(fc.integer({ min: 0, max: 700 }), { nil: null }),
            dueDay: fc.integer({ min: 1, max: 31 }),
            rent: fc.integer({ min: 0, max: 400_000 }),
            charges: fc.integer({ min: 0, max: 50_000 }),
            raise: fc.option(fc.record({ offset: fc.integer({ min: 0, max: 600 }), rent: fc.integer({ min: 0, max: 400_000 }), charges: fc.integer({ min: 0, max: 50_000 }) }), { nil: null }),
            monthOffset: fc.integer({ min: -2, max: 30 }),
          }),
          async (s) => {
            const start = addDays('2024-01-01', s.startOffset)
            const end = s.length === null ? null : addDays(start, s.length)
            const raiseDate = s.raise && s.raise.offset > 0 && (end === null || addDays(start, s.raise.offset) <= end) ? addDays(start, s.raise.offset) : null
            await c.query('savepoint run')
            const property = (await c.query("insert into public.properties (entity_id, label) values ($1, $2) returning id", [E.A, `Bien ${n++}`])).rows[0].id
            const lease = (await c.query('insert into public.leases (entity_id, property_id, start_date, end_date, due_day) values ($1, $2, $3, $4, $5) returning id', [E.A, property, start, end, s.dueDay])).rows[0].id
            await c.query('insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, $3, $4, $5)', [E.A, lease, start, s.rent, s.charges])
            const terms = [{ effectiveFrom: start, rentCents: s.rent, chargesCents: s.charges }]
            if (raiseDate && s.raise) {
              await c.query('insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, $3, $4, $5)', [E.A, lease, raiseDate, s.raise.rent, s.raise.charges])
              terms.push({ effectiveFrom: raiseDate, rentCents: s.raise.rent, chargesCents: s.raise.charges })
            }

            const startMonth = Number(start.slice(0, 4)) * 12 + Number(start.slice(5, 7)) - 1 + s.monthOffset
            const period = { year: Math.floor(startMonth / 12), month: (startMonth % 12) + 1 }
            const sql = (await c.query('select due_on::text as due_on, occupied_days, rent_cents, charges_cents from app.rent_charge_amounts($1, $2, $3)', [lease, period.year, period.month])).rows[0]
            const term = termForPeriod(terms, period, start)
            if (!term) {
              expect(sql).toBeUndefined()
            } else {
              const dim = new Date(Date.UTC(period.year, period.month, 0)).getUTCDate()
              const occ = occupiedDays(period, start, end)
              const amounts = chargeAmounts(term.rentCents, term.chargesCents, occ, dim)
              expect({
                due_on: sql.due_on,
                occupied_days: sql.occupied_days,
                rent_cents: sql.rent_cents,
                charges_cents: sql.charges_cents,
              }).toEqual({ due_on: dueDateFor(period, s.dueDay, start, end), occupied_days: occ, rent_cents: amounts.rentCents, charges_cents: amounts.chargesCents })
            }
            await c.query('rollback to savepoint run')
          },
        ),
        { numRuns: 60 },
      )
    })
  })
})
