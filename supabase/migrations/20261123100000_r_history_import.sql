-- Lot R : reprise d'historique (LR-01). Une seule fonction, réservée à l'opérateur (service_role), importe un lot en une
-- transaction : biens, dossiers, baux (conditions et colocataires), échéances imposées facultatives, paiements et
-- affectations, dépenses, apurements. Tout ou rien : à la moindre erreur ou en mode essai (dry-run), rien n'est écrit et le
-- rapport liste chaque erreur avec fichier et ligne. Les lignes financières portent external_ref et import_batch_id.
--
-- Une seule entrée d'audit par lot (history_import.completed) : l'audit ligne à ligne est suspendu pendant l'import.

-- Une référence externe ne bloque la réimportation que tant que sa ligne est active : après annulation d'une ligne ou d'un lot,
-- la même référence peut être réutilisée pour corriger.
-- allow-destructive: index remplacé par une version identique limitée aux lignes actives
drop index public.payments_external_ref_key;
-- allow-destructive: index remplacé par une version identique limitée aux lignes actives
drop index public.rent_charges_external_ref_key;
-- allow-destructive: index remplacé par une version identique limitée aux lignes actives
drop index public.expenses_external_ref_key;
-- allow-destructive: index remplacé par une version identique limitée aux lignes actives
drop index public.charge_settlements_external_ref_key;
create unique index payments_external_ref_key on public.payments (entity_id, external_ref) where external_ref is not null and cancelled_at is null;
create unique index rent_charges_external_ref_key on public.rent_charges (entity_id, external_ref) where external_ref is not null and cancelled_at is null;
create unique index expenses_external_ref_key on public.expenses (entity_id, external_ref) where external_ref is not null and cancelled_at is null;
create unique index charge_settlements_external_ref_key on public.charge_settlements (entity_id, external_ref) where external_ref is not null and cancelled_at is null;

-- Suspension de l'audit détaillé pendant un import (app.suppress_audit = 'on', réglage local à la transaction).
create or replace function app.write_audit(
  p_entity_id uuid,
  p_action text,
  p_subject_table text,
  p_subject_id uuid,
  p_details jsonb default '{}'::jsonb,
  p_actor_kind text default 'system'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if current_setting('app.suppress_audit', true) = 'on' then
    return null;
  end if;
  insert into public.audit_logs (entity_id, actor_kind, actor_id, action, subject_table, subject_id, details)
  values (
    p_entity_id,
    case
      when v_uid is not null then 'user'
      else coalesce(nullif(current_setting('app.actor_kind', true), ''), p_actor_kind)
    end,
    v_uid,
    p_action,
    p_subject_table,
    p_subject_id,
    coalesce(p_details, '{}'::jsonb)
  )
  returning id into v_id;
  return v_id;
end;
$$;

create function app.import_history(p_entity_id uuid, p_payload jsonb, p_files_sha256 text, p_dry_run boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := public.app_today();
  v_errors jsonb := '[]'::jsonb;
  v_counts jsonb := '{}'::jsonb;
  v_totals jsonb := '[]'::jsonb;
  v_unpaid jsonb := '[]'::jsonb;
  v_differences jsonb := '[]'::jsonb;
  v_batch uuid;
  v_existing uuid;
  v_row jsonb;
  v_sub jsonb;
  v_id uuid;
  v_lease uuid;
  v_lease_ids uuid[] := '{}';
  v_prop uuid;
  v_tenant uuid;
  v_charge uuid;
  v_payment uuid;
  v_remaining integer;
  v_alloc integer;
  v_period date;
  v_month date;
  v_info record;
  v_lease_rec public.leases%rowtype;
  v_new integer;
  v_reused integer;
  v_status text;
  c_properties integer := 0; c_properties_reused integer := 0;
  c_tenants integer := 0; c_tenants_reused integer := 0;
  c_leases integer := 0; c_leases_reused integer := 0;
  c_charges integer := 0; c_imposed integer := 0;
  c_payments integer := 0; c_allocations integer := 0;
  c_expenses integer := 0; c_settlements integer := 0;

  -- Enregistre l'erreur d'une ligne (fichier, numéro de ligne, message) sans interrompre le lot.
  v_file text;
  v_line integer;
begin
  if not exists (select 1 from public.ownership_entities e where e.id = p_entity_id) then
    raise exception 'Structure inconnue';
  end if;
  if coalesce(p_files_sha256, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'Empreinte des fichiers invalide';
  end if;
  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Contenu du lot invalide';
  end if;

  -- Rejeu d'un lot identique : sans effet.
  select b.id into v_existing from public.import_batches b
  where b.entity_id = p_entity_id and b.files_sha256 = p_files_sha256 and b.status = 'imported';
  if v_existing is not null then
    return jsonb_build_object('status', 'already_imported', 'batch_id', v_existing);
  end if;

  begin
    perform set_config('app.actor_kind', 'operator', true);
    perform set_config('app.suppress_audit', 'on', true);

    insert into public.import_batches (entity_id, files_sha256) values (p_entity_id, p_files_sha256) returning id into v_batch;

    -- Biens
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'properties', '[]')) loop
      v_file := 'biens'; v_line := (v_row ->> 'line')::integer;
      begin
        select p.id into v_id from public.properties p where p.entity_id = p_entity_id and p.external_ref = v_row ->> 'ref';
        if v_id is not null then
          c_properties_reused := c_properties_reused + 1;
        else
          insert into public.properties (entity_id, label, address_line1, postal_code, city, external_ref, import_batch_id)
          values (p_entity_id, v_row ->> 'label', coalesce(v_row ->> 'address_line1', ''), coalesce(v_row ->> 'postal_code', ''), coalesce(v_row ->> 'city', ''), v_row ->> 'ref', v_batch);
          c_properties := c_properties + 1;
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', sqlerrm);
      end;
    end loop;

    -- Dossiers locataires
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'tenants', '[]')) loop
      v_file := 'locataires'; v_line := (v_row ->> 'line')::integer;
      begin
        select t.id into v_id from public.tenants t where t.entity_id = p_entity_id and t.external_ref = v_row ->> 'ref';
        if v_id is not null then
          c_tenants_reused := c_tenants_reused + 1;
        else
          insert into public.tenants (entity_id, last_name, first_name, email, phone, external_ref, import_batch_id)
          values (p_entity_id, v_row ->> 'last_name', coalesce(v_row ->> 'first_name', ''), nullif(v_row ->> 'email', ''), nullif(v_row ->> 'phone', ''), v_row ->> 'ref', v_batch);
          c_tenants := c_tenants + 1;
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', sqlerrm);
      end;
    end loop;

    -- Baux : bail, versions de conditions, colocataires
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'leases', '[]')) loop
      v_file := 'baux'; v_line := (v_row ->> 'line')::integer;
      begin
        select l.id into v_lease from public.leases l where l.entity_id = p_entity_id and l.external_ref = v_row ->> 'ref';
        if v_lease is not null then
          c_leases_reused := c_leases_reused + 1;
        else
          select p.id into v_prop from public.properties p where p.entity_id = p_entity_id and p.external_ref = v_row ->> 'property_ref';
          if v_prop is null then
            raise exception 'Bien introuvable (%)', v_row ->> 'property_ref';
          end if;
          if jsonb_array_length(coalesce(v_row -> 'terms', '[]')) = 0 then
            raise exception 'Le bail n''a aucune condition de loyer';
          end if;
          if jsonb_array_length(coalesce(v_row -> 'tenants', '[]')) = 0 then
            raise exception 'Le bail n''a aucun locataire';
          end if;
          insert into public.leases (entity_id, property_id, start_date, end_date, due_day, deposit_cents, external_ref, import_batch_id)
          values (p_entity_id, v_prop, (v_row ->> 'start_date')::date, nullif(v_row ->> 'end_date', '')::date, (v_row ->> 'due_day')::integer,
                  nullif(v_row ->> 'deposit_cents', '')::integer, v_row ->> 'ref', v_batch)
          returning id into v_lease;
          for v_sub in select * from jsonb_array_elements(v_row -> 'terms') loop
            insert into public.rental_terms (entity_id, lease_id, effective_from, rent_cents, charges_cents, reason)
            values (p_entity_id, v_lease, (v_sub ->> 'effective_from')::date, (v_sub ->> 'rent_cents')::integer, (v_sub ->> 'charges_cents')::integer, 'Reprise d''historique');
          end loop;
          for v_sub in select * from jsonb_array_elements(v_row -> 'tenants') loop
            select t.id into v_tenant from public.tenants t where t.entity_id = p_entity_id and t.external_ref = v_sub ->> 'tenant_ref';
            if v_tenant is null then
              raise exception 'Locataire introuvable (%)', v_sub ->> 'tenant_ref';
            end if;
            insert into public.lease_tenants (entity_id, lease_id, tenant_id, start_date, end_date)
            values (p_entity_id, v_lease, v_tenant,
                    coalesce(nullif(v_sub ->> 'start_date', '')::date, (v_row ->> 'start_date')::date),
                    coalesce(nullif(v_sub ->> 'end_date', '')::date, nullif(v_row ->> 'end_date', '')::date));
          end loop;
          c_leases := c_leases + 1;
        end if;
        v_lease_ids := array_append(v_lease_ids, v_lease);
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', sqlerrm);
      end;
    end loop;

    -- Échéances imposées (facultatif) : loyer, charges et date réellement appliqués ; écart avec le calcul signalé.
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'charges', '[]')) loop
      v_file := 'echeances'; v_line := (v_row ->> 'line')::integer;
      begin
        select l.* into v_lease_rec from public.leases l where l.entity_id = p_entity_id and l.external_ref = v_row ->> 'lease_ref';
        if v_lease_rec.id is null then
          raise exception 'Bail introuvable (%)', v_row ->> 'lease_ref';
        end if;
        v_period := date_trunc('month', (v_row ->> 'period_start')::date)::date;
        select * into v_info from app.rent_charge_amounts(v_lease_rec.id, extract(year from v_period)::integer, extract(month from v_period)::integer);
        if v_info.term_id is null or v_info.occupied_days = 0 then
          raise exception 'Le bail ne couvre pas la période %', to_char(v_period, 'YYYY-MM');
        end if;
        if coalesce(nullif(v_row ->> 'due_on', '')::date, v_info.due_on) > v_today then
          raise exception 'La date d''échéance est dans le futur';
        end if;
        insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents, term_id, external_ref, import_batch_id)
        values (p_entity_id, v_lease_rec.id, v_info.period_start, v_info.period_end, coalesce(nullif(v_row ->> 'due_on', '')::date, v_info.due_on),
                (v_row ->> 'rent_cents')::integer, (v_row ->> 'charges_cents')::integer, v_info.term_id, nullif(v_row ->> 'ref', ''), v_batch);
        c_imposed := c_imposed + 1;
        if (v_row ->> 'rent_cents')::integer <> v_info.rent_cents or (v_row ->> 'charges_cents')::integer <> v_info.charges_cents then
          v_differences := v_differences || jsonb_build_object(
            'lease', v_row ->> 'lease_ref', 'period', to_char(v_period, 'YYYY-MM'),
            'imposed_cents', (v_row ->> 'rent_cents')::integer + (v_row ->> 'charges_cents')::integer,
            'computed_cents', v_info.rent_cents + v_info.charges_cents);
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', sqlerrm);
      end;
    end loop;

    -- Rattrapage : toutes les échéances échues de chaque bail du lot (jamais d'échéance future : pg_cron s'en charge).
    foreach v_lease in array v_lease_ids loop
      select * into v_lease_rec from public.leases where id = v_lease;
      for v_month in
        select generate_series(
          date_trunc('month', v_lease_rec.start_date)::date,
          date_trunc('month', least(coalesce(v_lease_rec.end_date, v_today), v_today))::date,
          interval '1 month')::date
      loop
        select * into v_info from app.rent_charge_amounts(v_lease, extract(year from v_month)::integer, extract(month from v_month)::integer);
        continue when v_info.term_id is null or v_info.occupied_days = 0 or v_info.due_on > v_today;
        continue when exists (select 1 from public.rent_charges c where c.lease_id = v_lease and c.period_start = v_info.period_start and c.cancelled_at is null);
        insert into public.rent_charges (entity_id, lease_id, period_start, period_end, due_on, rent_cents, charges_cents, term_id, import_batch_id)
        values (p_entity_id, v_lease, v_info.period_start, v_info.period_end, v_info.due_on, v_info.rent_cents, v_info.charges_cents, v_info.term_id, v_batch);
        c_charges := c_charges + 1;
      end loop;
    end loop;

    -- Paiements, par date de réception ; affectation indiquée par période, sinon de la plus ancienne à la plus récente.
    for v_row in
      select e.value from jsonb_array_elements(coalesce(p_payload -> 'payments', '[]')) e order by e.value ->> 'received_on', (e.value ->> 'line')::integer
    loop
      v_file := 'paiements'; v_line := (v_row ->> 'line')::integer;
      begin
        select l.id into v_lease from public.leases l where l.entity_id = p_entity_id and l.external_ref = v_row ->> 'lease_ref';
        if v_lease is null then
          raise exception 'Bail introuvable (%)', v_row ->> 'lease_ref';
        end if;
        if (v_row ->> 'received_on')::date > v_today then
          raise exception 'La date de réception est dans le futur';
        end if;
        insert into public.payments (entity_id, lease_id, amount_cents, received_on, mode, reference, external_ref, import_batch_id)
        values (p_entity_id, v_lease, (v_row ->> 'amount_cents')::integer, (v_row ->> 'received_on')::date, v_row ->> 'mode',
                nullif(v_row ->> 'reference', ''), v_row ->> 'ref', v_batch)
        returning id into v_payment;
        c_payments := c_payments + 1;
        v_remaining := (v_row ->> 'amount_cents')::integer;

        if nullif(v_row ->> 'period_start', '') is not null then
          select c.id into v_charge from public.rent_charges c
          where c.lease_id = v_lease and c.period_start = date_trunc('month', (v_row ->> 'period_start')::date)::date and c.cancelled_at is null;
          if v_charge is null then
            raise exception 'Aucune échéance pour la période %', v_row ->> 'period_start';
          end if;
          v_alloc := least(v_remaining, (
            select c.total_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.rent_charge_id = c.id and a.reversed_at is null), 0)
            from public.rent_charges c where c.id = v_charge));
          if v_alloc > 0 then
            insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values (p_entity_id, v_lease, v_payment, v_charge, v_alloc);
            c_allocations := c_allocations + 1;
          end if;
        else
          for v_charge, v_alloc in
            select c.id, c.total_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.rent_charge_id = c.id and a.reversed_at is null), 0)
            from public.rent_charges c where c.lease_id = v_lease and c.cancelled_at is null order by c.period_start
          loop
            continue when v_alloc <= 0;
            exit when v_remaining <= 0;
            v_alloc := least(v_alloc, v_remaining);
            insert into public.payment_allocations (entity_id, lease_id, payment_id, rent_charge_id, amount_cents) values (p_entity_id, v_lease, v_payment, v_charge, v_alloc);
            v_remaining := v_remaining - v_alloc;
            c_allocations := c_allocations + 1;
          end loop;
        end if;
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', case when sqlstate = '23505' then 'Référence déjà utilisée : annulez le lot ou la ligne avant de réimporter' else sqlerrm end);
      end;
    end loop;

    -- Dépenses
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'expenses', '[]')) loop
      v_file := 'depenses'; v_line := (v_row ->> 'line')::integer;
      begin
        select p.id into v_prop from public.properties p where p.entity_id = p_entity_id and p.external_ref = v_row ->> 'property_ref';
        if v_prop is null then
          raise exception 'Bien introuvable (%)', v_row ->> 'property_ref';
        end if;
        select c.id into v_id from public.expense_categories c
        where c.entity_id = p_entity_id and lower(btrim(c.name)) = lower(btrim(v_row ->> 'category')) and c.archived_at is null;
        if v_id is null then
          raise exception 'Catégorie de dépense inconnue (%)', v_row ->> 'category';
        end if;
        insert into public.expenses (entity_id, property_id, category_id, expense_date, description, amount_cents, recoverable, external_ref, import_batch_id)
        values (p_entity_id, v_prop, v_id, (v_row ->> 'expense_date')::date, v_row ->> 'description', (v_row ->> 'amount_cents')::integer,
                coalesce((v_row ->> 'recoverable')::boolean, false), v_row ->> 'ref', v_batch);
        c_expenses := c_expenses + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', case when sqlstate = '23505' then 'Référence déjà utilisée : annulez le lot ou la ligne avant de réimporter' else sqlerrm end);
      end;
    end loop;

    -- Apurements de charges (dont l'apurement final)
    for v_row in select * from jsonb_array_elements(coalesce(p_payload -> 'settlements', '[]')) loop
      v_file := 'apurements'; v_line := (v_row ->> 'line')::integer;
      begin
        select l.id into v_lease from public.leases l where l.entity_id = p_entity_id and l.external_ref = v_row ->> 'lease_ref';
        if v_lease is null then
          raise exception 'Bail introuvable (%)', v_row ->> 'lease_ref';
        end if;
        if (v_row ->> 'settled_on')::date > v_today then
          raise exception 'La date de l''apurement est dans le futur';
        end if;
        insert into public.charge_settlements (entity_id, lease_id, settled_on, amount_cents, mode, reason, is_final, period_start, period_end, external_ref, import_batch_id)
        values (p_entity_id, v_lease, (v_row ->> 'settled_on')::date, (v_row ->> 'amount_cents')::integer, v_row ->> 'mode', v_row ->> 'reason',
                coalesce((v_row ->> 'is_final')::boolean, false), nullif(v_row ->> 'period_start', '')::date, nullif(v_row ->> 'period_end', '')::date,
                v_row ->> 'ref', v_batch);
        c_settlements := c_settlements + 1;
      exception when others then
        v_errors := v_errors || jsonb_build_object('file', v_file, 'line', v_line, 'message', case when sqlstate = '23505' then 'Référence déjà utilisée : annulez le lot ou la ligne avant de réimporter' else sqlerrm end);
      end;
    end loop;

    -- Contrôle : totaux par bail et par année, échéances restées impayées.
    select coalesce(jsonb_agg(t order by t ->> 'lease', t ->> 'year'), '[]'::jsonb) into v_totals
    from (
      select jsonb_build_object(
        'lease', l.external_ref,
        'year', y.year,
        'called_cents', coalesce((select sum(c.total_cents) from public.rent_charges c where c.lease_id = l.id and c.cancelled_at is null and extract(year from c.due_on) = y.year), 0),
        'collected_cents', coalesce((select sum(p.amount_cents) from public.payments p where p.lease_id = l.id and p.cancelled_at is null and extract(year from p.received_on) = y.year), 0),
        'refunds_net_cents', coalesce((select sum(s.amount_cents) from public.charge_settlements s where s.lease_id = l.id and s.cancelled_at is null and extract(year from s.settled_on) = y.year), 0),
        'expenses_cents', coalesce((select sum(e.amount_cents) from public.expenses e where e.property_id = l.property_id and e.cancelled_at is null and extract(year from e.expense_date) = y.year), 0),
        'remaining_due_cents', coalesce((
          select sum(c.total_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.rent_charge_id = c.id and a.reversed_at is null), 0))
          from public.rent_charges c where c.lease_id = l.id and c.cancelled_at is null and extract(year from c.due_on) = y.year), 0)) as t
      from public.leases l
      cross join lateral generate_series(extract(year from l.start_date)::integer, extract(year from least(coalesce(l.end_date, v_today), v_today))::integer) as y(year)
      where l.id = any (v_lease_ids)
    ) x;

    select coalesce(jsonb_agg(jsonb_build_object('lease', l.external_ref, 'period', to_char(c.period_start, 'YYYY-MM'), 'due_on', c.due_on,
             'balance_cents', c.total_cents - coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.rent_charge_id = c.id and a.reversed_at is null), 0))
           order by l.external_ref, c.period_start), '[]'::jsonb) into v_unpaid
    from public.rent_charges c join public.leases l on l.id = c.lease_id
    where c.lease_id = any (v_lease_ids) and c.cancelled_at is null and c.due_on < v_today
      and c.total_cents > coalesce((select sum(a.amount_cents) from public.payment_allocations a where a.rent_charge_id = c.id and a.reversed_at is null), 0);

    v_counts := jsonb_build_object(
      'properties', c_properties, 'properties_reused', c_properties_reused, 'tenants', c_tenants, 'tenants_reused', c_tenants_reused,
      'leases', c_leases, 'leases_reused', c_leases_reused, 'charges_calculated', c_charges, 'charges_imposed', c_imposed,
      'payments', c_payments, 'allocations', c_allocations, 'expenses', c_expenses, 'settlements', c_settlements);

    -- Lot valide et pas d'essai : on enregistre le lot et l'unique entrée d'audit ; sinon on annule tout ce qui précède.
    if jsonb_array_length(v_errors) = 0 and not coalesce(p_dry_run, false) then
      update public.import_batches set counts = v_counts where id = v_batch;
      perform set_config('app.suppress_audit', 'off', true);
      perform app.write_audit(p_entity_id, 'history_import.completed', 'import_batches', v_batch, v_counts || jsonb_build_object('files_sha256', p_files_sha256), 'operator');
      v_status := 'imported';
    else
      v_status := case when jsonb_array_length(v_errors) > 0 then 'rejected' else 'dry_run' end;
      raise exception using errcode = 'P0900', message = 'rollback';
    end if;
  exception when sqlstate 'P0900' then
    null; -- tout ce qui précède dans ce bloc est annulé ; les variables du rapport sont conservées
  end;

  return jsonb_build_object(
    'status', v_status,
    'batch_id', case when v_status = 'imported' then v_batch end,
    'errors', v_errors, 'counts', v_counts, 'totals', v_totals, 'unpaid', v_unpaid, 'imposed_differences', v_differences);
end;
$$;

-- Annule un lot : affectations retirées, paiements, échéances, dépenses et apurements du lot marqués annulés avec motif,
-- rien n'est supprimé. Biens, dossiers et baux importés restent (ils sont réutilisés à la réimportation).
create function app.cancel_import_batch(p_batch_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch public.import_batches%rowtype;
  v_reason text := btrim(coalesce(p_reason, ''));
  n_alloc integer; n_pay integer; n_charge integer; n_exp integer; n_set integer;
begin
  if v_reason = '' then
    raise exception 'Le motif est obligatoire';
  end if;
  select * into v_batch from public.import_batches where id = p_batch_id for update;
  if v_batch.id is null then
    raise exception 'Lot introuvable';
  end if;
  if v_batch.status = 'cancelled' then
    raise exception 'Ce lot est déjà annulé';
  end if;

  perform set_config('app.actor_kind', 'operator', true);
  perform set_config('app.suppress_audit', 'on', true);

  update public.payment_allocations a
  set reversed_at = now(), reversal_reason = 'Lot d''import annulé : ' || v_reason
  where a.reversed_at is null
    and (a.payment_id in (select p.id from public.payments p where p.import_batch_id = p_batch_id)
         or a.rent_charge_id in (select c.id from public.rent_charges c where c.import_batch_id = p_batch_id));
  get diagnostics n_alloc = row_count;

  update public.payments set cancelled_at = now(), cancellation_reason = 'Lot d''import annulé : ' || v_reason
  where import_batch_id = p_batch_id and cancelled_at is null;
  get diagnostics n_pay = row_count;

  update public.rent_charges set cancelled_at = now(), cancellation_reason = 'Lot d''import annulé : ' || v_reason
  where import_batch_id = p_batch_id and cancelled_at is null;
  get diagnostics n_charge = row_count;

  update public.expenses set cancelled_at = now(), cancellation_reason = 'Lot d''import annulé : ' || v_reason
  where import_batch_id = p_batch_id and cancelled_at is null;
  get diagnostics n_exp = row_count;

  update public.charge_settlements set cancelled_at = now(), cancellation_reason = 'Lot d''import annulé : ' || v_reason
  where import_batch_id = p_batch_id and cancelled_at is null;
  get diagnostics n_set = row_count;

  update public.import_batches set status = 'cancelled', cancelled_at = now() where id = p_batch_id;

  perform set_config('app.suppress_audit', 'off', true);
  perform app.write_audit(v_batch.entity_id, 'import_batch.cancelled', 'import_batches', p_batch_id,
    jsonb_build_object('reason', v_reason, 'allocations', n_alloc, 'payments', n_pay, 'charges', n_charge, 'expenses', n_exp, 'settlements', n_set), 'operator');
  return jsonb_build_object('allocations', n_alloc, 'payments', n_pay, 'charges', n_charge, 'expenses', n_exp, 'settlements', n_set);
end;
$$;

create function public.import_history(p_entity_id uuid, p_payload jsonb, p_files_sha256 text, p_dry_run boolean)
returns jsonb language sql set search_path = '' as $$ select app.import_history(p_entity_id, p_payload, p_files_sha256, p_dry_run) $$;
create function public.cancel_import_batch(p_batch_id uuid, p_reason text)
returns jsonb language sql set search_path = '' as $$ select app.cancel_import_batch(p_batch_id, p_reason) $$;

-- Réservées à l'opérateur : jamais appelables depuis l'application (clé publique) ni par un utilisateur connecté.
revoke all on function app.import_history(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function app.cancel_import_batch(uuid, text) from public, anon, authenticated;
revoke all on function public.import_history(uuid, jsonb, text, boolean) from public, anon, authenticated;
revoke all on function public.cancel_import_batch(uuid, text) from public, anon, authenticated;
grant execute on function app.import_history(uuid, jsonb, text, boolean) to service_role;
grant execute on function app.cancel_import_batch(uuid, text) to service_role;
grant execute on function public.import_history(uuid, jsonb, text, boolean) to service_role;
grant execute on function public.cancel_import_batch(uuid, text) to service_role;
