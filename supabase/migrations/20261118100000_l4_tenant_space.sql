-- Lot 4 : espace du locataire rattaché (L4-02). Trois lectures et une modification, toutes limitées aux dossiers
-- dont le compte connecté a un rattachement actif. Le locataire ne voit ni échéances, ni paiements, ni soldes,
-- ni garant, ni aide au logement, ni le dossier d'un colocataire.

-- Dossiers du compte connecté (rattachement actif) : coordonnées et état du consentement.
create function app.my_tenant_dossiers()
returns table (
  access_id uuid, tenant_id uuid, entity_name text, first_name text, last_name text,
  email text, phone text, address_line1 text, postal_code text, city text,
  consent_withdrawn_at timestamptz, paper_delivery_requested boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, t.id, e.name, t.first_name, t.last_name, t.email, t.phone, t.address_line1, t.postal_code, t.city,
         a.consent_withdrawn_at, t.paper_delivery_requested
  from public.tenant_access a
  join public.tenants t on t.id = a.tenant_id
  join public.ownership_entities e on e.id = a.entity_id
  where a.profile_id = auth.uid() and a.status = 'active'
  order by e.name, t.last_name
$$;

-- Résumé des baux de ces dossiers (y compris terminés) : bien, dates, loyer et charges en vigueur.
create function app.my_tenant_leases()
returns table (
  tenant_id uuid, lease_id uuid, property_label text, address_line1 text, postal_code text, city text,
  start_date date, end_date date, rent_cents integer, charges_cents integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select lt.tenant_id, l.id, p.label, p.address_line1, p.postal_code, p.city, l.start_date, l.end_date,
         term.rent_cents, term.charges_cents
  from public.tenant_access a
  join public.lease_tenants lt on lt.tenant_id = a.tenant_id
  join public.leases l on l.id = lt.lease_id
  join public.properties p on p.id = l.property_id
  left join lateral (
    select r.rent_cents, r.charges_cents
    from public.rental_terms r
    where r.lease_id = l.id and r.effective_from <= greatest(public.app_today(), l.start_date)
    order by r.effective_from desc
    limit 1
  ) term on true
  where a.profile_id = auth.uid() and a.status = 'active'
  order by l.start_date desc, l.id
$$;

-- Le locataire met à jour ses coordonnées de contact. L'e-mail du dossier et le nom restent au propriétaire.
create function app.update_my_contact(p_tenant_id uuid, p_phone text, p_address_line1 text, p_postal_code text, p_city text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity uuid;
begin
  select a.entity_id into v_entity
  from public.tenant_access a
  where a.tenant_id = p_tenant_id and a.profile_id = auth.uid() and a.status = 'active';
  if v_entity is null then
    raise exception 'Dossier introuvable' using errcode = 'insufficient_privilege';
  end if;

  update public.tenants
  set phone = nullif(btrim(coalesce(p_phone, '')), ''),
      address_line1 = nullif(btrim(coalesce(p_address_line1, '')), ''),
      postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
      city = nullif(btrim(coalesce(p_city, '')), '')
  where id = p_tenant_id;
  perform app.write_audit(v_entity, 'tenant.contact_updated_by_tenant', 'tenants', p_tenant_id);
end;
$$;

create function public.my_tenant_dossiers()
returns table (
  access_id uuid, tenant_id uuid, entity_name text, first_name text, last_name text,
  email text, phone text, address_line1 text, postal_code text, city text,
  consent_withdrawn_at timestamptz, paper_delivery_requested boolean
)
language sql stable set search_path = '' as $$ select * from app.my_tenant_dossiers() $$;
create function public.my_tenant_leases()
returns table (
  tenant_id uuid, lease_id uuid, property_label text, address_line1 text, postal_code text, city text,
  start_date date, end_date date, rent_cents integer, charges_cents integer
)
language sql stable set search_path = '' as $$ select * from app.my_tenant_leases() $$;
create function public.update_my_contact(p_tenant_id uuid, p_phone text, p_address_line1 text, p_postal_code text, p_city text)
returns void language sql set search_path = '' as $$ select app.update_my_contact(p_tenant_id, p_phone, p_address_line1, p_postal_code, p_city) $$;

revoke all on function app.my_tenant_dossiers() from public, anon;
revoke all on function public.my_tenant_dossiers() from public, anon;
revoke all on function app.my_tenant_leases() from public, anon;
revoke all on function public.my_tenant_leases() from public, anon;
revoke all on function app.update_my_contact(uuid, text, text, text, text) from public, anon;
revoke all on function public.update_my_contact(uuid, text, text, text, text) from public, anon;
grant execute on function app.my_tenant_dossiers() to authenticated;
grant execute on function public.my_tenant_dossiers() to authenticated;
grant execute on function app.my_tenant_leases() to authenticated;
grant execute on function public.my_tenant_leases() to authenticated;
grant execute on function app.update_my_contact(uuid, text, text, text, text) to authenticated;
grant execute on function public.update_my_contact(uuid, text, text, text, text) to authenticated;
