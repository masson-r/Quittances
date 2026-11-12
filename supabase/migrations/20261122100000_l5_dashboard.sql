-- Lot 5 : tableau de bord (L5-02). Trois fonctions SQL calculées à la demande, sans vue matérialisée ni total stocké,
-- exécutées sous les droits de l'utilisateur : la RLS limite les lignes aux structures dont il est membre.
--
-- Définitions (ticket 010) :
--   appelé      = échéances non annulées dont la date d'échéance est dans la période ;
--   encaissé    = paiements non annulés dont la date de réception est dans la période (base trésorerie, affectés ou non) ;
--   dépenses    = dépenses non annulées dont la date est dans la période ;
--   remboursements nets = somme signée des apurements de charges à leur date (les compléments reçus ne comptent pas dans l'encaissé) ;
--   solde de trésorerie estimé = encaissé - dépenses - remboursements nets (n'est pas un résultat fiscal) ;
--   restant dû  = soldes courants des échéances non annulées échues à la fin de la période (bornée à aujourd'hui) ou avant ;
--   impayés échus = soldes des échéances en retard, sur tout l'historique de la sélection ;
--   à affecter  = part des paiements non annulés qui n'est affectée à aucune échéance, à ce jour.
-- Filtres : structures (null = toutes celles que l'utilisateur voit) et biens (null = tous).

create function public.dashboard_summary(p_entity_ids uuid[], p_property_ids uuid[], p_from date, p_to date)
returns table (
  active_properties integer, running_leases integer, active_tenants integer,
  called_cents bigint, collected_cents bigint, expenses_cents bigint, refunds_net_cents bigint, estimated_balance_cents bigint,
  remaining_due_cents bigint, overdue_cents bigint, overdue_count integer, overdue_max_days integer,
  to_allocate_cents bigint, final_settlements_pending integer
)
language sql
stable
set search_path = ''
as $$
  with today as (select public.app_today() as d),
  props as (
    select p.id, p.entity_id, p.archived_at
    from public.properties p
    where (p_entity_ids is null or p.entity_id = any (p_entity_ids)) and (p_property_ids is null or p.id = any (p_property_ids))
  ),
  lease_set as (
    select l.id, l.entity_id, l.start_date, l.end_date from public.leases l join props on props.id = l.property_id
  ),
  charges as (
    select b.* from public.rent_charge_balances b join lease_set ls on ls.id = b.lease_id where b.cancelled_at is null
  ),
  pays as (
    select pay.* from public.payments pay join lease_set ls on ls.id = pay.lease_id where pay.cancelled_at is null
  )
  select
    (select count(*) from props where archived_at is null)::integer,
    (select count(*) from lease_set, today where start_date <= today.d and (end_date is null or end_date >= today.d))::integer,
    (select count(distinct lt.tenant_id)
       from public.lease_tenants lt
       join lease_set ls on ls.id = lt.lease_id, today
       where ls.start_date <= today.d and (ls.end_date is null or ls.end_date >= today.d)
         and lt.start_date <= today.d and (lt.end_date is null or lt.end_date >= today.d))::integer,
    (select coalesce(sum(total_cents), 0) from charges where due_on between p_from and p_to)::bigint,
    (select coalesce(sum(amount_cents), 0) from pays where received_on between p_from and p_to)::bigint,
    (select coalesce(sum(e.amount_cents), 0)
       from public.expenses e join props on props.id = e.property_id
       where e.cancelled_at is null and e.expense_date between p_from and p_to)::bigint,
    (select coalesce(sum(s.amount_cents), 0)
       from public.charge_settlements s join lease_set ls on ls.id = s.lease_id
       where s.cancelled_at is null and s.settled_on between p_from and p_to)::bigint,
    (
      (select coalesce(sum(amount_cents), 0) from pays where received_on between p_from and p_to)
      - (select coalesce(sum(e.amount_cents), 0) from public.expenses e join props on props.id = e.property_id
         where e.cancelled_at is null and e.expense_date between p_from and p_to)
      - (select coalesce(sum(s.amount_cents), 0) from public.charge_settlements s join lease_set ls on ls.id = s.lease_id
         where s.cancelled_at is null and s.settled_on between p_from and p_to)
    )::bigint,
    (select coalesce(sum(balance_cents), 0) from charges, today where due_on <= least(p_to, today.d))::bigint,
    (select coalesce(sum(balance_cents), 0) from charges where status = 'late')::bigint,
    (select count(*) from charges where status = 'late')::integer,
    (select coalesce(max(today.d - due_on), 0) from charges, today where status = 'late')::integer,
    (select coalesce(sum(pays.amount_cents - coalesce((
        select sum(a.amount_cents) from public.payment_allocations a where a.payment_id = pays.id and a.reversed_at is null), 0)), 0) from pays)::bigint,
    (select count(*) from lease_set ls, today
       where ls.end_date is not null and ls.end_date < today.d
         and not exists (select 1 from public.charge_settlements s where s.lease_id = ls.id and s.is_final and s.cancelled_at is null))::integer
$$;

create function public.dashboard_monthly(p_entity_ids uuid[], p_property_ids uuid[], p_from date, p_to date)
returns table (month date, called_cents bigint, collected_cents bigint, expenses_cents bigint)
language sql
stable
set search_path = ''
as $$
  with props as (
    select p.id from public.properties p
    where (p_entity_ids is null or p.entity_id = any (p_entity_ids)) and (p_property_ids is null or p.id = any (p_property_ids))
  ),
  lease_set as (select l.id from public.leases l join props on props.id = l.property_id),
  months as (
    select generate_series(date_trunc('month', p_from)::date, date_trunc('month', p_to)::date, interval '1 month')::date as m
  )
  select
    months.m,
    (select coalesce(sum(c.total_cents), 0) from public.rent_charges c join lease_set ls on ls.id = c.lease_id
       where c.cancelled_at is null and c.due_on between greatest(months.m, p_from) and least((months.m + interval '1 month - 1 day')::date, p_to))::bigint,
    (select coalesce(sum(pay.amount_cents), 0) from public.payments pay join lease_set ls on ls.id = pay.lease_id
       where pay.cancelled_at is null and pay.received_on between greatest(months.m, p_from) and least((months.m + interval '1 month - 1 day')::date, p_to))::bigint,
    (select coalesce(sum(e.amount_cents), 0) from public.expenses e join props on props.id = e.property_id
       where e.cancelled_at is null and e.expense_date between greatest(months.m, p_from) and least((months.m + interval '1 month - 1 day')::date, p_to))::bigint
  from months
  order by months.m
$$;

create function public.dashboard_by_property(p_entity_ids uuid[], p_property_ids uuid[], p_from date, p_to date)
returns table (
  entity_id uuid, entity_name text, property_id uuid, property_label text,
  called_cents bigint, collected_cents bigint, overdue_cents bigint, expenses_cents bigint, refunds_net_cents bigint, estimated_balance_cents bigint
)
language sql
stable
set search_path = ''
as $$
  select
    p.entity_id,
    e.name,
    p.id,
    p.label,
    (select coalesce(sum(c.total_cents), 0) from public.rent_charges c join public.leases l on l.id = c.lease_id
       where l.property_id = p.id and c.cancelled_at is null and c.due_on between p_from and p_to)::bigint,
    (select coalesce(sum(pay.amount_cents), 0) from public.payments pay join public.leases l on l.id = pay.lease_id
       where l.property_id = p.id and pay.cancelled_at is null and pay.received_on between p_from and p_to)::bigint,
    (select coalesce(sum(b.balance_cents), 0) from public.rent_charge_balances b join public.leases l on l.id = b.lease_id
       where l.property_id = p.id and b.status = 'late')::bigint,
    (select coalesce(sum(x.amount_cents), 0) from public.expenses x
       where x.property_id = p.id and x.cancelled_at is null and x.expense_date between p_from and p_to)::bigint,
    (select coalesce(sum(s.amount_cents), 0) from public.charge_settlements s join public.leases l on l.id = s.lease_id
       where l.property_id = p.id and s.cancelled_at is null and s.settled_on between p_from and p_to)::bigint,
    (
      (select coalesce(sum(pay.amount_cents), 0) from public.payments pay join public.leases l on l.id = pay.lease_id
         where l.property_id = p.id and pay.cancelled_at is null and pay.received_on between p_from and p_to)
      - (select coalesce(sum(x.amount_cents), 0) from public.expenses x
         where x.property_id = p.id and x.cancelled_at is null and x.expense_date between p_from and p_to)
      - (select coalesce(sum(s.amount_cents), 0) from public.charge_settlements s join public.leases l on l.id = s.lease_id
         where l.property_id = p.id and s.cancelled_at is null and s.settled_on between p_from and p_to)
    )::bigint
  from public.properties p
  join public.ownership_entities e on e.id = p.entity_id
  where (p_entity_ids is null or p.entity_id = any (p_entity_ids)) and (p_property_ids is null or p.id = any (p_property_ids))
  order by e.name, p.label
$$;

revoke all on function public.dashboard_summary(uuid[], uuid[], date, date) from public, anon;
revoke all on function public.dashboard_monthly(uuid[], uuid[], date, date) from public, anon;
revoke all on function public.dashboard_by_property(uuid[], uuid[], date, date) from public, anon;
grant execute on function public.dashboard_summary(uuid[], uuid[], date, date) to authenticated;
grant execute on function public.dashboard_monthly(uuid[], uuid[], date, date) to authenticated;
grant execute on function public.dashboard_by_property(uuid[], uuid[], date, date) to authenticated;
