-- Sub-category (L2) analytics, PRD v1.3 §6.7.1.
--   spend_by_category: new p_level ('parent' | 'leaf') and the extra columns the detail screens need.
--   category_monthly:  p_include_children, default 6 months.
--   top_places:        top payees with the sub-category they were mostly paid under.
--   category_remaining: the median spend in the rest of the month over prior months (the trend projection).
-- All are security invoker (the default), so RLS applies. Pot spending stays out of everything here.

drop function if exists spend_by_category(date, date, uuid, boolean);
create function spend_by_category(p_from date, p_to date, p_parent uuid default null, p_pool_only boolean default false,
                                  p_level text default 'parent')
returns table (category_id uuid, name text, icon text, color text, parent_id uuid,
               total_pence bigint, txn_count int, norm_pence bigint,
               parent_name text, is_fixed boolean, is_parent_direct boolean, visits int)
language sql stable as $$
  with scoped as (
    select t.occurred_on, t.amount_pence,
           case when p_parent is null and p_level = 'parent' then coalesce(c.parent_id, c.id) else c.id end as gid
      from transactions t
      join categories c on c.id = t.category_id
      left join accounts a on a.id = t.account_id
     where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
       and t.occurred_on >= months_back(p_from, 6) and t.occurred_on <= p_to
       and (not p_pool_only or a.counts_as_cash)
       and (p_parent is null or c.id = p_parent or c.parent_id = p_parent)
  ),
  cur as (
    select gid, sum(amount_pence)::bigint as total, count(*)::int as n from scoped
     where occurred_on between p_from and p_to group by gid
  ),
  first_txn as (select min(occurred_on) as d from transactions where deleted_at is null and pot_id is null),
  ks as (
    select k from generate_series(1, 6) k, first_txn
     where months_back(p_from, k) >= first_txn.d
  ),
  prior as (
    select g.gid, k.k, coalesce(sum(s.amount_pence), 0) as total
      from (select distinct gid from scoped) g
      cross join ks k
      left join scoped s on s.gid = g.gid
           and s.occurred_on between months_back(p_from, k.k) and months_back(p_to, k.k)
     group by g.gid, k.k
  ),
  norms as (
    select gid, round(percentile_cont(0.5) within group (order by total))::bigint as norm from prior group by gid
  )
  select c.id, c.name, c.icon, c.color, c.parent_id, cur.total, cur.n, norms.norm,
         pc.name,
         -- a parent is fixed when it has sub-categories and every one of them is
         (coalesce(c.is_fixed, false) or (c.parent_id is null
            and exists (select 1 from categories k where k.parent_id = c.id)
            and not exists (select 1 from categories k where k.parent_id = c.id and not k.is_fixed))),
         (c.parent_id is null and (p_parent is not null or p_level = 'leaf')),
         cur.n
    from cur
    join categories c on c.id = cur.gid
    left join categories pc on pc.id = c.parent_id
    left join norms on norms.gid = cur.gid
   order by cur.total desc, c.name
$$;

drop function if exists category_monthly(uuid, int);
create function category_monthly(p_category uuid, p_months int default 6, p_include_children boolean default true)
returns table (month date, total_pence bigint, txn_count int)
language sql stable as $$
  with months as (
    select g::date as m from generate_series(
      (date_trunc('month', london_today()) - make_interval(months => p_months - 1))::date,
      date_trunc('month', london_today())::date, interval '1 month') g
  ), ids as (
    select c.id from categories c where c.id = p_category or (p_include_children and c.parent_id = p_category)
  )
  select months.m, coalesce(sum(t.amount_pence), 0)::bigint, count(t.id)::int
    from months
    left join transactions t on t.deleted_at is null and t.type = 'expense' and t.pot_id is null
         and t.category_id in (select id from ids)
         and t.occurred_on >= months.m and t.occurred_on < (months.m + interval '1 month')::date
   group by months.m order by months.m
$$;

-- Top payees in a category (and its sub-categories), each with the category most of its money went to.
create function top_places(p_from date, p_to date, p_limit int default 3, p_category uuid default null)
returns table (payee_id uuid, name text, category_id uuid, category_name text, visits int, total_pence bigint)
language sql stable as $$
  with scoped as (
    select t.payee_id, t.category_id, t.amount_pence
      from transactions t
     where t.deleted_at is null and t.type = 'expense' and t.pot_id is null and t.payee_id is not null
       and t.occurred_on between p_from and p_to
       and (p_category is null or t.category_id in (select c.id from categories c where c.id = p_category or c.parent_id = p_category))
  ),
  per_cat as (
    select payee_id, category_id, sum(amount_pence) as s,
           row_number() over (partition by payee_id order by sum(amount_pence) desc, category_id) as rn
      from scoped group by payee_id, category_id
  ),
  per_payee as (select payee_id, count(*)::int as visits, sum(amount_pence)::bigint as total from scoped group by payee_id)
  select p.id, p.name, pc.category_id, c.name, pp.visits, pp.total
    from per_payee pp
    join payees p on p.id = pp.payee_id
    join per_cat pc on pc.payee_id = pp.payee_id and pc.rn = 1
    left join categories c on c.id = pc.category_id
   order by pp.total desc, p.name
   limit p_limit
$$;

-- The projection for a month in progress: spend after the same day of the month, median of the prior p_months months.
create function category_remaining(p_category uuid, p_as_of date, p_months int default 3, p_include_children boolean default true)
returns bigint
language sql stable as $$
  with ids as (
    select c.id from categories c where c.id = p_category or (p_include_children and c.parent_id = p_category)
  ), ks as (select k from generate_series(1, p_months) k),
  per as (
    select k.k, coalesce(sum(t.amount_pence), 0) as s
      from ks k
      left join transactions t on t.deleted_at is null and t.type = 'expense' and t.pot_id is null
           and t.category_id in (select id from ids)
           and t.occurred_on > months_back(p_as_of, k.k)
           and t.occurred_on < (date_trunc('month', months_back(p_as_of, k.k)) + interval '1 month')::date
     group by k.k
  )
  select coalesce(round(percentile_cont(0.5) within group (order by s)), 0)::bigint from per
$$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
