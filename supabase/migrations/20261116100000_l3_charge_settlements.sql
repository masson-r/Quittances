-- Lot 3 : apurement des charges. Saisie manuelle du remboursement (ou du complément reçu) à la fin d'une période de charges.
-- Montant signé : positif = remboursement versé au locataire (sortie), négatif = complément reçu du locataire (entrée).
-- Aucun effet sur les échéances, les soldes ni les quittances. Un apurement final (éventuellement nul) est obligatoire à la fin du bail.
--
-- document_id recevra sa clé étrangère vers documents avec la migration expenses (Lot 5).

create table public.charge_settlements (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  lease_id uuid not null,
  kind text not null default 'charges_adjustment' check (kind in ('charges_adjustment', 'unallocated_refund')),
  settled_on date not null,
  amount_cents integer not null,
  mode text not null check (mode in ('transfer', 'cheque', 'cash', 'other')),
  reason text not null check (length(btrim(reason)) > 0),
  period_start date,
  period_end date,
  payment_id uuid,
  is_final boolean not null default false,
  reference text,
  comment text,
  document_id uuid,
  created_by uuid references public.profiles (id) default auth.uid(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancellation_reason text,
  external_ref text,
  import_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((period_start is null) = (period_end is null)),
  check (period_end is null or period_end >= period_start),
  check ((cancelled_at is null) = (cancellation_reason is null)),
  -- Le zéro n'est permis que pour l'apurement final.
  check (amount_cents <> 0 or is_final),
  -- Remboursement du non affecté : toujours positif et adossé à un paiement ; ajustement de charges : sans paiement.
  check (
    (kind = 'unallocated_refund' and amount_cents > 0 and payment_id is not null and not is_final)
    or (kind = 'charges_adjustment' and payment_id is null)
  ),
  unique (entity_id, id),
  foreign key (entity_id, lease_id) references public.leases (entity_id, id),
  foreign key (entity_id, lease_id, payment_id) references public.payments (entity_id, lease_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id)
);

-- Au plus un apurement final non annulé par bail.
create unique index charge_settlements_one_final_per_lease on public.charge_settlements (lease_id) where is_final and cancelled_at is null;
create unique index charge_settlements_external_ref_key on public.charge_settlements (entity_id, external_ref) where external_ref is not null;
create index charge_settlements_lease_idx on public.charge_settlements (lease_id, settled_on desc);
create index charge_settlements_payment_idx on public.charge_settlements (payment_id) where payment_id is not null and cancelled_at is null;

create trigger charge_settlements_set_updated_at
  before update on public.charge_settlements
  for each row execute function app.set_updated_at();

alter table public.charge_settlements enable row level security;

create trigger charge_settlements_no_delete
  before delete on public.charge_settlements
  for each row execute function app.refuse_delete();

-- Colonnes modifiables : mode, date, référence, commentaire, justificatif et annulation. Le montant se corrige par annulation puis nouvelle saisie.
create function app.guard_settlement_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.entity_id is distinct from old.entity_id or new.lease_id is distinct from old.lease_id or new.kind is distinct from old.kind
     or new.amount_cents <> old.amount_cents or new.payment_id is distinct from old.payment_id or new.is_final <> old.is_final
     or new.reason <> old.reason or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
     or new.created_by is distinct from old.created_by or new.external_ref is distinct from old.external_ref or new.import_batch_id is distinct from old.import_batch_id then
    raise exception 'Le montant et la nature d''un apurement ne se modifient pas : annulez puis saisissez à nouveau';
  end if;
  if old.cancelled_at is not null and (new.cancelled_at is distinct from old.cancelled_at or new.cancellation_reason is distinct from old.cancellation_reason) then
    raise exception 'Un apurement annulé ne se modifie plus';
  end if;
  if new.settled_on > public.app_today() then
    raise exception 'La date d''un apurement ne peut pas être dans le futur';
  end if;
  return new;
end;
$$;

create trigger charge_settlements_guard_update
  before update on public.charge_settlements
  for each row execute function app.guard_settlement_update();

-- Invariants à l'insertion : date non future ; un remboursement du non affecté ne dépasse pas le reste non affecté du paiement.
create function app.check_settlement_invariants()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  if new.cancelled_at is not null then
    return new;
  end if;
  if tg_op = 'INSERT' and new.external_ref is null and new.settled_on > public.app_today() then
    raise exception 'La date d''un apurement ne peut pas être dans le futur';
  end if;

  if new.kind = 'unallocated_refund' then
    select * into v_payment from public.payments where id = new.payment_id for update;
    if v_payment.cancelled_at is not null then
      raise exception 'Impossible de rembourser un paiement annulé';
    end if;
    if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a where a.payment_id = new.payment_id and a.reversed_at is null)
       + (select coalesce(sum(s.amount_cents), 0) from public.charge_settlements s where s.payment_id = new.payment_id and s.cancelled_at is null)
       > v_payment.amount_cents then
      raise exception 'Le remboursement dépasse le montant non affecté du paiement';
    end if;
  end if;
  return new;
end;
$$;

create trigger charge_settlements_invariants
  after insert on public.charge_settlements
  for each row execute function app.check_settlement_invariants();

-- Les affectations tiennent compte des remboursements du non affecté : ils réduisent d'autant « À affecter ».
create or replace function app.check_allocation_invariants()
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

  select * into v_payment from public.payments where id = new.payment_id for update;
  select * into v_charge from public.rent_charges where id = new.rent_charge_id for update;

  if v_payment.cancelled_at is not null then
    raise exception 'Impossible d''affecter un paiement annulé';
  end if;
  if v_charge.cancelled_at is not null then
    raise exception 'Impossible d''affecter une échéance annulée';
  end if;

  if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a where a.payment_id = new.payment_id and a.reversed_at is null)
     + (select coalesce(sum(s.amount_cents), 0) from public.charge_settlements s where s.payment_id = new.payment_id and s.cancelled_at is null)
     > v_payment.amount_cents then
    raise exception 'Les affectations dépassent le montant du paiement';
  end if;
  if (select coalesce(sum(a.amount_cents), 0) from public.payment_allocations a where a.rent_charge_id = new.rent_charge_id and a.reversed_at is null) > v_charge.total_cents then
    raise exception 'Les affectations dépassent le montant de l''échéance';
  end if;
  return new;
end;
$$;

-- Un paiement ne s'annule pas tant qu'un remboursement du non affecté en dépend.
create or replace function app.guard_payment_update()
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
  if old.cancelled_at is null and new.cancelled_at is not null then
    if exists (select 1 from public.payment_allocations a where a.payment_id = old.id and a.reversed_at is null) then
      raise exception 'Ce paiement a des affectations actives : retirez-les avant de l''annuler';
    end if;
    if exists (select 1 from public.charge_settlements s where s.payment_id = old.id and s.cancelled_at is null) then
      raise exception 'Ce paiement a un remboursement actif : annulez-le d''abord';
    end if;
  end if;
  return new;
end;
$$;

----------------------------------------------------------------------------------------------------
-- Fonctions : saisie, correction et annulation, avec audit
----------------------------------------------------------------------------------------------------

create function public.record_charge_settlement(
  p_lease_id uuid,
  p_kind text,
  p_settled_on date,
  p_amount_cents integer,
  p_mode text,
  p_reason text,
  p_period_start date default null,
  p_period_end date default null,
  p_payment_id uuid default null,
  p_is_final boolean default false,
  p_reference text default null,
  p_comment text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lease public.leases%rowtype;
  v_id uuid;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if v_lease.id is null or not app.has_permission(v_lease.entity_id, 'settlement:write') then
    raise exception 'Droit insuffisant pour saisir un apurement' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_cents is null then
    raise exception 'Le montant est obligatoire';
  end if;
  if p_amount_cents = 0 and not coalesce(p_is_final, false) then
    raise exception 'Un montant nul n''est permis que pour l''apurement final';
  end if;
  if p_settled_on is null or p_settled_on > public.app_today() then
    raise exception 'La date d''un apurement ne peut pas être dans le futur';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if coalesce(p_is_final, false) and exists (select 1 from public.charge_settlements s where s.lease_id = p_lease_id and s.is_final and s.cancelled_at is null) then
    raise exception 'Ce bail a déjà un apurement final : annulez-le avant d''en saisir un autre';
  end if;

  insert into public.charge_settlements (entity_id, lease_id, kind, settled_on, amount_cents, mode, reason, period_start, period_end, payment_id, is_final, reference, comment)
  values (v_lease.entity_id, p_lease_id, p_kind, p_settled_on, p_amount_cents, p_mode, btrim(p_reason), p_period_start, p_period_end, p_payment_id,
          coalesce(p_is_final, false), nullif(btrim(p_reference), ''), nullif(btrim(p_comment), ''))
  returning id into v_id;

  perform app.write_audit(v_lease.entity_id, 'charge_settlement.created', 'charge_settlements', v_id,
    jsonb_build_object('lease_id', p_lease_id, 'kind', p_kind, 'amount_cents', p_amount_cents, 'is_final', coalesce(p_is_final, false), 'settled_on', p_settled_on));
  return v_id;
end;
$$;

create function public.cancel_charge_settlement(p_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_row public.charge_settlements%rowtype;
begin
  select * into v_row from public.charge_settlements where id = p_id for update;
  if v_row.id is null or not app.has_permission(v_row.entity_id, 'settlement:cancel') then
    raise exception 'Droit insuffisant pour annuler cet apurement' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'Cet apurement est déjà annulé';
  end if;

  update public.charge_settlements
  set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason)
  where id = p_id;
  perform app.write_audit(v_row.entity_id, 'charge_settlement.cancelled', 'charge_settlements', p_id,
    jsonb_build_object('amount_cents', v_row.amount_cents, 'is_final', v_row.is_final, 'reason', btrim(p_reason)));
end;
$$;

create function public.update_charge_settlement_details(p_id uuid, p_settled_on date, p_mode text, p_reference text, p_comment text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.charge_settlements%rowtype;
  v_changed text[] := '{}';
  v_details jsonb := '{}'::jsonb;
begin
  select * into v_old from public.charge_settlements where id = p_id for update;
  if v_old.id is null or not app.has_permission(v_old.entity_id, 'settlement:write') then
    raise exception 'Droit insuffisant pour modifier cet apurement' using errcode = 'insufficient_privilege';
  end if;
  if p_mode not in ('transfer', 'cheque', 'cash', 'other') then
    raise exception 'Mode de paiement inconnu';
  end if;
  if p_settled_on > public.app_today() then
    raise exception 'La date d''un apurement ne peut pas être dans le futur';
  end if;

  if p_settled_on <> v_old.settled_on then
    v_changed := array_append(v_changed, 'settled_on'::text);
    v_details := v_details || jsonb_build_object('settled_on', jsonb_build_object('from', v_old.settled_on, 'to', p_settled_on));
  end if;
  if p_mode <> v_old.mode then
    v_changed := array_append(v_changed, 'mode'::text);
    v_details := v_details || jsonb_build_object('mode', jsonb_build_object('from', v_old.mode, 'to', p_mode));
  end if;
  if nullif(btrim(p_reference), '') is distinct from v_old.reference then v_changed := array_append(v_changed, 'reference'::text); end if;
  if nullif(btrim(p_comment), '') is distinct from v_old.comment then v_changed := array_append(v_changed, 'comment'::text); end if;
  if array_length(v_changed, 1) is null then
    return;
  end if;

  update public.charge_settlements
  set settled_on = p_settled_on, mode = p_mode, reference = nullif(btrim(p_reference), ''), comment = nullif(btrim(p_comment), '')
  where id = p_id;
  perform app.write_audit(v_old.entity_id, 'charge_settlement.modified', 'charge_settlements', p_id, v_details || jsonb_build_object('changed', to_jsonb(v_changed)));
end;
$$;

----------------------------------------------------------------------------------------------------
-- État de l'apurement final par bail (alerte « Apurement final à saisir ») et garde pour l'anonymisation
----------------------------------------------------------------------------------------------------

create view public.lease_settlement_status with (security_invoker = true) as
select
  l.id as lease_id,
  l.entity_id,
  l.end_date,
  exists (select 1 from public.charge_settlements s where s.lease_id = l.id and s.is_final and s.cancelled_at is null) as has_final,
  l.end_date is not null
    and l.end_date < public.app_today()
    and not exists (select 1 from public.charge_settlements s where s.lease_id = l.id and s.is_final and s.cancelled_at is null) as final_missing
from public.leases l;

-- Vrai si un bail terminé du dossier n'a pas d'apurement final : l'anonymisation du dossier est alors refusée (LR-02).
create function app.tenant_has_missing_final_settlement(p_tenant_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.lease_tenants lt
    join public.leases l on l.id = lt.lease_id
    where lt.tenant_id = p_tenant_id
      and l.end_date is not null
      and l.end_date < public.app_today()
      and not exists (select 1 from public.charge_settlements s where s.lease_id = l.id and s.is_final and s.cancelled_at is null)
  )
$$;

----------------------------------------------------------------------------------------------------
-- RLS et privilèges
----------------------------------------------------------------------------------------------------

create policy settlements_select on public.charge_settlements for select to authenticated using (app.has_permission(entity_id, 'settlement:read'));
create policy settlements_insert on public.charge_settlements for insert to authenticated
  with check (app.has_permission(entity_id, 'settlement:write') and created_by = auth.uid());
create policy settlements_update on public.charge_settlements for update to authenticated
  using (app.has_permission(entity_id, 'settlement:write')) with check (app.has_permission(entity_id, 'settlement:write'));

revoke all on public.charge_settlements, public.lease_settlement_status from public, anon, authenticated, service_role;
grant select, insert, update on public.charge_settlements to authenticated, service_role;
grant select on public.lease_settlement_status to authenticated, service_role;

revoke all on function app.guard_settlement_update() from public, anon, authenticated, service_role;
revoke all on function app.check_settlement_invariants() from public, anon, authenticated, service_role;
revoke all on function app.tenant_has_missing_final_settlement(uuid) from public, anon, authenticated;
grant execute on function app.tenant_has_missing_final_settlement(uuid) to service_role;

revoke all on function public.record_charge_settlement(uuid, text, date, integer, text, text, date, date, uuid, boolean, text, text) from public, anon;
revoke all on function public.cancel_charge_settlement(uuid, text) from public, anon;
revoke all on function public.update_charge_settlement_details(uuid, date, text, text, text) from public, anon;
grant execute on function public.record_charge_settlement(uuid, text, date, integer, text, text, date, date, uuid, boolean, text, text) to authenticated;
grant execute on function public.cancel_charge_settlement(uuid, text) to authenticated;
grant execute on function public.update_charge_settlement_details(uuid, date, text, text, text) to authenticated;
