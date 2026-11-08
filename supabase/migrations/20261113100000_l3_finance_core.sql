-- Lot 3 : cœur financier. Échéances, paiements, affectations, vue des soldes.
-- Montants en centimes. Soldes et statuts ne sont jamais stockés (ADR 0001) : la vue rent_charge_balances les calcule.
-- Les opérations qui écrivent plusieurs lignes sont des fonctions SQL (migration finance_functions, ADR 0003) ;
-- les triggers ci-dessous sont la dernière ligne de défense des invariants, y compris sous concurrence.

----------------------------------------------------------------------------------------------------
-- Échéances
----------------------------------------------------------------------------------------------------

create table public.rent_charges (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  lease_id uuid not null,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  rent_cents integer not null check (rent_cents >= 0),
  charges_cents integer not null check (charges_cents >= 0),
  total_cents integer generated always as (rent_cents + charges_cents) stored,
  term_id uuid,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancellation_reason text,
  external_ref text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end >= period_start),
  check ((cancelled_at is null) = (cancellation_reason is null)),
  unique (entity_id, id),
  unique (entity_id, lease_id, id),
  foreign key (entity_id, lease_id) references public.leases (entity_id, id),
  foreign key (entity_id, term_id) references public.rental_terms (entity_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id)
);

-- Une seule échéance non annulée par bail et par période.
create unique index rent_charges_one_active_per_period on public.rent_charges (lease_id, period_start) where cancelled_at is null;
create unique index rent_charges_external_ref_key on public.rent_charges (entity_id, external_ref) where external_ref is not null;
create index rent_charges_due_idx on public.rent_charges (entity_id, due_on);

create trigger rent_charges_set_updated_at
  before update on public.rent_charges
  for each row execute function app.set_updated_at();

alter table public.rent_charges enable row level security;

----------------------------------------------------------------------------------------------------
-- Paiements
----------------------------------------------------------------------------------------------------

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  lease_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  received_on date not null,
  mode text not null check (mode in ('transfer', 'cheque', 'cash', 'other')),
  reference text,
  comment text,
  created_by uuid references public.profiles (id) default auth.uid(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancellation_reason text,
  external_ref text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((cancelled_at is null) = (cancellation_reason is null)),
  unique (entity_id, id),
  unique (entity_id, lease_id, id),
  foreign key (entity_id, lease_id) references public.leases (entity_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id)
);

create unique index payments_external_ref_key on public.payments (entity_id, external_ref) where external_ref is not null;
create index payments_lease_idx on public.payments (lease_id, received_on desc);

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function app.set_updated_at();

alter table public.payments enable row level security;

----------------------------------------------------------------------------------------------------
-- Affectations : un paiement règle une ou plusieurs échéances du même bail
----------------------------------------------------------------------------------------------------

create table public.payment_allocations (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  lease_id uuid not null,
  payment_id uuid not null,
  rent_charge_id uuid not null,
  amount_cents integer not null check (amount_cents > 0),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.profiles (id),
  reversal_reason text,
  check ((reversed_at is null) = (reversal_reason is null)),
  -- Même structure et même bail pour le paiement et l'échéance, garantis par les clés composites.
  foreign key (entity_id, lease_id, payment_id) references public.payments (entity_id, lease_id, id),
  foreign key (entity_id, lease_id, rent_charge_id) references public.rent_charges (entity_id, lease_id, id)
);

create index payment_allocations_payment_idx on public.payment_allocations (payment_id) where reversed_at is null;
create index payment_allocations_charge_idx on public.payment_allocations (rent_charge_id) where reversed_at is null;

alter table public.payment_allocations enable row level security;

----------------------------------------------------------------------------------------------------
-- Immutabilité : aucune suppression (service_role compris), colonnes modifiables limitées
----------------------------------------------------------------------------------------------------

create function app.refuse_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% : suppression interdite, annulez plutôt', tg_table_name using errcode = 'insufficient_privilege';
end;
$$;

create trigger rent_charges_no_delete before delete on public.rent_charges for each row execute function app.refuse_delete();
create trigger payments_no_delete before delete on public.payments for each row execute function app.refuse_delete();
create trigger payment_allocations_no_delete before delete on public.payment_allocations for each row execute function app.refuse_delete();

-- Échéance : seuls les montants (recalcul, tant qu'aucune affectation active) et l'annulation se modifient.
create function app.guard_rent_charge_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_id is distinct from old.entity_id or new.lease_id is distinct from old.lease_id
     or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
     or new.due_on is distinct from old.due_on or new.term_id is distinct from old.term_id
     or new.external_ref is distinct from old.external_ref or new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'Seuls les montants et l''annulation d''une échéance peuvent changer';
  end if;
  if old.cancelled_at is not null and (new.cancelled_at is distinct from old.cancelled_at or new.rent_cents <> old.rent_cents or new.charges_cents <> old.charges_cents) then
    raise exception 'Une échéance annulée ne se modifie plus';
  end if;
  if (new.rent_cents <> old.rent_cents or new.charges_cents <> old.charges_cents or (old.cancelled_at is null and new.cancelled_at is not null))
     and exists (select 1 from public.payment_allocations a where a.rent_charge_id = old.id and a.reversed_at is null) then
    raise exception 'Cette échéance a des affectations actives : retirez-les avant de la recalculer ou de l''annuler';
  end if;
  return new;
end;
$$;

create trigger rent_charges_guard_update
  before update on public.rent_charges
  for each row execute function app.guard_rent_charge_update();

-- Paiement : référence, commentaire, mode, date de réception et annulation seulement.
create function app.guard_payment_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_id is distinct from old.entity_id or new.lease_id is distinct from old.lease_id
     or new.amount_cents <> old.amount_cents or new.created_by is distinct from old.created_by
     or new.external_ref is distinct from old.external_ref or new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'Le montant et le bail d''un paiement ne se modifient pas : annulez puis saisissez à nouveau';
  end if;
  if old.cancelled_at is not null and (new.cancelled_at is distinct from old.cancelled_at or new.cancellation_reason is distinct from old.cancellation_reason) then
    raise exception 'Un paiement annulé ne se modifie plus';
  end if;
  if old.cancelled_at is null and new.cancelled_at is not null
     and exists (select 1 from public.payment_allocations a where a.payment_id = old.id and a.reversed_at is null) then
    raise exception 'Ce paiement a des affectations actives : retirez-les avant de l''annuler';
  end if;
  return new;
end;
$$;

create trigger payments_guard_update
  before update on public.payments
  for each row execute function app.guard_payment_update();

-- Affectation : seule l'annulation (reversed_*) se modifie, une fois.
create function app.guard_allocation_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_id is distinct from old.entity_id or new.lease_id is distinct from old.lease_id or new.payment_id is distinct from old.payment_id
     or new.rent_charge_id is distinct from old.rent_charge_id or new.amount_cents <> old.amount_cents or new.created_by is distinct from old.created_by then
    raise exception 'Une affectation ne se modifie pas : retirez-la puis créez-en une autre';
  end if;
  if old.reversed_at is not null and (new.reversed_at is distinct from old.reversed_at or new.reversal_reason is distinct from old.reversal_reason) then
    raise exception 'Une affectation retirée ne se modifie plus';
  end if;
  return new;
end;
$$;

create trigger payment_allocations_guard_update
  before update on public.payment_allocations
  for each row execute function app.guard_allocation_update();

----------------------------------------------------------------------------------------------------
-- Invariants des affectations, sous concurrence : verrou sur le paiement et l'échéance, puis contrôle des sommes
----------------------------------------------------------------------------------------------------

create function app.check_allocation_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_charge public.rent_charges%rowtype;
begin
  if new.reversed_at is not null then
    return new;
  end if;

  -- Toujours dans le même ordre (paiement puis échéance) pour éviter les verrous croisés.
  select * into v_payment from public.payments where id = new.payment_id for update;
  select * into v_charge from public.rent_charges where id = new.rent_charge_id for update;

  if v_payment.cancelled_at is not null then
    raise exception 'Impossible d''affecter un paiement annulé';
  end if;
  if v_charge.cancelled_at is not null then
    raise exception 'Impossible d''affecter une échéance annulée';
  end if;

  if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a where a.payment_id = new.payment_id and a.reversed_at is null) > v_payment.amount_cents then
    raise exception 'Les affectations dépassent le montant du paiement';
  end if;
  if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a where a.rent_charge_id = new.rent_charge_id and a.reversed_at is null) > v_charge.total_cents then
    raise exception 'Les affectations dépassent le montant de l''échéance';
  end if;
  return new;
end;
$$;

create trigger payment_allocations_invariants
  after insert or update of amount_cents, reversed_at on public.payment_allocations
  for each row execute function app.check_allocation_invariants();

----------------------------------------------------------------------------------------------------
-- Vue des soldes et statuts (calculés, jamais stockés), sous les droits de l'utilisateur
----------------------------------------------------------------------------------------------------

create view public.rent_charge_balances with (security_invoker = true) as
select
  c.id,
  c.entity_id,
  c.lease_id,
  c.period_start,
  c.period_end,
  c.due_on,
  c.rent_cents,
  c.charges_cents,
  c.total_cents,
  c.cancelled_at,
  coalesce(a.paid_cents, 0)::integer as paid_cents,
  (c.total_cents - coalesce(a.paid_cents, 0))::integer as balance_cents,
  case
    when c.cancelled_at is not null then 'cancelled'
    when c.total_cents - coalesce(a.paid_cents, 0) = 0 then 'paid'
    when public.app_today() > c.due_on then 'late'
    when coalesce(a.paid_cents, 0) > 0 then 'partially_paid'
    else 'to_pay'
  end as status
from public.rent_charges c
left join lateral (
  select sum(pa.amount_cents) as paid_cents
  from public.payment_allocations pa
  where pa.rent_charge_id = c.id and pa.reversed_at is null
) a on true;

----------------------------------------------------------------------------------------------------
-- Politiques RLS
----------------------------------------------------------------------------------------------------

create policy rent_charges_select on public.rent_charges for select to authenticated using (app.has_permission(entity_id, 'rent_charge:read'));
create policy rent_charges_update on public.rent_charges for update to authenticated
  using (app.has_permission(entity_id, 'rent_charge:write')) with check (app.has_permission(entity_id, 'rent_charge:write'));

create policy payments_select on public.payments for select to authenticated using (app.has_permission(entity_id, 'payment:read'));
create policy payments_insert on public.payments for insert to authenticated
  with check (app.has_permission(entity_id, 'payment:write') and created_by = auth.uid());
create policy payments_update on public.payments for update to authenticated
  using (app.has_permission(entity_id, 'payment:write')) with check (app.has_permission(entity_id, 'payment:write'));

create policy allocations_select on public.payment_allocations for select to authenticated using (app.has_permission(entity_id, 'payment:read'));
create policy allocations_insert on public.payment_allocations for insert to authenticated
  with check (app.has_permission(entity_id, 'payment:write') and created_by = auth.uid());
create policy allocations_update on public.payment_allocations for update to authenticated
  using (app.has_permission(entity_id, 'payment:write')) with check (app.has_permission(entity_id, 'payment:write'));

revoke all on public.rent_charges, public.payments, public.payment_allocations, public.rent_charge_balances
  from public, anon, authenticated, service_role;

-- Les échéances sont créées par le système (pg_cron) ou par l'outil de l'opérateur : pas d'INSERT pour les utilisateurs.
grant select, update on public.rent_charges to authenticated;
grant select, insert, update on public.rent_charges to service_role;
grant select, insert, update on public.payments, public.payment_allocations to authenticated, service_role;
grant select on public.rent_charge_balances to authenticated, service_role;

revoke all on function app.refuse_delete() from public, anon, authenticated, service_role;
revoke all on function app.guard_rent_charge_update() from public, anon, authenticated, service_role;
revoke all on function app.guard_payment_update() from public, anon, authenticated, service_role;
revoke all on function app.guard_allocation_update() from public, anon, authenticated, service_role;
revoke all on function app.check_allocation_invariants() from public, anon, authenticated, service_role;
