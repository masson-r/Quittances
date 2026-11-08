import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld, createAuthUser } from './personas'

const P = '00000000-0000-4000-8000-0000000000c1'
const L = '00000000-0000-4000-8000-0000000000a9'
const C = { jan: '00000000-0000-4000-8000-0000000000e1', feb: '00000000-0000-4000-8000-0000000000e2', mar: '00000000-0000-4000-8000-0000000000e3' }
const T = { alice: '00000000-0000-4000-8000-0000000000f1', bob: '00000000-0000-4000-8000-0000000000f2', carl: '00000000-0000-4000-8000-0000000000f5' }
const ACCOUNT = '00000000-0000-4000-8000-0000000000f3'
const SHA = 'a'.repeat(64)

/** Bail de janvier à mars 2026 (loyer 800 € + 50 €), deux colocataires, aujourd'hui = 10 mars 2026. */
const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("update public.ownership_entities set address_line = '3 rue du Bailleur', postal_code = '75002', city = 'Paris', siret = '12345678901234' where id = $1", [E.A])
    await c.query("insert into public.properties (id, entity_id, label, address_line1, postal_code, city) values ($1, $2, 'Appartement 3', '1 rue des Lilas', '75001', 'Paris')", [P, E.A])
    await c.query("insert into public.leases (id, entity_id, property_id, start_date, due_day) values ($1, $2, $3, '2026-01-01', 5)", [L, E.A, P])
    await c.query("insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values ($1, $2, '2026-01-01', 80000, 5000)", [E.A, L])
    await c.query(
      "insert into public.tenants (id, entity_id, last_name, first_name) values ($1, $4, 'Durand', 'Alice'), ($2, $4, 'Martin', 'Bob'), ($3, $4, 'Zola', 'Carl')",
      [T.alice, T.bob, T.carl, E.A],
    )
    // Carl ne rejoint le bail qu'en mars : absent de la quittance de janvier.
    await c.query(
      "insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date) values ($1, $2, $3, '2026-01-01', null), ($1, $2, $4, '2026-01-01', null), ($1, $2, $5, '2026-03-01', null)",
      [E.A, L, T.alice, T.bob, T.carl],
    )
    await c.query(
      `insert into public.rent_charges (id, entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents) values
         ($1, $4, $5, '2026-01-01', '2026-01-31', '2026-01-05', 80000, 5000),
         ($2, $4, $5, '2026-02-01', '2026-02-28', '2026-02-05', 80000, 5000),
         ($3, $4, $5, '2026-03-01', '2026-03-31', '2026-03-05', 80000, 5000)`,
      [C.jan, C.feb, C.mar, E.A, L],
    )
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-03-10', true)")
    await fn(c)
  })

const pay = async (c: pg.Client, amount: number, received: string, charge: string, mode = 'transfer') =>
  (
    await c.query('select public.record_payment($1, $2, $3, $4, null, null, $5::jsonb, false) as id', [
      L,
      amount,
      received,
      mode,
      JSON.stringify([{ rent_charge_id: charge, amount_cents: amount }]),
    ])
  ).rows[0].id as string

const issue = async (c: pg.Client, kind: string, charge: string, payment: string | null = null, issued: string | null = null, paid: string | null = null) =>
  (await c.query('select * from public.issue_receipt($1, $2, $3, $4, $5)', [kind, charge, payment, issued, paid])).rows[0] as { id: string; number: string }

/** Une requête refusée par la base, sans abandonner la transaction du test. */
const refuses = async (c: pg.Client, message: RegExp | undefined, sql: string, params?: unknown[]) => {
  await c.query('savepoint refus')
  const error = await c.query(sql, params).then(
    () => null,
    (e: Error) => e,
  )
  await c.query('rollback to savepoint refus')
  expect(error, 'la requête devait être refusée').not.toBeNull()
  if (message) expect(error!.message).toMatch(message)
}

const receipt = async (c: pg.Client, id: string) => (await c.query('select * from public.receipts where id = $1', [id])).rows[0]

describe('émission d\'une quittance', () => {
  it('quittance pour une échéance soldée : numéro, dates par défaut, instantané complet', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 50000, '2026-01-03', C.jan)
      await pay(c, 35000, '2026-01-20', C.jan, 'cheque')
      const { id, number } = await issue(c, 'quittance', C.jan)
      expect(number).toBe('QUI-2026-03-0001')
      const r = await receipt(c, id)
      expect(r).toMatchObject({ kind: 'quittance', amount_cents: 85000, version: 1, file_path: null, payment_id: null, signature_id: null })
      expect(String(r.issued_on)).toContain('2026')
      const snap = r.snapshot
      expect(snap.lessor).toMatchObject({ name: 'Structure A', postal_code: '75002', siret: '12345678901234' })
      expect(snap.tenants).toEqual(['Alice Durand', 'Bob Martin']) // Carl n'est pas encore présent en janvier
      expect(snap.property).toMatchObject({ label: 'Appartement 3', city: 'Paris' })
      expect(snap).toMatchObject({ rent_cents: 80000, charges_cents: 5000, total_cents: 85000, remaining_cents: 0, signature: null })
      expect(snap.settlements.map((s: { received_on: string; amount_cents: number }) => [s.received_on, s.amount_cents])).toEqual([['2026-01-03', 50000], ['2026-01-20', 35000]])
      // Date de paiement par défaut : dernier règlement soldant l'échéance.
      expect(await c.query('select paid_on::text, proposed_paid_on::text, issued_on::text from public.receipts where id = $1', [id]).then((x) => x.rows[0])).toEqual({
        paid_on: '2026-01-20',
        proposed_paid_on: '2026-01-20',
        issued_on: '2026-03-10',
      })
    })
  })

  it('refuse une échéance non soldée, annulée, ou déjà couverte par une quittance active', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 40000, '2026-02-03', C.feb)
      await refuses(c, /intégralement réglée/, "select * from public.issue_receipt('quittance', $1, null, null, null)", [C.feb])
      await pay(c, 85000, '2026-01-03', C.jan)
      await issue(c, 'quittance', C.jan)
      await refuses(c, /déjà émise/, "select * from public.issue_receipt('quittance', $1, null, null, null)", [C.jan])
      await refuses(c, /intégralement réglée/, "select * from public.issue_receipt('quittance', $1, null, null, null)", [C.mar])
    })
  })

  it('dates modifiables : valeurs proposées conservées, écarts tracés ; ni future, ni paiement postérieur à l\'émission', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-12', C.jan)
      await refuses(c, /futur/, "select * from public.issue_receipt('quittance', $1, null, '2026-03-11', null)", [C.jan])
      await refuses(c, /postérieure/, "select * from public.issue_receipt('quittance', $1, null, '2026-01-10', null)", [C.jan])
      await refuses(c, /postérieure/, "select * from public.issue_receipt('quittance', $1, null, null, '2026-03-11')", [C.jan])
      const { id } = await issue(c, 'quittance', C.jan, null, '2026-02-01', '2026-01-10')
      const r = (await c.query('select issued_on::text, paid_on::text, proposed_issued_on::text, proposed_paid_on::text from public.receipts where id = $1', [id])).rows[0]
      expect(r).toEqual({ issued_on: '2026-02-01', paid_on: '2026-01-10', proposed_issued_on: '2026-03-10', proposed_paid_on: '2026-01-12' })
      await asOwner(c)
      const log = (await c.query("select details from public.audit_logs where action = 'receipt.issued'")).rows[0].details
      expect(log).toMatchObject({ proposed_issued_on: '2026-03-10', issued_on: '2026-02-01', proposed_paid_on: '2026-01-12', paid_on: '2026-01-10' })
    })
  })

  it('numérotation par structure, genre et mois d\'émission, sans trou ni doublon', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      await pay(c, 85000, '2026-02-03', C.feb)
      const first = await issue(c, 'quittance', C.jan)
      const second = await issue(c, 'quittance', C.feb)
      expect([first.number, second.number]).toEqual(['QUI-2026-03-0001', 'QUI-2026-03-0002'])
      await c.query('select public.cancel_receipt($1, $2)', [first.id, 'erreur de saisie'])
      const replacement = (await c.query('select * from public.replace_receipt($1, $2, null, null)', [second.id, 'date erronée'])).rows[0]
      expect(replacement.number).toBe('QUI-2026-03-0003')
    })
  })

  it('reçu de paiement partiel : montant du paiement affecté, reste dû, jamais pour une échéance soldée', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const p1 = await pay(c, 30000, '2026-02-03', C.feb)
      const { id, number } = await issue(c, 'partial_receipt', C.feb, p1)
      expect(number).toBe('REC-2026-03-0001')
      const r = await receipt(c, id)
      expect(r).toMatchObject({ kind: 'partial_receipt', amount_cents: 30000, payment_id: p1 })
      expect(r.snapshot).toMatchObject({ received_cents: 30000, remaining_cents: 55000, total_cents: 85000 })
      await refuses(c, /déjà émis/, "select * from public.issue_receipt('partial_receipt', $1, $2, null, null)", [C.feb, p1])
      await refuses(c, /intégralement|n'est pas affecté/, "select * from public.issue_receipt('partial_receipt', $1, $2, null, null)", [C.jan, p1])
      await refuses(c, /rattache à un paiement/, "select * from public.issue_receipt('partial_receipt', $1, null, null, null)", [C.feb])

      await pay(c, 55000, '2026-02-20', C.feb)
      await refuses(c, /soldée/, "select * from public.issue_receipt('partial_receipt', $1, $2, null, null)", [C.feb, p1])
    })
  })

  it('la signature de la personne qui émet est référencée (identifiant et empreinte)', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const sig = (await c.query("select public.save_my_signature($1, 'image/png', 10, 10, decode('89504e47', 'hex')) as id", [E.A])).rows[0].id
      await pay(c, 85000, '2026-01-03', C.jan)
      const { id } = await issue(c, 'quittance', C.jan)
      const r = await receipt(c, id)
      expect(r.signature_id).toBe(sig)
      expect(r.snapshot.signature).toMatchObject({ id: sig })
      expect(r.snapshot.signature.sha256).toMatch(/^[0-9a-f]{64}$/)
      // La signature d'un autre membre n'est jamais utilisée.
      await asUser(c, U.adminA)
      await pay(c, 85000, '2026-02-03', C.feb)
      const other = await issue(c, 'quittance', C.feb)
      expect((await receipt(c, other.id)).signature_id).toBeNull()
    })
  })

  it.each([
    ['lecteur', U.readerA, 'aal2'],
    ['gestionnaire sans second facteur', U.managerA, 'aal1'],
    ['administrateur d\'une autre structure', U.adminB, 'aal2'],
    ['membre suspendu', U.suspendedA, 'aal2'],
  ] as const)('refuse l\'émission : %s', async (_label, user, aal) => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      await asUser(c, user, aal)
      await refuses(c, /Droit insuffisant/, "select * from public.issue_receipt('quittance', $1, null, null, null)", [C.jan])
    })
  })

  it('pas d\'insertion ni de modification directe : seules les fonctions écrivent', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      const { id } = await issue(c, 'quittance', C.jan)
      await refuses(c, undefined, "update public.receipts set amount_cents = 1 where id = $1", [id])
      await refuses(c, undefined, "delete from public.receipts where id = $1", [id])
      await refuses(c, undefined, "insert into public.receipts (entity_id, kind, number, lease_id, rent_charge_id, period_start, period_end, issued_on, paid_on, proposed_issued_on, proposed_paid_on, amount_cents, snapshot, issued_by) values ($1, 'quittance', 'QUI-FAUX', $2, $3, '2026-02-01', '2026-02-28', '2026-03-01', '2026-03-01', '2026-03-01', '2026-03-01', 1, '{}', $4)", [E.A, L, C.feb, U.managerA])
      await asOwner(c)
      // Même le propriétaire de la base ne modifie pas un document émis.
      await refuses(c, /ne peut pas être modifié/, 'update public.receipts set amount_cents = 1 where id = $1', [id])
      await refuses(c, /suppression interdite/, 'delete from public.receipts where id = $1', [id])
    })
  })
})

describe('fichier PDF et annulation', () => {
  const path = (id: string) => `${E.A}/${id}.pdf`

  it('enregistre l\'empreinte une seule fois, par la personne qui a émis', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      const { id } = await issue(c, 'quittance', C.jan)
      await c.query('select public.attach_receipt_file($1, $2, $3, 1234)', [id, path(id), SHA])
      expect(await receipt(c, id)).toMatchObject({ file_path: path(id), file_sha256: SHA, file_size: 1234 })
      await refuses(c, /déjà enregistré/, 'select public.attach_receipt_file($1, $2, $3, 1234)', [id, path(id), 'b'.repeat(64)])
      await asOwner(c)
      await refuses(c, /ne change jamais|ne peut pas être modifié/, "update public.receipts set file_sha256 = $2 where id = $1", [id, 'c'.repeat(64)])
    })
  })

  it('refuse un chemin inattendu, une empreinte invalide, et un autre membre', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      const { id } = await issue(c, 'quittance', C.jan)
      await refuses(c, /Chemin/, 'select public.attach_receipt_file($1, $2, $3, 10)', [id, `${E.A}/autre.pdf`, SHA])
      await refuses(c, /Empreinte/, 'select public.attach_receipt_file($1, $2, $3, 10)', [id, path(id), 'xyz'])
      await asUser(c, U.adminA)
      await refuses(c, /Droit insuffisant/, 'select public.attach_receipt_file($1, $2, $3, 10)', [id, path(id), SHA])
    })
  })

  it('annulation avec motif, par l\'administrateur ou le gestionnaire ; le lecteur ne peut pas', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      const { id } = await issue(c, 'quittance', C.jan)
      await asUser(c, U.readerA)
      await refuses(c, /Droit insuffisant/, 'select public.cancel_receipt($1, $2)', [id, 'motif'])
      await asUser(c, U.managerA)
      await refuses(c, /motif/, 'select public.cancel_receipt($1, $2)', [id, '  '])
      await c.query('select public.cancel_receipt($1, $2)', [id, 'erreur'])
      await refuses(c, /déjà annulé/, 'select public.cancel_receipt($1, $2)', [id, 'encore'])
      expect(await receipt(c, id)).toMatchObject({ cancellation_reason: 'erreur' })
      // Après annulation, une nouvelle quittance peut être émise pour l'échéance.
      const again = await issue(c, 'quittance', C.jan)
      expect(again.id).not.toBe(id)
    })
  })

  it('remplacement : ancienne version conservée annulée, nouvelle version liée, trace des deux', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-01-03', C.jan)
      const first = await issue(c, 'quittance', C.jan)
      const next = (await c.query("select * from public.replace_receipt($1, 'dates incorrectes', '2026-03-05', '2026-01-03')", [first.id])).rows[0]
      expect(await receipt(c, first.id)).toMatchObject({ cancellation_reason: 'dates incorrectes', version: 1 })
      expect(await receipt(c, next.id)).toMatchObject({ version: 2, supersedes_receipt_id: first.id, cancelled_at: null })
      expect((await c.query('select issued_on::text from public.receipts where id = $1', [next.id])).rows[0].issued_on).toBe('2026-03-05')
      await asOwner(c)
      const actions = (await c.query("select action from public.audit_logs where subject_table = 'receipts' order by action")).rows.map((r) => r.action)
      expect(actions).toEqual(['receipt.cancelled', 'receipt.issued', 'receipt.issued'])
    })
  })
})

describe('dépendances financières', () => {
  it('retrait, déplacement et annulation du paiement refusés tant qu\'une quittance en dépend', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const payment = await pay(c, 85000, '2026-01-03', C.jan)
      const allocation = (await c.query('select id from public.payment_allocations where payment_id = $1', [payment])).rows[0].id
      const { id } = await issue(c, 'quittance', C.jan)
      await refuses(c, /annulez-le d'abord/, "select public.reverse_allocation($1, 'erreur')", [allocation])
      await refuses(c, /annulez-le d'abord/, "select public.move_allocation($1, $2, 'erreur')", [allocation, C.feb])
      await refuses(c, /annulez-le d'abord/, "select public.cancel_payment($1, 'erreur')", [payment])

      await c.query('select public.cancel_receipt($1, $2)', [id, 'erreur'])
      await c.query("select public.cancel_payment($1, 'erreur')", [payment])
      expect((await c.query('select status from public.rent_charge_balances where id = $1', [C.jan])).rows[0].status).toBe('late')
    })
  })

  it('un reçu partiel bloque seulement son propre paiement', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const p1 = await pay(c, 30000, '2026-02-03', C.feb)
      const p2 = await pay(c, 20000, '2026-02-10', C.feb)
      await issue(c, 'partial_receipt', C.feb, p1)
      await refuses(c, /annulez-le d'abord/, "select public.cancel_payment($1, 'erreur')", [p1])
      await c.query("select public.cancel_payment($1, 'erreur')", [p2])
    })
  })
})

describe('documents du locataire rattaché', () => {
  const attach = async (c: pg.Client, tenant: string) => {
    await asOwner(c)
    await createAuthUser(c, ACCOUNT, 'compte@example.test')
    await c.query('update auth.users set email_confirmed_at = now() where id = $1', [ACCOUNT])
    await asUser(c, U.adminA)
    const inv = (await c.query('select * from public.create_tenant_invitation($1)', [tenant])).rows[0]
    await asUser(c, ACCOUNT, 'aal1')
    const request = (await c.query("select request_id from public.consume_tenant_invitation($1, null, true, 'v1')", [inv.token])).rows[0].request_id
    await asUser(c, U.adminA)
    await c.query('select public.decide_tenant_access($1, true)', [request])
    return request as string
  }

  const issueStored = async (c: pg.Client, charge: string, amount: number, received: string) => {
    await asUser(c, U.managerA)
    await pay(c, amount, received, charge)
    const r = await issue(c, 'quittance', charge)
    await c.query('select public.attach_receipt_file($1, $2, $3, 100)', [r.id, `${E.A}/${r.id}.pdf`, SHA])
    return r.id
  }

  it('voit les documents déposés de son bail, pas les annulés ni ceux sans fichier, pas ceux d\'une période où il est absent', async () => {
    await world(async (c) => {
      const jan = await issueStored(c, C.jan, 85000, '2026-01-03')
      const feb = await issueStored(c, C.feb, 85000, '2026-02-03')
      await asUser(c, U.managerA)
      await pay(c, 85000, '2026-03-03', C.mar)
      await issue(c, 'quittance', C.mar) // sans fichier
      await c.query('select public.cancel_receipt($1, $2)', [feb, 'erreur'])

      await attach(c, T.alice)
      await asUser(c, ACCOUNT, 'aal1')
      const rows = (await c.query('select id, number, entity_name, property_label from public.my_receipts()')).rows
      expect(rows.map((r) => r.id)).toEqual([jan])
      expect(rows[0]).toMatchObject({ entity_name: 'Structure A', property_label: 'Appartement 3' })
      expect((await c.query('select * from public.receipts')).rows).toEqual([])
    })
  })

  it('un colocataire présent seulement plus tard ne voit pas les périodes antérieures', async () => {
    await world(async (c) => {
      await issueStored(c, C.jan, 85000, '2026-01-03')
      const mar = await issueStored(c, C.mar, 85000, '2026-03-03')
      await attach(c, T.carl)
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select id from public.my_receipts()')).rows.map((r) => r.id)).toEqual([mar])
    })
  })

  it('rien avant validation ni après révocation', async () => {
    await world(async (c) => {
      await issueStored(c, C.jan, 85000, '2026-01-03')
      const request = await attach(c, T.alice)
      await asUser(c, U.adminA)
      await c.query('select public.revoke_tenant_access($1)', [request])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select * from public.my_receipts()')).rows).toEqual([])
    })
  })

  it('après retrait du consentement, les nouveaux documents ne sont plus mis à disposition, les anciens le restent', async () => {
    await world(async (c) => {
      const jan = await issueStored(c, C.jan, 85000, '2026-01-03')
      const request = await attach(c, T.alice)
      await asUser(c, ACCOUNT, 'aal1')
      await c.query('select public.withdraw_tenant_consent($1)', [request])
      // Dans la transaction du test, tout est émis « maintenant » : on déplace le retrait pour simuler l'avant et l'après.
      await asOwner(c)
      await c.query("update public.tenant_access set consent_withdrawn_at = now() + interval '1 hour' where id = $1", [request])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select id from public.my_receipts()')).rows.map((r) => r.id)).toEqual([jan])
      await asOwner(c)
      await c.query("update public.tenant_access set consent_withdrawn_at = now() - interval '1 hour' where id = $1", [request])
      await asUser(c, ACCOUNT, 'aal1')
      expect((await c.query('select id from public.my_receipts()')).rows).toEqual([])
    })
  })
})
