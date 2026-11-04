import { describe, expect, it } from 'vitest'
import { inRollback } from './db'
import { U, createAuthUser } from './personas'

const SESSION = '00000000-0000-4000-8000-0000000000e1'

describe('désactivation d\'un profil', () => {
  it('révoque les sessions, interdit la reconnexion et date la désactivation', async () => {
    await inRollback(async (c) => {
      await createAuthUser(c, U.outsider, 'a.desactiver@example.test')
      await c.query('insert into auth.sessions (id, user_id) values ($1, $2)', [SESSION, U.outsider])
      await c.query('insert into auth.refresh_tokens (token, user_id, session_id) values ($1, $2, $3)', ['jeton-test', U.outsider, SESSION])

      await c.query("update public.profiles set status = 'disabled' where id = $1", [U.outsider])

      expect((await c.query('select 1 from auth.sessions where user_id = $1', [U.outsider])).rows).toEqual([])
      expect((await c.query('select 1 from auth.refresh_tokens where user_id = $1', [U.outsider])).rows).toEqual([])
      const { rows } = await c.query(
        'select u.banned_until > now() + interval \'10 years\' as banned, p.disabled_at is not null as dated from auth.users u join public.profiles p on p.id = u.id where u.id = $1',
        [U.outsider],
      )
      expect(rows[0]).toEqual({ banned: true, dated: true })
    })
  })

  it('la réactivation lève l\'interdiction et efface la date', async () => {
    await inRollback(async (c) => {
      await createAuthUser(c, U.outsider, 'a.reactiver@example.test')
      await c.query("update public.profiles set status = 'disabled' where id = $1", [U.outsider])
      await c.query("update public.profiles set status = 'active' where id = $1", [U.outsider])
      const { rows } = await c.query(
        'select u.banned_until is null as free, p.disabled_at is null as undated from auth.users u join public.profiles p on p.id = u.id where u.id = $1',
        [U.outsider],
      )
      expect(rows[0]).toEqual({ free: true, undated: true })
    })
  })

  it('ne touche pas aux sessions des autres utilisateurs', async () => {
    await inRollback(async (c) => {
      await createAuthUser(c, U.outsider, 'cible@example.test')
      await createAuthUser(c, U.readerA, 'voisin@example.test')
      await c.query('insert into auth.sessions (id, user_id) values ($1, $2)', [SESSION, U.readerA])
      await c.query("update public.profiles set status = 'disabled' where id = $1", [U.outsider])
      expect((await c.query('select 1 from auth.sessions where user_id = $1', [U.readerA])).rows).toHaveLength(1)
    })
  })
})
