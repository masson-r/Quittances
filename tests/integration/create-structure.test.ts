import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { U, asAnon, asOwner, asUser, buildWorld } from './personas'

interface Created {
  entity_id: string
  invitation_id: string
  token: string
  expires_at: string
}

const asServiceRole = async (c: pg.Client) => {
  await c.query('reset role')
  await c.query("select set_config('request.jwt.claims', '', true)")
  await c.query('set local role service_role')
}

const create = async (c: pg.Client, name = 'SCI Les Tilleuls', kind = 'sci', email = 'Marie.Dupont@Example.Test') =>
  (await c.query('select * from public.create_structure($1, $2, $3)', [name, kind, email])).rows[0] as Created

describe('create_structure (outil de l\'opérateur)', () => {
  it('crée la structure et invite son premier administrateur', async () => {
    await inRollback(async (c) => {
      await asServiceRole(c)
      const created = await create(c)
      await asOwner(c)

      const entity = (await c.query('select name, kind, archived_at from public.ownership_entities where id = $1', [created.entity_id])).rows[0]
      expect(entity).toEqual({ name: 'SCI Les Tilleuls', kind: 'sci', archived_at: null })

      const invitation = (
        await c.query(
          "select kind, email, role, created_by, token_hash, used_at, revoked_at, expires_at - created_at as validity, encode(sha256(convert_to($2, 'UTF8')), 'hex') as expected_hash from public.invitations where id = $1",
          [created.invitation_id, created.token],
        )
      ).rows[0]
      expect(invitation.kind).toBe('member')
      expect(invitation.email).toBe('marie.dupont@example.test')
      expect(invitation.role).toBe('administrator')
      expect(invitation.created_by).toBeNull()
      expect(invitation.validity).toEqual({ days: 14 })
      expect(invitation.used_at).toBeNull()
      expect(invitation.revoked_at).toBeNull()
      expect(invitation.token_hash).toBe(invitation.expected_hash)
      expect(invitation.token_hash).not.toBe(created.token)
    })
  })

  it('renvoie un jeton long et aléatoire', async () => {
    await inRollback(async (c) => {
      await asServiceRole(c)
      const a = await create(c, 'A')
      const b = await create(c, 'B')
      expect(a.token).toMatch(/^[0-9a-f]{64}$/)
      expect(a.token).not.toBe(b.token)
    })
  })

  it('ne crée aucun membre : l\'administrateur le devient en utilisant son invitation', async () => {
    await inRollback(async (c) => {
      await asServiceRole(c)
      const created = await create(c)
      await asOwner(c)
      const { rows } = await c.query('select 1 from public.entity_memberships where entity_id = $1', [created.entity_id])
      expect(rows).toEqual([])
    })
  })

  it('trace la création, au nom de l\'opérateur, dans le journal de la structure', async () => {
    await inRollback(async (c) => {
      await asServiceRole(c)
      const created = await create(c)
      await asOwner(c)
      const { rows } = await c.query(
        'select action, actor_kind, actor_id, subject_table, details from public.audit_logs where entity_id = $1 order by action',
        [created.entity_id],
      )
      expect(rows.map((r) => r.action)).toEqual(['invitation.created', 'structure.created'])
      for (const r of rows) {
        expect(r.actor_kind).toBe('operator')
        expect(r.actor_id).toBeNull()
      }
      expect(rows.find((r) => r.action === 'structure.created').details).toEqual({ kind: 'sci' })
      expect(JSON.stringify(rows)).not.toMatch(/example\.test|Tilleuls/)
    })
  })

  it('refuse un nom vide, un genre inconnu et une adresse invalide, sans rien créer', async () => {
    await inRollback(async (c) => {
      await asServiceRole(c)
      for (const args of [['  ', 'sci', 'a@example.test'], ['X', 'banque', 'a@example.test'], ['X', 'sci', 'pas-un-email'], ['X', 'sci', '']]) {
        await c.query('savepoint essai')
        await expect(create(c, ...(args as [string, string, string])), args.join('|')).rejects.toThrow()
        await c.query('rollback to savepoint essai')
      }
      await asOwner(c)
      expect((await c.query("select 1 from public.ownership_entities where name in ('X', '  ')")).rows).toEqual([])
    })
  })

  it("n'est exécutable ni par un visiteur ni par un utilisateur connecté", async () => {
    await inRollback(async (c) => {
      await buildWorld(c)
      await asAnon(c)
      await expect(create(c)).rejects.toThrow(/permission denied/)
    })
    await inRollback(async (c) => {
      await buildWorld(c)
      await asUser(c, U.adminA)
      await expect(create(c)).rejects.toThrow(/permission denied/)
    })
  })
})

describe('invitations créées par un utilisateur', () => {
  it('un utilisateur ne peut pas créer d\'invitation sans auteur', async () => {
    await inRollback(async (c) => {
      await buildWorld(c)
      await asUser(c, U.adminA)
      await c.query('savepoint essai')
      let blocked = false
      try {
        const res = await c.query(
          "insert into public.invitations (entity_id, kind, email, role, token_hash, created_by) values ('00000000-0000-4000-8000-00000000aaaa', 'member', 'x@example.test', 'reader', 'h-null', null)",
        )
        blocked = res.rowCount === 0
      } catch {
        blocked = true
      }
      expect(blocked).toBe(true)
    })
  })
})

describe('auteur du journal sans session utilisateur', () => {
  it('prend app.actor_kind quand il est fixé ; la session utilisateur reste prioritaire', async () => {
    await inRollback(async (c) => {
      await c.query("select set_config('app.actor_kind', 'operator', true)")
      await c.query("select app.write_audit(null, 'test.operator', 'x', null, '{}'::jsonb)")
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.adminA, role: 'authenticated' })])
      await c.query("select app.write_audit(null, 'test.user', 'x', null, '{}'::jsonb)")
      await c.query("select set_config('request.jwt.claims', '', true), set_config('app.actor_kind', 'robot', true)")
      await c.query('savepoint essai')
      await expect(c.query("select app.write_audit(null, 'test.robot', 'x', null, '{}'::jsonb)")).rejects.toThrow()
      await c.query('rollback to savepoint essai')
      const { rows } = await c.query("select action, actor_kind from public.audit_logs where action like 'test.%' order by action")
      expect(rows).toEqual([
        { action: 'test.operator', actor_kind: 'operator' },
        { action: 'test.user', actor_kind: 'user' },
      ])
    })
  })
})
