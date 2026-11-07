-- Lot 1 : second facteur (TOTP) obligatoire pour l'administrateur et le gestionnaire, et codes de secours.
-- Supabase Auth gère le facteur TOTP ; la base refuse tout droit à ces deux rôles tant que la session
-- n'est pas de niveau aal2 (second facteur validé). Le lecteur n'est pas concerné.

create or replace function app.has_permission(p_entity_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.entity_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.role_permissions rp on rp.role = m.role
    where m.entity_id = p_entity_id
      and m.profile_id = auth.uid()
      and m.status = 'active'
      and p.status = 'active'
      and rp.permission = p_permission
      and (m.role = 'reader' or coalesce(auth.jwt() ->> 'aal', '') = 'aal2')
  )
$$;

----------------------------------------------------------------------------------------------------
-- Codes de secours
----------------------------------------------------------------------------------------------------

create table public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  code_hash text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  unique (profile_id, code_hash)
);

create table public.mfa_recovery_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  attempted_at timestamptz not null default now()
);

create index mfa_recovery_attempts_idx on public.mfa_recovery_attempts (profile_id, attempted_at);

-- Aucun accès direct : tout passe par les fonctions ci-dessous.
alter table public.mfa_recovery_codes enable row level security;
alter table public.mfa_recovery_attempts enable row level security;
revoke all on public.mfa_recovery_codes, public.mfa_recovery_attempts from public, anon, authenticated, service_role;

-- Journal : une entrée dans chaque structure dont l'utilisateur est membre actif.
create function app.audit_mfa(p_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  for m in
    select entity_id from public.entity_memberships where profile_id = auth.uid() and status = 'active'
  loop
    perform app.write_audit(m.entity_id, p_action, 'profiles', auth.uid(), '{}'::jsonb);
  end loop;
end;
$$;

-- Dix nouveaux codes à usage unique, affichés une seule fois ; les anciens sont remplacés.
-- Exige un second facteur validé (aal2).
create function app.regenerate_recovery_codes()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_codes text[] := '{}';
  v_raw text;
  v_code text;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'Le second facteur doit être validé pour générer des codes de secours' using errcode = 'insufficient_privilege';
  end if;

  delete from public.mfa_recovery_codes where profile_id = v_uid;
  for i in 1..10 loop
    v_raw := encode(extensions.gen_random_bytes(8), 'hex');
    v_code := substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4) || '-' || substr(v_raw, 9, 4) || '-' || substr(v_raw, 13, 4);
    v_codes := v_codes || v_code;
    insert into public.mfa_recovery_codes (profile_id, code_hash)
    values (v_uid, encode(sha256(convert_to(v_code, 'UTF8')), 'hex'));
  end loop;

  perform app.audit_mfa('mfa.recovery_codes_generated');
  return v_codes;
end;
$$;

-- Utilisation d'un code de secours après perte du second facteur : le code est consommé, le facteur perdu
-- est supprimé (l'utilisateur doit en activer un nouveau). Résultat : 'ok', 'invalid' ou 'locked'
-- (5 essais ratés dans l'heure). Utilisable avec un simple mot de passe (aal1).
create function app.use_recovery_code(p_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_norm text;
  v_row uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = 'insufficient_privilege';
  end if;

  if (select count(*) from public.mfa_recovery_attempts where profile_id = v_uid and attempted_at > now() - interval '1 hour') >= 5 then
    return 'locked';
  end if;

  v_norm := lower(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if v_norm ~ '^[0-9a-f]{16}$' then
    v_norm := substr(v_norm, 1, 4) || '-' || substr(v_norm, 5, 4) || '-' || substr(v_norm, 9, 4) || '-' || substr(v_norm, 13, 4);
    update public.mfa_recovery_codes
    set used_at = now()
    where profile_id = v_uid
      and code_hash = encode(sha256(convert_to(v_norm, 'UTF8')), 'hex')
      and used_at is null
    returning id into v_row;
  end if;

  if v_row is null then
    insert into public.mfa_recovery_attempts (profile_id) values (v_uid);
    return 'invalid';
  end if;

  delete from public.mfa_recovery_attempts where profile_id = v_uid;
  delete from auth.mfa_factors where user_id = v_uid;
  perform app.audit_mfa('mfa.recovery_code_used');
  return 'ok';
end;
$$;

create function public.regenerate_recovery_codes()
returns text[]
language sql
set search_path = ''
as $$ select app.regenerate_recovery_codes() $$;

create function public.use_recovery_code(p_code text)
returns text
language sql
set search_path = ''
as $$ select app.use_recovery_code(p_code) $$;

revoke all on function app.audit_mfa(text) from public, anon, authenticated, service_role;
revoke all on function app.regenerate_recovery_codes() from public, anon;
revoke all on function app.use_recovery_code(text) from public, anon;
revoke all on function public.regenerate_recovery_codes() from public, anon;
revoke all on function public.use_recovery_code(text) from public, anon;
grant execute on function app.regenerate_recovery_codes() to authenticated;
grant execute on function app.use_recovery_code(text) to authenticated;
grant execute on function public.regenerate_recovery_codes() to authenticated;
grant execute on function public.use_recovery_code(text) to authenticated;
