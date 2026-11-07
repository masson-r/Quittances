// Matrice déclarative de la RLS : table × rôle × action → 'allowed' ou 'denied'.
// Toute nouvelle table du schéma public DOIT être ajoutée ici (le test de garde l'exige),
// avec une ligne d'exemple pour chaque rôle et chaque action.
// 'denied' = erreur, ou aucune ligne modifiée ou lue (update, delete, select).

export type Action = 'select' | 'insert' | 'update' | 'delete'
export type Outcome = 'allowed' | 'denied'
export type DbRole = 'anon' | 'authenticated' | 'service_role'

export interface TableSpec {
  /** Exécuté par le propriétaire avant les essais : au moins une ligne doit exister. */
  seed: string
  statements: Record<Action, string>
  expected: Record<DbRole, Record<Action, Outcome>>
}

const nothing: Record<Action, Outcome> = { select: 'denied', insert: 'denied', update: 'denied', delete: 'denied' }


const IDENTITY_SEED = `
  insert into auth.users (id, email, aud, role) values
    ('00000000-0000-4000-8000-00000000f001', 'm1@example.test', 'authenticated', 'authenticated'),
    ('00000000-0000-4000-8000-00000000f002', 'm2@example.test', 'authenticated', 'authenticated'),
    ('00000000-0000-4000-8000-00000000f003', 'm3@example.test', 'authenticated', 'authenticated');
  insert into public.ownership_entities (id, name, kind) values ('00000000-0000-4000-8000-00000000ffff', 'Matrice', 'sci');
  insert into public.entity_memberships (entity_id, profile_id, role) values
    ('00000000-0000-4000-8000-00000000ffff', '00000000-0000-4000-8000-00000000f001', 'administrator'),
    ('00000000-0000-4000-8000-00000000ffff', '00000000-0000-4000-8000-00000000f002', 'reader');
  insert into public.invitations (entity_id, kind, email, role, token_hash, created_by) values
    ('00000000-0000-4000-8000-00000000ffff', 'member', 'i@example.test', 'reader', 'matrix-hash-1', '00000000-0000-4000-8000-00000000f001');
`
const E_ID = "'00000000-0000-4000-8000-00000000ffff'"
const P1 = "'00000000-0000-4000-8000-00000000f001'"
const P3 = "'00000000-0000-4000-8000-00000000f003'"
const serviceRoleOnly = { anon: nothing, authenticated: nothing }

export const RLS_MATRIX: Record<string, TableSpec> = {
  audit_logs: {
    seed: "select app.write_audit(null, 'matrix.seed', 'audit_logs', null, '{}'::jsonb)",
    statements: {
      select: 'select * from public.audit_logs',
      insert: "insert into public.audit_logs (action) values ('matrix.insert')",
      update: "update public.audit_logs set action = 'matrix.update'",
      delete: 'delete from public.audit_logs',
    },
    expected: {
      anon: nothing,
      authenticated: nothing,
      service_role: { ...nothing, select: 'allowed' },
    },
  },
  role_permissions: {
    seed: IDENTITY_SEED,
    statements: {
      select: 'select * from public.role_permissions',
      insert: "insert into public.role_permissions (role, permission) values ('reader', 'matrix:write')",
      update: "update public.role_permissions set permission = 'matrix:x'",
      delete: 'delete from public.role_permissions',
    },
    expected: {
      anon: nothing,
      authenticated: { ...nothing, select: 'allowed' },
      service_role: { ...nothing, select: 'allowed' },
    },
  },
  profiles: {
    seed: IDENTITY_SEED,
    statements: {
      select: 'select * from public.profiles',
      insert: "insert into public.profiles (id, email) values (gen_random_uuid(), 'z@example.test')",
      update: "update public.profiles set first_name = 'matrice'",
      delete: 'delete from public.profiles',
    },
    expected: { ...serviceRoleOnly, service_role: { ...nothing, select: 'allowed', update: 'allowed' } },
  },
  ownership_entities: {
    seed: IDENTITY_SEED,
    statements: {
      select: 'select * from public.ownership_entities',
      insert: "insert into public.ownership_entities (name, kind) values ('Autre', 'sci')",
      update: "update public.ownership_entities set name = 'matrice'",
      delete: 'delete from public.ownership_entities',
    },
    expected: { ...serviceRoleOnly, service_role: { ...nothing, select: 'allowed', insert: 'allowed', update: 'allowed' } },
  },
  entity_memberships: {
    seed: IDENTITY_SEED,
    statements: {
      select: 'select * from public.entity_memberships',
      insert: `insert into public.entity_memberships (entity_id, profile_id, role) values (${E_ID}, ${P3}, 'reader')`,
      update: "update public.entity_memberships set status = 'suspended' where role = 'reader'",
      delete: 'delete from public.entity_memberships',
    },
    expected: { ...serviceRoleOnly, service_role: { ...nothing, select: 'allowed', insert: 'allowed', update: 'allowed' } },
  },
  invitations: {
    seed: IDENTITY_SEED,
    statements: {
      select: 'select * from public.invitations',
      insert: `insert into public.invitations (entity_id, kind, email, role, token_hash, created_by) values (${E_ID}, 'member', 'j@example.test', 'reader', 'matrix-hash-2', ${P1})`,
      update: 'update public.invitations set revoked_at = now()',
      delete: 'delete from public.invitations',
    },
    expected: { ...serviceRoleOnly, service_role: { ...nothing, select: 'allowed', insert: 'allowed', update: 'allowed' } },
  },
  mfa_recovery_codes: {
    seed: IDENTITY_SEED + `insert into public.mfa_recovery_codes (profile_id, code_hash) values (${P1}, 'matrix-code-hash');`,
    statements: {
      select: 'select * from public.mfa_recovery_codes',
      insert: `insert into public.mfa_recovery_codes (profile_id, code_hash) values (${P1}, 'matrix-code-hash-2')`,
      update: 'update public.mfa_recovery_codes set used_at = now()',
      delete: 'delete from public.mfa_recovery_codes',
    },
    expected: { anon: nothing, authenticated: nothing, service_role: nothing },
  },
  mfa_recovery_attempts: {
    seed: IDENTITY_SEED + `insert into public.mfa_recovery_attempts (profile_id) values (${P1});`,
    statements: {
      select: 'select * from public.mfa_recovery_attempts',
      insert: `insert into public.mfa_recovery_attempts (profile_id) values (${P1})`,
      update: 'update public.mfa_recovery_attempts set attempted_at = now()',
      delete: 'delete from public.mfa_recovery_attempts',
    },
    expected: { anon: nothing, authenticated: nothing, service_role: nothing },
  },
}

/** Fonctions SECURITY DEFINER autorisées (schéma app uniquement), sous la forme app.nom. */
export const ALLOWED_SECURITY_DEFINER = [
  'app.write_audit',
  'app.purge_audit_logs',
  'app.has_permission',
  'app.sync_profile_from_auth',
  'app.guard_last_admin',
  'app.guard_last_admin_profile',
  'app.revoke_sessions_on_disable',
  'app.audit_mfa',
  'app.regenerate_recovery_codes',
  'app.use_recovery_code',
]
