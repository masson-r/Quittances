import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asAnon, asOwner, asUser, buildWorld, createAuthUser } from './personas'

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await fn(c)
  })

const can = async (c: pg.Client, user: string, entity: string, permission: string) => {
  await asUser(c, user)
  const { rows } = await c.query('select app.has_permission($1::uuid, $2) as ok', [entity, permission])
  await asOwner(c)
  return rows[0].ok as boolean
}

const ids = (rows: { id?: string; entity_id?: string }[], key: 'id' | 'entity_id' = 'id') => rows.map((r) => r[key]).sort()

/** Vrai si l'instruction échoue ou ne touche aucune ligne. */
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

describe('has_permission', () => {
  it('administrateur : tout, y compris membres et journal d\'audit', async () => {
    await world(async (c) => {
      for (const p of ['member:write', 'audit:read', 'structure:write', 'payment:cancel', 'expense_category:write', 'sensitive:read'])
        expect(await can(c, U.adminA, E.A, p), p).toBe(true)
    })
  })

  it('gestionnaire : opérationnel complet, ni membres ni journal, structure en lecture', async () => {
    await world(async (c) => {
      for (const p of ['payment:write', 'lease:cancel', 'receipt:write', 'sensitive:write', 'signature:write', 'structure:read', 'expense_category:read'])
        expect(await can(c, U.managerA, E.A, p), p).toBe(true)
      for (const p of ['member:read', 'member:write', 'audit:read', 'structure:write', 'expense_category:write'])
        expect(await can(c, U.managerA, E.A, p), p).toBe(false)
    })
  })

  it('lecteur : lecture seule, sans membres, journal ni champs sensibles', async () => {
    await world(async (c) => {
      for (const p of ['payment:read', 'lease:read', 'structure:read']) expect(await can(c, U.readerA, E.A, p), p).toBe(true)
      for (const p of ['payment:write', 'lease:write', 'member:read', 'audit:read', 'sensitive:read', 'signature:write'])
        expect(await can(c, U.readerA, E.A, p), p).toBe(false)
    })
  })

  it('aucun droit hors de sa structure, suspendu, désactivé ou sans session', async () => {
    await world(async (c) => {
      expect(await can(c, U.adminA, E.B, 'structure:read')).toBe(false)
      expect(await can(c, U.adminB, E.A, 'structure:read')).toBe(false)
      expect(await can(c, U.outsider, E.A, 'structure:read')).toBe(false)
      expect(await can(c, U.suspendedA, E.A, 'structure:read')).toBe(false)
      expect(await can(c, U.disabled, E.A, 'structure:read')).toBe(false)
      expect(await can(c, U.adminA, E.A, 'inconnue:read')).toBe(false)
      await asAnon(c)
      await expect(c.query('select app.has_permission($1::uuid, $2)', [E.A, 'structure:read'])).rejects.toThrow(/permission denied/)
    })
  })

  it('la désactivation du profil coupe les droits immédiatement', async () => {
    await world(async (c) => {
      expect(await can(c, U.managerA, E.A, 'payment:write')).toBe(true)
      await c.query("update public.profiles set status = 'disabled' where id = $1", [U.managerA])
      expect(await can(c, U.managerA, E.A, 'payment:write')).toBe(false)
    })
  })
})

describe('cloisonnement par structure', () => {
  it('une structure n\'est visible que de ses membres actifs', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect(ids((await c.query('select id from public.ownership_entities')).rows)).toEqual([E.A])
      await asUser(c, U.adminB)
      expect(ids((await c.query('select id from public.ownership_entities')).rows)).toEqual([E.B])
      for (const u of [U.outsider, U.suspendedA, U.disabled]) {
        await asUser(c, u)
        expect((await c.query('select id from public.ownership_entities')).rows, u).toEqual([])
      }
    })
  })

  it('les membres : l\'administrateur voit toute sa structure, les autres leur seule ligne', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const all = await c.query('select profile_id, entity_id from public.entity_memberships')
      expect(new Set(all.rows.map((r) => r.entity_id))).toEqual(new Set([E.A]))
      expect(all.rows).toHaveLength(5)
      for (const u of [U.managerA, U.readerA]) {
        await asUser(c, u)
        const own = await c.query('select profile_id from public.entity_memberships')
        expect(own.rows.map((r) => r.profile_id), u).toEqual([u])
      }
      await asUser(c, U.outsider)
      expect((await c.query('select 1 from public.entity_memberships')).rows).toEqual([])
    })
  })

  it('les profils : soi-même, et les membres de sa structure pour l\'administrateur', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      expect(ids((await c.query('select id from public.profiles')).rows)).toEqual([U.managerA])
      await asUser(c, U.adminA)
      const seen = ids((await c.query('select id from public.profiles')).rows)
      expect(seen).toEqual([U.adminA, U.managerA, U.readerA, U.suspendedA, U.disabled].sort())
      expect(seen).not.toContain(U.adminB)
    })
  })
})

describe('écriture selon le rôle', () => {
  it('structure : l\'administrateur modifie la sienne, personne d\'autre', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect((await c.query("update public.ownership_entities set name = 'Renommée' where id = $1", [E.A])).rowCount).toBe(1)
      expect(await blocked(c, "update public.ownership_entities set name = 'Piratée' where id = $1", [E.B])).toBe(true)
      for (const u of [U.managerA, U.readerA]) {
        await asUser(c, u)
        expect(await blocked(c, "update public.ownership_entities set name = 'X' where id = $1", [E.A]), u).toBe(true)
      }
    })
  })

  it('aucune création ni suppression de structure par un utilisateur', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect(await blocked(c, "insert into public.ownership_entities (name, kind) values ('Nouvelle', 'sci')")).toBe(true)
      expect(await blocked(c, 'delete from public.ownership_entities where id = $1', [E.A])).toBe(true)
    })
  })

  it('membres : seul l\'administrateur de la structure change un rôle ou suspend', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect((await c.query("update public.entity_memberships set role = 'manager' where entity_id = $1 and profile_id = $2", [E.A, U.readerA])).rowCount).toBe(1)
      for (const u of [U.managerA, U.readerA]) {
        await asUser(c, u)
        expect(await blocked(c, "update public.entity_memberships set role = 'administrator' where profile_id = $1", [u]), u).toBe(true)
      }
      await asUser(c, U.adminB)
      expect(await blocked(c, "update public.entity_memberships set status = 'suspended' where entity_id = $1", [E.A])).toBe(true)
    })
  })

  it('aucune création ni suppression directe de membre', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect(await blocked(c, "insert into public.entity_memberships (entity_id, profile_id, role) values ($1, $2, 'reader')", [E.A, U.outsider])).toBe(true)
      expect(await blocked(c, 'delete from public.entity_memberships where entity_id = $1', [E.A])).toBe(true)
    })
  })

  it('profil : nom modifiable par soi-même, ni e-mail ni statut', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect((await c.query("update public.profiles set first_name = 'Zoé' where id = $1", [U.readerA])).rowCount).toBe(1)
      expect(await blocked(c, "update public.profiles set email = 'autre@example.test' where id = $1", [U.readerA])).toBe(true)
      expect(await blocked(c, "update public.profiles set status = 'active' where id = $1", [U.readerA])).toBe(true)
      expect(await blocked(c, "update public.profiles set first_name = 'X' where id = $1", [U.managerA])).toBe(true)
    })
  })
})

describe('dernier administrateur protégé', () => {
  it('refuse de retirer le rôle, de suspendre ou de supprimer le seul administrateur actif', async () => {
    await world(async (c) => {
      // Structure B : adminB est le seul administrateur.
      await expect(c.query("update public.entity_memberships set role = 'reader' where profile_id = $1", [U.adminB])).rejects.toThrow(/au moins un administrateur/)
    })
    await world(async (c) => {
      await expect(c.query("update public.entity_memberships set status = 'suspended' where profile_id = $1", [U.adminB])).rejects.toThrow(/au moins un administrateur/)
    })
    await world(async (c) => {
      await expect(c.query('delete from public.entity_memberships where profile_id = $1', [U.adminB])).rejects.toThrow(/au moins un administrateur/)
    })
  })

  it('un administrateur au profil désactivé ne compte pas', async () => {
    await world(async (c) => {
      // Structure A : adminA actif + un administrateur désactivé. adminA est donc le dernier.
      await expect(c.query("update public.entity_memberships set role = 'reader' where profile_id = $1", [U.adminA])).rejects.toThrow(/au moins un administrateur/)
    })
  })

  it('permet de retirer un administrateur quand un autre reste actif', async () => {
    await world(async (c) => {
      await c.query("update public.entity_memberships set role = 'administrator' where profile_id = $1", [U.managerA])
      await c.query("update public.entity_memberships set role = 'reader' where profile_id = $1", [U.adminA])
      const { rows } = await c.query("select role from public.entity_memberships where profile_id = $1", [U.adminA])
      expect(rows[0].role).toBe('reader')
    })
  })

  it('refuse de désactiver le profil du dernier administrateur', async () => {
    await world(async (c) => {
      await expect(c.query("update public.profiles set status = 'disabled' where id = $1", [U.adminB])).rejects.toThrow(/au moins un administrateur/)
    })
  })

  it('l\'administrateur ne peut pas se rétrograder seul via l\'interface', async () => {
    await world(async (c) => {
      await asUser(c, U.adminB)
      expect(await blocked(c, "update public.entity_memberships set role = 'reader' where profile_id = $1", [U.adminB])).toBe(true)
    })
  })
})

describe('copie de l\'e-mail et du nom depuis l\'authentification', () => {
  it('crée le profil à l\'inscription, e-mail en minuscules', async () => {
    await inRollback(async (c) => {
      await createAuthUser(c, U.outsider, 'Alice.Martin@Example.Test', { first_name: 'Alice', last_name: 'Martin' })
      const { rows } = await c.query('select email, first_name, last_name, status from public.profiles where id = $1', [U.outsider])
      expect(rows[0]).toEqual({ email: 'alice.martin@example.test', first_name: 'Alice', last_name: 'Martin', status: 'active' })
    })
  })

  it('synchronise l\'e-mail quand il change côté authentification', async () => {
    await inRollback(async (c) => {
      await createAuthUser(c, U.outsider, 'avant@example.test')
      await c.query("update auth.users set email = 'Apres@Example.Test' where id = $1", [U.outsider])
      const { rows } = await c.query('select email from public.profiles where id = $1', [U.outsider])
      expect(rows[0].email).toBe('apres@example.test')
    })
  })

  it('un profil sans nom reçoit des chaînes vides', async () => {
    await inRollback(async (c) => {
      await createAuthUser(c, U.outsider, 'sans.nom@example.test')
      const { rows } = await c.query('select first_name, last_name from public.profiles where id = $1', [U.outsider])
      expect(rows[0]).toEqual({ first_name: '', last_name: '' })
    })
  })
})

describe('invitations', () => {
  const memberInvite = `insert into public.invitations (entity_id, kind, email, role, token_hash, created_by)
                        values ($1, 'member', 'nouveau@example.test', 'reader', $2, $3)`
  const TENANT = '00000000-0000-4000-8000-0000000000f9'
  const tenantInvite = `insert into public.invitations (entity_id, kind, tenant_id, token_hash, created_by)
                        values ($1, 'tenant', '${TENANT}', $2, $3)`

  it('l\'administrateur invite un membre ; le gestionnaire et le lecteur non', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect((await c.query(memberInvite, [E.A, 'h-admin', U.adminA])).rowCount).toBe(1)
      for (const [u, h] of [[U.managerA, 'h-man'], [U.readerA, 'h-read']] as const) {
        await asUser(c, u)
        expect(await blocked(c, memberInvite, [E.A, h, u]), u).toBe(true)
      }
    })
  })

  it('le gestionnaire invite un locataire ; le lecteur non', async () => {
    await world(async (c) => {
      await c.query("insert into public.tenants (id, entity_id, last_name) values ($1, $2, 'Locataire')", [TENANT, E.A])
      await asUser(c, U.managerA)
      expect((await c.query(tenantInvite, [E.A, 'h-t1', U.managerA])).rowCount).toBe(1)
      await asUser(c, U.readerA)
      expect(await blocked(c, tenantInvite, [E.A, 'h-t2', U.readerA])).toBe(true)
    })
  })

  it('refuse une invitation créée au nom d\'un autre ou dans une autre structure', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      expect(await blocked(c, memberInvite, [E.A, 'h-x', U.adminB])).toBe(true)
      expect(await blocked(c, memberInvite, [E.B, 'h-y', U.adminA])).toBe(true)
    })
  })

  it('cloisonnement : les invitations ne sont visibles que de la structure', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query(memberInvite, [E.A, 'h-a', U.adminA])
      await asUser(c, U.adminB)
      expect((await c.query('select id from public.invitations')).rows).toEqual([])
      await asUser(c, U.readerA)
      expect((await c.query('select id from public.invitations')).rows).toEqual([])
    })
  })

  it('le jeton haché n\'est jamais lisible par un utilisateur', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query(memberInvite, [E.A, 'h-secret', U.adminA])
      expect((await c.query('select id, expires_at, used_at, revoked_at from public.invitations')).rows).toHaveLength(1)
      await expect(c.query('select token_hash from public.invitations')).rejects.toThrow(/permission denied/)
    })
  })

  it('valable 14 jours, révocable, rien d\'autre ne se modifie', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query(memberInvite, [E.A, 'h-rev', U.adminA])
      const { rows } = await c.query("select (expires_at - created_at) as validity from public.invitations")
      expect(rows[0].validity).toEqual({ days: 14 })
      expect((await c.query("update public.invitations set revoked_at = now(), revoked_by = $1", [U.adminA])).rowCount).toBe(1)
      expect(await blocked(c, "update public.invitations set role = 'administrator'")).toBe(true)
      expect(await blocked(c, "update public.invitations set used_at = now()")).toBe(true)
      expect(await blocked(c, 'delete from public.invitations')).toBe(true)
    })
  })

  it('cohérence du type : membre avec e-mail et rôle, locataire avec dossier', async () => {
    await inRollback(async (c) => {
      await buildWorld(c)
      await c.query('savepoint a')
      await expect(
        c.query("insert into public.invitations (entity_id, kind, token_hash, created_by) values ($1, 'member', 'h1', $2)", [E.A, U.adminA]),
      ).rejects.toThrow()
      await c.query('rollback to savepoint a')
      await expect(
        c.query("insert into public.invitations (entity_id, kind, email, role, tenant_id, token_hash, created_by) values ($1, 'tenant', 'x@example.test', 'reader', gen_random_uuid(), 'h2', $2)", [E.A, U.adminA]),
      ).rejects.toThrow()
    })
  })

  it('jeton unique', async () => {
    await world(async (c) => {
      await c.query(memberInvite, [E.A, 'h-dup', U.adminA])
      await expect(c.query(memberInvite, [E.A, 'h-dup', U.adminA])).rejects.toThrow(/unique/)
    })
  })
})

describe('journal d\'audit des membres et invitations', () => {
  it('trace création, changement de rôle et suspension, lisibles par l\'administrateur seul', async () => {
    await world(async (c) => {
      await c.query("update public.entity_memberships set role = 'manager' where profile_id = $1", [U.readerA])
      await c.query("update public.entity_memberships set status = 'suspended' where profile_id = $1", [U.managerA])
      await asUser(c, U.adminA)
      const { rows } = await c.query("select action, entity_id, details from public.audit_logs where subject_table = 'entity_memberships' order by occurred_at, id")
      const actions = rows.map((r) => r.action)
      expect(actions).toContain('member.created')
      expect(actions).toContain('member.role_changed')
      expect(actions).toContain('member.suspended')
      expect(rows.every((r) => r.entity_id === E.A)).toBe(true)
      const changed = rows.find((r) => r.action === 'member.role_changed')
      expect(changed.details).toEqual({ from: 'reader', to: 'manager' })
      for (const u of [U.managerA, U.readerA, U.adminB]) {
        await asUser(c, u)
        expect((await c.query("select 1 from public.audit_logs where entity_id = $1", [E.A])).rows, u).toEqual([])
      }
    })
  })

  it('trace la création et la révocation d\'une invitation, sans e-mail', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      await c.query("insert into public.invitations (entity_id, kind, email, role, token_hash, created_by) values ($1, 'member', 'nouveau@example.test', 'reader', 'h-audit', $2)", [E.A, U.adminA])
      await c.query('update public.invitations set revoked_at = now(), revoked_by = $1', [U.adminA])
      const { rows } = await c.query("select action, details from public.audit_logs where subject_table = 'invitations' order by occurred_at, id")
      expect(rows.map((r) => r.action).sort()).toEqual(['invitation.created', 'invitation.revoked'])
      expect(JSON.stringify(rows)).not.toContain('example.test')
    })
  })
})

describe('role_permissions', () => {
  it('lisible par un utilisateur connecté, jamais modifiable, fermée au visiteur', async () => {
    await world(async (c) => {
      await asUser(c, U.readerA)
      expect((await c.query('select 1 from public.role_permissions')).rows.length).toBeGreaterThan(20)
      expect(await blocked(c, "insert into public.role_permissions (role, permission) values ('reader', 'payment:write')")).toBe(true)
      expect(await blocked(c, "update public.role_permissions set permission = 'x'")).toBe(true)
      expect(await blocked(c, 'delete from public.role_permissions')).toBe(true)
      await asAnon(c)
      await expect(c.query('select 1 from public.role_permissions')).rejects.toThrow(/permission denied/)
    })
  })
})
