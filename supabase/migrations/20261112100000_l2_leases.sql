-- Lot 2 : baux, colocataires avec périodes de présence, conditions de loyer.
-- Un bien n'a qu'un bail à la fois ; un colocataire ne peut pas être présent deux fois en même temps.
-- Les échéances (et le rattrapage d'un bail ancien) arrivent avec le Lot 3.

create extension if not exists btree_gist with schema extensions;

create table public.leases (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  property_id uuid not null,
  start_date date not null,
  end_date date,
  due_day integer not null check (due_day between 1 and 31),
  proration_rule text not null default 'actual_days' check (proration_rule in ('actual_days')),
  deposit_cents integer check (deposit_cents >= 0),
  deposit_received_on date,
  external_ref text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  unique (entity_id, id),
  foreign key (entity_id, property_id) references public.properties (entity_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id),
  -- Pas de chevauchement de baux sur un même bien (bornes incluses).
  constraint leases_no_overlap exclude using gist (
    property_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  )
);

create unique index leases_external_ref_key on public.leases (entity_id, external_ref) where external_ref is not null;
create index leases_property_idx on public.leases (property_id, start_date desc);
create index leases_entity_idx on public.leases (entity_id);

create trigger leases_set_updated_at
  before update on public.leases
  for each row execute function app.set_updated_at();

alter table public.leases enable row level security;

-- Colocataires : (bail, dossier) avec période de présence ; un colocataire entre ou sort sans nouveau bail.
create table public.lease_tenants (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  lease_id uuid not null,
  tenant_id uuid not null,
  start_date date not null,
  end_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or end_date >= start_date),
  foreign key (entity_id, lease_id) references public.leases (entity_id, id),
  foreign key (entity_id, tenant_id) references public.tenants (entity_id, id),
  constraint lease_tenants_no_overlap exclude using gist (
    lease_id with =,
    tenant_id with =,
    daterange(start_date, coalesce(end_date, 'infinity'::date), '[]') with &&
  )
);

create index lease_tenants_lease_idx on public.lease_tenants (lease_id);
create index lease_tenants_tenant_idx on public.lease_tenants (tenant_id);

create trigger lease_tenants_set_updated_at
  before update on public.lease_tenants
  for each row execute function app.set_updated_at();

alter table public.lease_tenants enable row level security;

-- Conditions de loyer : une version par date d'effet, sans date de fin (la fin est la date d'effet de la suivante).
create table public.rental_terms (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  lease_id uuid not null,
  effective_from date not null,
  rent_cents integer not null check (rent_cents >= 0),
  charges_cents integer not null check (charges_cents >= 0),
  reason text,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lease_id, effective_from),
  unique (entity_id, id),
  foreign key (entity_id, lease_id) references public.leases (entity_id, id)
);

create trigger rental_terms_set_updated_at
  before update on public.rental_terms
  for each row execute function app.set_updated_at();

alter table public.rental_terms enable row level security;

----------------------------------------------------------------------------------------------------
-- Cohérence des dates
----------------------------------------------------------------------------------------------------

-- Une présence reste dans la période du bail ; une version de conditions ne précède pas le début du bail.
create function app.check_lease_dates()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_lease record;
begin
  if tg_table_name = 'leases' then
    if exists (
      select 1 from public.lease_tenants t
      where t.lease_id = new.id and (t.start_date < new.start_date or (new.end_date is not null and (t.end_date is null or t.end_date > new.end_date)))
    ) then
      raise exception 'Une présence de colocataire dépasse les nouvelles dates du bail';
    end if;
    if exists (select 1 from public.rental_terms r where r.lease_id = new.id and r.effective_from < new.start_date) then
      raise exception 'Une version des conditions de loyer précède le début du bail';
    end if;
    return new;
  end if;

  select * into v_lease from public.leases where id = new.lease_id;
  if tg_table_name = 'lease_tenants' then
    if new.start_date < v_lease.start_date or (v_lease.end_date is not null and (new.end_date is null or new.end_date > v_lease.end_date)) then
      raise exception 'La présence du colocataire doit rester dans la période du bail';
    end if;
  elsif new.effective_from < v_lease.start_date or (v_lease.end_date is not null and new.effective_from > v_lease.end_date) then
    raise exception 'La date d''effet doit être comprise dans la période du bail';
  end if;
  return new;
end;
$$;

create trigger leases_check_dates
  before update of start_date, end_date on public.leases
  for each row execute function app.check_lease_dates();

create trigger lease_tenants_check_dates
  before insert or update of start_date, end_date on public.lease_tenants
  for each row execute function app.check_lease_dates();

create trigger rental_terms_check_dates
  before insert or update of effective_from on public.rental_terms
  for each row execute function app.check_lease_dates();

----------------------------------------------------------------------------------------------------
-- Création d'un bail en une transaction : bail, première version des conditions, colocataires présents dès le début
----------------------------------------------------------------------------------------------------

create function public.create_lease(
  p_entity_id uuid,
  p_property_id uuid,
  p_start_date date,
  p_end_date date,
  p_due_day integer,
  p_rent_cents integer,
  p_charges_cents integer,
  p_tenant_ids uuid[],
  p_deposit_cents integer default null,
  p_deposit_received_on date default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lease uuid;
  v_tenant uuid;
begin
  if not app.has_permission(p_entity_id, 'lease:write') then
    raise exception 'Droit insuffisant pour créer un bail' using errcode = 'insufficient_privilege';
  end if;
  if coalesce(array_length(p_tenant_ids, 1), 0) = 0 then
    raise exception 'Un bail a au moins un locataire';
  end if;

  insert into public.leases (entity_id, property_id, start_date, end_date, due_day, deposit_cents, deposit_received_on)
  values (p_entity_id, p_property_id, p_start_date, p_end_date, p_due_day, p_deposit_cents, p_deposit_received_on)
  returning id into v_lease;

  insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents, reason)
  values (p_entity_id, v_lease, p_start_date, p_rent_cents, p_charges_cents, 'Conditions initiales');

  for v_tenant in select distinct unnest(p_tenant_ids) loop
    insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date)
    values (p_entity_id, v_lease, v_tenant, p_start_date, p_end_date);
  end loop;

  return v_lease;
end;
$$;

-- Fin d'un bail : ferme aussi les présences encore ouvertes ou postérieures à la date de fin.
create function public.end_lease(p_lease_id uuid, p_end_date date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_lease public.leases%rowtype;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if v_lease.id is null or not app.has_permission(v_lease.entity_id, 'lease:write') then
    raise exception 'Droit insuffisant pour modifier ce bail' using errcode = 'insufficient_privilege';
  end if;
  if p_end_date < v_lease.start_date then
    raise exception 'La date de fin précède le début du bail';
  end if;

  update public.lease_tenants
  set end_date = p_end_date
  where lease_id = p_lease_id and (end_date is null or end_date > p_end_date);

  update public.leases set end_date = p_end_date where id = p_lease_id;
end;
$$;

----------------------------------------------------------------------------------------------------
-- Journal d'audit
----------------------------------------------------------------------------------------------------

create function app.audit_lease()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'leases' then
    if tg_op = 'INSERT' then
      perform app.write_audit(new.entity_id, 'lease.created', 'leases', new.id,
        jsonb_build_object('property_id', new.property_id, 'start_date', new.start_date, 'end_date', new.end_date, 'due_day', new.due_day));
    elsif new.end_date is distinct from old.end_date then
      perform app.write_audit(new.entity_id, 'lease.end_date_changed', 'leases', new.id,
        jsonb_build_object('from', old.end_date, 'to', new.end_date));
    end if;
  elsif tg_table_name = 'rental_terms' then
    if tg_op = 'INSERT' then
      perform app.write_audit(new.entity_id, 'lease.terms_added', 'rental_terms', new.id,
        jsonb_build_object('lease_id', new.lease_id, 'effective_from', new.effective_from, 'rent_cents', new.rent_cents, 'charges_cents', new.charges_cents));
    else
      perform app.write_audit(new.entity_id, 'lease.terms_changed', 'rental_terms', new.id,
        jsonb_build_object('lease_id', new.lease_id,
          'from', jsonb_build_object('rent_cents', old.rent_cents, 'charges_cents', old.charges_cents),
          'to', jsonb_build_object('rent_cents', new.rent_cents, 'charges_cents', new.charges_cents)));
    end if;
  else
    if tg_op = 'INSERT' then
      perform app.write_audit(new.entity_id, 'lease.tenant_added', 'lease_tenants', new.id,
        jsonb_build_object('lease_id', new.lease_id, 'tenant_id', new.tenant_id, 'start_date', new.start_date));
    elsif new.end_date is distinct from old.end_date or new.start_date is distinct from old.start_date then
      perform app.write_audit(new.entity_id, 'lease.tenant_presence_changed', 'lease_tenants', new.id,
        jsonb_build_object('lease_id', new.lease_id, 'tenant_id', new.tenant_id, 'start_date', new.start_date, 'end_date', new.end_date));
    end if;
  end if;
  return new;
end;
$$;

create trigger leases_audit after insert or update on public.leases for each row execute function app.audit_lease();
create trigger rental_terms_audit after insert or update on public.rental_terms for each row execute function app.audit_lease();
create trigger lease_tenants_audit after insert or update on public.lease_tenants for each row execute function app.audit_lease();

----------------------------------------------------------------------------------------------------
-- Politiques RLS : lecture avec lease:read, écriture avec lease:write, aucune suppression
----------------------------------------------------------------------------------------------------

create policy leases_select on public.leases for select to authenticated using (app.has_permission(entity_id, 'lease:read'));
create policy leases_insert on public.leases for insert to authenticated with check (app.has_permission(entity_id, 'lease:write'));
create policy leases_update on public.leases for update to authenticated
  using (app.has_permission(entity_id, 'lease:write')) with check (app.has_permission(entity_id, 'lease:write'));

create policy lease_tenants_select on public.lease_tenants for select to authenticated using (app.has_permission(entity_id, 'lease:read'));
create policy lease_tenants_insert on public.lease_tenants for insert to authenticated with check (app.has_permission(entity_id, 'lease:write'));
create policy lease_tenants_update on public.lease_tenants for update to authenticated
  using (app.has_permission(entity_id, 'lease:write')) with check (app.has_permission(entity_id, 'lease:write'));

create policy rental_terms_select on public.rental_terms for select to authenticated using (app.has_permission(entity_id, 'lease:read'));
create policy rental_terms_insert on public.rental_terms for insert to authenticated with check (app.has_permission(entity_id, 'lease:write'));
create policy rental_terms_update on public.rental_terms for update to authenticated
  using (app.has_permission(entity_id, 'lease:write')) with check (app.has_permission(entity_id, 'lease:write'));

revoke all on public.leases, public.lease_tenants, public.rental_terms from public, anon, authenticated, service_role;
grant select, insert, update on public.leases, public.lease_tenants, public.rental_terms to authenticated, service_role;

revoke all on function app.check_lease_dates() from public, anon, authenticated, service_role;
revoke all on function app.audit_lease() from public, anon, authenticated, service_role;
revoke all on function public.create_lease(uuid, uuid, date, date, integer, integer, integer, uuid[], integer, date) from public, anon;
grant execute on function public.create_lease(uuid, uuid, date, date, integer, integer, integer, uuid[], integer, date) to authenticated;
revoke all on function public.end_lease(uuid, date) from public, anon;
grant execute on function public.end_lease(uuid, date) to authenticated;
