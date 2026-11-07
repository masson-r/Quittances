-- Lot 2 : lots d'import, biens, notes de maintenance, codes d'accès, dossiers locataires et données privées.
-- Clés étrangères composites (entity_id, x_id) : aucun lien possible entre deux structures (ADR 0002).

----------------------------------------------------------------------------------------------------
-- Lots d'import (remplis par l'outil de l'opérateur au Lot R ; lecture réservée à l'administrateur)
----------------------------------------------------------------------------------------------------

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  imported_at timestamptz not null default now(),
  operator_label text not null default 'opérateur',
  files_sha256 text,
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  status text not null default 'imported' check (status in ('imported', 'cancelled')),
  cancelled_at timestamptz,
  unique (entity_id, id)
);

alter table public.import_batches enable row level security;

----------------------------------------------------------------------------------------------------
-- Biens
----------------------------------------------------------------------------------------------------

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  label text not null check (length(btrim(label)) > 0),
  address_line1 text not null default '',
  address_line2 text,
  postal_code text not null default '',
  city text not null default '',
  description text,
  archived_at timestamptz,
  external_ref text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id)
);

create unique index properties_external_ref_key on public.properties (entity_id, external_ref) where external_ref is not null;
create index properties_entity_idx on public.properties (entity_id);

create trigger properties_set_updated_at
  before update on public.properties
  for each row execute function app.set_updated_at();

alter table public.properties enable row level security;

-- Notes de maintenance : ajout seul (une correction est une nouvelle note), lisibles par le lecteur.
create table public.property_maintenance_notes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  property_id uuid not null,
  noted_on date not null default public.app_today(),
  author_id uuid references public.profiles (id) default auth.uid(),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  foreign key (entity_id, property_id) references public.properties (entity_id, id)
);

create index property_maintenance_notes_property_idx on public.property_maintenance_notes (property_id, noted_on desc);
alter table public.property_maintenance_notes enable row level security;

create function app.refuse_modification()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% est en ajout seul (% refusé)', tg_table_name, tg_op using errcode = 'insufficient_privilege';
end;
$$;

create trigger property_maintenance_notes_append_only
  before update or delete on public.property_maintenance_notes
  for each row execute function app.refuse_modification();

-- Codes d'accès : champ sensible (administrateur et gestionnaire).
create table public.property_access_codes (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  property_id uuid not null,
  label text not null check (length(btrim(label)) > 0),
  code text not null,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (entity_id, property_id) references public.properties (entity_id, id)
);

create index property_access_codes_property_idx on public.property_access_codes (property_id);

create trigger property_access_codes_set_updated_at
  before update on public.property_access_codes
  for each row execute function app.set_updated_at();

alter table public.property_access_codes enable row level security;

----------------------------------------------------------------------------------------------------
-- Dossiers locataires
----------------------------------------------------------------------------------------------------

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  last_name text not null check (length(btrim(last_name)) > 0),
  first_name text not null default '',
  email text,
  phone text,
  address_line1 text,
  postal_code text,
  city text,
  paper_delivery_requested boolean not null default false,
  archived_at timestamptz,
  anonymized_at timestamptz,
  external_ref text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id)
);

create unique index tenants_external_ref_key on public.tenants (entity_id, external_ref) where external_ref is not null;
create index tenants_entity_idx on public.tenants (entity_id);

create trigger tenants_set_updated_at
  before update on public.tenants
  for each row execute function app.set_updated_at();

alter table public.tenants enable row level security;

-- Données sensibles du dossier (date de naissance facultative, garant, aide au logement) : administrateur et gestionnaire.
create table public.tenant_private_details (
  tenant_id uuid primary key,
  entity_id uuid not null references public.ownership_entities (id),
  birth_date date,
  guarantor_kind text not null default 'none' check (guarantor_kind in ('none', 'person', 'visale', 'bank', 'other')),
  guarantor_name text,
  guarantor_contact text,
  housing_aid text not null default 'none' check (housing_aid in ('none', 'to_tenant', 'to_landlord')),
  note text,
  updated_at timestamptz not null default now(),
  foreign key (entity_id, tenant_id) references public.tenants (entity_id, id)
);

create trigger tenant_private_details_set_updated_at
  before update on public.tenant_private_details
  for each row execute function app.set_updated_at();

alter table public.tenant_private_details enable row level security;

-- Le dossier visé par une invitation de locataire appartient à la même structure.
alter table public.invitations
  add constraint invitations_tenant_fk foreign key (entity_id, tenant_id) references public.tenants (entity_id, id);

----------------------------------------------------------------------------------------------------
-- Journal d'audit (identifiants seulement, jamais de coordonnées ni de contenu sensible)
----------------------------------------------------------------------------------------------------

create function app.audit_archive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_kind text := case tg_table_name when 'properties' then 'property' else 'tenant' end;
begin
  if old.archived_at is null and new.archived_at is not null then
    perform app.write_audit(new.entity_id, v_kind || '.archived', tg_table_name, new.id);
  elsif old.archived_at is not null and new.archived_at is null then
    perform app.write_audit(new.entity_id, v_kind || '.restored', tg_table_name, new.id);
  end if;
  return new;
end;
$$;

create trigger properties_audit_archive
  after update of archived_at on public.properties
  for each row execute function app.audit_archive();

create trigger tenants_audit_archive
  after update of archived_at on public.tenants
  for each row execute function app.audit_archive();

-- Modification d'un champ sensible : on trace le fait, pas le contenu.
create function app.audit_sensitive()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_row record := case when tg_op = 'DELETE' then old else new end;
  v_subject uuid := coalesce(to_jsonb(v_row) ->> 'tenant_id', to_jsonb(v_row) ->> 'id')::uuid;
begin
  perform app.write_audit(
    v_row.entity_id,
    case tg_table_name when 'tenant_private_details' then 'tenant.private_details_changed' else 'property.access_code_changed' end,
    tg_table_name,
    v_subject,
    jsonb_build_object('operation', lower(tg_op))
  );
  return v_row;
end;
$$;

create trigger tenant_private_details_audit
  after insert or update or delete on public.tenant_private_details
  for each row execute function app.audit_sensitive();

create trigger property_access_codes_audit
  after insert or update or delete on public.property_access_codes
  for each row execute function app.audit_sensitive();

----------------------------------------------------------------------------------------------------
-- Politiques RLS
----------------------------------------------------------------------------------------------------

create policy import_batches_select on public.import_batches
  for select to authenticated using (app.has_permission(entity_id, 'audit:read'));

create policy properties_select on public.properties
  for select to authenticated using (app.has_permission(entity_id, 'property:read'));
create policy properties_insert on public.properties
  for insert to authenticated with check (app.has_permission(entity_id, 'property:write'));
create policy properties_update on public.properties
  for update to authenticated
  using (app.has_permission(entity_id, 'property:write'))
  with check (app.has_permission(entity_id, 'property:write'));

create policy notes_select on public.property_maintenance_notes
  for select to authenticated using (app.has_permission(entity_id, 'property:read'));
create policy notes_insert on public.property_maintenance_notes
  for insert to authenticated
  with check (app.has_permission(entity_id, 'property:write') and author_id = auth.uid());

create policy access_codes_select on public.property_access_codes
  for select to authenticated using (app.has_permission(entity_id, 'sensitive:read'));
create policy access_codes_insert on public.property_access_codes
  for insert to authenticated with check (app.has_permission(entity_id, 'sensitive:write'));
create policy access_codes_update on public.property_access_codes
  for update to authenticated
  using (app.has_permission(entity_id, 'sensitive:write'))
  with check (app.has_permission(entity_id, 'sensitive:write'));
create policy access_codes_delete on public.property_access_codes
  for delete to authenticated using (app.has_permission(entity_id, 'sensitive:write'));

create policy tenants_select on public.tenants
  for select to authenticated using (app.has_permission(entity_id, 'tenant:read'));
create policy tenants_insert on public.tenants
  for insert to authenticated with check (app.has_permission(entity_id, 'tenant:write'));
create policy tenants_update on public.tenants
  for update to authenticated
  using (app.has_permission(entity_id, 'tenant:write'))
  with check (app.has_permission(entity_id, 'tenant:write'));

create policy private_details_select on public.tenant_private_details
  for select to authenticated using (app.has_permission(entity_id, 'sensitive:read'));
create policy private_details_insert on public.tenant_private_details
  for insert to authenticated with check (app.has_permission(entity_id, 'sensitive:write'));
create policy private_details_update on public.tenant_private_details
  for update to authenticated
  using (app.has_permission(entity_id, 'sensitive:write'))
  with check (app.has_permission(entity_id, 'sensitive:write'));

----------------------------------------------------------------------------------------------------
-- Privilèges
----------------------------------------------------------------------------------------------------

revoke all on public.import_batches, public.properties, public.property_maintenance_notes, public.property_access_codes,
              public.tenants, public.tenant_private_details
  from public, anon, authenticated, service_role;

grant select on public.import_batches to authenticated;
grant select, insert, update on public.import_batches to service_role;

grant select, insert, update on public.properties, public.tenants to authenticated, service_role;
grant select, insert on public.property_maintenance_notes to authenticated, service_role;
grant select, insert, update, delete on public.property_access_codes to authenticated;
grant select, insert, update on public.property_access_codes to service_role;
grant select, insert, update on public.tenant_private_details to authenticated, service_role;

revoke all on function app.refuse_modification() from public, anon, authenticated, service_role;
revoke all on function app.audit_archive() from public, anon, authenticated, service_role;
revoke all on function app.audit_sensitive() from public, anon, authenticated, service_role;
