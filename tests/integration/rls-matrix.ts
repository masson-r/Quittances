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
}

/** Fonctions SECURITY DEFINER autorisées (schéma app uniquement), sous la forme app.nom. */
export const ALLOWED_SECURITY_DEFINER = ['app.write_audit', 'app.purge_audit_logs']
