-- Un profil désactivé ne lit plus rien, pas même sa propre ligne de membre (la lecture de son profil reste possible :
-- elle sert à détecter la désactivation et à le déconnecter).
-- Fonction SECURITY DEFINER : lit profiles sans repasser par sa RLS (qui renvoie vers entity_memberships).
create function app.is_active_profile()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') $$;

revoke all on function app.is_active_profile() from public, anon;
grant execute on function app.is_active_profile() to authenticated;

-- allow-destructive: politique remplacée par une version plus stricte, sans perte de donnée
drop policy memberships_select on public.entity_memberships;

create policy memberships_select on public.entity_memberships
  for select to authenticated
  using ((profile_id = auth.uid() and status = 'active' and app.is_active_profile()) or app.has_permission(entity_id, 'member:read'));
