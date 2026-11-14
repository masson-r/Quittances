-- Lot R : fin de vie des données (LR-02). Anonymisation manuelle d'un dossier locataire par l'administrateur, utilisable
-- trois ans après la fin du dernier bail. Les lignes financières, les baux et les quittances sont conservés (obligation
-- comptable, accès restreint) : seules les données d'identité et de contact du dossier sont effacées.
-- La purge du journal d'audit à trois ans existe déjà (app.purge_audit_logs, planifiée par pg_cron).

create function app.anonymize_tenant(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant public.tenants%rowtype;
  v_today date := public.app_today();
  v_last_end date;
  v_lease record;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if v_tenant.id is null or not app.has_permission(v_tenant.entity_id, 'structure:write') then
    raise exception 'Droit insuffisant pour anonymiser ce dossier' using errcode = 'insufficient_privilege';
  end if;
  if v_tenant.anonymized_at is not null then
    raise exception 'Ce dossier est déjà anonymisé';
  end if;

  for v_lease in
    select l.id, l.end_date
    from public.leases l
    join public.lease_tenants lt on lt.lease_id = l.id
    where lt.tenant_id = p_tenant_id
    group by l.id, l.end_date
  loop
    if v_lease.end_date is null or v_lease.end_date >= v_today then
      raise exception 'Un bail de ce dossier est encore en cours';
    end if;
    v_last_end := greatest(coalesce(v_last_end, v_lease.end_date), v_lease.end_date);
    if not exists (select 1 from public.charge_settlements s where s.lease_id = v_lease.id and s.is_final and s.cancelled_at is null) then
      raise exception 'Un bail terminé de ce dossier n''a pas d''apurement final : saisissez-le avant d''anonymiser';
    end if;
  end loop;

  if v_last_end is not null and v_last_end > (v_today - interval '3 years')::date then
    raise exception 'L''anonymisation n''est possible que trois ans après la fin du dernier bail (le %)', to_char((v_last_end + interval '3 years')::date, 'DD/MM/YYYY');
  end if;
  if v_last_end is null and v_tenant.archived_at is null then
    raise exception 'Archivez d''abord ce dossier sans bail';
  end if;

  update public.tenants
  set last_name = 'Dossier anonymisé', first_name = '', email = null, phone = null, address_line1 = null, postal_code = null, city = null,
      paper_delivery_requested = false, anonymized_at = now(), archived_at = coalesce(archived_at, now())
  where id = p_tenant_id;

  delete from public.tenant_private_details where tenant_id = p_tenant_id;

  update public.tenant_access set status = 'revoked', ended_at = now(), ended_by = auth.uid() where tenant_id = p_tenant_id and status = 'active';
  update public.tenant_access set status = 'refused', decided_at = now(), decided_by = auth.uid() where tenant_id = p_tenant_id and status = 'pending';
  update public.invitations set revoked_at = now(), revoked_by = auth.uid() where tenant_id = p_tenant_id and used_at is null and revoked_at is null;

  perform app.write_audit(v_tenant.entity_id, 'tenant.anonymized', 'tenants', p_tenant_id);
end;
$$;

create function public.anonymize_tenant(p_tenant_id uuid)
returns void language sql set search_path = '' as $$ select app.anonymize_tenant(p_tenant_id) $$;

revoke all on function app.anonymize_tenant(uuid) from public, anon;
revoke all on function public.anonymize_tenant(uuid) from public, anon;
grant execute on function app.anonymize_tenant(uuid) to authenticated;
grant execute on function public.anonymize_tenant(uuid) to authenticated;
