import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const P = { a: '00000000-0000-4000-8000-0000000000c1', b: '00000000-0000-4000-8000-0000000000c2' }
const T = { a: '00000000-0000-4000-8000-0000000000c3' }
const L = { a: '00000000-0000-4000-8000-0000000000a9', b: '00000000-0000-4000-8000-0000000000b9' }
const C = { jan: '00000000-0000-4000-8000-0000000000e1' }
const PAY = { one: '00000000-0000-4000-8000-0000000000f1', b: '00000000-0000-4000-8000-0000000000f9' }

const world = (fn: (c: pg.Client) => Promise<void>, leaseEnd: string | null = null) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $3, 'Bien A'), ($2, $4, 'Bien B')", [P.a, P.b, E.A, E.B])
    await c.query("insert into public.tenants (id, entity_id, last_name) values ($1, $2, 'Martin')", [T.a, E.A])
    await c.query("insert into public.leases (id, entity_id, property_id, start_date, end_date, due_day) values ($1, $3, $5, '2026-01-01', $7, 5), ($2, $4, $6, '2026-01-01', null, 5)", [L.a, L.b, E.A, E.B, P.a, P.b, leaseEnd])
    await c.query("insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date) values ($1, $2, $3, '2026-01-01', $4)", [E.A, L.a, T.a, leaseEnd])
    await c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-01-01', 80000, 5000)", [E.A, L.a])
    await c.query("insert into public.rent_charges (id, entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values ($1, $2, $3, '2026-01-01', '2026-01-31', '2026-01-05', 80000, 5000)", [C.jan, E.A, L.a])
    await c.query("insert into public.payments (id, entity_id, lease_id, amount_cents, received_on, mode) values ($1, $3, $5, 100000, '2026-01-04', 'transfer'), ($2, $4, $6, 5000, '2026-01-04', 'transfer')", [PAY.one, PAY.b, E.A, E.B, L.a, L.b])
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-06-15', true)")
    await fn(c)
  })

interface Settle {
  lease?: string
  kind?: string
  on?: string
  amount?: number
  mode?: string
  reason?: string
  payment?: string | null
  final?: boolean
}
const settle = async (c: pg.Client, o: Settle = {}) =>
  (
    await c.query('select public.record_charge_settlement($1, $2, $3, $4, $5, $6, null, null, $7, $8, null, null) as id', [
      o.lease ?? L.a,
      o.kind ?? 'charges_adjustment',
      o.on ?? '2026-06-01',
      o.amount ?? 12000,
      o.mode ?? 'transfer',
      o.reason ?? 'Régularisation annuelle',
      o.payment ?? null,
      o.final ?? false,
    ])
  ).rows[0].id as string

const audit = async (c: pg.Client, prefix: string) => {
  await c.query('reset role')
  const { rows } = await c.query('select action, details from public.audit_logs where entity_id = $1 and action like $2 order by occurred_at, id', [E.A, `${prefix}%`])
  await c.query('set local role authenticated')
  return rows
}

describe('record_charge_settlement', () => {
  it('accepte un remboursement positif, un complément reçu négatif et plusieurs apurements pendant le bail', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await settle(c, { amount: 12000 })
      await settle(c, { amount: -8000, on: '2026-06-10', reason: 'Complément de charges 2025' })
      await settle(c, { amount: 500, on: '2026-06-12' })
      const { rows } = await c.query('select amount_cents from public.charge_settlements order by amount_cents')
      expect(rows.map((r) => r.amount_cents)).toEqual([-8000, 500, 12000])
    })
  })

  it('le montant zéro est réservé à l\'apurement final', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await expect(settle(c, { amount: 0 })).rejects.toThrow(/montant nul/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await settle(c, { amount: 0, final: true, reason: 'Aucune régularisation' })
      expect((await c.query('select is_final, amount_cents from public.charge_settlements where id = $1', [id])).rows[0]).toEqual({ is_final: true, amount_cents: 0 })
    })
  })

  it('un seul apurement final non annulé par bail ; annulé, il se ressaisit', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const first = await settle(c, { amount: 0, final: true, reason: 'Fin de bail' })
      await c.query('savepoint s')
      await expect(settle(c, { amount: 100, final: true })).rejects.toThrow(/déjà un apurement final/)
      await c.query('rollback to savepoint s')
      await c.query("select public.cancel_charge_settlement($1, 'Saisi par erreur')", [first])
      await settle(c, { amount: 200, final: true, reason: 'Fin de bail' })
    })
  })

  it('refuse une date future, un motif vide, et un bail d\'une autre structure', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await expect(settle(c, { on: '2026-06-16' })).rejects.toThrow(/dans le futur/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await expect(settle(c, { reason: '  ' })).rejects.toThrow(/motif est obligatoire/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await expect(settle(c, { lease: L.b })).rejects.toThrow(/Droit insuffisant/)
    })
  })

  it('lecture seule pour le lecteur, rien sans second facteur', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      await expect(settle(c)).rejects.toThrow(/Droit insuffisant/)
    })
    await world(async (c) => {
      await asUser(c, U.adminA, 'aal1')
      await expect(settle(c)).rejects.toThrow(/Droit insuffisant/)
    })
  })

  it('aucun effet sur les échéances, les soldes et les paiements', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const before = (await c.query('select paid_cents, balance_cents, status from public.rent_charge_balances where id = $1', [C.jan])).rows[0]
      await settle(c, { amount: 12000 })
      await settle(c, { amount: -9000, on: '2026-06-02' })
      expect((await c.query('select paid_cents, balance_cents, status from public.rent_charge_balances where id = $1', [C.jan])).rows[0]).toEqual(before)
      expect((await c.query('select amount_cents from public.payments where id = $1', [PAY.one])).rows[0].amount_cents).toBe(100000)
    })
  })

  it('trace la création sans le motif libre', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await settle(c, { amount: 12000, reason: 'Détail privé' })
      const rows = await audit(c, 'charge_settlement.')
      expect(rows.map((r) => r.action)).toEqual(['charge_settlement.created'])
      expect(rows[0].details).toMatchObject({ amount_cents: 12000, kind: 'charges_adjustment', is_final: false })
      expect(JSON.stringify(rows)).not.toContain('Détail privé')
    })
  })
})

describe('remboursement du paiement non affecté', () => {
  it('doit être positif, adossé à un paiement du même bail, et réduit d\'autant le montant affectable', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await settle(c, { kind: 'unallocated_refund', amount: 30000, payment: PAY.one, reason: 'Trop-perçu rendu' })
      // 100 000 − 30 000 = 70 000 restent affectables
      await c.query('savepoint s')
      await expect(c.query("select public.allocate_payment($1, $2::jsonb)", [PAY.one, JSON.stringify([{ rent_charge_id: C.jan, amount_cents: 70001 }])])).rejects.toThrow()
      await c.query('rollback to savepoint s')
      await c.query("select public.allocate_payment($1, $2::jsonb)", [PAY.one, JSON.stringify([{ rent_charge_id: C.jan, amount_cents: 70000 }])])
    })
  })

  it('refuse un montant négatif, sans paiement, supérieur au reste non affecté, ou pour un autre bail', async () => {
    for (const [o, message] of [
      [{ amount: -100, payment: PAY.one }, /check|violates/],
      [{ amount: 100, payment: null }, /check|violates/],
      [{ amount: 100001, payment: PAY.one }, /dépasse le montant non affecté/],
      [{ amount: 100, payment: PAY.b }, /foreign key/],
    ] as const) {
      await world(async (c) => {
        await asUser(c, U.managerA)
        await expect(settle(c, { kind: 'unallocated_refund', ...o })).rejects.toThrow(message)
      })
    }
  })

  it('le reste non affecté tient compte des affectations existantes', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await c.query("select public.allocate_payment($1, $2::jsonb)", [PAY.one, JSON.stringify([{ rent_charge_id: C.jan, amount_cents: 85000 }])])
      await expect(settle(c, { kind: 'unallocated_refund', amount: 15001, payment: PAY.one })).rejects.toThrow(/dépasse le montant non affecté/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await c.query("select public.allocate_payment($1, $2::jsonb)", [PAY.one, JSON.stringify([{ rent_charge_id: C.jan, amount_cents: 85000 }])])
      await settle(c, { kind: 'unallocated_refund', amount: 15000, payment: PAY.one })
    })
  })

  it('un paiement ne s\'annule pas tant qu\'un remboursement actif en dépend', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await settle(c, { kind: 'unallocated_refund', amount: 1000, payment: PAY.one })
      await c.query('savepoint s')
      await expect(c.query("select public.cancel_payment($1, 'Doublon')", [PAY.one])).rejects.toThrow(/remboursement actif/)
      await c.query('rollback to savepoint s')
      await c.query("select public.cancel_charge_settlement($1, 'Annulé')", [id])
      await c.query("select public.cancel_payment($1, 'Doublon')", [PAY.one])
    })
  })
})

describe('annulation, correction et immutabilité', () => {
  it('annule avec un motif obligatoire, une seule fois ; trace l\'annulation', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await settle(c)
      await expect(c.query("select public.cancel_charge_settlement($1, ' ')", [id])).rejects.toThrow(/motif est obligatoire/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await settle(c)
      await c.query("select public.cancel_charge_settlement($1, 'Erreur de montant')", [id])
      expect((await audit(c, 'charge_settlement.cancelled'))[0].details).toMatchObject({ amount_cents: 12000, reason: 'Erreur de montant' })
      await expect(c.query("select public.cancel_charge_settlement($1, 'encore')", [id])).rejects.toThrow(/déjà annulé/)
    })
  })

  it('corrige date, mode, référence et commentaire avec trace ; le montant ne se corrige pas', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await settle(c)
      await c.query("select public.update_charge_settlement_details($1, '2026-06-05', 'cheque', 'CHQ-9', 'Note privée')", [id])
      const row = (await c.query('select settled_on::text as d, mode, reference from public.charge_settlements where id = $1', [id])).rows[0]
      expect(row).toEqual({ d: '2026-06-05', mode: 'cheque', reference: 'CHQ-9' })
      const rows = await audit(c, 'charge_settlement.modified')
      expect(rows[0].details.changed.sort()).toEqual(['comment', 'mode', 'reference', 'settled_on'])
      expect(JSON.stringify(rows)).not.toMatch(/Note privée|CHQ-9/)
      await expect(c.query('update public.charge_settlements set amount_cents = 1 where id = $1', [id])).rejects.toThrow(/montant et la nature/)
    })
  })

  it('aucune suppression, y compris pour service_role', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await settle(c)
      await asOwner(c)
      await expect(c.query('delete from public.charge_settlements')).rejects.toThrow(/suppression interdite/)
    })
    await world(async (c) => {
      await asUser(c, U.managerA)
      await settle(c)
      await asOwner(c)
      await c.query('grant delete on public.charge_settlements to service_role')
      await c.query('set local role service_role')
      await expect(c.query('delete from public.charge_settlements')).rejects.toThrow(/suppression interdite/)
    })
  })
})

describe('cloisonnement', () => {
  it('lecture pour le lecteur, rien pour une autre structure', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await settle(c)
      await asUser(c, U.readerA)
      expect((await c.query('select 1 from public.charge_settlements')).rows).toHaveLength(1)
      await asUser(c, U.adminB)
      expect((await c.query('select 1 from public.charge_settlements')).rows).toEqual([])
    })
  })
})

describe('apurement final manquant', () => {
  const status = async (c: pg.Client) => (await c.query('select final_missing, has_final from public.lease_settlement_status where lease_id = $1', [L.a])).rows[0]

  it('un bail terminé sans apurement final est signalé ; la saisie ou l\'annulation change l\'alerte', async () => {
    await world(
      async (c) => {
        await asUser(c, U.managerA)
        expect(await status(c)).toEqual({ final_missing: true, has_final: false })
        const id = await settle(c, { amount: 0, final: true, reason: 'Fin de bail' })
        expect(await status(c)).toEqual({ final_missing: false, has_final: true })
        await c.query("select public.cancel_charge_settlement($1, 'Erreur')", [id])
        expect(await status(c)).toEqual({ final_missing: true, has_final: false })
      },
      '2026-05-31',
    )
  })

  it('un bail en cours, ou qui se termine plus tard, n\'est pas signalé', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      expect(await status(c)).toEqual({ final_missing: false, has_final: false })
    })
    await world(
      async (c) => {
        await asUser(c, U.managerA)
        expect((await status(c)).final_missing).toBe(false)
      },
      '2026-12-31',
    )
  })

  it('bloque l\'anonymisation du dossier tant que l\'apurement final manque', async () => {
    await world(
      async (c) => {
        await asOwner(c)
        const missing = async () => (await c.query('select app.tenant_has_missing_final_settlement($1) as m', [T.a])).rows[0].m
        expect(await missing()).toBe(true)
        await asUser(c, U.managerA)
        await settle(c, { amount: 0, final: true, reason: 'Fin de bail' })
        await asOwner(c)
        expect(await missing()).toBe(false)
      },
      '2026-05-31',
    )
  })

  it('ne bloque ni la saisie des paiements ni les affectations', async () => {
    await world(
      async (c) => {
        await asUser(c, U.managerA)
        await c.query("select public.record_payment($1, 1000, '2026-06-01', 'transfer', null, null, '[]'::jsonb, false)", [L.a])
      },
      '2026-05-31',
    )
  })
})
