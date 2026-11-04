-- Lot 1 : désactiver un profil coupe l'accès tout de suite.
-- Sessions et jetons de rafraîchissement supprimés, reconnexion interdite ; l'application refuse
-- aussi le profil à chaque requête (droits relus en base, jamais portés par le jeton de session).

create function app.set_disabled_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'disabled' and old.status <> 'disabled' then
    new.disabled_at := now();
  elsif new.status = 'active' and old.status <> 'active' then
    new.disabled_at := null;
  end if;
  return new;
end;
$$;

create trigger profiles_set_disabled_at
  before update of status on public.profiles
  for each row execute function app.set_disabled_at();

create function app.revoke_sessions_on_disable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'disabled' and old.status <> 'disabled' then
    delete from auth.sessions where user_id = new.id;
    update auth.users set banned_until = 'infinity' where id = new.id;
  elsif new.status = 'active' and old.status <> 'active' then
    update auth.users set banned_until = null where id = new.id;
  end if;
  return new;
end;
$$;

create trigger profiles_revoke_sessions
  after update of status on public.profiles
  for each row execute function app.revoke_sessions_on_disable();

revoke all on function app.set_disabled_at() from public, anon, authenticated, service_role;
revoke all on function app.revoke_sessions_on_disable() from public, anon, authenticated, service_role;
