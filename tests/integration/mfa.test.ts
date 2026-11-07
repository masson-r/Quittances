import { describe, expect, it } from 'vitest'
import type pg from 'pg'
import { inRollback } from './db'
import { E, U, asAnon, asOwner, asUser, buildWorld } from './personas'

const world = (fn: (c: pg.Client) => Promise<void>) =>
  inRollback(async (c) => {
    await buildWorld(c)
    await fn(c)
  })

const FACTOR = '00000000-0000-4000-8000-0000000000f1'
const CODE_FORMAT = /^[0-9a-f]{4}(-[0-9a-f]{4}){3}$/

const addFactor = (c: pg.Client, user: string, id = FACTOR) =>
  c.query(
    "insert into auth.mfa_factors (id, user_id, factor_type, status, created_at, updated_at) values ($1, $2, 'totp', 'verified', now(), now())",
    [id, user],
  )

const factorCount = async (c: pg.Client, user: string) =>
  Number((await c.query('select count(*) as n from auth.mfa_factors where user_id = $1', [user])).rows[0].n)

const generate = async (c: pg.Client) => (await c.query('select public.regenerate_recovery_codes() as codes')).rows[0].codes as string[]
const redeemCode = async (c: pg.Client, code: string) => (await c.query('select public.use_recovery_code($1) as r', [code])).rows[0].r as string

const allowed = async (c: pg.Client, user: string, aal: 'aal1' | 'aal2', permission = 'structure:read') => {
  await asUser(c, user, aal)
  const { rows } = await c.query('select app.has_permission($1::uuid, $2) as ok', [E.A, permission])
  await asOwner(c)
  return rows[0].ok as boolean
}

describe('second facteur exigé par has_permission', () => {
  it('administrateur et gestionnaire n\'ont aucun droit sans second facteur validé', async () => {
    await world(async (c) => {
      for (const user of [U.adminA, U.managerA]) {
        expect(await allowed(c, user, 'aal1'), `${user} aal1`).toBe(false)
        expect(await allowed(c, user, 'aal1', 'payment:read'), `${user} aal1 payment`).toBe(false)
        expect(await allowed(c, user, 'aal2'), `${user} aal2`).toBe(true)
      }
    })
  })

  it('le lecteur n\'est pas concerné', async () => {
    await world(async (c) => {
      expect(await allowed(c, U.readerA, 'aal1')).toBe(true)
      expect(await allowed(c, U.readerA, 'aal2')).toBe(true)
    })
  })

  it('sans second facteur, la structure et les autres membres restent invisibles ; sa propre ligne reste lisible', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA, 'aal1')
      expect((await c.query('select 1 from public.ownership_entities')).rows).toEqual([])
      // L'application lit son propre rôle pour savoir si le second facteur est exigé.
      expect((await c.query('select profile_id from public.entity_memberships')).rows).toEqual([{ profile_id: U.adminA }])
    })
  })
})

describe('codes de secours : génération', () => {
  it('refuse la génération sans second facteur validé', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA, 'aal1')
      await expect(generate(c)).rejects.toThrow(/second facteur/)
    })
  })

  it('génère 10 codes distincts, stockés hachés', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const codes = await generate(c)
      expect(codes).toHaveLength(10)
      expect(new Set(codes).size).toBe(10)
      for (const code of codes) expect(code).toMatch(CODE_FORMAT)
      await asOwner(c)
      const { rows } = await c.query('select code_hash, used_at from public.mfa_recovery_codes where profile_id = $1', [U.adminA])
      expect(rows).toHaveLength(10)
      for (const r of rows) {
        expect(codes).not.toContain(r.code_hash)
        expect(r.used_at).toBeNull()
      }
    })
  })

  it('une nouvelle génération remplace les anciens codes', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const first = await generate(c)
      const second = await generate(c)
      expect(second.some((code) => first.includes(code))).toBe(false)
      await asOwner(c)
      expect(Number((await c.query('select count(*) as n from public.mfa_recovery_codes where profile_id = $1', [U.adminA])).rows[0].n)).toBe(10)
      await addFactor(c, U.adminA)
      await asUser(c, U.adminA, 'aal1')
      expect(await redeemCode(c, first[0])).toBe('invalid')
    })
  })
})

describe('codes de secours : utilisation', () => {
  it('un code valide supprime le facteur perdu et ne sert qu\'une fois', async () => {
    await world(async (c) => {
      await addFactor(c, U.adminA)
      await asUser(c, U.adminA)
      const [code, other] = await generate(c)

      await asUser(c, U.adminA, 'aal1')
      expect(await redeemCode(c, code)).toBe('ok')
      await asOwner(c)
      expect(await factorCount(c, U.adminA)).toBe(0)

      await asUser(c, U.adminA, 'aal1')
      expect(await redeemCode(c, code)).toBe('invalid')
      expect(await redeemCode(c, other)).toBe('ok')
    })
  })

  it('accepte le code saisi en majuscules, avec espaces ou sans tirets', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const [a, b] = await generate(c)
      await asUser(c, U.adminA, 'aal1')
      expect(await redeemCode(c, ` ${a.toUpperCase()} `)).toBe('ok')
      expect(await redeemCode(c, b.replaceAll('-', ''))).toBe('ok')
    })
  })

  it('le code d\'un autre utilisateur ne fonctionne pas', async () => {
    await world(async (c) => {
      await asUser(c, U.managerA)
      const [managerCode] = await generate(c)
      await asUser(c, U.adminA, 'aal1')
      expect(await redeemCode(c, managerCode)).toBe('invalid')
    })
  })

  it('bloque après 5 essais ratés, même avec le bon code, pendant une heure', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const [code] = await generate(c)
      await asUser(c, U.adminA, 'aal1')
      for (let i = 0; i < 5; i++) expect(await redeemCode(c, '0000-0000-0000-0000')).toBe('invalid')
      expect(await redeemCode(c, code)).toBe('locked')

      await asOwner(c)
      await c.query("update public.mfa_recovery_attempts set attempted_at = now() - interval '61 minutes' where profile_id = $1", [U.adminA])
      await asUser(c, U.adminA, 'aal1')
      expect(await redeemCode(c, code)).toBe('ok')
    })
  })

  it('exige une session ouverte', async () => {
    await world(async (c) => {
      await asAnon(c)
      await expect(redeemCode(c, '0000-0000-0000-0000')).rejects.toThrow(/permission denied/)
    })
  })

  it('trace l\'utilisation et la génération dans le journal de chaque structure du membre', async () => {
    await world(async (c) => {
      await asUser(c, U.adminA)
      const [code] = await generate(c)
      await asUser(c, U.adminA, 'aal1')
      await redeemCode(c, code)
      await asOwner(c)
      const { rows } = await c.query(
        "select action, entity_id, actor_id, details from public.audit_logs where action like 'mfa.%' and entity_id = $1 order by action",
        [E.A],
      )
      expect(rows.map((r) => r.action)).toEqual(['mfa.recovery_code_used', 'mfa.recovery_codes_generated'])
      const used = rows.find((r) => r.action === 'mfa.recovery_code_used')
      expect(used.actor_id).toBe(U.adminA)
      expect(JSON.stringify(rows)).not.toMatch(CODE_FORMAT)
    })
  })
})
