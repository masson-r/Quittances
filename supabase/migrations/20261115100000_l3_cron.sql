-- Lot 3 : création automatique des échéances, à leur date d'échéance (date du jour à Paris), de façon idempotente.
-- Aucune génération à l'avance. Un bail saisi avec une date de début passée est rattrapé tout de suite.
-- Une échéance annulée n'est jamais recréée : la période a déjà une échéance, annulée par décision.

create extension if not exists pg_cron with schema pg_catalog;

-- Crée les échéances dont la date est atteinte, pour un bail ou pour tous. Renvoie le nombre d'échéances créées.
-- SECURITY DEFINER : exécutée par pg_cron (système) et par le rattrapage d'un bail créé par un utilisateur.
create function app.create_due_rent_charges(p_lease_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := public.app_today();
  v_lease record;
  v_month date;
  v_info record;
  v_id uuid;
  v_count integer := 0;
begin
  for v_lease in
    select l.id, l.entity_id, l.start_date, l.end_date
    from public.leases l
    where (p_lease_id is null or l.id = p_lease_id) and l.start_date <= v_today
  loop
    for v_month in
      select generate_series(
        date_trunc('month', v_lease.start_date)::date,
        date_trunc('month', least(coalesce(v_lease.end_date, v_today), v_today))::date,
        interval '1 month'
      )::date
    loop
      select * into v_info from app.rent_charge_amounts(v_lease.id, extract(year from v_month)::integer, extract(month from v_month)::integer);
      continue when v_info.term_id is null or v_info.occupied_days = 0 or v_info.due_on > v_today;
      continue when exists (select 1 from public.rent_charges c where c.lease_id = v_lease.id and c.period_start = v_info.period_start);

      insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents, term_id)
      values (v_lease.entity_id, v_lease.id, v_info.period_start, v_info.period_end, v_info.due_on, v_info.rent_cents, v_info.charges_cents, v_info.term_id)
      on conflict do nothing
      returning id into v_id;

      if v_id is not null then
        v_count := v_count + 1;
        perform app.write_audit(v_lease.entity_id, 'rent_charge.created', 'rent_charges', v_id,
          jsonb_build_object('lease_id', v_lease.id, 'period_start', v_info.period_start, 'due_on', v_info.due_on, 'total_cents', v_info.rent_cents + v_info.charges_cents));
      end if;
    end loop;
  end loop;
  return v_count;
end;
$$;

-- Rattrapage demandé par un utilisateur pour un bail qu'il a le droit de modifier.
create function public.catch_up_lease(p_lease_id uuid)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_entity uuid;
begin
  select entity_id into v_entity from public.leases where id = p_lease_id;
  if v_entity is null or not app.has_permission(v_entity, 'lease:write') then
    raise exception 'Droit insuffisant pour ce bail' using errcode = 'insufficient_privilege';
  end if;
  return app.create_due_rent_charges(p_lease_id);
end;
$$;

-- La création d'un bail rattrape aussitôt ses échéances échues.
create or replace function public.create_lease(
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

  perform app.create_due_rent_charges(v_lease);
  return v_lease;
end;
$$;

-- Une fin de bail ne peut pas précéder une échéance déjà créée : il faut d'abord l'annuler.
create or replace function public.end_lease(p_lease_id uuid, p_end_date date)
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
  if exists (select 1 from public.rent_charges c where c.lease_id = p_lease_id and c.cancelled_at is null and c.period_start > p_end_date) then
    raise exception 'La date de fin précède une échéance déjà créée : annulez d''abord cette échéance';
  end if;

  update public.lease_tenants
  set end_date = p_end_date
  where lease_id = p_lease_id and (end_date is null or end_date > p_end_date);

  update public.leases set end_date = p_end_date where id = p_lease_id;
end;
$$;

revoke all on function app.create_due_rent_charges(uuid) from public, anon, authenticated, service_role;
revoke all on function public.catch_up_lease(uuid) from public, anon;
grant execute on function app.create_due_rent_charges(uuid) to authenticated;
grant execute on function public.catch_up_lease(uuid) to authenticated;

-- Tâches quotidiennes (00 h 10 UTC, soit 01 h ou 02 h à Paris : toujours le jour de Paris à traiter). Idempotentes.
select cron.schedule('create-due-rent-charges', '10 0 * * *', 'select app.create_due_rent_charges()');
select cron.schedule('purge-audit-logs', '30 0 * * *', 'select app.purge_audit_logs()');
