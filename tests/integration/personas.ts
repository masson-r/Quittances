import type pg from 'pg'

export const U = {
  adminA: '00000000-0000-4000-8000-0000000000a1',
  managerA: '00000000-0000-4000-8000-0000000000a2',
  readerA: '00000000-0000-4000-8000-0000000000a3',
  suspendedA: '00000000-0000-4000-8000-0000000000a4',
  adminB: '00000000-0000-4000-8000-0000000000b1',
  outsider: '00000000-0000-4000-8000-0000000000c1',
  disabled: '00000000-0000-4000-8000-0000000000d1',
} as const

export const E = {
  A: '00000000-0000-4000-8000-00000000aaaa',
  B: '00000000-0000-4000-8000-00000000bbbb',
} as const

/** Crée un utilisateur d'authentification (le trigger crée son profil). À appeler en propriétaire. */
export async function createAuthUser(c: pg.Client, id: string, email: string, meta: Record<string, string> = {}) {
  await c.query(
    "insert into auth.users (id, email, raw_user_meta_data, aud, role) values ($1, $2, $3::jsonb, 'authenticated', 'authenticated')",
    [id, email, JSON.stringify(meta)],
  )
}

/** Deux structures et sept personnes : le décor des tests de cloisonnement. Rôle propriétaire. */
export async function buildWorld(c: pg.Client) {
  const users: [string, string][] = [
    [U.adminA, 'admin.a@example.test'],
    [U.managerA, 'manager.a@example.test'],
    [U.readerA, 'reader.a@example.test'],
    [U.suspendedA, 'suspended.a@example.test'],
    [U.adminB, 'admin.b@example.test'],
    [U.outsider, 'outsider@example.test'],
    [U.disabled, 'disabled@example.test'],
  ]
  for (const [id, email] of users) await createAuthUser(c, id, email)
  await c.query("insert into public.ownership_entities (id, name, kind) values ($1, 'Structure A', 'sci'), ($2, 'Structure B', 'natural_person')", [E.A, E.B])
  await c.query(
    `insert into public.entity_memberships (entity_id, profile_id, role, status) values
       ($1, $3, 'administrator', 'active'),
       ($1, $4, 'manager', 'active'),
       ($1, $5, 'reader', 'active'),
       ($1, $6, 'reader', 'suspended'),
       ($1, $8, 'administrator', 'active'),
       ($2, $7, 'administrator', 'active')`,
    [E.A, E.B, U.adminA, U.managerA, U.readerA, U.suspendedA, U.adminB, U.disabled],
  )
  await c.query("update public.profiles set status = 'disabled' where id = $1", [U.disabled])
}

/** Se place dans la peau d'un utilisateur connecté (rôle authenticated, session JWT). */
export async function asUser(c: pg.Client, userId: string) {
  await c.query('reset role')
  await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: 'authenticated' })])
  await c.query('set local role authenticated')
}

/** Visiteur sans session. */
export async function asAnon(c: pg.Client) {
  await c.query('reset role')
  await c.query("select set_config('request.jwt.claims', '', true)")
  await c.query('set local role anon')
}

/** Retour au propriétaire de la base. */
export async function asOwner(c: pg.Client) {
  await c.query('reset role')
  await c.query("select set_config('request.jwt.claims', '', true)")
}
