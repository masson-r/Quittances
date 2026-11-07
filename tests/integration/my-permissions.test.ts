import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asAnon, asUser, buildWorld } from './personas'

const permissions = async (c: pg.Client, entity = E.A) =>
  ((await c.query('select public.my_permissions($1) as p', [entity])).rows[0].p as string[]).sort()

describe('my_permissions', () => {
  it('liste les permissions du rôle de l\'utilisateur dans la structure', async () => {
    await inRollback(async (c) => {
      await buildWorld(c)
      await asUser(c, U.adminA)
      const admin = await permissions(c)
      expect(admin).toContain('member:write')
      expect(admin).toContain('audit:read')

      await asUser(c, U.managerA)
      const manager = await permissions(c)
      expect(manager).toContain('payment:write')
      expect(manager).not.toContain('member:read')

      await asUser(c, U.readerA)
      const reader = await permissions(c)
      expect(reader).toContain('payment:read')
      expect(reader.some((p) => p.endsWith(':write'))).toBe(false)
    })
  })

  it('est vide sans second facteur, hors de la structure, pour un membre suspendu ou un profil désactivé', async () => {
    await inRollback(async (c) => {
      await buildWorld(c)
      await asUser(c, U.adminA, 'aal1')
      expect(await permissions(c)).toEqual([])
      await asUser(c, U.adminB)
      expect(await permissions(c, E.A)).toEqual([])
      await asUser(c, U.suspendedA)
      expect(await permissions(c)).toEqual([])
      await asUser(c, U.disabled)
      expect(await permissions(c)).toEqual([])
    })
  })

  it('n\'est pas exécutable par un visiteur', async () => {
    await inRollback(async (c) => {
      await buildWorld(c)
      await asAnon(c)
      await expect(permissions(c)).rejects.toThrow(/permission denied/)
    })
  })
})
