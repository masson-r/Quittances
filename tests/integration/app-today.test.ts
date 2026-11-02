import { describe, expect, it } from 'vitest'
import { inRollback } from './db'

describe('app_today (base locale)', () => {
  it('ignore la date imposée hors environnement de test', async () => {
    await inRollback(async (c) => {
      await c.query("select set_config('app.environment', 'production', true), set_config('app.today_override', '2030-05-17', true)")
      const { rows } = await c.query("select public.app_today()::text as d, app.paris_date(now())::text as paris")
      expect(rows[0].d).toBe(rows[0].paris)
    })
  })

  it('accepte la date imposée avec app.environment = test', async () => {
    await inRollback(async (c) => {
      await c.query("select set_config('app.environment', 'test', true), set_config('app.today_override', '2030-05-17', true)")
      const { rows } = await c.query('select public.app_today()::text as d')
      expect(rows[0].d).toBe('2030-05-17')
    })
  })

  it('refuse l\'exécution au rôle anonyme', async () => {
    await inRollback(async (c) => {
      await c.query('set local role anon')
      await expect(c.query('select public.app_today()')).rejects.toThrow(/permission denied/)
    })
  })
})
