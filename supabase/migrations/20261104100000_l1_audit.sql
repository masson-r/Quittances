-- Lot 1 : journal d'audit en ajout seul (ADR 0003, ticket modèle relationnel).
-- Écrit uniquement par app.write_audit (fonctions SQL et triggers), jamais par le code applicatif.
-- Pas de donnée personnelle : identifiants, montants, dates, motifs.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  entity_id uuid,
  actor_kind text not null default 'system' check (actor_kind in ('user', 'system', 'operator')),
  actor_id uuid,
  action text not null check (length(action) > 0),
  subject_table text,
  subject_id uuid,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object')
);

create index audit_logs_entity_idx on public.audit_logs (entity_id, occurred_at desc);
create index audit_logs_subject_idx on public.audit_logs (subject_table, subject_id);
create index audit_logs_occurred_idx on public.audit_logs (occurred_at);

-- RLS activée sans politique : tout est refusé. La migration identity ajoute la lecture
-- pour les membres autorisés (permission audit:read).
alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from public, anon, authenticated, service_role;
grant select on public.audit_logs to service_role;

-- Ajout seul : UPDATE, TRUNCATE et DELETE refusés pour tous les rôles, service_role compris.
-- Seule exception : la purge de 3 ans, exécutée par le propriétaire via app.purge_audit_logs().
create function app.audit_logs_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     and coalesce(current_setting('app.audit_purge', true), '') = 'on'
     and current_user = 'postgres' then
    return old;
  end if;
  raise exception 'audit_logs est en ajout seul (% refusé)', tg_op using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_logs_no_update_delete
  before update or delete on public.audit_logs
  for each row execute function app.audit_logs_append_only();

-- allow-destructive: ce trigger interdit TRUNCATE, il n'en exécute aucun
create trigger audit_logs_no_truncate
  before truncate on public.audit_logs
  for each statement execute function app.audit_logs_append_only();

-- Écriture d'une entrée. L'auteur vient de la session (auth.uid()) quand il existe ;
-- sans session, p_actor_kind vaut 'system' (pg_cron) ou 'operator' (script de l'opérateur).
create function app.write_audit(
  p_entity_id uuid,
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_details jsonb default '{}'::jsonb,
  p_actor_kind text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  insert into public.audit_logs (entity_id, actor_kind, actor_id, action, subject_table, subject_id, details)
  values (
    p_entity_id,
    case when v_uid is not null then 'user' else p_actor_kind end,
    v_uid,
    p_action,
    p_subject_table,
    p_subject_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- Purge des entrées de plus de 3 ans. Appelée par pg_cron (migration finance_cron) ou l'opérateur.
create function app.purge_audit_logs()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  perform set_config('app.audit_purge', 'on', true);
  delete from public.audit_logs where occurred_at < now() - interval '3 years';
  get diagnostics n = row_count;
  perform set_config('app.audit_purge', 'off', true);
  return n;
end;
$$;

revoke all on function app.audit_logs_append_only() from public, anon;
revoke all on function app.write_audit(uuid, text, text, uuid, jsonb, text) from public, anon;
revoke all on function app.purge_audit_logs() from public, anon, authenticated, service_role;
grant execute on function app.write_audit(uuid, text, text, uuid, jsonb, text) to authenticated, service_role;
