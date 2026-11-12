import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { computeStatus } from '../../src/domains/finance/rules'
import { DATABASE_URL, inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = { a: '00000000-0000-4000-8000-0000000000c1', b: '00000000-0000-4000-8000-0000000000c2' }
const L = { a: '00000000-0000-4000-8000-0000000000a9', b: '00000000-0000-4000-8000-0000000000b9' }
const C = { jan: '00000000-0000-4000-8000-0000000000e1', feb: '00000000-0000-4000-8000-0000000000e2', b: '00000000-0000-4000-8000-0000000000e9' }
const PAY = { one: '00000000-0000-4000-8000-0000000000f1', two: '00000000-0000-4000-8000-0000000000f2', b: '00000000-0000-4000-8000-0000000000f9' }

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $3, 'Bien A'), ($2, $4, 'Bien B')", [P.a, P.b, E.A, E.B])
    await c.query("insert into public.leases (id, entity_id, property_id, start_date, due_day) values ($1, $3, $5, '2026-01-01', 5), ($2, $4, $6, '2026-01-01', 5)", [L.a, L.b, E.A, E.B, P.a, P.b])
    await c.query(
      `insert into public.rent_charges (id, entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values
         ($1, $4, $5, '2026-01-01', '2026-01-31', '2026-01-05', 80000, 5000),
         ($2, $4, $5, '2026-02-01', '2026-02-28', '2026-02-05', 80000, 5000),
         ($3, $6, $7, '2026-01-01', '2026-01-31', '2026-01-05', 50000, 0)`,
      [C.jan, C.feb, C.b, E.A, L.a, E.B, L.b],
    )
    await c.query(
      `insert into public.payments (id, entity_id, lease_id, amount_cents, received_on, mode) values
         ($1, $4, $5, 100000, '2026-01-04', 'transfer'), ($2, $4, $5, 85000, '2026-02-04', 'cheque'), ($3, $6, $7, 50000, '2026-01-04', 'transfer')`,
      [PAY.one, PAY.two, PAY.b, E.A, L.a, E.B, L.b],
    )
    await fn(c)
  })

const allocate = (c: pg.Client, payment: string, charge: string, amount: number, lease = L.a, entity = E.A) =>
  c.query('insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values ($1, $2, $3, $4, $5) returning id', [entity, lease, payment, charge, amount])

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

describe('suppression interdite, y compris pour service_role', () => {
  it.each(['rent_charges', 'payments', 'payment_allocations'])('%s : DELETE refusé au propriétaire de la base', async (table) => {
    await world(async (c) => {
      await allocate(c, PAY.one, C.jan, 1000)
      await expect(c.query(`delete from public.${table}`)).rejects.toThrow(/suppression interdite/)
    })
  })

  it.each(['rent_charges', 'payments', 'payment_allocations'])('%s : DELETE refusé même avec le privilège donné à service_role', async (table) => {
    await world(async (c) => {
      await allocate(c, PAY.one, C.jan, 1000)
      await c.query(`grant delete on public.${table} to service_role`)
      await c.query('set local role service_role')
      await expect(c.query(`delete from public.${table}`)).rejects.toThrow(/suppression interdite/)
    })
  })
})

describe('colonnes modifiables', () => {
  it('paiement : référence, commentaire, mode et date de réception se corrigent ; montant et bail jamais', async () => {
    await world(async (c) => {
      await c.query("update public.payments set reference = 'VIR-1', comment = 'ok', mode = 'cheque', received_on = '2026-01-03' where id = $1", [PAY.one])
      await expect(c.query('update public.payments set amount_cents = 1 where id = $1', [PAY.one])).rejects.toThrow(/montant et le bail/)
    })
    await world(async (c) => {
      await expect(c.query('update public.payments set lease_id = $2 where id = $1', [PAY.one, L.b])).rejects.toThrow()
    })
  })

  it('échéance : période, date d\'échéance et bail immuables ; montants modifiables sans affectation active', async () => {
    await world(async (c) => {
      await c.query('update public.rent_charges set rent_cents = 81000 where id = $1', [C.jan])
      expect((await c.query('select total_cents from public.rent_charges where id = $1', [C.jan])).rows[0].total_cents).toBe(86000)
      await expect(c.query("update public.rent_charges set due_on = '2026-01-10' where id = $1", [C.jan])).rejects.toThrow(/Seuls les montants/)
    })
    await world(async (c) => {
      await expect(c.query("update public.rent_charges set period_start = '2026-01-02' where id = $1", [C.jan])).rejects.toThrow(/Seuls les montants/)
    })
  })

  it('échéance : recalcul et annulation refusés tant qu\'une affectation est active', async () => {
    await world(async (c) => {
      await allocate(c, PAY.one, C.jan, 1000)
      await expect(c.query('update public.rent_charges set rent_cents = 1 where id = $1', [C.jan])).rejects.toThrow(/affectations actives/)
    })
    await world(async (c) => {
      await allocate(c, PAY.one, C.jan, 1000)
      await expect(c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'erreur' where id = $1", [C.jan])).rejects.toThrow(/affectations actives/)
    })
    await world(async (c) => {
      const { rows } = await allocate(c, PAY.one, C.jan, 1000)
      await c.query("update public.payment_allocations set reversed_at = now(), reversal_reason = 'erreur' where id = $1", [rows[0].id])
      await c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'erreur' where id = $1", [C.jan])
      await expect(c.query('update public.rent_charges set rent_cents = 1 where id = $1', [C.jan])).rejects.toThrow(/annulée/)
    })
  })

  it('paiement : annulation refusée tant qu\'une affectation est active, puis motif obligatoire', async () => {
    await world(async (c) => {
      await allocate(c, PAY.one, C.jan, 1000)
      await expect(c.query("update public.payments set cancelled_at = now(), cancellation_reason = 'doublon' where id = $1", [PAY.one])).rejects.toThrow(/affectations actives/)
    })
    await world(async (c) => {
      const { rows } = await allocate(c, PAY.one, C.jan, 1000)
      await c.query("update public.payment_allocations set reversed_at = now(), reversal_reason = 'doublon' where id = $1", [rows[0].id])
      await expect(c.query('update public.payments set cancelled_at = now() where id = $1', [PAY.one])).rejects.toThrow(/check/)
    })
    await world(async (c) => {
      await c.query("update public.payments set cancelled_at = now(), cancellation_reason = 'doublon' where id = $1", [PAY.one])
      await expect(c.query("update public.payments set comment = 'x', cancelled_at = null, cancellation_reason = null where id = $1", [PAY.one])).rejects.toThrow(/annulé/)
    })
  })

  it('affectation : seule l\'annulation se modifie, une fois', async () => {
    await world(async (c) => {
      const { rows } = await allocate(c, PAY.one, C.jan, 1000)
      await expect(c.query('update public.payment_allocations set amount_cents = 2000 where id = $1', [rows[0].id])).rejects.toThrow(/ne se modifie pas/)
    })
    await world(async (c) => {
      const { rows } = await allocate(c, PAY.one, C.jan, 1000)
      await c.query("update public.payment_allocations set reversed_at = now(), reversal_reason = 'a' where id = $1", [rows[0].id])
      await expect(c.query("update public.payment_allocations set reversal_reason = 'b' where id = $1", [rows[0].id])).rejects.toThrow(/déjà|retirée/)
    })
  })
})

describe('invariants des affectations', () => {
  it('la somme des affectations actives ne dépasse ni le paiement ni l\'échéance', async () => {
    await world(async (c) => {
      await allocate(c, PAY.one, C.jan, 85000) // solde complet de janvier
      await expect(allocate(c, PAY.one, C.jan, 1)).rejects.toThrow(/dépassent le montant de l'échéance/)
    })
    await world(async (c) => {
      await allocate(c, PAY.two, C.jan, 50000)
      await c.query('savepoint s')
      await expect(allocate(c, PAY.two, C.feb, 35001)).rejects.toThrow(/dépassent le montant du paiement/)
      await c.query('rollback to savepoint s')
      await allocate(c, PAY.two, C.feb, 35000)
    })
  })

  it('une affectation retirée libère le solde', async () => {
    await world(async (c) => {
      const { rows } = await allocate(c, PAY.one, C.jan, 85000)
      await c.query("update public.payment_allocations set reversed_at = now(), reversal_reason = 'erreur' where id = $1", [rows[0].id])
      await allocate(c, PAY.one, C.jan, 85000)
      expect((await c.query('select paid_cents from public.rent_charge_balances where id = $1', [C.jan])).rows[0].paid_cents).toBe(85000)
    })
  })

  it('refuse un paiement ou une échéance annulés, et le paiement d\'un autre bail ou d\'une autre structure', async () => {
    await world(async (c) => {
      await c.query("update public.payments set cancelled_at = now(), cancellation_reason = 'doublon' where id = $1", [PAY.one])
      await expect(allocate(c, PAY.one, C.jan, 1000)).rejects.toThrow(/paiement annulé/)
    })
    await world(async (c) => {
      await c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'erreur' where id = $1", [C.jan])
      await expect(allocate(c, PAY.one, C.jan, 1000)).rejects.toThrow(/échéance annulée/)
    })
    await world(async (c) => {
      await expect(allocate(c, PAY.b, C.jan, 1000)).rejects.toThrow(/foreign key/)
    })
    await world(async (c) => {
      await expect(allocate(c, PAY.one, C.b, 1000)).rejects.toThrow(/foreign key/)
    })
  })

  it('montants strictement positifs', async () => {
    await world(async (c) => {
      await expect(allocate(c, PAY.one, C.jan, 0)).rejects.toThrow(/check/)
    })
    await world(async (c) => {
      await expect(
        c.query("insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode) values ($1, $2, 0, '2026-01-01', 'cash')", [E.A, L.a]),
      ).rejects.toThrow(/check/)
    })
  })
})

describe('unicité des échéances', () => {
  it('une seule échéance non annulée par bail et par période ; après annulation, on peut en recréer une', async () => {
    await world(async (c) => {
      await expect(
        c.query("insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, '2026-01-01', '2026-01-31', '2026-01-05', 1, 1)", [E.A, L.a]),
      ).rejects.toThrow(/rent_charges_one_active_per_period/)
    })
    await world(async (c) => {
      await c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'erreur' where id = $1", [C.jan])
      await c.query("insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, '2026-01-01', '2026-01-31', '2026-01-05', 1, 1)", [E.A, L.a])
    })
  })
})

describe('vue rent_charge_balances', () => {
  const today = (c: pg.Client, date: string) => c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', $1, true)", [date])
  const row = async (c: pg.Client, id: string) => (await c.query('select * from public.rent_charge_balances where id = $1', [id])).rows[0]

  it('calcule payé, solde et statut à partir des seules affectations actives', async () => {
    await world(async (c) => {
      await today(c, '2026-01-04')
      expect(await row(c, C.jan)).toMatchObject({ paid_cents: 0, balance_cents: 85000, status: 'to_pay', total_cents: 85000 })
      const { rows } = await allocate(c, PAY.one, C.jan, 30000)
      expect(await row(c, C.jan)).toMatchObject({ paid_cents: 30000, balance_cents: 55000, status: 'partially_paid' })
      await today(c, '2026-01-06')
      expect((await row(c, C.jan)).status).toBe('late')
      await allocate(c, PAY.one, C.jan, 55000)
      expect(await row(c, C.jan)).toMatchObject({ balance_cents: 0, status: 'paid' })
      await c.query("update public.payment_allocations set reversed_at = now(), reversal_reason = 'erreur' where id = $1", [rows[0].id])
      expect(await row(c, C.jan)).toMatchObject({ paid_cents: 55000, balance_cents: 30000, status: 'late' })
    })
  })

  it('une échéance annulée a le statut « cancelled »', async () => {
    await world(async (c) => {
      await c.query("update public.rent_charges set cancelled_at = now(), cancellation_reason = 'erreur' where id = $1", [C.feb])
      expect((await row(c, C.feb)).status).toBe('cancelled')
    })
  })

  it('même résultat que la fonction pure computeStatus, sur une grille de cas', async () => {
    await world(async (c) => {
      const dates = ['2026-01-04', '2026-01-05', '2026-01-06', '2026-03-01']
      const paid = [0, 1, 40000, 85000]
      for (const date of dates) {
        for (const amount of paid) {
          await c.query('savepoint s')
          if (amount > 0) await allocate(c, PAY.one, C.jan, amount)
          await today(c, date)
          const r = await row(c, C.jan)
          expect(r.status, `${date} · payé ${amount}`).toBe(computeStatus({ totalCents: 85000, allocatedCents: amount, dueDate: '2026-01-05', today: date }))
          await c.query('rollback to savepoint s')
        }
      }
    })
  })

  it('suit les droits : lecture pour le lecteur, rien pour une autre structure ni sans second facteur', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect((await c.query('select 1 from public.rent_charge_balances')).rows).toHaveLength(2)
      await asUser(c, U.adminB)
      expect((await c.query('select entity_id from public.rent_charge_balances')).rows).toEqual([{ entity_id: E.B }])
      await asUser(c, U.adminA, 'aal1')
      expect((await c.query('select 1 from public.rent_charge_balances')).rows).toEqual([])
      await asOwner(c)
    })
  })
})

describe('droits sur les tables financières', () => {
  it('lecture pour le lecteur ; écriture pour le gestionnaire ; aucune création d\'échéance par un utilisateur', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect((await c.query('select 1 from public.payments')).rows).toHaveLength(2)
      expect(await blocked(c, "insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode, created_by) values ($1, $2, 100, '2026-01-01', 'cash', $3)", [E.A, L.a, U.readerA])).toBe(true)

      await asUser(c, U.managerA)
      expect((await c.query("insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode) values ($1, $2, 100, '2026-01-01', 'cash')", [E.A, L.a])).rowCount).toBe(1)
      expect(await blocked(c, "insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode, created_by) values ($1, $2, 100, '2026-01-01', 'cash', $3)", [E.A, L.a, U.adminA])).toBe(true)
      expect(await blocked(c, "insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, '2026-05-01', '2026-05-31', '2026-05-05', 1, 1)", [E.A, L.a])).toBe(true)
      expect(await blocked(c, 'delete from public.payments')).toBe(true)

      await asUser(c, U.adminB)
      expect((await c.query('select 1 from public.payments')).rows).toHaveLength(1)
      expect(await blocked(c, "update public.payments set comment = 'piraté' where id = $1", [PAY.one])).toBe(true)
    })
  })
})

describe('concurrence', () => {
  /** Jeu de données validé en base (deux connexions doivent le voir), supprimé ensuite en désactivant les triggers d'immutabilité. */
  async function withCommittedData(fn: (ids: { entity: string; lease: string; charge: string; chargeTwo: string; payments: string[] }) => Promise<void>) {
    const admin = new pg.Client({ connectionString: DATABASE_URL })
    await admin.connect()
    const q = async (sql: string, params: unknown[] = []) => (await admin.query(sql, params)).rows
    const entity = (await q("insert into public.ownership_entities (name, kind) values ('Concurrence', 'sci') returning id"))[0].id as string
    try {
      const property = (await q("insert into public.properties (entity_id, label) values ($1, 'Bien') returning id", [entity]))[0].id as string
      const lease = (await q("insert into public.leases (entity_id, property_id, start_date, due_day) values ($1, $2, '2026-01-01', 5) returning id", [entity, property]))[0].id as string
      const charges = await q(
        "insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, '2026-01-01', '2026-01-31', '2026-01-05', 100, 0), ($1, $2, '2026-02-01', '2026-02-28', '2026-02-05', 100, 0) returning id",
        [entity, lease],
      )
      const payments = await q(
        "insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode) values ($1, $2, 100, '2026-01-01', 'transfer'), ($1, $2, 100, '2026-01-02', 'transfer') returning id",
        [entity, lease],
      )
      await fn({ entity, lease, charge: charges[0].id, chargeTwo: charges[1].id, payments: payments.map((p) => p.id) })
    } finally {
      for (const [table, trigger] of [['payment_allocations', 'payment_allocations_no_delete'], ['payments', 'payments_no_delete'], ['rent_charges', 'rent_charges_no_delete']]) {
        await admin.query(`alter table public.${table} disable trigger ${trigger}`)
        await admin.query(`delete from public.${table} where entity_id = $1`, [entity])
        await admin.query(`alter table public.${table} enable trigger ${trigger}`)
      }
      await admin.query('delete from public.leases where entity_id = $1', [entity])
      await admin.query('delete from public.properties where entity_id = $1', [entity])
      await admin.query('delete from public.expense_categories where entity_id = $1', [entity])
      await admin.query('delete from public.ownership_entities where id = $1', [entity])
      await admin.end()
    }
  }

  const insertAllocation = 'insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values ($1, $2, $3, $4, $5)'

  it('deux affectations simultanées ne peuvent pas dépasser le montant de l\'échéance', async () => {
    await withCommittedData(async ({ entity, lease, charge, payments }) => {
      const a = new pg.Client({ connectionString: DATABASE_URL })
      const b = new pg.Client({ connectionString: DATABASE_URL })
      await Promise.all([a.connect(), b.connect()])
      try {
        await a.query('begin')
        await b.query('begin')
        await a.query(insertAllocation, [entity, lease, payments[0], charge, 60])
        const second = b.query(insertAllocation, [entity, lease, payments[1], charge, 60]) // attend le verrou de l'échéance
        await new Promise((r) => setTimeout(r, 400))
        await a.query('commit')
        await expect(second).rejects.toThrow(/dépassent le montant de l'échéance/)
        await b.query('rollback')
        const { rows } = await a.query('select coalesce(sum(amount_cents), 0)::int as total from public.payment_allocations where rent_charge_id = $1', [charge])
        expect(rows[0].total).toBe(60)
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    })
  })

  it('deux affectations simultanées d\'un même paiement ne peuvent pas dépasser son montant', async () => {
    await withCommittedData(async ({ entity, lease, charge, chargeTwo, payments }) => {
      const a = new pg.Client({ connectionString: DATABASE_URL })
      const b = new pg.Client({ connectionString: DATABASE_URL })
      await Promise.all([a.connect(), b.connect()])
      try {
        await a.query('begin')
        await b.query('begin')
        await a.query(insertAllocation, [entity, lease, payments[0], charge, 70])
        const second = b.query(insertAllocation, [entity, lease, payments[0], chargeTwo, 70])
        await new Promise((r) => setTimeout(r, 400))
        await a.query('commit')
        await expect(second).rejects.toThrow(/dépassent le montant du paiement/)
        await b.query('rollback')
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    })
  })

  it('des affectations simultanées dont la somme tient dans le solde réussissent toutes', async () => {
    await withCommittedData(async ({ entity, lease, charge, payments }) => {
      const a = new pg.Client({ connectionString: DATABASE_URL })
      const b = new pg.Client({ connectionString: DATABASE_URL })
      await Promise.all([a.connect(), b.connect()])
      try {
        await a.query('begin')
        await b.query('begin')
        await a.query(insertAllocation, [entity, lease, payments[0], charge, 40])
        const second = b.query(insertAllocation, [entity, lease, payments[1], charge, 60])
        await new Promise((r) => setTimeout(r, 400))
        await a.query('commit')
        await second
        await b.query('commit')
        const { rows } = await a.query('select sum(amount_cents)::int as total from public.payment_allocations where rent_charge_id = $1', [charge])
        expect(rows[0].total).toBe(100)
      } finally {
        await Promise.all([a.end(), b.end()])
      }
    })
  })
})
