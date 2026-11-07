-- Lot 1 : permissions de l'utilisateur connecté dans une structure, en un seul appel
-- (menu de l'interface). Mêmes règles que has_permission : membre actif, profil actif, second facteur.
create function public.my_permissions(p_entity_id uuid)
returns text[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(rp.permission order by rp.permission), '{}')
  from (select distinct permission from public.role_permissions) rp
  where app.has_permission(p_entity_id, rp.permission)
$$;

revoke all on function public.my_permissions(uuid) from public, anon;
grant execute on function public.my_permissions(uuid) to authenticated;
