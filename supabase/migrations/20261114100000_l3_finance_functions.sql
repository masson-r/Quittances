-- Lot 3 : opérations financières. Chaque opération qui écrit plusieurs lignes est une fonction SQL transactionnelle,
-- exécutée sous les droits de l'utilisateur (donc sous la RLS), qui verrouille puis trace dans audit_logs (ADR 0003).
-- Les invariants de somme restent garantis en dernier recours par les triggers de finance_core.
--
-- À mettre à jour avec les quittances (Lot 4) : retrait, déplacement et annulation sont refusés tant qu'une
-- quittance émise dépend de l'échéance.

----------------------------------------------------------------------------------------------------
-- Calcul d'une échéance à partir du bail et des conditions de loyer (mêmes règles que src/domains/finance/rules.ts)
----------------------------------------------------------------------------------------------------

create function app.rent_charge_amounts(p_lease_id uuid, p_year integer, p_month integer)
returns table (
  period_start date,
  period_end date,
  due_on date,
  rent_cents integer,
  charges_cents integer,
  term_id uuid,
  occupied_days integer,
  days_in_month integer
)
language plpgsql
stable
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_lease public.leases%rowtype;
  v_first date := make_date(p_year, p_month, 1);
  v_last date := (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date;
  v_dim integer := extract(day from (make_date(p_year, p_month, 1) + interval '1 month - 1 day'))::integer;
  v_from date;
  v_to date;
  v_occ integer;
  v_nominal date;
  v_due date;
  v_term public.rental_terms%rowtype;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if v_lease.id is null then
    return;
  end if;

  v_from := greatest(v_lease.start_date, v_first);
  v_to := least(coalesce(v_lease.end_date, v_last), v_last);
  v_occ := case when v_from > v_to then 0 else (v_to - v_from) + 1 end;

  v_nominal := make_date(p_year, p_month, least(v_lease.due_day, v_dim));
  v_due := case
    when v_nominal < v_lease.start_date then v_lease.start_date
    when v_lease.end_date is not null and v_nominal > v_lease.end_date then v_lease.end_date
    else v_nominal
  end;

  -- Version applicable : la plus récente dont la date d'effet n'est pas postérieure au début de la période
  -- (le début du bail compte pour la première période).
  select * into v_term
  from public.rental_terms t
  where t.lease_id = p_lease_id and t.effective_from <= greatest(v_first, v_lease.start_date)
  order by t.effective_from desc
  limit 1;

  if v_term.id is null then
    return;
  end if;

  return query select
    v_first,
    v_last,
    v_due,
    ((2::bigint * v_term.rent_cents * v_occ + v_dim) / (2::bigint * v_dim))::integer,
    ((2::bigint * v_term.charges_cents * v_occ + v_dim) / (2::bigint * v_dim))::integer,
    v_term.id,
    v_occ,
    v_dim;
end;
$$;

----------------------------------------------------------------------------------------------------
-- Paiements et affectations
----------------------------------------------------------------------------------------------------

-- Ajoute des affectations [{ "rent_charge_id": …, "amount_cents": … }] à un paiement existant (fonction interne).
create function app.add_allocations(p_payment_id uuid, p_allocations jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_item jsonb;
  v_charge public.rent_charges%rowtype;
  v_amount integer;
  v_count integer := 0;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'Les affectations doivent former une liste';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) loop
    v_amount := (v_item ->> 'amount_cents')::integer;
    select * into v_charge from public.rent_charges where id = (v_item ->> 'rent_charge_id')::uuid;
    if v_charge.id is null or v_charge.lease_id <> v_payment.lease_id then
      raise exception 'Échéance introuvable pour ce bail';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'Chaque affectation doit avoir un montant positif';
    end if;

    insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents)
    values (v_payment.entity_id, v_payment.lease_id, v_payment.id, v_charge.id, v_amount);
    perform app.write_audit(v_payment.entity_id, 'allocation.created', 'payments', v_payment.id,
      jsonb_build_object('rent_charge_id', v_charge.id, 'amount_cents', v_amount));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Saisie d'un paiement avec ses affectations, en une transaction. Le reste du paiement demeure non affecté.
create function public.record_payment(
  p_lease_id uuid,
  p_amount_cents integer,
  p_received_on date,
  p_mode text,
  p_reference text default null,
  p_comment text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_confirm_cash boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lease public.leases%rowtype;
  v_payment uuid;
begin
  select * into v_lease from public.leases where id = p_lease_id;
  if v_lease.id is null or not app.has_permission(v_lease.entity_id, 'payment:write') then
    raise exception 'Droit insuffisant pour saisir un paiement' using errcode = 'insufficient_privilege';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'Le montant du paiement doit être positif';
  end if;
  if p_mode is null or p_mode not in ('transfer', 'cheque', 'cash', 'other') then
    raise exception 'Mode de paiement inconnu';
  end if;
  if p_received_on is null or p_received_on > public.app_today() then
    raise exception 'La date de réception ne peut pas être dans le futur';
  end if;
  if p_mode = 'cash' and p_amount_cents >= 100000 and not coalesce(p_confirm_cash, false) then
    raise exception 'Confirmation requise : paiement en espèces de 1 000 € ou plus';
  end if;

  insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode, reference, comment)
  values (v_lease.entity_id, p_lease_id, p_amount_cents, p_received_on, p_mode, nullif(btrim(p_reference), ''), nullif(btrim(p_comment), ''))
  returning id into v_payment;

  perform app.write_audit(v_lease.entity_id, 'payment.created', 'payments', v_payment,
    jsonb_build_object('lease_id', p_lease_id, 'amount_cents', p_amount_cents, 'mode', p_mode, 'received_on', p_received_on));
  if p_mode = 'cash' and p_amount_cents >= 100000 then
    perform app.write_audit(v_lease.entity_id, 'payment.cash_warning_confirmed', 'payments', v_payment,
      jsonb_build_object('amount_cents', p_amount_cents));
  end if;

  perform app.add_allocations(v_payment, p_allocations);
  return v_payment;
end;
$$;

-- Affecte (ou complète l'affectation d') un paiement déjà saisi, par exemple un paiement en avance une fois l'échéance créée.
create function public.allocate_payment(p_payment_id uuid, p_allocations jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
begin
  select * into v_payment from public.payments where id = p_payment_id;
  if v_payment.id is null or not app.has_permission(v_payment.entity_id, 'payment:write') then
    raise exception 'Droit insuffisant pour affecter ce paiement' using errcode = 'insufficient_privilege';
  end if;
  return app.add_allocations(p_payment_id, p_allocations);
end;
$$;

-- Retire une affectation (motif obligatoire), sans annuler le paiement.
create function public.reverse_allocation(p_allocation_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_alloc public.payment_allocations%rowtype;
begin
  select * into v_alloc from public.payment_allocations where id = p_allocation_id for update;
  if v_alloc.id is null or not app.has_permission(v_alloc.entity_id, 'payment:write') then
    raise exception 'Droit insuffisant pour retirer cette affectation' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if v_alloc.reversed_at is not null then
    raise exception 'Cette affectation est déjà retirée';
  end if;

  update public.payment_allocations
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
  where id = p_allocation_id;
  perform app.write_audit(v_alloc.entity_id, 'allocation.reversed', 'payments', v_alloc.payment_id,
    jsonb_build_object('rent_charge_id', v_alloc.rent_charge_id, 'amount_cents', v_alloc.amount_cents, 'reason', btrim(p_reason)));
end;
$$;

-- Déplace une affectation vers une autre échéance du même bail, d'un seul tenant.
create function public.move_allocation(p_allocation_id uuid, p_new_charge_id uuid, p_reason text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_alloc public.payment_allocations%rowtype;
  v_new uuid;
begin
  select * into v_alloc from public.payment_allocations where id = p_allocation_id for update;
  if v_alloc.id is null or not app.has_permission(v_alloc.entity_id, 'payment:write') then
    raise exception 'Droit insuffisant pour déplacer cette affectation' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if v_alloc.reversed_at is not null then
    raise exception 'Cette affectation est déjà retirée';
  end if;
  if v_alloc.rent_charge_id = p_new_charge_id then
    raise exception 'L''échéance de destination est la même';
  end if;
  if not exists (select 1 from public.rent_charges c where c.id = p_new_charge_id and c.lease_id = v_alloc.lease_id) then
    raise exception 'Échéance introuvable pour ce bail';
  end if;

  update public.payment_allocations
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = btrim(p_reason)
  where id = p_allocation_id;

  insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents)
  values (v_alloc.entity_id, v_alloc.lease_id, v_alloc.payment_id, p_new_charge_id, v_alloc.amount_cents)
  returning id into v_new;

  perform app.write_audit(v_alloc.entity_id, 'allocation.moved', 'payments', v_alloc.payment_id,
    jsonb_build_object('from_rent_charge_id', v_alloc.rent_charge_id, 'to_rent_charge_id', p_new_charge_id, 'amount_cents', v_alloc.amount_cents, 'reason', btrim(p_reason)));
  return v_new;
end;
$$;

-- Annule un paiement : motif conservé, affectations retirées, soldes restaurés.
create function public.cancel_payment(p_payment_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_payment public.payments%rowtype;
  v_reversed integer;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if v_payment.id is null or not app.has_permission(v_payment.entity_id, 'payment:cancel') then
    raise exception 'Droit insuffisant pour annuler ce paiement' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if v_payment.cancelled_at is not null then
    raise exception 'Ce paiement est déjà annulé';
  end if;

  update public.payment_allocations
  set reversed_at = now(), reversed_by = auth.uid(), reversal_reason = 'Paiement annulé : ' || btrim(p_reason)
  where payment_id = p_payment_id and reversed_at is null;
  get diagnostics v_reversed = row_count;

  update public.payments
  set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason)
  where id = p_payment_id;

  perform app.write_audit(v_payment.entity_id, 'payment.cancelled', 'payments', p_payment_id,
    jsonb_build_object('amount_cents', v_payment.amount_cents, 'reversed_allocations', v_reversed, 'reason', btrim(p_reason)));
end;
$$;

-- Correction en place de la référence, du commentaire, du mode et de la date de réception ; trace des champs modifiés.
create function public.update_payment_details(p_payment_id uuid, p_reference text, p_comment text, p_mode text, p_received_on date)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old public.payments%rowtype;
  v_changed text[] := '{}';
  v_details jsonb := '{}'::jsonb;
begin
  select * into v_old from public.payments where id = p_payment_id for update;
  if v_old.id is null or not app.has_permission(v_old.entity_id, 'payment:write') then
    raise exception 'Droit insuffisant pour modifier ce paiement' using errcode = 'insufficient_privilege';
  end if;
  if p_mode not in ('transfer', 'cheque', 'cash', 'other') then
    raise exception 'Mode de paiement inconnu';
  end if;
  if p_received_on > public.app_today() then
    raise exception 'La date de réception ne peut pas être dans le futur';
  end if;

  if nullif(btrim(p_reference), '') is distinct from v_old.reference then v_changed := array_append(v_changed, 'reference'::text); end if;
  if nullif(btrim(p_comment), '') is distinct from v_old.comment then v_changed := array_append(v_changed, 'comment'::text); end if;
  if p_mode <> v_old.mode then
    v_changed := array_append(v_changed, 'mode'::text);
    v_details := v_details || jsonb_build_object('mode', jsonb_build_object('from', v_old.mode, 'to', p_mode));
  end if;
  if p_received_on <> v_old.received_on then
    v_changed := array_append(v_changed, 'received_on'::text);
    v_details := v_details || jsonb_build_object('received_on', jsonb_build_object('from', v_old.received_on, 'to', p_received_on));
  end if;

  if array_length(v_changed, 1) is null then
    return;
  end if;

  update public.payments
  set reference = nullif(btrim(p_reference), ''), comment = nullif(btrim(p_comment), ''), mode = p_mode, received_on = p_received_on
  where id = p_payment_id;
  perform app.write_audit(v_old.entity_id, 'payment.updated', 'payments', p_payment_id, v_details || jsonb_build_object('changed', to_jsonb(v_changed)));
end;
$$;

----------------------------------------------------------------------------------------------------
-- Échéances : recalcul et annulation (seulement sans affectation active)
----------------------------------------------------------------------------------------------------

create function public.recalc_rent_charge(p_charge_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_charge public.rent_charges%rowtype;
  v_new record;
begin
  select * into v_charge from public.rent_charges where id = p_charge_id for update;
  if v_charge.id is null or not app.has_permission(v_charge.entity_id, 'rent_charge:write') then
    raise exception 'Droit insuffisant pour recalculer cette échéance' using errcode = 'insufficient_privilege';
  end if;
  if v_charge.cancelled_at is not null then
    raise exception 'Une échéance annulée ne se recalcule pas';
  end if;

  select * into v_new from app.rent_charge_amounts(v_charge.lease_id, extract(year from v_charge.period_start)::integer, extract(month from v_charge.period_start)::integer);
  if v_new.term_id is null then
    raise exception 'Aucune condition de loyer applicable à cette période';
  end if;
  if v_new.rent_cents = v_charge.rent_cents and v_new.charges_cents = v_charge.charges_cents then
    return;
  end if;

  update public.rent_charges
  set rent_cents = v_new.rent_cents, charges_cents = v_new.charges_cents
  where id = p_charge_id;
  perform app.write_audit(v_charge.entity_id, 'rent_charge.recalculated', 'rent_charges', p_charge_id,
    jsonb_build_object(
      'from', jsonb_build_object('rent_cents', v_charge.rent_cents, 'charges_cents', v_charge.charges_cents),
      'to', jsonb_build_object('rent_cents', v_new.rent_cents, 'charges_cents', v_new.charges_cents)));
end;
$$;

create function public.cancel_rent_charge(p_charge_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_charge public.rent_charges%rowtype;
begin
  select * into v_charge from public.rent_charges where id = p_charge_id for update;
  if v_charge.id is null or not app.has_permission(v_charge.entity_id, 'rent_charge:cancel') then
    raise exception 'Droit insuffisant pour annuler cette échéance' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if v_charge.cancelled_at is not null then
    raise exception 'Cette échéance est déjà annulée';
  end if;

  update public.rent_charges
  set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason)
  where id = p_charge_id;
  perform app.write_audit(v_charge.entity_id, 'rent_charge.cancelled', 'rent_charges', p_charge_id,
    jsonb_build_object('total_cents', v_charge.total_cents, 'reason', btrim(p_reason)));
end;
$$;

----------------------------------------------------------------------------------------------------
-- Privilèges
----------------------------------------------------------------------------------------------------

revoke all on function app.rent_charge_amounts(uuid, integer, integer) from public, anon;
revoke all on function app.add_allocations(uuid, jsonb) from public, anon;
grant execute on function app.rent_charge_amounts(uuid, integer, integer) to authenticated, service_role;
grant execute on function app.add_allocations(uuid, jsonb) to authenticated;

revoke all on function public.record_payment(uuid, integer, date, text, text, text, jsonb, boolean) from public, anon;
revoke all on function public.allocate_payment(uuid, jsonb) from public, anon;
revoke all on function public.reverse_allocation(uuid, text) from public, anon;
revoke all on function public.move_allocation(uuid, uuid, text) from public, anon;
revoke all on function public.cancel_payment(uuid, text) from public, anon;
revoke all on function public.update_payment_details(uuid, text, text, text, date) from public, anon;
revoke all on function public.recalc_rent_charge(uuid) from public, anon;
revoke all on function public.cancel_rent_charge(uuid, text) from public, anon;

grant execute on function public.record_payment(uuid, integer, date, text, text, text, jsonb, boolean) to authenticated;
grant execute on function public.allocate_payment(uuid, jsonb) to authenticated;
grant execute on function public.reverse_allocation(uuid, text) to authenticated;
grant execute on function public.move_allocation(uuid, uuid, text) to authenticated;
grant execute on function public.cancel_payment(uuid, text) to authenticated;
grant execute on function public.update_payment_details(uuid, text, text, text, date) to authenticated;
grant execute on function public.recalc_rent_charge(uuid) to authenticated;
grant execute on function public.cancel_rent_charge(uuid, text) to authenticated;
