import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const PA = '00000000-0000-4000-8000-0000000000c1'
const PB = '00000000-0000-4000-8000-0000000000c2'
const DOC = '00000000-0000-4000-8000-0000000000d7'

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await c.query("insert into public.properties (id, entity_id, label) values ($1, $3, 'Bien A'), ($2, $4, 'Bien B')", [PA, PB, E.A, E.B])
    await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2026-03-10', true)")
    await fn(c)
  })

const category = async (c: pg.Client, entity: string, name: string) =>
  (await c.query('select id from public.expense_categories where entity_id = $1 and name = $2', [entity, name])).rows[0].id as string

const add = async (c: pg.Client, o: { property?: string; category: string; date?: string; amount?: number; entity?: string; document?: string | null }) =>
  (
    await c.query(
      'insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, document_id, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id',
      [o.entity ?? E.A, o.property ?? PA, o.category, o.date ?? '2026-03-01', 'Plomberie', o.amount ?? 12000, o.document ?? null, (await c.query('select auth.uid() as u')).rows[0].u],
    )
  ).rows[0].id as string

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

describe('catégories', () => {
  it('toute nouvelle structure reçoit les sept catégories par défaut', async () => {
    await world(async (c) => {
      const { rows } = await c.query('select name from public.expense_categories where entity_id = $1 order by name', [E.A])
      expect(rows.map((r) => r.name)).toEqual([
        'Assurance',
        'Autres dépenses',
        'Charges de copropriété',
        'Entretien et réparations',
        'Frais de gestion',
        'Taxe foncière',
        'Travaux',
      ])
    })
  })

  it('seul l\'administrateur ajoute, renomme et archive ; le gestionnaire et le lecteur les lisent', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query("insert into public.expense_categories (entity_id, name) values ($1, 'Jardinage')", [E.A])
      await c.query("update public.expense_categories set name = 'Espaces verts' where entity_id = $1 and name = 'Jardinage'", [E.A])
      await c.query("update public.expense_categories set archived_at = now() where entity_id = $1 and name = 'Espaces verts'", [E.A])
      await refuses(c, /unique|duplicate/, "insert into public.expense_categories (entity_id, name) values ($1, ' travaux ')", [E.A])
      for (const user of [U.managerA, U.readerA]) {
        await asUser(c, user)
        expect((await c.query('select count(*)::int as n from public.expense_categories where entity_id = $1', [E.A])).rows[0].n).toBeGreaterThanOrEqual(7)
        await refuses(c, undefined, "insert into public.expense_categories (entity_id, name) values ($1, 'Interdit')", [E.A])
        expect((await c.query("update public.expense_categories set name = 'Hack' where entity_id = $1", [E.A])).rowCount).toBe(0)
      }
      await asUser(c, U.adminB)
      expect((await c.query('select id from public.expense_categories where entity_id = $1', [E.A])).rows).toEqual([])
    })
  })
})

describe('dépenses', () => {
  it('saisie par l\'administrateur ou le gestionnaire, trace sans contenu libre', async () => {
    await world(async (c) => {
      for (const user of [U.adminA, U.managerA]) {
        await asUser(c, user)
        await add(c, { category: await category(c, E.A, 'Travaux') })
      }
      await asOwner(c)
      const { rows } = await c.query("select action, details from public.audit_logs where action = 'expense.created'")
      expect(rows).toHaveLength(2)
      expect(JSON.stringify(rows)).not.toContain('Plomberie')
    })
  })

  it.each([
    ['lecteur', U.readerA, 'aal2'],
    ['gestionnaire sans second facteur', U.managerA, 'aal1'],
    ['administrateur d\'une autre structure', U.adminB, 'aal2'],
    ['membre suspendu', U.suspendedA, 'aal2'],
  ] as const)('refuse la saisie : %s', async (_label, user, aal) => {
    await world(async (c) => {
      const cat = await category(c, E.A, 'Travaux')
      await asUser(c, user, aal)
      await refuses(c, undefined, "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, created_by) values ($1, $2, $3, '2026-03-01', 'x', 100, $4)", [E.A, PA, cat, user])
    })
  })

  it('montant strictement positif, pas de date future, bien et catégorie de la même structure', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const cat = await category(c, E.A, 'Travaux')
      await refuses(c, undefined, "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, created_by) values ($1, $2, $3, '2026-03-01', 'x', 0, $4)", [E.A, PA, cat, U.adminA])
      await refuses(c, /futur/, "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, created_by) values ($1, $2, $3, '2026-03-11', 'x', 100, $4)", [E.A, PA, cat, U.adminA])
      await refuses(c, undefined, "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, created_by) values ($1, $2, $3, '2026-03-01', 'x', 100, $4)", [E.A, PB, cat, U.adminA])
      await refuses(c, undefined, "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, created_by) values ($1, $2, $3, '2026-03-01', 'x', 100, $4)", [E.A, PA, '00000000-0000-4000-8000-0000000000aa', U.adminA])
    })
  })

  it('modification tracée (anciennes et nouvelles valeurs), annulation avec motif, plus de modification après', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const id = await add(c, { category: await category(c, E.A, 'Travaux') })
      await c.query('update public.expenses set amount_cents = 15000, recoverable = true where id = $1', [id])
      await refuses(c, /motif/, 'select public.cancel_expense($1, $2)', [id, ' '])
      await c.query('select public.cancel_expense($1, $2)', [id, 'Doublon'])
      await refuses(c, /déjà annulée/, 'select public.cancel_expense($1, $2)', [id, 'Encore'])
      await refuses(c, /annulée ne se modifie/, 'update public.expenses set amount_cents = 1 where id = $1', [id])
      await refuses(c, undefined, 'delete from public.expenses where id = $1', [id])
      await asOwner(c)
      const updated = (await c.query("select details from public.audit_logs where action = 'expense.updated'")).rows[0].details
      expect(updated.amount_cents).toEqual({ from: 12000, to: 15000 })
      expect((await c.query("select count(*)::int as n from public.audit_logs where action = 'expense.cancelled'")).rows[0].n).toBe(1)
    })
  })

  it('le lecteur lit les dépenses mais ne peut ni annuler ni modifier ; l\'autre structure ne voit rien', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const id = await add(c, { category: await category(c, E.A, 'Assurance') })
      await asUser(c, U.readerA)
      expect((await c.query('select id from public.expenses')).rows).toHaveLength(1)
      await refuses(c, /Droit insuffisant/, 'select public.cancel_expense($1, $2)', [id, 'x'])
      expect((await c.query("update public.expenses set amount_cents = 1 where id = $1", [id])).rowCount).toBe(0)
      await asUser(c, U.adminB)
      expect((await c.query('select id from public.expenses')).rows).toEqual([])
      await refuses(c, /Droit insuffisant/, 'select public.cancel_expense($1, $2)', [id, 'x'])
    })
  })
})

describe('justificatifs', () => {
  const doc = (c: pg.Client, id = DOC, path?: string) =>
    c.query(
      "insert into public.documents (id, entity_id, file_path, content_type, byte_size, sha256, original_name) values ($1, $2, $3, 'application/pdf', 100, $4, 'facture.pdf')",
      [id, E.A, path ?? `${E.A}/${id}`, 'a'.repeat(64)],
    )

  it('enregistre les métadonnées, rattachées à la dépense ; immuables et jamais supprimées', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await doc(c)
      const id = await add(c, { category: await category(c, E.A, 'Travaux'), document: DOC })
      expect((await c.query('select document_id from public.expenses where id = $1', [id])).rows[0].document_id).toBe(DOC)
      await refuses(c, undefined, "update public.documents set original_name = 'x' where id = $1", [DOC])
      await refuses(c, undefined, 'delete from public.documents where id = $1', [DOC])
      await asOwner(c)
      await refuses(c, /ne se modifie pas/, "update public.documents set original_name = 'x' where id = $1", [DOC])
    })
  })

  it('refuse un chemin inattendu, un lecteur, et un justificatif d\'une autre structure sur une dépense', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      await refuses(c, undefined, 'insert into public.documents (id, entity_id, file_path, content_type, byte_size, sha256, original_name) values ($1, $2, $3, \'application/pdf\', 1, $4, \'x.pdf\')', [DOC, E.A, `${E.A}/autre`, 'a'.repeat(64)])
      await asUser(c, U.readerA)
      await refuses(c, undefined, "insert into public.documents (id, entity_id, file_path, content_type, byte_size, sha256, original_name) values ('00000000-0000-4000-8000-0000000000d8', $1::uuid, $1::text || '/00000000-0000-4000-8000-0000000000d8', 'application/pdf', 1, $2, 'x.pdf')", [E.A, 'a'.repeat(64)])
      await asOwner(c)
      await c.query("insert into public.documents (id, entity_id, file_path, content_type, byte_size, sha256, original_name, created_by) values ($1::uuid, $2::uuid, $2::text || '/' || $1::text, 'application/pdf', 1, $3, 'b.pdf', $4)", [DOC, E.B, 'a'.repeat(64), U.adminB])
      await asUser(c, U.managerA)
      await refuses(
        c,
        undefined,
        "insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, document_id, created_by) values ($1, $2, $3, '2026-03-01', 'x', 100, $4, $5)",
        [E.A, PA, await category(c, E.A, 'Travaux'), DOC, U.managerA],
      )
    })
  })
})
