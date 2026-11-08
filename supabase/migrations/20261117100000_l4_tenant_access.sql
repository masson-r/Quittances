-- Lot 4 : rattachement d'un compte locataire à un dossier (L4-01).
-- Invitation de locataire (lien privé), demande de rattachement avec consentement à la remise dématérialisée,
-- validation ou refus par le propriétaire, révocation (propriétaire ou locataire), retrait du consentement, expiration.
--
-- Le locataire n'a aucun accès direct à la table : tout passe par des fonctions SECURITY DEFINER de `app`, qui lisent
-- l'utilisateur dans la session (auth.uid()), jamais dans un paramètre. Un rattachement ne repose jamais sur l'e-mail seul.

create table public.tenant_access (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.ownership_entities (id),
  tenant_id uuid not null,
  profile_id uuid not null references public.profiles (id),
  invitation_id uuid not null references public.invitations (id),
  status text not null default 'pending' check (status in ('pending', 'active', 'refused', 'revoked', 'expired')),
  -- Consentement exprès à la remise dématérialisée : profil, date et heure, version du texte.
  consent_at timestamptz not null default now(),
  consent_version text not null check (length(btrim(consent_version)) > 0),
  consent_withdrawn_at timestamptz,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references public.profiles (id),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id),
  foreign key (entity_id, tenant_id) references public.tenants (entity_id, id),
  check ((status in ('active', 'refused') and decided_at is not null) or status in ('pending', 'revoked', 'expired')),
  check ((status in ('revoked', 'expired')) = (ended_at is not null) or status = 'active')
);

-- Un dossier a au plus un profil actif ; un profil n'a qu'une demande en attente par dossier.
create unique index tenant_access_active_key on public.tenant_access (tenant_id) where status = 'active';
create unique index tenant_access_pending_key on public.tenant_access (tenant_id, profile_id) where status = 'pending';
create index tenant_access_entity_idx on public.tenant_access (entity_id, status);
create index tenant_access_profile_idx on public.tenant_access (profile_id);

alter table public.tenant_access enable row level security;

-- Le propriétaire lit les rattachements de sa structure (sans e-mail de compte : voir tenant_access_overview).
create policy tenant_access_select on public.tenant_access
  for select to authenticated
  using (app.has_permission(entity_id, 'tenant:read'));

revoke all on public.tenant_access from public, anon, authenticated, service_role;
grant select on public.tenant_access to authenticated;
grant select on public.tenant_access to service_role;

----------------------------------------------------------------------------------------------------
-- Invitation de locataire (lien privé de 14 jours, régénérable)
----------------------------------------------------------------------------------------------------

create function public.create_tenant_invitation(p_tenant_id uuid)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_entity uuid;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  select t.entity_id into v_entity
  from public.tenants t
  where t.id = p_tenant_id and t.archived_at is null and t.anonymized_at is null;
  if v_entity is null or not app.has_permission(v_entity, 'tenant:write') then
    raise exception 'Droit insuffisant pour inviter ce locataire' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.tenant_access a where a.tenant_id = p_tenant_id and a.status = 'active') then
    raise exception 'Ce dossier est déjà rattaché à un compte : révoquez le rattachement avant de réinviter';
  end if;

  update public.invitations
  set revoked_at = now(), revoked_by = auth.uid()
  where tenant_id = p_tenant_id and kind = 'tenant' and used_at is null and revoked_at is null;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.invitations (entity_id, kind, tenant_id, token_hash, created_by)
  values (v_entity, 'tenant', p_tenant_id, encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), auth.uid())
  returning id, public.invitations.expires_at into v_id, v_expires;

  return query select v_id, v_token, v_expires;
end;
$$;

----------------------------------------------------------------------------------------------------
-- Demande de rattachement (consommation du lien par le locataire connecté)
----------------------------------------------------------------------------------------------------

-- Résultat : 'ok' (demande en attente créée), 'invalid' (message unique pour tout lien inutilisable, compte sans
-- e-mail vérifié, dossier déjà rattaché…), 'locked' (10 essais ratés en une heure) ou 'consent_required'
-- (sans consentement, rien n'est consommé ni enregistré, quel que soit le lien).
create function app.consume_tenant_invitation(p_token text, p_client_key text, p_consent boolean, p_consent_version text)
returns table (status text, request_id uuid, entity_name text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_hash text;
  v_inv record;
  v_request uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'Connexion requise' using errcode = 'insufficient_privilege';
  end if;

  if (
    select count(*)
    from public.invitation_attempts a
    where a.attempted_at > now() - interval '1 hour'
      and (a.profile_id = v_uid or (p_client_key is not null and a.client_key = p_client_key))
  ) >= 10 then
    return query select 'locked'::text, null::uuid, null::text;
    return;
  end if;

  if p_consent is distinct from true or btrim(coalesce(p_consent_version, '')) = '' then
    return query select 'consent_required'::text, null::uuid, null::text;
    return;
  end if;

  v_hash := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  select i.* into v_inv
  from public.invitations i
  where i.token_hash = v_hash and i.kind = 'tenant' and i.used_at is null and i.revoked_at is null and i.expires_at > now()
  for update;

  if v_inv.id is null
     or not exists (select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null)
     or not exists (select 1 from public.profiles p where p.id = v_uid and p.status = 'active')
     or not exists (select 1 from public.tenants t where t.id = v_inv.tenant_id and t.archived_at is null and t.anonymized_at is null)
     or exists (select 1 from public.tenant_access a where a.tenant_id = v_inv.tenant_id and a.status = 'active') then
    insert into public.invitation_attempts (profile_id, client_key) values (v_uid, p_client_key);
    return query select 'invalid'::text, null::uuid, null::text;
    return;
  end if;

  insert into public.tenant_access (entity_id, tenant_id, profile_id, invitation_id, consent_version)
  values (v_inv.entity_id, v_inv.tenant_id, v_uid, v_inv.id, btrim(p_consent_version))
  on conflict do nothing
  returning id into v_request;

  if v_request is null then
    insert into public.invitation_attempts (profile_id, client_key) values (v_uid, p_client_key);
    return query select 'invalid'::text, null::uuid, null::text;
    return;
  end if;

  update public.invitations set used_at = now(), used_by = v_uid where id = v_inv.id;
  delete from public.invitation_attempts where profile_id = v_uid;
  perform app.write_audit(v_inv.entity_id, 'tenant_access.requested', 'tenant_access', v_request,
    jsonb_build_object('tenant_id', v_inv.tenant_id, 'consent_version', btrim(p_consent_version)));

  select e.name into v_name from public.ownership_entities e where e.id = v_inv.entity_id;
  return query select 'ok'::text, v_request, v_name;
end;
$$;

create function public.consume_tenant_invitation(p_token text, p_client_key text, p_consent boolean, p_consent_version text)
returns table (status text, request_id uuid, entity_name text)
language sql
set search_path = ''
as $$ select * from app.consume_tenant_invitation(p_token, p_client_key, p_consent, p_consent_version) $$;

----------------------------------------------------------------------------------------------------
-- Décision du propriétaire, révocation, retrait du consentement
----------------------------------------------------------------------------------------------------

-- Valide (p_approve = true) ou refuse une demande en attente. Droit tenant:write relu en base.
create function app.decide_tenant_access(p_request_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.tenant_access;
begin
  select * into v_req from public.tenant_access where id = p_request_id for update;
  if v_req.id is null or not app.has_permission(v_req.entity_id, 'tenant:write') then
    raise exception 'Droit insuffisant pour décider de cette demande' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'Cette demande a déjà été traitée ou a expiré';
  end if;
  if p_approve and exists (select 1 from public.tenant_access a where a.tenant_id = v_req.tenant_id and a.status = 'active') then
    raise exception 'Ce dossier est déjà rattaché à un compte';
  end if;

  update public.tenant_access
  set status = case when p_approve then 'active' else 'refused' end, decided_at = now(), decided_by = auth.uid()
  where id = p_request_id;
  perform app.write_audit(v_req.entity_id, case when p_approve then 'tenant_access.approved' else 'tenant_access.refused' end,
    'tenant_access', p_request_id, jsonb_build_object('tenant_id', v_req.tenant_id));
end;
$$;

-- Révocation d'un rattachement actif, par le propriétaire (tenant:write) ou par le locataire lui-même (détachement).
create function app.revoke_tenant_access(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.tenant_access;
begin
  select * into v_req from public.tenant_access where id = p_request_id for update;
  if v_req.id is null or not (v_req.profile_id = auth.uid() or app.has_permission(v_req.entity_id, 'tenant:write')) then
    raise exception 'Droit insuffisant pour révoquer ce rattachement' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'active' then
    raise exception 'Ce rattachement n''est pas actif';
  end if;

  update public.tenant_access set status = 'revoked', ended_at = now(), ended_by = auth.uid() where id = p_request_id;
  perform app.write_audit(v_req.entity_id, 'tenant_access.revoked', 'tenant_access', p_request_id,
    jsonb_build_object('tenant_id', v_req.tenant_id, 'by_tenant', v_req.profile_id = auth.uid()));
end;
$$;

-- Retrait du consentement par le locataire : « remise papier demandée » sur le dossier, visible du propriétaire.
-- Le rattachement reste actif ; les nouvelles quittances ne sont plus mises à disposition en ligne (L4-05).
create function app.withdraw_tenant_consent(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.tenant_access;
begin
  select * into v_req from public.tenant_access where id = p_request_id and profile_id = auth.uid() for update;
  if v_req.id is null then
    raise exception 'Rattachement introuvable' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'active' then
    raise exception 'Ce rattachement n''est pas actif';
  end if;
  if v_req.consent_withdrawn_at is not null then
    return;
  end if;

  update public.tenant_access set consent_withdrawn_at = now() where id = p_request_id;
  update public.tenants set paper_delivery_requested = true where id = v_req.tenant_id;
  perform app.write_audit(v_req.entity_id, 'tenant_access.consent_withdrawn', 'tenant_access', p_request_id,
    jsonb_build_object('tenant_id', v_req.tenant_id));
end;
$$;

-- Expiration quotidienne des demandes en attente depuis plus de 30 jours (idempotente). Renvoie le nombre expiré.
create function app.expire_tenant_access()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_count integer := 0;
begin
  for v_row in
    update public.tenant_access
    set status = 'expired', ended_at = now()
    where status = 'pending' and requested_at < now() - interval '30 days'
    returning id, entity_id, tenant_id
  loop
    v_count := v_count + 1;
    perform app.write_audit(v_row.entity_id, 'tenant_access.expired', 'tenant_access', v_row.id,
      jsonb_build_object('tenant_id', v_row.tenant_id));
  end loop;
  return v_count;
end;
$$;

select cron.schedule('expire-tenant-access', '20 0 * * *', 'select app.expire_tenant_access()');

----------------------------------------------------------------------------------------------------
-- Lectures
----------------------------------------------------------------------------------------------------

-- Demandes du locataire connecté : statut et nom de la structure, rien d'autre.
create function app.my_tenant_access()
returns table (
  id uuid, entity_name text, status text, requested_at timestamptz, decided_at timestamptz,
  ended_at timestamptz, consent_withdrawn_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, e.name, a.status, a.requested_at, a.decided_at, a.ended_at, a.consent_withdrawn_at
  from public.tenant_access a
  join public.ownership_entities e on e.id = a.entity_id
  where a.profile_id = auth.uid()
  order by a.requested_at desc
$$;

-- Vue du propriétaire (tenant:write) : e-mail du compte et du dossier, avec indicateur d'écart.
create function app.tenant_access_overview(p_entity_id uuid)
returns table (
  id uuid, tenant_id uuid, tenant_name text, tenant_email text, account_email text, email_mismatch boolean,
  status text, requested_at timestamptz, decided_at timestamptz, ended_at timestamptz, consent_withdrawn_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.has_permission(p_entity_id, 'tenant:write') then
    raise exception 'Droit insuffisant pour consulter les rattachements' using errcode = 'insufficient_privilege';
  end if;
  return query
    select a.id, a.tenant_id, btrim(t.first_name || ' ' || t.last_name), t.email, p.email,
           lower(coalesce(t.email, '')) <> lower(p.email),
           a.status, a.requested_at, a.decided_at, a.ended_at, a.consent_withdrawn_at
    from public.tenant_access a
    join public.tenants t on t.id = a.tenant_id
    join public.profiles p on p.id = a.profile_id
    where a.entity_id = p_entity_id
    order by (a.status = 'pending') desc, a.requested_at desc;
end;
$$;

create function public.decide_tenant_access(p_request_id uuid, p_approve boolean)
returns void language sql set search_path = '' as $$ select app.decide_tenant_access(p_request_id, p_approve) $$;
create function public.revoke_tenant_access(p_request_id uuid)
returns void language sql set search_path = '' as $$ select app.revoke_tenant_access(p_request_id) $$;
create function public.withdraw_tenant_consent(p_request_id uuid)
returns void language sql set search_path = '' as $$ select app.withdraw_tenant_consent(p_request_id) $$;
create function public.my_tenant_access()
returns table (
  id uuid, entity_name text, status text, requested_at timestamptz, decided_at timestamptz,
  ended_at timestamptz, consent_withdrawn_at timestamptz
)
language sql stable set search_path = '' as $$ select * from app.my_tenant_access() $$;
create function public.tenant_access_overview(p_entity_id uuid)
returns table (
  id uuid, tenant_id uuid, tenant_name text, tenant_email text, account_email text, email_mismatch boolean,
  status text, requested_at timestamptz, decided_at timestamptz, ended_at timestamptz, consent_withdrawn_at timestamptz
)
language sql stable set search_path = '' as $$ select * from app.tenant_access_overview(p_entity_id) $$;

revoke all on function public.create_tenant_invitation(uuid) from public, anon;
revoke all on function app.consume_tenant_invitation(text, text, boolean, text) from public, anon;
revoke all on function public.consume_tenant_invitation(text, text, boolean, text) from public, anon;
revoke all on function app.decide_tenant_access(uuid, boolean) from public, anon;
revoke all on function public.decide_tenant_access(uuid, boolean) from public, anon;
revoke all on function app.revoke_tenant_access(uuid) from public, anon;
revoke all on function public.revoke_tenant_access(uuid) from public, anon;
revoke all on function app.withdraw_tenant_consent(uuid) from public, anon;
revoke all on function public.withdraw_tenant_consent(uuid) from public, anon;
revoke all on function app.expire_tenant_access() from public, anon, authenticated, service_role;
revoke all on function app.my_tenant_access() from public, anon;
revoke all on function public.my_tenant_access() from public, anon;
revoke all on function app.tenant_access_overview(uuid) from public, anon;
revoke all on function public.tenant_access_overview(uuid) from public, anon;

grant execute on function public.create_tenant_invitation(uuid) to authenticated;
grant execute on function app.consume_tenant_invitation(text, text, boolean, text) to authenticated;
grant execute on function public.consume_tenant_invitation(text, text, boolean, text) to authenticated;
grant execute on function app.decide_tenant_access(uuid, boolean) to authenticated;
grant execute on function public.decide_tenant_access(uuid, boolean) to authenticated;
grant execute on function app.revoke_tenant_access(uuid) to authenticated;
grant execute on function public.revoke_tenant_access(uuid) to authenticated;
grant execute on function app.withdraw_tenant_consent(uuid) to authenticated;
grant execute on function public.withdraw_tenant_consent(uuid) to authenticated;
grant execute on function app.my_tenant_access() to authenticated;
grant execute on function public.my_tenant_access() to authenticated;
grant execute on function app.tenant_access_overview(uuid) to authenticated;
grant execute on function public.tenant_access_overview(uuid) to authenticated;
