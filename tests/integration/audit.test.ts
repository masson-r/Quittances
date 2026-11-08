import { describe, expect, it } from 'vitest'
import { inRollback } from './db'

const ENTITY = '11111111-1111-1111-1111-111111111111'
const USER = '22222222-2222-2222-2222-222222222222'
const WRITE = "select app.write_audit(null, 'test.created', 'x', null, '{}'::jsonb)"

describe('audit_logs : ajout seul', () => {
  it('UPDATE est refusé, y compris au propriétaire de la table', async () => {
    await inRollback(async (c) => {
      await c.query(WRITE)
      await expect(c.query("update public.audit_logs set action = 'autre'")).rejects.toThrow(/ajout seul/)
    })
  })

  it('DELETE est refusé, y compris au propriétaire de la table', async () => {
    await inRollback(async (c) => {
      await c.query(WRITE)
      await expect(c.query('delete from public.audit_logs')).rejects.toThrow(/ajout seul/)
    })
  })

  it('TRUNCATE est refusé', async () => {
    await inRollback(async (c) => {
      await expect(c.query('truncate public.audit_logs')).rejects.toThrow(/ajout seul/)
    })
  })

  it('le drapeau de purge ne suffit pas à un autre rôle que le propriétaire', async () => {
    await inRollback(async (c) => {
      await c.query(WRITE)
      await c.query("select set_config('app.audit_purge', 'on', true)")
      await c.query('grant delete on public.audit_logs to service_role')
      await c.query('set local role service_role')
      await expect(c.query('delete from public.audit_logs')).rejects.toThrow(/ajout seul/)
    })
  })
})

describe('app.write_audit', () => {
  it("enregistre l'action, la structure et les détails", async () => {
    await inRollback(async (c) => {
      await c.query(
        'select app.write_audit($1::uuid, $2, $3, $4::uuid, $5::jsonb)',
        [ENTITY, 'payment.cancelled', 'payments', USER, JSON.stringify({ amount_cents: 85000 })],
      )
      const { rows } = await c.query("select * from public.audit_logs where action = 'payment.cancelled'")
      expect(rows).toHaveLength(1)
      expect(rows[0].entity_id).toBe(ENTITY)
      expect(rows[0].subject_table).toBe('payments')
      expect(rows[0].details).toEqual({ amount_cents: 85000 })
      expect(rows[0].actor_kind).toBe('system')
      expect(rows[0].actor_id).toBeNull()
    })
  })

  it("prend l'auteur dans la session de l'utilisateur, sans se fier aux paramètres", async () => {
    await inRollback(async (c) => {
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: USER, role: 'authenticated' })])
      await c.query("select app.write_audit(null, 'test.session_actor', 'leases', null, '{}'::jsonb, 'operator')")
      const { rows } = await c.query("select actor_kind, actor_id from public.audit_logs where action = 'test.session_actor'")
      expect(rows[0]).toEqual({ actor_kind: 'user', actor_id: USER })
    })
  })

  it('accepte « operator » sans session utilisateur et refuse un genre inconnu', async () => {
    await inRollback(async (c) => {
      await c.query("select app.write_audit(null, 'structure.created', 'ownership_entities', null, '{}'::jsonb, 'operator')")
      const { rows } = await c.query("select actor_kind from public.audit_logs where action = 'structure.created'")
      expect(rows[0].actor_kind).toBe('operator')
      await expect(c.query("select app.write_audit(null, 'x', 'x', null, '{}'::jsonb, 'robot')")).rejects.toThrow()
    })
  })

  it('refuse une action vide', async () => {
    await inRollback(async (c) => {
      await expect(c.query("select app.write_audit(null, '', 'x', null, '{}'::jsonb)")).rejects.toThrow()
    })
  })
})

describe('app.purge_audit_logs', () => {
  it('supprime les entrées de plus de 3 ans et garde les autres', async () => {
    await inRollback(async (c) => {
      await c.query(
        "insert into public.audit_logs (action, occurred_at) values ('ancienne', now() - interval '3 years 1 day'), ('recente', now() - interval '2 years 11 months')",
      )
      const { rows } = await c.query('select app.purge_audit_logs() as n')
      expect(Number(rows[0].n)).toBe(1)
      const left = await c.query("select action from public.audit_logs where action in ('ancienne', 'recente') order by 1")
      expect(left.rows.map((r) => r.action)).toEqual(['recente'])
    })
  })

  it("n'est pas exécutable par un utilisateur", async () => {
    await inRollback(async (c) => {
      await c.query('set local role authenticated')
      await expect(c.query('select app.purge_audit_logs()')).rejects.toThrow(/permission denied/)
    })
  })
})
