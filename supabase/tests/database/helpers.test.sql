begin;
select plan(11);

-- paris_date : fuseau de Paris, y compris autour de minuit et du changement d'heure
select is(app.paris_date('2026-01-31 23:30:00+00'), date '2026-02-01', 'hiver (UTC+1) : 23h30 UTC est déjà le lendemain à Paris');
select is(app.paris_date('2026-01-31 22:59:00+00'), date '2026-01-31', 'hiver : 22h59 UTC reste le même jour');
select is(app.paris_date('2026-06-30 22:30:00+00'), date '2026-07-01', 'été (UTC+2) : 22h30 UTC est déjà le lendemain à Paris');
select is(app.paris_date('2026-06-30 21:59:00+00'), date '2026-06-30', 'été : 21h59 UTC reste le même jour');
select is(app.paris_date('2026-03-29 00:30:00+00'), date '2026-03-29', 'nuit du passage à l''heure d''été');

-- app_today : date imposée acceptée uniquement avec app.environment = test
set local app.today_override = '2030-05-17';

set local app.environment = 'production';
select is(public.app_today(), app.paris_date(now()), 'production : la date imposée est ignorée');

set local app.environment = '';
select is(public.app_today(), app.paris_date(now()), 'environnement non défini : la date imposée est ignorée');

set local app.environment = 'test';
select is(public.app_today(), date '2030-05-17', 'test : la date imposée est utilisée');

set local app.today_override = '';
select is(public.app_today(), app.paris_date(now()), 'test sans date imposée : date du jour à Paris');

-- set_updated_at
create temp table t_touch (id int primary key, updated_at timestamptz not null default '2000-01-01');
create trigger t_touch_updated before update on t_touch for each row execute function app.set_updated_at();
insert into t_touch (id) values (1);
update t_touch set id = 1 where id = 1;
select cmp_ok((select updated_at from t_touch), '>', timestamptz '2000-01-01', 'set_updated_at met à jour updated_at');

select has_function('app', 'set_updated_at', 'set_updated_at est dans le schéma app');

select * from finish();
rollback;
