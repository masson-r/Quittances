-- Lot 5 : dépenses, catégories par structure et justificatifs (L5-01).
-- Une dépense est active ou annulée (motif conservé), jamais supprimée. Les justificatifs sont déposés dans le bucket
-- privé `documents` par le serveur (aucune politique Storage) ; la base n'en garde que les métadonnées et l'empreinte.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documents', 'documents', false, 5242880, array['application/pdf', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

----------------------------------------------------------------------------------------------------
-- Catégories (sept par défaut à la création d'une structure, modifiables par l'administrateur seul)
----------------------------------------------------------------------------------------------------

create table public.expense_categories (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  name text not null check (length(btrim(name)) between 1 and 80),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, id)
);

-- Deux catégories actives ne portent pas le même nom dans une structure.
create unique index expense_categories_name_key on public.expense_categories (entity_id, lower(btrim(name))) where archived_at is null;

create trigger expense_categories_set_updated_at
  before update on public.expense_categories
  for each row execute function app.set_updated_at();

alter table public.expense_categories enable row level security;

create function app.seed_expense_categories()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.expense_categories (entity_id, name)
  select new.id, c
  from unnest(array['Travaux', 'Entretien et réparations', 'Assurance', 'Taxe foncière', 'Charges de copropriété', 'Frais de gestion', 'Autres dépenses']) as c;
  return new;
end;
$$;

create trigger ownership_entities_seed_categories
  after insert on public.ownership_entities
  for each row execute function app.seed_expense_categories();

-- Structures déjà créées.
insert into public.expense_categories (entity_id, name)
select e.id, c
from public.ownership_entities e,
     unnest(array['Travaux', 'Entretien et réparations', 'Assurance', 'Taxe foncière', 'Charges de copropriété', 'Frais de gestion', 'Autres dépenses']) as c
where not exists (select 1 from public.expense_categories x where x.entity_id = e.id);

create policy expense_categories_select on public.expense_categories
  for select to authenticated using (app.has_permission(entity_id, 'expense_category:read'));
create policy expense_categories_insert on public.expense_categories
  for insert to authenticated with check (app.has_permission(entity_id, 'expense_category:write'));
create policy expense_categories_update on public.expense_categories
  for update to authenticated
  using (app.has_permission(entity_id, 'expense_category:write'))
  with check (app.has_permission(entity_id, 'expense_category:write'));

revoke all on public.expense_categories from public, anon, authenticated, service_role;
grant select on public.expense_categories to authenticated, service_role;
grant insert (entity_id, name) on public.expense_categories to authenticated;
grant update (name, archived_at) on public.expense_categories to authenticated;

create function app.audit_expense_category()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Les sept catégories par défaut, insérées par le déclencheur de création de structure, ne sont pas tracées une à une.
    if pg_trigger_depth() > 1 then
      return new;
    end if;
    perform app.write_audit(new.entity_id, 'expense_category.created', 'expense_categories', new.id);
  elsif new.name is distinct from old.name then
    perform app.write_audit(new.entity_id, 'expense_category.renamed', 'expense_categories', new.id);
  elsif old.archived_at is null and new.archived_at is not null then
    perform app.write_audit(new.entity_id, 'expense_category.archived', 'expense_categories', new.id);
  elsif old.archived_at is not null and new.archived_at is null then
    perform app.write_audit(new.entity_id, 'expense_category.restored', 'expense_categories', new.id);
  end if;
  return new;
end;
$$;

create trigger expense_categories_audit
  after insert or update on public.expense_categories
  for each row execute function app.audit_expense_category();

----------------------------------------------------------------------------------------------------
-- Justificatifs (dépenses et apurements) : métadonnées seulement
----------------------------------------------------------------------------------------------------

create table public.documents (
  id uuid primary key,
  entity_id uuid not null references public.ownership_entities (id),
  file_path text not null,
  content_type text not null check (content_type in ('application/pdf', 'image/png', 'image/jpeg')),
  byte_size integer not null check (byte_size between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  original_name text not null check (length(btrim(original_name)) between 1 and 200),
  created_by uuid not null references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (entity_id, id),
  check (file_path = entity_id::text || '/' || id::text)
);

alter table public.documents enable row level security;
create trigger documents_no_delete before delete on public.documents for each row execute function app.refuse_delete();

create function app.documents_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Un justificatif enregistré ne se modifie pas';
end;
$$;
create trigger documents_no_update before update on public.documents for each row execute function app.documents_immutable();

create policy documents_select on public.documents
  for select to authenticated
  using (app.has_permission(entity_id, 'expense:read') or app.has_permission(entity_id, 'settlement:read'));
create policy documents_insert on public.documents
  for insert to authenticated
  with check (created_by = auth.uid() and (app.has_permission(entity_id, 'expense:write') or app.has_permission(entity_id, 'settlement:write')));

revoke all on public.documents from public, anon, authenticated, service_role;
grant select on public.documents to authenticated, service_role;
grant insert (id, entity_id, file_path, content_type, byte_size, sha256, original_name, created_by) on public.documents to authenticated;

create function app.audit_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.write_audit(new.entity_id, 'document.registered', 'documents', new.id,
    jsonb_build_object('sha256', new.sha256, 'byte_size', new.byte_size, 'content_type', new.content_type));
  return new;
end;
$$;
create trigger documents_audit after insert on public.documents for each row execute function app.audit_document();

alter table public.charge_settlements
  add constraint charge_settlements_document_fk foreign key (entity_id, document_id) references public.documents (entity_id, id);

----------------------------------------------------------------------------------------------------
-- Dépenses
----------------------------------------------------------------------------------------------------

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  property_id uuid not null,
  category_id uuid not null,
  expense_date date not null,
  description text not null check (length(btrim(description)) between 1 and 500),
  amount_cents integer not null check (amount_cents > 0),
  recoverable boolean not null default false,
  document_id uuid,
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
  foreign key (entity_id, property_id) references public.properties (entity_id, id),
  foreign key (entity_id, category_id) references public.expense_categories (entity_id, id),
  foreign key (entity_id, document_id) references public.documents (entity_id, id),
  foreign key (entity_id, import_batch_id) references public.import_batches (entity_id, id)
);

create unique index expenses_external_ref_key on public.expenses (entity_id, external_ref) where external_ref is not null;
create index expenses_entity_date_idx on public.expenses (entity_id, expense_date desc);
create index expenses_property_idx on public.expenses (property_id);

create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function app.set_updated_at();
create trigger expenses_no_delete before delete on public.expenses for each row execute function app.refuse_delete();

-- Pas de date future ; une dépense annulée ne change plus ; la structure et l'auteur sont figés.
create function app.guard_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expense_date > public.app_today() then
    raise exception 'La date d''une dépense ne peut pas être dans le futur';
  end if;
  if tg_op = 'UPDATE' then
    if new.entity_id <> old.entity_id or new.created_by is distinct from old.created_by
       or new.external_ref is distinct from old.external_ref or new.import_batch_id is distinct from old.import_batch_id then
      raise exception 'La structure et l''origine d''une dépense ne changent pas';
    end if;
    if old.cancelled_at is not null then
      raise exception 'Une dépense annulée ne se modifie plus';
    end if;
  end if;
  return new;
end;
$$;

create trigger expenses_guard
  before insert or update on public.expenses
  for each row execute function app.guard_expense();

alter table public.expenses enable row level security;

create policy expenses_select on public.expenses
  for select to authenticated using (app.has_permission(entity_id, 'expense:read'));
create policy expenses_insert on public.expenses
  for insert to authenticated with check (app.has_permission(entity_id, 'expense:write') and created_by = auth.uid());
create policy expenses_update on public.expenses
  for update to authenticated
  using (app.has_permission(entity_id, 'expense:write'))
  with check (app.has_permission(entity_id, 'expense:write'));

revoke all on public.expenses from public, anon, authenticated, service_role;
grant select on public.expenses to authenticated, service_role;
grant insert (entity_id, property_id, category_id, expense_date, description, amount_cents, recoverable, document_id, created_by) on public.expenses to authenticated;
grant update (property_id, category_id, expense_date, description, amount_cents, recoverable, document_id, cancelled_at, cancelled_by, cancellation_reason) on public.expenses to authenticated;
grant insert, update on public.expenses to service_role;

create function app.audit_expense()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform app.write_audit(new.entity_id, 'expense.created', 'expenses', new.id, jsonb_build_object('amount_cents', new.amount_cents));
  elsif old.cancelled_at is null and new.cancelled_at is not null then
    perform app.write_audit(new.entity_id, 'expense.cancelled', 'expenses', new.id,
      jsonb_build_object('amount_cents', new.amount_cents, 'reason', new.cancellation_reason));
  else
    perform app.write_audit(new.entity_id, 'expense.updated', 'expenses', new.id,
      jsonb_strip_nulls(jsonb_build_object(
        'amount_cents', case when new.amount_cents <> old.amount_cents then jsonb_build_object('from', old.amount_cents, 'to', new.amount_cents) end,
        'expense_date', case when new.expense_date <> old.expense_date then jsonb_build_object('from', old.expense_date, 'to', new.expense_date) end,
        'category_changed', case when new.category_id <> old.category_id then true end,
        'property_changed', case when new.property_id <> old.property_id then true end)));
  end if;
  return new;
end;
$$;

create trigger expenses_audit
  after insert or update on public.expenses
  for each row execute function app.audit_expense();

-- Annulation avec motif, réservée à expense:cancel (la RLS ne distingue pas l'annulation d'une modification).
create function public.cancel_expense(p_expense_id uuid, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_entity uuid;
  n integer;
begin
  select e.entity_id into v_entity from public.expenses e where e.id = p_expense_id;
  if v_entity is null or not app.has_permission(v_entity, 'expense:cancel') then
    raise exception 'Droit insuffisant pour annuler cette dépense' using errcode = 'insufficient_privilege';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception 'Le motif est obligatoire';
  end if;
  update public.expenses
  set cancelled_at = now(), cancelled_by = auth.uid(), cancellation_reason = btrim(p_reason)
  where id = p_expense_id and cancelled_at is null;
  get diagnostics n = row_count;
  if n = 0 then
    raise exception 'Cette dépense est déjà annulée';
  end if;
end;
$$;

revoke all on function app.seed_expense_categories() from public, anon, authenticated, service_role;
revoke all on function app.audit_expense_category() from public, anon, authenticated, service_role;
revoke all on function app.documents_immutable() from public, anon, authenticated, service_role;
revoke all on function app.audit_document() from public, anon, authenticated, service_role;
revoke all on function app.guard_expense() from public, anon, authenticated, service_role;
revoke all on function app.audit_expense() from public, anon, authenticated, service_role;
revoke all on function public.cancel_expense(uuid, text) from public, anon;
grant execute on function public.cancel_expense(uuid, text) to authenticated;
