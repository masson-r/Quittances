import { describe, expect, it } from 'vitest'
import { inRollback } from './db'
import { RLS_MATRIX, type Action, type DbRole } from './rls-matrix'
import { tablesMissingFromMatrix, tablesWithoutRls, unexpectedSecurityDefiners } from './rls-guard'

describe('test de garde', () => {
  it('toutes les tables du schéma public ont la RLS activée', async () => {
    await inRollback(async (c) => expect(await tablesWithoutRls(c)).toEqual([]))
  })

  it('toutes les tables du schéma public figurent dans la matrice', async () => {
    await inRollback(async (c) => expect(await tablesMissingFromMatrix(c)).toEqual([]))
  })

  it('les fonctions SECURITY DEFINER sont dans la liste, dans app, avec search_path vide', async () => {
    await inRollback(async (c) => expect(await unexpectedSecurityDefiners(c)).toEqual([]))
  })

  it('le garde échoue sur une table sans RLS', async () => {
    await inRollback(async (c) => {
      await c.query('create table public.garde_sans_rls (id int)')
      expect(await tablesWithoutRls(c)).toContain('garde_sans_rls')
      expect(await tablesMissingFromMatrix(c)).toContain('garde_sans_rls')
    })
  })

  it('le garde échoue sur une fonction SECURITY DEFINER non listée', async () => {
    await inRollback(async (c) => {
      await c.query('create function public.garde_definer() returns int language sql security definer as $$ select 1 $$')
      expect(await unexpectedSecurityDefiners(c)).toContain('public.garde_definer')
    })
  })
})

const actions: Action[] = ['select', 'insert', 'update', 'delete']
const roles: DbRole[] = ['anon', 'authenticated', 'service_role']

describe.each(Object.entries(RLS_MATRIX))('matrice RLS : %s', (_table, spec) => {
  for (const role of roles) {
    for (const action of actions) {
      const expected = spec.expected[role][action]
      it(`${role} · ${action} : ${expected}`, async () => {
        await inRollback(async (c) => {
          await c.query(spec.seed)
          await c.query(`set local role ${role}`)
          let denied = false
          try {
            const res = await c.query(spec.statements[action])
            denied = action === 'insert' ? false : res.rowCount === 0
          } catch {
            denied = true
          }
          expect(denied ? 'denied' : 'allowed').toBe(expected)
        })
      })
    }
  }
})
