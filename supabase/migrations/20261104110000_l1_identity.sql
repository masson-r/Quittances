-- Lot 1 : identité et autorisations (profils, structures, membres, permissions, invitations).
-- RLS dans ce fichier. Les droits viennent de has_permission(), relue en base à chaque requête.
-- Les tables créées à partir d'ici n'ouvrent aucun droit par défaut aux rôles anon et authenticated.

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;

----------------------------------------------------------------------------------------------------
-- Profils : copie synchronisée de auth.users
----------------------------------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id),
  email text not null,
  first_name text not null default '',
  last_name text not null default '',
  status text not null default 'active' check (status in ('active', 'disabled')),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_key on public.profiles (email) where email <> '';

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function app.set_updated_at();

alter table public.profiles enable row level security;

-- À l'inscription et à chaque changement d'e-mail côté authentification.
create function app.sync_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.profiles (id, email, first_name, last_name)
    values (
      new.id,
      coalesce(lower(new.email), ''),
      coalesce(new.raw_user_meta_data ->> 'first_name', ''),
      coalesce(new.raw_user_meta_data ->> 'last_name', '')
    )
    on conflict (id) do update set email = excluded.email;
  else
    update public.profiles set email = coalesce(lower(new.email), '') where id = new.id;
  end if;
  return new;
end;
$$;

create trigger on_auth_user_sync
  after insert or update of email on auth.users
  for each row execute function app.sync_profile_from_auth();

----------------------------------------------------------------------------------------------------
-- Structures propriétaires
----------------------------------------------------------------------------------------------------

create table public.ownership_entities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  kind text not null check (kind in ('natural_person', 'sci', 'other')),
  address_line text,
  postal_code text,
  city text,
  contact_email text,
  contact_phone text,
  siret text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger ownership_entities_set_updated_at
  before update on public.ownership_entities
  for each row execute function app.set_updated_at();

alter table public.ownership_entities enable row level security;

----------------------------------------------------------------------------------------------------
-- Membres et permissions
----------------------------------------------------------------------------------------------------

create table public.entity_memberships (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  profile_id uuid not null references public.profiles (id),
  role text not null check (role in ('administrator', 'manager', 'reader')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, profile_id)
);

create index entity_memberships_profile_idx on public.entity_memberships (profile_id);

create trigger entity_memberships_set_updated_at
  before update on public.entity_memberships
  for each row execute function app.set_updated_at();

alter table public.entity_memberships enable row level security;

create table public.role_permissions (
  role text not null check (role in ('administrator', 'manager', 'reader')),
  permission text not null check (permission ~ '^[a-z_]+:(read|write|cancel)$'),
  primary key (role, permission)
);

alter table public.role_permissions enable row level security;

-- Permissions nommées <ressource>:<verbe> ; verbes : read (L), write (E), cancel (A : annulation ou archivage).
insert into public.role_permissions (role, permission)
select 'administrator', r || ':' || v
from unnest(array['structure', 'member', 'property', 'tenant', 'lease', 'rent_charge', 'payment', 'expense',
                  'expense_category', 'settlement', 'receipt']) as r,
     unnest(array['read', 'write', 'cancel']) as v;

insert into public.role_permissions (role, permission) values
  ('administrator', 'audit:read'),
  ('administrator', 'sensitive:read'),
  ('administrator', 'sensitive:write'),
  ('administrator', 'signature:write');

insert into public.role_permissions (role, permission)
select 'manager', r || ':' || v
from unnest(array['property', 'tenant', 'lease', 'rent_charge', 'payment', 'expense', 'settlement', 'receipt']) as r,
     unnest(array['read', 'write', 'cancel']) as v;

insert into public.role_permissions (role, permission) values
  ('manager', 'structure:read'),
  ('manager', 'expense_category:read'),
  ('manager', 'sensitive:read'),
  ('manager', 'sensitive:write'),
  ('manager', 'signature:write');

insert into public.role_permissions (role, permission)
select 'reader', r || ':read'
from unnest(array['structure', 'property', 'tenant', 'lease', 'rent_charge', 'payment', 'expense',
                  'expense_category', 'settlement', 'receipt']) as r;

-- Droit de l'utilisateur connecté sur une structure : membre actif, profil actif, permission accordée au rôle.
-- SECURITY DEFINER pour lire les membres sans repasser par leur RLS (qui l'appelle elle-même).
-- L'utilisateur vient de la session (auth.uid()), jamais d'un paramètre.
create function app.has_permission(p_entity_id uuid, p_permission text)
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
  )
$$;

-- Au moins un administrateur actif (membre actif, profil actif) par structure, même sous concurrence.
create function app.guard_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'administrator' and old.status = 'active'
     and (tg_op = 'DELETE' or new.role <> 'administrator' or new.status <> 'active' or new.entity_id <> old.entity_id) then
    perform pg_advisory_xact_lock(hashtextextended(old.entity_id::text, 0));
    if not exists (
      select 1
      from public.entity_memberships m
      join public.profiles p on p.id = m.profile_id
      where m.entity_id = old.entity_id
        and m.id <> old.id
        and m.role = 'administrator'
        and m.status = 'active'
        and p.status = 'active'
    ) then
      raise exception 'Une structure doit garder au moins un administrateur actif' using errcode = 'check_violation';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger entity_memberships_last_admin
  before update or delete on public.entity_memberships
  for each row execute function app.guard_last_admin();

create function app.guard_last_admin_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  m record;
begin
  if old.status = 'active' and new.status <> 'active' then
    for m in
      select entity_id from public.entity_memberships
      where profile_id = old.id and role = 'administrator' and status = 'active'
    loop
      perform pg_advisory_xact_lock(hashtextextended(m.entity_id::text, 0));
      if not exists (
        select 1
        from public.entity_memberships mm
        join public.profiles p on p.id = mm.profile_id
        where mm.entity_id = m.entity_id
          and mm.profile_id <> old.id
          and mm.role = 'administrator'
          and mm.status = 'active'
          and p.status = 'active'
      ) then
        raise exception 'Une structure doit garder au moins un administrateur actif' using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

create trigger profiles_last_admin
  before update of status on public.profiles
  for each row execute function app.guard_last_admin_profile();

-- Journal d'audit des membres : identifiants, rôles et statuts seulement.
create function app.audit_membership()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit(new.entity_id, 'member.created', 'entity_memberships', new.id,
      jsonb_build_object('profile_id', new.profile_id, 'role', new.role));
  else
    if new.role <> old.role then
      perform app.write_audit(new.entity_id, 'member.role_changed', 'entity_memberships', new.id,
        jsonb_build_object('from', old.role, 'to', new.role));
    end if;
    if new.status <> old.status then
      perform app.write_audit(new.entity_id,
        case when new.status = 'suspended' then 'member.suspended' else 'member.reactivated' end,
        'entity_memberships', new.id, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

create trigger entity_memberships_audit
  after insert or update on public.entity_memberships
  for each row execute function app.audit_membership();

----------------------------------------------------------------------------------------------------
-- Invitations (membres et locataires)
----------------------------------------------------------------------------------------------------

-- tenant_id reçoit sa clé étrangère dans la migration property_tenants (la table tenants n'existe pas encore).
create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  kind text not null check (kind in ('member', 'tenant')),
  email text,
  role text check (role in ('administrator', 'manager', 'reader')),
  tenant_id uuid,
  token_hash text not null unique,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_at timestamptz,
  used_by uuid references public.profiles (id),
  revoked_at timestamptz,
  revoked_by uuid references public.profiles (id),
  check (
    (kind = 'member' and email is not null and role is not null and tenant_id is null)
    or (kind = 'tenant' and tenant_id is not null and role is null and email is null)
  )
);

create index invitations_entity_idx on public.invitations (entity_id);

alter table public.invitations enable row level security;

create function app.audit_invitation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit(new.entity_id, 'invitation.created', 'invitations', new.id,
      jsonb_strip_nulls(jsonb_build_object('kind', new.kind, 'role', new.role)));
  else
    if old.revoked_at is null and new.revoked_at is not null then
      perform app.write_audit(new.entity_id, 'invitation.revoked', 'invitations', new.id, '{}'::jsonb);
    end if;
    if old.used_at is null and new.used_at is not null then
      perform app.write_audit(new.entity_id, 'invitation.used', 'invitations', new.id, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$$;

create trigger invitations_audit
  after insert or update on public.invitations
  for each row execute function app.audit_invitation();

----------------------------------------------------------------------------------------------------
-- Politiques RLS
----------------------------------------------------------------------------------------------------

create policy role_permissions_select on public.role_permissions
  for select to authenticated using (true);

create policy profiles_select on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1 from public.entity_memberships m
      where m.profile_id = profiles.id and app.has_permission(m.entity_id, 'member:read')
    )
  );

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid() and status = 'active')
  with check (id = auth.uid());

create policy entities_select on public.ownership_entities
  for select to authenticated using (app.has_permission(id, 'structure:read'));

create policy entities_update on public.ownership_entities
  for update to authenticated
  using (app.has_permission(id, 'structure:write'))
  with check (app.has_permission(id, 'structure:write'));

create policy memberships_select on public.entity_memberships
  for select to authenticated
  using ((profile_id = auth.uid() and status = 'active') or app.has_permission(entity_id, 'member:read'));

create policy memberships_update on public.entity_memberships
  for update to authenticated
  using (app.has_permission(entity_id, 'member:write'))
  with check (app.has_permission(entity_id, 'member:write'));

create policy invitations_select on public.invitations
  for select to authenticated
  using (
    (kind = 'member' and app.has_permission(entity_id, 'member:read'))
    or (kind = 'tenant' and app.has_permission(entity_id, 'tenant:read'))
  );

create policy invitations_insert on public.invitations
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and (
      (kind = 'member' and app.has_permission(entity_id, 'member:write'))
      or (kind = 'tenant' and app.has_permission(entity_id, 'tenant:write'))
    )
  );

create policy invitations_revoke on public.invitations
  for update to authenticated
  using (
    (kind = 'member' and app.has_permission(entity_id, 'member:write'))
    or (kind = 'tenant' and app.has_permission(entity_id, 'tenant:write'))
  )
  with check (
    (kind = 'member' and app.has_permission(entity_id, 'member:write'))
    or (kind = 'tenant' and app.has_permission(entity_id, 'tenant:write'))
  );

-- Le journal d'audit se lit avec la permission audit:read (administrateur).
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (entity_id is not null and app.has_permission(entity_id, 'audit:read'));

----------------------------------------------------------------------------------------------------
-- Privilèges (la RLS filtre les lignes, les droits de colonne limitent ce qui se modifie)
----------------------------------------------------------------------------------------------------

revoke all on public.profiles, public.ownership_entities, public.entity_memberships,
              public.role_permissions, public.invitations
  from public, anon, authenticated, service_role;

grant select on public.role_permissions to authenticated, service_role;
grant select on public.audit_logs to authenticated;

grant select on public.profiles to authenticated;
grant update (first_name, last_name) on public.profiles to authenticated;
grant select, update on public.profiles to service_role;

grant select on public.ownership_entities to authenticated;
grant update (name, kind, address_line, postal_code, city, contact_email, contact_phone, siret, archived_at)
  on public.ownership_entities to authenticated;
grant select, insert, update on public.ownership_entities to service_role;

grant select on public.entity_memberships to authenticated;
grant update (role, status) on public.entity_memberships to authenticated;
grant select, insert, update on public.entity_memberships to service_role;

-- Jamais token_hash en lecture pour un utilisateur ; seule la révocation se modifie.
grant select (id, entity_id, kind, email, role, tenant_id, created_by, created_at, expires_at, used_at, used_by, revoked_at, revoked_by)
  on public.invitations to authenticated;
grant insert (entity_id, kind, email, role, tenant_id, token_hash, created_by) on public.invitations to authenticated;
grant update (revoked_at, revoked_by) on public.invitations to authenticated;
grant select, insert, update on public.invitations to service_role;

revoke all on function app.has_permission(uuid, text) from public, anon;
revoke all on function app.sync_profile_from_auth() from public, anon, authenticated, service_role;
revoke all on function app.guard_last_admin() from public, anon, authenticated, service_role;
revoke all on function app.guard_last_admin_profile() from public, anon, authenticated, service_role;
revoke all on function app.audit_membership() from public, anon, authenticated, service_role;
revoke all on function app.audit_invitation() from public, anon, authenticated, service_role;
grant execute on function app.has_permission(uuid, text) to authenticated, service_role;
