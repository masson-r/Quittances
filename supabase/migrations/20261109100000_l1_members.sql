-- Lot 1 : gestion des membres. Invitation d'un membre (lien privé lié à une adresse e-mail vérifiée),
-- consommation du lien, révocation. Rôles et suspension passent par des mises à jour sous RLS (L1-02).
--
-- La consommation est une fonction SECURITY DEFINER appelée sous l'identité de l'utilisateur :
-- la clé service_role n'est pas nécessaire côté application.

create table public.invitation_attempts (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id),
  client_key text,
  attempted_at timestamptz not null default now()
);

create index invitation_attempts_profile_idx on public.invitation_attempts (profile_id, attempted_at);
create index invitation_attempts_client_idx on public.invitation_attempts (client_key, attempted_at);

alter table public.invitation_attempts enable row level security;
revoke all on public.invitation_attempts from public, anon, authenticated, service_role;

-- Droit de l'utilisateur connecté, lisible par l'application (mêmes règles que la RLS).
create function public.has_permission(p_entity_id uuid, p_permission text)
returns boolean
language sql
stable
set search_path = ''
as $$ select app.has_permission(p_entity_id, p_permission) $$;

-- Invitation d'un membre : lien valable 14 jours, jeton renvoyé une seule fois (stocké haché).
-- Une invitation en attente pour la même adresse est révoquée (régénération).
create function public.create_member_invitation(p_entity_id uuid, p_email text, p_role text)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  if not app.has_permission(p_entity_id, 'member:write') then
    raise exception 'Droit insuffisant pour inviter un membre' using errcode = 'insufficient_privilege';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Adresse e-mail invalide';
  end if;
  if p_role not in ('administrator', 'manager', 'reader') then
    raise exception 'Rôle inconnu';
  end if;
  if exists (
    select 1
    from public.entity_memberships m
    join public.profiles p on p.id = m.profile_id
    where m.entity_id = p_entity_id and p.email = v_email
  ) then
    raise exception 'Cette personne est déjà membre de la structure';
  end if;

  update public.invitations
  set revoked_at = now(), revoked_by = auth.uid()
  where entity_id = p_entity_id and kind = 'member' and email = v_email and used_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (entity_id, kind, email, role, token_hash, created_by)
  values (p_entity_id, 'member', v_email, p_role, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning id, public.invitations.expires_at into v_id, v_expires;

  return query select v_id, v_token, v_expires;
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.invitations
  set revoked_at = now(), revoked_by = auth.uid()
  where id = p_invitation_id and used_at is null and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Invitation introuvable ou déjà utilisée';
  end if;
end;
$$;

-- Consommation du lien par l'utilisateur connecté. Résultat : 'ok' (avec la structure), 'invalid' (message
-- unique : lien inconnu, expiré, utilisé, révoqué, adresse différente ou non vérifiée…) ou 'locked'
-- (10 essais ratés en une heure pour ce profil ou cette adresse réseau, p_client_key = empreinte de l'IP).
create function app.consume_invitation(p_token text, p_client_key text)
returns table (status text, entity_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_inv record;
  v_email text;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = 'insufficient_privilege';
  end if;

  if (
    select count(*)
    from public.invitation_attempts a
    where a.attempted_at > now() - interval '1 hour'
      and (a.profile_id = v_uid or (p_client_key is not null and a.client_key = p_client_key))
  ) >= 10 then
    return query select 'locked'::text, null::uuid;
    return;
  end if;

  v_hash := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  select i.* into v_inv
  from public.invitations i
  where i.token_hash = v_hash and i.kind = 'member' and i.used_at is null and i.revoked_at is null and i.expires_at > now()
  for update;

  select u.email into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;

  if v_inv.id is null
     or v_email is null
     or lower(v_email) <> v_inv.email
     or not exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'active')
     or exists (select 1 from public.entity_memberships m where m.entity_id = v_inv.entity_id and m.profile_id = v_uid) then
    insert into public.invitation_attempts (profile_id, client_key) values (v_uid, p_client_key);
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  insert into public.entity_memberships (entity_id, profile_id, role) values (v_inv.entity_id, v_uid, v_inv.role);
  update public.invitations set used_at = now(), used_by = v_uid where id = v_inv.id;
  delete from public.invitation_attempts where profile_id = v_uid;
  return query select 'ok'::text, v_inv.entity_id;
end;
$$;

create function public.consume_invitation(p_token text, p_client_key text)
returns table (status text, entity_id uuid)
language sql
set search_path = ''
as $$ select * from app.consume_invitation(p_token, p_client_key) $$;

revoke all on function public.has_permission(uuid, text) from public, anon;
revoke all on function public.create_member_invitation(uuid, text, text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function app.consume_invitation(text, text) from public, anon;
revoke all on function public.consume_invitation(text, text) from public, anon;
grant execute on function public.has_permission(uuid, text) to authenticated;
grant execute on function public.create_member_invitation(uuid, text, text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function app.consume_invitation(text, text) to authenticated;
grant execute on function public.consume_invitation(text, text) to authenticated;
