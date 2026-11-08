import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asOwner, asUser, buildWorld } from './personas'

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await fn(c)
  })

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

const save = async (c: pg.Client, image: Buffer = PNG, entity: string = E.A, type = 'image/png', w = 600, h = 300) =>
  (await c.query('select public.save_my_signature($1, $2, $3, $4, $5) as id', [entity, type, w, h, image])).rows[0].id as string

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

describe('signature du bailleur', () => {
  it.each([
    ['administrateur', U.adminA],
    ['gestionnaire', U.managerA],
  ] as const)('%s enregistre sa signature : empreinte calculée par la base', async (_label, user) => {
    await world(async (c) => {
      await asUser(c, user)
      const id = await save(c)
      const row = (
        await c.query("select profile_id, active, byte_size, content_type, sha256 = encode(sha256(image), 'hex') as hashed from public.member_signatures where id = $1", [id])
      ).rows[0]
      expect(row).toEqual({ profile_id: user, active: true, byte_size: PNG.length, content_type: 'image/png', hashed: true })
    })
  })

  it('une nouvelle signature retire la précédente, conservée mais inactive', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const first = await save(c)
      const second = await save(c, Buffer.concat([PNG, Buffer.from([1])]))
      const { rows } = await c.query('select id, active from public.member_signatures order by created_at, id')
      expect(rows.find((r) => r.id === first).active).toBe(false)
      expect(rows.find((r) => r.id === second).active).toBe(true)
      await c.query('select public.remove_my_signature($1)', [E.A])
      expect((await c.query('select count(*)::int as n from public.member_signatures where active')).rows[0].n).toBe(0)
      expect((await c.query('select count(*)::int as n from public.member_signatures')).rows[0].n).toBe(2)
      await refuses(c, /Aucune signature/, 'select public.remove_my_signature($1)', [E.A])
    })
  })

  it('une signature retirée ne se réactive pas', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const id = await save(c)
      await c.query('select public.remove_my_signature($1)', [E.A])
      await refuses(c, /réactivée/, 'update public.member_signatures set active = true, retired_at = null where id = $1', [id])
    })
  })

  it('chacun ne voit que la sienne : ni l\'autre membre, ni une autre structure', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await save(c)
      await asUser(c, U.managerA)
      expect((await c.query('select id from public.member_signatures')).rows).toEqual([])
      await asUser(c, U.adminB)
      expect((await c.query('select id from public.member_signatures')).rows).toEqual([])
      await refuses(c, /Droit insuffisant/, 'select public.save_my_signature($1, $2, 1, 1, $3)', [E.A, 'image/png', PNG])
      await refuses(c, /Aucune signature/, 'select public.remove_my_signature($1)', [E.A])
    })
  })

  it('refuse le lecteur, le membre suspendu et l\'administrateur sans second facteur', async () => {
    for (const [user, aal] of [[U.readerA, 'aal2'], [U.suspendedA, 'aal2'], [U.adminA, 'aal1']] as const) {
      await world(async (c) => {
        await asUser(c, user, aal)
        await refuses(c, /Droit insuffisant/, 'select public.save_my_signature($1, $2, 1, 1, $3)', [E.A, 'image/png', PNG])
      })
    }
  })

  it('refuse un type inconnu, une image trop lourde ou trop grande, vide', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await refuses(c, undefined, 'select public.save_my_signature($1, $2, 10, 10, $3)', [E.A, 'image/gif', PNG])
      await refuses(c, /500 Ko/, 'select public.save_my_signature($1, $2, 10, 10, $3)', [E.A, 'image/png', Buffer.alloc(512001, 1)])
      await refuses(c, /500 Ko/, 'select public.save_my_signature($1, $2, 10, 10, $3)', [E.A, 'image/png', Buffer.alloc(0)])
      await refuses(c, undefined, 'select public.save_my_signature($1, $2, 1201, 10, $3)', [E.A, 'image/png', PNG])
      await refuses(c, undefined, 'select public.save_my_signature($1, $2, 10, 601, $3)', [E.A, 'image/png', PNG])
    })
  })

  it('pas d\'écriture directe usurpant un autre membre ; trace sans contenu', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const membership = (await c.query('select id from public.entity_memberships where profile_id = $1', [U.managerA])).rows[0].id
      await refuses(
        c,
        undefined,
        "insert into public.member_signatures (entity_id, membership_id, profile_id, content_type, width, height, byte_size, sha256, image) values ($1, $2, $3, 'image/png', 1, 1, 1, 'x', decode('01', 'hex'))",
        [E.A, membership, U.managerA],
      )
      await save(c)
      await c.query('select public.remove_my_signature($1)', [E.A])
      await asOwner(c)
      const { rows } = await c.query("select action, details from public.audit_logs where subject_table = 'member_signatures' order by occurred_at, id")
      expect(rows.map((r) => r.action).sort()).toEqual(['signature.retired', 'signature.uploaded'])
      expect(rows.find((r) => r.action === 'signature.uploaded').details).toMatchObject({ byte_size: PNG.length })
    })
  })
})
