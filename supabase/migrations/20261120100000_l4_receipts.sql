-- Lot 4 : quittances et reçus de paiement partiel (L4-04).
-- Un document est généré une seule fois, à l'émission (ADR 0004) : la base fixe son numéro et son instantané (tout ce
-- que le PDF affiche), le serveur produit le PDF d'après cet instantané, le dépose dans le bucket privé `receipts` et
-- enregistre son empreinte SHA-256. Jamais de régénération : une correction passe par l'annulation puis le remplacement.
--
-- L'émission est une fonction SECURITY DEFINER (schéma app) : un utilisateur ne peut pas insérer lui-même un numéro
-- ou un instantané de son choix. Aucune politique Storage : le bucket n'est lisible que par le serveur (service_role).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['application/pdf'])
on conflict (id) do nothing;

create table public.receipt_counters (
  entity_id uuid not null references public.ownership_entities (id),
  kind text not null check (kind in ('quittance', 'partial_receipt')),
  year_month text not null check (year_month ~ '^\d{4}-\d{2}$'),
  last_number integer not null,
  primary key (entity_id, kind, year_month)
);

alter table public.receipt_counters enable row level security;
revoke all on public.receipt_counters from public, anon, authenticated, service_role;

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  kind text not null check (kind in ('quittance', 'partial_receipt')),
  number text not null,
  version integer not null default 1 check (version >= 1),
  lease_id uuid not null,
  rent_charge_id uuid not null,
  payment_id uuid,
  period_start date not null,
  period_end date not null,
  issued_on date not null,
  paid_on date not null,
  proposed_issued_on date not null,
  proposed_paid_on date not null,
  amount_cents integer not null check (amount_cents > 0),
  snapshot jsonb not null,
  signature_id uuid references public.member_signatures (id),
  issued_by uuid not null references public.profiles (id),
  issued_at timestamptz not null default now(),
  file_path text,
  file_sha256 text,
  file_size integer,
  supersedes_receipt_id uuid references public.receipts (id),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id),
  cancellation_reason text,
  unique (entity_id, number),
  unique (entity_id, id),
  check ((kind = 'quittance' and payment_id is null) or (kind = 'partial_receipt' and payment_id is not null)),
  check (paid_on <= issued_on),
  check ((file_path is null) = (file_sha256 is null) and (file_path is null) = (file_size is null)),
  check ((cancelled_at is null) = (cancellation_reason is null)),
  foreign key (entity_id, lease_id, rent_charge_id) references public.rent_charges (entity_id, lease_id, id),
  foreign key (entity_id, lease_id, payment_id) references public.payments (entity_id, lease_id, id)
);

-- Une seule quittance active par échéance ; un seul reçu actif par paiement et échéance.
create unique index receipts_one_active_quittance on public.receipts (rent_charge_id) where kind = 'quittance' and cancelled_at is null;
create unique index receipts_one_active_partial on public.receipts (payment_id, rent_charge_id) where kind = 'partial_receipt' and cancelled_at is null;
create index receipts_entity_idx on public.receipts (entity_id, issued_on desc);
create index receipts_lease_idx on public.receipts (lease_id);

alter table public.receipts enable row level security;

create policy receipts_select on public.receipts
  for select to authenticated
  using (app.has_permission(entity_id, 'receipt:read'));

revoke all on public.receipts from public, anon, authenticated, service_role;
grant select (id, entity_id, kind, number, version, lease_id, rent_charge_id, payment_id, period_start, period_end, issued_on, paid_on,
              proposed_issued_on, proposed_paid_on, amount_cents, snapshot, signature_id, issued_by, issued_at, file_path, file_sha256,
              file_size, supersedes_receipt_id, cancelled_at, cancelled_by, cancellation_reason)
  on public.receipts to authenticated;
grant select on public.receipts to service_role;

----------------------------------------------------------------------------------------------------
-- Immutabilité
----------------------------------------------------------------------------------------------------

create trigger receipts_no_delete before delete on public.receipts for each row execute function app.refuse_delete();

-- Une quittance émise ne change plus : seuls le fichier (une fois) et l'annulation (une fois) s'enregistrent.
create function app.guard_receipt_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(new) - 'file_path' - 'file_sha256' - 'file_size' - 'cancelled_at' - 'cancelled_by' - 'cancellation_reason'
     is distinct from to_jsonb(old) - 'file_path' - 'file_sha256' - 'file_size' - 'cancelled_at' - 'cancelled_by' - 'cancellation_reason' then
    raise exception 'Un document émis ne peut pas être modifié : annulez-le puis remplacez-le';
  end if;
  if old.file_path is not null and (new.file_path is distinct from old.file_path or new.file_sha256 is distinct from old.file_sha256) then
    raise exception 'Le fichier d''un document émis ne change jamais';
  end if;
  if old.cancelled_at is not null and new.cancelled_at is distinct from old.cancelled_at then
    raise exception 'Ce document est déjà annulé';
  end if;
  return new;
end;
$$;

create trigger receipts_guard_update
  before update on public.receipts
  for each row execute function app.guard_receipt_update();

-- Retirer ou déplacer une affectation (donc annuler un paiement) est refusé tant qu'un document émis en dépend.
create function app.guard_allocation_receipts()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.reversed_at is null and new.reversed_at is not null and exists (
    select 1 from public.receipts r
    where r.rent_charge_id = old.rent_charge_id and r.cancelled_at is null
      and (r.kind = 'quittance' or r.payment_id = old.payment_id)
  ) then
    raise exception 'Un document émis (quittance ou reçu) dépend de cette échéance : annulez-le d''abord';
  end if;
  return new;
end;
$$;

create trigger payment_allocations_guard_receipts
  before update on public.payment_allocations
  for each row execute function app.guard_allocation_receipts();

----------------------------------------------------------------------------------------------------
-- Émission
----------------------------------------------------------------------------------------------------

create function app.issue_receipt_core(
  p_kind text, p_charge_id uuid, p_payment_id uuid, p_issued_on date, p_paid_on date, p_supersedes uuid, p_version integer
)
returns table (id uuid, number text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_today date := public.app_today();
  v_charge public.rent_charges%rowtype;
  v_paid integer;
  v_amount integer;
  v_default_paid date;
  v_issued date;
  v_paid_on date;
  v_entity public.ownership_entities%rowtype;
  v_lease public.leases%rowtype;
  v_property public.properties%rowtype;
  v_signature record;
  v_issuer record;
  v_n integer;
  v_number text;
  v_ym text;
  v_snapshot jsonb;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = 'insufficient_privilege';
  end if;
  if p_kind not in ('quittance', 'partial_receipt') then
    raise exception 'Genre de document inconnu';
  end if;

  select * into v_charge from public.rent_charges where id = p_charge_id for update;
  if v_charge.id is null or not app.has_permission(v_charge.entity_id, 'receipt:write') then
    raise exception 'Droit insuffisant pour émettre ce document' using errcode = 'insufficient_privilege';
  end if;
  if v_charge.cancelled_at is not null then
    raise exception 'Cette échéance est annulée';
  end if;

  select coalesce(sum(a.amount_cents), 0) into v_paid
  from public.payment_allocations a
  where a.rent_charge_id = p_charge_id and a.reversed_at is null;

  if p_kind = 'quittance' then
    if p_payment_id is not null then raise exception 'Une quittance ne se rattache pas à un paiement'; end if;
    if v_charge.total_cents <= 0 or v_paid <> v_charge.total_cents then
      raise exception 'Une quittance ne s''émet que pour une échéance intégralement réglée';
    end if;
    if exists (select 1 from public.receipts r where r.rent_charge_id = p_charge_id and r.kind = 'quittance' and r.cancelled_at is null) then
      raise exception 'Une quittance est déjà émise pour cette échéance';
    end if;
    v_amount := v_charge.total_cents;
    select max(p.received_on) into v_default_paid
    from public.payments p
    where p.cancelled_at is null
      and exists (select 1 from public.payment_allocations a where a.payment_id = p.id and a.rent_charge_id = p_charge_id and a.reversed_at is null);
  else
    if p_payment_id is null then raise exception 'Un reçu se rattache à un paiement'; end if;
    if v_paid >= v_charge.total_cents then
      raise exception 'Cette échéance est soldée : émettez la quittance';
    end if;
    select coalesce(sum(a.amount_cents), 0), max(p.received_on) into v_amount, v_default_paid
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id
    where a.rent_charge_id = p_charge_id and a.payment_id = p_payment_id and a.reversed_at is null and p.cancelled_at is null;
    if v_amount <= 0 then
      raise exception 'Ce paiement n''est pas affecté à cette échéance';
    end if;
    if exists (select 1 from public.receipts r where r.rent_charge_id = p_charge_id and r.payment_id = p_payment_id and r.kind = 'partial_receipt' and r.cancelled_at is null) then
      raise exception 'Un reçu est déjà émis pour ce paiement';
    end if;
  end if;

  v_issued := coalesce(p_issued_on, v_today);
  v_paid_on := coalesce(p_paid_on, v_default_paid);
  if v_issued > v_today then
    raise exception 'La date d''émission ne peut pas être dans le futur';
  end if;
  if v_paid_on > v_issued then
    raise exception 'La date de paiement ne peut pas être postérieure à la date d''émission';
  end if;

  select * into v_entity from public.ownership_entities where id = v_charge.entity_id;
  select * into v_lease from public.leases where id = v_charge.lease_id;
  select * into v_property from public.properties where id = v_lease.property_id;
  select s.id, s.sha256 into v_signature
  from public.member_signatures s
  where s.entity_id = v_charge.entity_id and s.profile_id = v_uid and s.active;
  select p.first_name, p.last_name into v_issuer from public.profiles p where p.id = v_uid;

  v_ym := to_char(v_issued, 'YYYY-MM');
  insert into public.receipt_counters as c (entity_id, kind, year_month, last_number)
  values (v_charge.entity_id, p_kind, v_ym, 1)
  on conflict (entity_id, kind, year_month) do update set last_number = c.last_number + 1
  returning c.last_number into v_n;
  v_number := case p_kind when 'quittance' then 'QUI' else 'REC' end || '-' || v_ym || '-' || lpad(v_n::text, 4, '0');

  v_snapshot := jsonb_build_object(
    'kind', p_kind,
    'number', v_number,
    'version', p_version,
    'lessor', jsonb_build_object(
      'name', v_entity.name, 'kind', v_entity.kind, 'address_line', v_entity.address_line,
      'postal_code', v_entity.postal_code, 'city', v_entity.city, 'siret', v_entity.siret),
    'tenants', coalesce((
      select jsonb_agg(btrim(t.first_name || ' ' || t.last_name) order by t.last_name, t.first_name)
      from public.lease_tenants lt
      join public.tenants t on t.id = lt.tenant_id
      where lt.lease_id = v_charge.lease_id
        and lt.start_date <= v_charge.period_end and coalesce(lt.end_date, 'infinity'::date) >= v_charge.period_start
    ), '[]'::jsonb),
    'property', jsonb_build_object(
      'label', v_property.label, 'address_line1', v_property.address_line1, 'address_line2', v_property.address_line2,
      'postal_code', v_property.postal_code, 'city', v_property.city),
    'period', jsonb_build_object('start', v_charge.period_start, 'end', v_charge.period_end),
    'due_on', v_charge.due_on,
    'rent_cents', v_charge.rent_cents,
    'charges_cents', v_charge.charges_cents,
    'total_cents', v_charge.total_cents,
    'amount_cents', v_amount,
    'received_cents', v_paid,
    'remaining_cents', v_charge.total_cents - v_paid,
    'settlements', coalesce((
      select jsonb_agg(jsonb_build_object('payment_id', x.payment_id, 'received_on', x.received_on, 'mode', x.mode, 'amount_cents', x.amount_cents)
                       order by x.received_on, x.payment_id)
      from (
        select a.payment_id, p.received_on, p.mode, sum(a.amount_cents)::integer as amount_cents
        from public.payment_allocations a
        join public.payments p on p.id = a.payment_id
        where a.rent_charge_id = p_charge_id and a.reversed_at is null and p.cancelled_at is null
        group by a.payment_id, p.received_on, p.mode
      ) x
    ), '[]'::jsonb),
    'payment_id', p_payment_id,
    'issued_on', v_issued,
    'paid_on', v_paid_on,
    'issuer', btrim(coalesce(v_issuer.first_name, '') || ' ' || coalesce(v_issuer.last_name, '')),
    'signature', case when v_signature.id is null then null else jsonb_build_object('id', v_signature.id, 'sha256', v_signature.sha256) end
  );

  insert into public.receipts (
    entity_id, kind, number, version, lease_id, rent_charge_id, payment_id, period_start, period_end, issued_on, paid_on,
    proposed_issued_on, proposed_paid_on, amount_cents, snapshot, signature_id, issued_by, supersedes_receipt_id
  ) values (
    v_charge.entity_id, p_kind, v_number, p_version, v_charge.lease_id, p_charge_id, p_payment_id, v_charge.period_start, v_charge.period_end,
    v_issued, v_paid_on, v_today, coalesce(v_default_paid, v_paid_on), v_amount, v_snapshot, v_signature.id, v_uid, p_supersedes
  ) returning receipts.id into v_id;

  perform app.write_audit(v_charge.entity_id, 'receipt.issued', 'receipts', v_id,
    jsonb_strip_nulls(jsonb_build_object(
      'kind', p_kind, 'number', v_number, 'rent_charge_id', p_charge_id, 'payment_id', p_payment_id, 'version', p_version,
      'proposed_issued_on', v_today, 'issued_on', v_issued, 'proposed_paid_on', v_default_paid, 'paid_on', v_paid_on,
      'supersedes', p_supersedes)));
  return query select v_id, v_number;
end;
$$;

create function app.issue_receipt(p_kind text, p_charge_id uuid, p_payment_id uuid, p_issued_on date, p_paid_on date)
returns table (id uuid, number text)
language sql
security definer
set search_path = ''
as $$ select * from app.issue_receipt_core(p_kind, p_charge_id, p_payment_id, p_issued_on, p_paid_on, null, 1) $$;

-- Enregistre le fichier PDF déposé dans le bucket : une seule fois, par la personne qui a émis le document.
create function app.attach_receipt_file(p_id uuid, p_path text, p_sha256 text, p_size integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.receipts%rowtype;
begin
  select * into v_receipt from public.receipts where id = p_id for update;
  if v_receipt.id is null or v_receipt.issued_by is distinct from auth.uid() or not app.has_permission(v_receipt.entity_id, 'receipt:write') then
    raise exception 'Droit insuffisant pour finaliser ce document' using errcode = 'insufficient_privilege';
  end if;
  if v_receipt.file_path is not null then
    raise exception 'Le fichier de ce document est déjà enregistré';
  end if;
  if v_receipt.cancelled_at is not null then
    raise exception 'Ce document est annulé';
  end if;
  if p_path <> v_receipt.entity_id::text || '/' || v_receipt.id::text || '.pdf' then
    raise exception 'Chemin de fichier inattendu';
  end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' or p_size is null or p_size <= 0 then
    raise exception 'Empreinte ou taille invalide';
  end if;

  update public.receipts set file_path = p_path, file_sha256 = p_sha256, file_size = p_size where id = p_id;
  perform app.write_audit(v_receipt.entity_id, 'receipt.file_stored', 'receipts', p_id,
    jsonb_build_object('number', v_receipt.number, 'sha256', p_sha256, 'size', p_size));
end;
$$;

create function app.cancel_receipt(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt public.receipts%rowtype;
begin
  select * into v_receipt from public.receipts where id = p_id for update;
  if v_receipt.id is null or not app.has_permission(v_receipt.entity_id, 'receipt:cancel') then
    raise exception 'Droit insuffisant pour annuler ce document' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  if v_receipt.cancelled_at is not null then
    raise exception 'Ce document est déjà annulé';
  end if;

  update public.receipts set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason) where id = p_id;
  perform app.write_audit(v_receipt.entity_id, 'receipt.cancelled', 'receipts', p_id,
    jsonb_build_object('number', v_receipt.number, 'reason', btrim(p_reason)));
end;
$$;

-- Annule un document et en émet un nouveau (même genre, même échéance), d'un seul tenant : version suivante.
create function app.replace_receipt(p_id uuid, p_reason text, p_issued_on date, p_paid_on date)
returns table (id uuid, number text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_receipt public.receipts%rowtype;
begin
  select * into v_receipt from public.receipts r where r.id = p_id for update;
  if v_receipt.id is null or not app.has_permission(v_receipt.entity_id, 'receipt:cancel')
     or not app.has_permission(v_receipt.entity_id, 'receipt:write') then
    raise exception 'Droit insuffisant pour remplacer ce document' using errcode = 'insufficient_privilege';
  end if;
  perform app.cancel_receipt(p_id, p_reason);
  return query select * from app.issue_receipt_core(v_receipt.kind, v_receipt.rent_charge_id, v_receipt.payment_id, p_issued_on, p_paid_on, p_id, v_receipt.version + 1);
end;
$$;

-- Documents mis à disposition du locataire rattaché : ceux de ses baux, non annulés, déposés, émis avant tout retrait
-- de consentement. Le fichier n'est atteignable que par la route de téléchargement du serveur.
create function app.my_receipts()
returns table (
  id uuid, kind text, number text, entity_name text, property_label text, period_start date, period_end date,
  amount_cents integer, issued_on date, paid_on date, file_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (r.issued_on, r.id) r.id, r.kind, r.number, e.name, p.label, r.period_start, r.period_end, r.amount_cents, r.issued_on, r.paid_on, r.file_path
  from public.tenant_access a
  join public.lease_tenants lt on lt.tenant_id = a.tenant_id
  join public.receipts r on r.lease_id = lt.lease_id and r.entity_id = a.entity_id
  join public.ownership_entities e on e.id = r.entity_id
  join public.leases l on l.id = r.lease_id
  join public.properties p on p.id = l.property_id
  where a.profile_id = auth.uid() and a.status = 'active'
    and r.cancelled_at is null and r.file_path is not null
    and lt.start_date <= r.period_end and coalesce(lt.end_date, 'infinity'::date) >= r.period_start
    and (a.consent_withdrawn_at is null or r.issued_at < a.consent_withdrawn_at)
  order by r.issued_on desc, r.id
$$;

create function public.issue_receipt(p_kind text, p_charge_id uuid, p_payment_id uuid, p_issued_on date, p_paid_on date)
returns table (id uuid, number text)
language sql set search_path = '' as $$ select * from app.issue_receipt(p_kind, p_charge_id, p_payment_id, p_issued_on, p_paid_on) $$;
create function public.attach_receipt_file(p_id uuid, p_path text, p_sha256 text, p_size integer)
returns void
language sql set search_path = '' as $$ select app.attach_receipt_file(p_id, p_path, p_sha256, p_size) $$;
create function public.cancel_receipt(p_id uuid, p_reason text)
returns void
language sql set search_path = '' as $$ select app.cancel_receipt(p_id, p_reason) $$;
create function public.replace_receipt(p_id uuid, p_reason text, p_issued_on date, p_paid_on date)
returns table (id uuid, number text)
language sql set search_path = '' as $$ select * from app.replace_receipt(p_id, p_reason, p_issued_on, p_paid_on) $$;
create function public.my_receipts()
returns table (
  id uuid, kind text, number text, entity_name text, property_label text, period_start date, period_end date,
  amount_cents integer, issued_on date, paid_on date, file_path text
)
language sql stable set search_path = '' as $$ select * from app.my_receipts() $$;

revoke all on function app.guard_receipt_update() from public, anon, authenticated, service_role;
revoke all on function app.guard_allocation_receipts() from public, anon, authenticated, service_role;
revoke all on function app.issue_receipt_core(text, uuid, uuid, date, date, uuid, integer) from public, anon, authenticated, service_role;
revoke all on function app.issue_receipt(text, uuid, uuid, date, date) from public, anon;
revoke all on function app.attach_receipt_file(uuid, text, text, integer) from public, anon;
revoke all on function app.cancel_receipt(uuid, text) from public, anon;
revoke all on function app.replace_receipt(uuid, text, date, date) from public, anon;
revoke all on function app.my_receipts() from public, anon;
revoke all on function public.issue_receipt(text, uuid, uuid, date, date) from public, anon;
revoke all on function public.attach_receipt_file(uuid, text, text, integer) from public, anon;
revoke all on function public.cancel_receipt(uuid, text) from public, anon;
revoke all on function public.replace_receipt(uuid, text, date, date) from public, anon;
revoke all on function public.my_receipts() from public, anon;
grant execute on function app.issue_receipt(text, uuid, uuid, date, date) to authenticated;
grant execute on function app.attach_receipt_file(uuid, text, text, integer) to authenticated;
grant execute on function app.cancel_receipt(uuid, text) to authenticated;
grant execute on function app.replace_receipt(uuid, text, date, date) to authenticated;
grant execute on function app.my_receipts() to authenticated;
grant execute on function public.issue_receipt(text, uuid, uuid, date, date) to authenticated;
grant execute on function public.attach_receipt_file(uuid, text, text, integer) to authenticated;
grant execute on function public.cancel_receipt(uuid, text) to authenticated;
grant execute on function public.replace_receipt(uuid, text, date, date) to authenticated;
grant execute on function public.my_receipts() to authenticated;
