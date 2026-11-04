import type pg from 'pg'
import { RLS_MATRIX, ALLOWED_SECURITY_DEFINER } from './rls-matrix'

/** Tables du schéma public sans RLS activée. */
export async function tablesWithoutRls(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity order by 1`,
  )
  return rows.map((r) => r.relname)
}

/** Tables du schéma public absentes de la matrice déclarative. */
export async function tablesMissingFromMatrix(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query(
    `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1`,
  )
  return rows.map((r) => r.relname).filter((t) => !(t in RLS_MATRIX))
}

/** Fonctions SECURITY DEFINER hors liste, hors schéma app, ou sans search_path vide. */
export async function unexpectedSecurityDefiners(c: pg.Client): Promise<string[]> {
  const { rows } = await c.query(
    `select n.nspname || '.' || p.proname as name, coalesce(p.proconfig, '{}') as config
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prosecdef and n.nspname in ('public', 'app') order by 1`,
  )
  return rows
    .filter((r) => !ALLOWED_SECURITY_DEFINER.includes(r.name) || !r.config.some((x: string) => /^search_path=("")?$/.test(x)))
    .map((r) => r.name)
}
