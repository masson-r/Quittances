-- Lot 0 : schéma applicatif non exposé et fonctions utilitaires.
-- Les extensions nécessaires plus tard (pg_cron) sont créées par la migration qui les utilise.

create schema if not exists app;
comment on schema app is 'Fonctions internes, dont les SECURITY DEFINER ; non exposé par l''API.';

grant usage on schema app to authenticated, service_role;
alter default privileges in schema app revoke execute on functions from public;

-- Date du jour à Paris pour un instant donné.
create function app.paris_date(ts timestamptz)
returns date
language sql
immutable
set search_path = ''
as $$
  select (ts at time zone 'Europe/Paris')::date
$$;

-- Date du jour à Paris. Une date imposée (app.today_override) n'est acceptée
-- que si app.environment vaut 'test' : jamais en staging ni en production.
create function public.app_today()
returns date
language plpgsql
stable
set search_path = ''
as $$
declare
  forced text;
begin
  if coalesce(current_setting('app.environment', true), '') = 'test' then
    forced := nullif(current_setting('app.today_override', true), '');
    if forced is not null then
      return forced::date;
    end if;
  end if;
  return app.paris_date(now());
end;
$$;

-- Trigger : maintient updated_at.
create function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function app.paris_date(timestamptz) from public, anon;
revoke all on function public.app_today() from public, anon;
revoke all on function app.set_updated_at() from public, anon;
grant execute on function app.paris_date(timestamptz) to authenticated, service_role;
grant execute on function public.app_today() to authenticated, service_role;
