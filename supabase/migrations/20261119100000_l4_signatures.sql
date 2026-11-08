-- Lot 4 : signature du bailleur (L4-03). Chaque membre téléverse, remplace et retire sa propre signature
-- (image PNG ou JPEG, 500 Ko et 1 200 × 600 pixels au maximum, métadonnées EXIF retirées par le serveur avant l'enregistrement).
-- La signature utilisée sur un document est celle de la personne qui l'émet ; elle est facultative.
--
-- L'image est conservée dans la table (au plus 500 Ko) plutôt que dans Storage : lecture et écriture passent par la RLS,
-- sans clé service_role. Les anciennes signatures sont conservées (elles restent référencées par les quittances émises).

create table public.member_signatures (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  membership_id uuid not null references public.entity_memberships (id),
  profile_id uuid not null references public.profiles (id),
  content_type text not null check (content_type in ('image/png', 'image/jpeg')),
  width integer not null check (width between 1 and 1200),
  height integer not null check (height between 1 and 600),
  byte_size integer not null check (byte_size between 1 and 512000),
  sha256 text not null,
  image bytea not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  unique (entity_id, id),
  check (active = (retired_at is null)),
  check (octet_length(image) = byte_size)
);

-- Une seule signature active par membre et structure.
create unique index member_signatures_active_key on public.member_signatures (membership_id) where active;
create index member_signatures_entity_idx on public.member_signatures (entity_id);

alter table public.member_signatures enable row level security;

-- Seul l'auteur lit, ajoute et retire sa signature, et seulement avec le droit signature:write dans la structure.
create policy member_signatures_select on public.member_signatures
  for select to authenticated
  using (profile_id = auth.uid() and app.has_permission(entity_id, 'signature:write'));

create policy member_signatures_insert on public.member_signatures
  for insert to authenticated
  with check (
    profile_id = auth.uid()
    and app.has_permission(entity_id, 'signature:write')
    and exists (
      select 1 from public.entity_memberships m
      where m.id = membership_id and m.entity_id = member_signatures.entity_id and m.profile_id = auth.uid()
    )
  );

create policy member_signatures_retire on public.member_signatures
  for update to authenticated
  using (profile_id = auth.uid() and app.has_permission(entity_id, 'signature:write'))
  with check (profile_id = auth.uid() and app.has_permission(entity_id, 'signature:write'));

revoke all on public.member_signatures from public, anon, authenticated, service_role;
grant select on public.member_signatures to authenticated;
grant insert (entity_id, membership_id, profile_id, content_type, width, height, byte_size, sha256, image) on public.member_signatures to authenticated;
grant update (active, retired_at) on public.member_signatures to authenticated;
grant select on public.member_signatures to service_role;

-- Une signature retirée ne se réactive pas : on en téléverse une nouvelle.
create function app.guard_signature_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.active is false then
    raise exception 'Une signature retirée ne peut pas être réactivée';
  end if;
  return new;
end;
$$;

create trigger member_signatures_guard
  before update on public.member_signatures
  for each row execute function app.guard_signature_update();

-- Journal d'audit : identifiants et empreinte seulement.
create function app.audit_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit(new.entity_id, 'signature.uploaded', 'member_signatures', new.id,
      jsonb_build_object('sha256', new.sha256, 'byte_size', new.byte_size));
  elsif old.active and not new.active then
    perform app.write_audit(new.entity_id, 'signature.retired', 'member_signatures', new.id);
  end if;
  return new;
end;
$$;

create trigger member_signatures_audit
  after insert or update on public.member_signatures
  for each row execute function app.audit_signature();

-- Enregistre la signature de l'utilisateur connecté et retire la précédente (conservée). Le serveur a déjà validé
-- l'image et retiré les métadonnées ; la base contrôle le type, la taille et les dimensions.
create function public.save_my_signature(p_entity_id uuid, p_content_type text, p_width integer, p_height integer, p_image bytea)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_membership uuid;
  v_id uuid;
begin
  select m.id into v_membership
  from public.entity_memberships m
  where m.entity_id = p_entity_id and m.profile_id = auth.uid() and m.status = 'active';
  if v_membership is null or not app.has_permission(p_entity_id, 'signature:write') then
    raise exception 'Droit insuffisant pour enregistrer une signature' using errcode = 'insufficient_privilege';
  end if;
  if p_image is null or octet_length(p_image) = 0 or octet_length(p_image) > 512000 then
    raise exception 'La signature dépasse 500 Ko';
  end if;

  update public.member_signatures set active = false, retired_at = now() where membership_id = v_membership and active;
  insert into public.member_signatures (entity_id, membership_id, profile_id, content_type, width, height, byte_size, sha256, image)
  values (p_entity_id, v_membership, auth.uid(), p_content_type, p_width, p_height, octet_length(p_image),
          encode(sha256(p_image), 'hex'), p_image)
  returning id into v_id;
  return v_id;
end;
$$;

-- Retire la signature active de l'utilisateur connecté (sans effet sur les documents déjà émis).
create function public.remove_my_signature(p_entity_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  n integer;
begin
  update public.member_signatures set active = false, retired_at = now()
  where entity_id = p_entity_id and profile_id = auth.uid() and active;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Aucune signature à retirer';
  end if;
end;
$$;

revoke all on function app.guard_signature_update() from public, anon, authenticated, service_role;
revoke all on function app.audit_signature() from public, anon, authenticated, service_role;
revoke all on function public.save_my_signature(uuid, text, integer, integer, bytea) from public, anon;
revoke all on function public.remove_my_signature(uuid) from public, anon;
grant execute on function public.save_my_signature(uuid, text, integer, integer, bytea) to authenticated;
grant execute on function public.remove_my_signature(uuid) to authenticated;
