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

const PROP = "'00000000-0000-4000-8000-0000000000d1'"
const TENANT = "'00000000-0000-4000-8000-0000000000d2'"
const BATCH = "'00000000-0000-4000-8000-0000000000d3'"
const PROPERTY_SEED =
  IDENTITY_SEED +
  `insert into public.import_batches (id, entity_id) values (${BATCH}, ${E_ID});
   insert into public.properties (id, entity_id, label) values (${PROP}, ${E_ID}, 'Bien matrice');
   insert into public.tenants (id, entity_id, last_name) values (${TENANT}, ${E_ID}, 'Locataire matrice');
   insert into public.tenant_private_details (tenant_id, entity_id) values (${TENANT}, ${E_ID});
   insert into public.property_access_codes (entity_id, property_id, label, code) values (${E_ID}, ${PROP}, 'Portail', '0000');
   insert into public.property_maintenance_notes (entity_id, property_id, body) values (${E_ID}, ${PROP}, 'Note matrice');`

const LEASE = "'00000000-0000-4000-8000-0000000000d4'"
const LEASE_SEED =
  PROPERTY_SEED +
  `insert into public.leases (id, entity_id, property_id, start_date, due_day) values (${LEASE}, ${E_ID}, ${PROP}, '2026-01-01', 5);
   insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) values (${E_ID}, ${LEASE}, ${TENANT}, '2026-01-01');
   insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values (${E_ID}, ${LEASE}, '2026-01-01', 80000, 5000);`
const serviceCrud = { ...nothing, select: 'allowed', insert: 'allowed', update: 'allowed' } as Record<Action, Outcome>

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
  invitation_attempts: {
    seed: IDENTITY_SEED + `insert into public.invitation_attempts (profile_id, client_key) values (${P1}, 'matrix-key');`,
    statements: {
      select: 'select * from public.invitation_attempts',
      insert: `insert into public.invitation_attempts (profile_id, client_key) values (${P1}, 'matrix-key-2')`,
      update: 'update public.invitation_attempts set attempted_at = now()',
      delete: 'delete from public.invitation_attempts',
    },
    expected: { anon: nothing, authenticated: nothing, service_role: nothing },
  },
  import_batches: {
    seed: PROPERTY_SEED,
    statements: {
      select: 'select * from public.import_batches',
      insert: `insert into public.import_batches (entity_id) values (${E_ID})`,
      update: "update public.import_batches set status = 'cancelled'",
      delete: 'delete from public.import_batches',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
  },
  properties: {
    seed: PROPERTY_SEED,
    statements: {
      select: 'select * from public.properties',
      insert: `insert into public.properties (entity_id, label) values (${E_ID}, 'Autre bien')`,
      update: "update public.properties set description = 'matrice'",
      delete: 'delete from public.properties',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
  },
  property_maintenance_notes: {
    seed: PROPERTY_SEED,
    statements: {
      select: 'select * from public.property_maintenance_notes',
      insert: `insert into public.property_maintenance_notes (entity_id, property_id, body) values (${E_ID}, ${PROP}, 'Autre note')`,
      update: "update public.property_maintenance_notes set body = 'matrice'",
      delete: 'delete from public.property_maintenance_notes',
    },
    expected: { ...serviceRoleOnly, service_role: { ...nothing, select: 'allowed', insert: 'allowed' } },
  },
  property_access_codes: {
    seed: PROPERTY_SEED,
    statements: {
      select: 'select * from public.property_access_codes',
      insert: `insert into public.property_access_codes (entity_id, property_id, label, code) values (${E_ID}, ${PROP}, 'Autre', '1')`,
      update: "update public.property_access_codes set code = '9'",
      delete: 'delete from public.property_access_codes',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
  },
  tenants: {
    seed: PROPERTY_SEED,
    statements: {
      select: 'select * from public.tenants',
      insert: `insert into public.tenants (entity_id, last_name) values (${E_ID}, 'Autre')`,
      update: "update public.tenants set phone = '0'",
      delete: 'delete from public.tenants',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
  },
  tenant_private_details: {
    seed: PROPERTY_SEED,
    statements: {
      select: 'select * from public.tenant_private_details',
      insert: `insert into public.tenant_private_details (tenant_id, entity_id) values (${TENANT}, ${E_ID})`,
      update: "update public.tenant_private_details set note = 'matrice'",
      delete: 'delete from public.tenant_private_details',
    },
    expected: { ...serviceRoleOnly, service_role: { ...serviceCrud, insert: 'denied' } },
  },
  leases: {
    seed: LEASE_SEED,
    statements: {
      select: 'select * from public.leases',
      insert: `with p as (insert into public.properties (entity_id, label) values (${E_ID}, 'Autre bien') returning id)
               insert into public.leases (entity_id, property_id, start_date, due_day) select ${E_ID}, id, '2030-01-01', 5 from p`,
      update: "update public.leases set deposit_cents = 100",
      delete: 'delete from public.leases',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
  },
  lease_tenants: {
    seed: LEASE_SEED,
    statements: {
      select: 'select * from public.lease_tenants',
      insert: `with t as (insert into public.tenants (entity_id, last_name) values (${E_ID}, 'Colocataire') returning id)
               insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date) select ${E_ID}, ${LEASE}, id, '2026-02-01' from t`,
      update: "update public.lease_tenants set end_date = '2026-12-31'",
      delete: 'delete from public.lease_tenants',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
  },
  rental_terms: {
    seed: LEASE_SEED,
    statements: {
      select: 'select * from public.rental_terms',
      insert: `insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents) values (${E_ID}, ${LEASE}, '2026-06-01', 82000, 5000)`,
      update: "update public.rental_terms set reason = 'matrice'",
      delete: 'delete from public.rental_terms',
    },
    expected: { ...serviceRoleOnly, service_role: serviceCrud },
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
  'app.consume_invitation',
  'app.regenerate_recovery_codes',
  'app.use_recovery_code',
]
