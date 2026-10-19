-- Sterling: the single source of truth for balances and available cash (PRD §10.4).
-- All functions are security invoker, so RLS applies. Nothing derived is ever stored.

-- Signed effect of each transaction on each account it touches (a transfer touches two).
--   expense: -amount on account_id            income: +amount on account_id
--   transfer: -amount on account_id, +amount on counter_account_id
--   adjustment: +amount (already signed) on account_id
create view txn_effects with (security_invoker = true) as
  select t.id as txn_id, t.user_id, t.account_id, t.counter_account_id as other_account_id,
         t.occurred_on, t.type, t.category_id, t.payee_id, t.amount_pence,
         case t.type when 'expense' then -t.amount_pence
                     when 'income' then t.amount_pence
                     when 'transfer' then -t.amount_pence
                     else t.amount_pence end as delta_pence
    from transactions t
   where t.deleted_at is null
  union all
  select t.id, t.user_id, t.counter_account_id, t.account_id,
         t.occurred_on, t.type, null::uuid, null::uuid, t.amount_pence, t.amount_pence
    from transactions t
   where t.deleted_at is null and t.type = 'transfer';

-- Is the account part of the world on day d? (it has started, and is not yet gone)
create function account_live_on(a accounts, d date) returns boolean
  language sql stable as $$
  select a.opening_date <= d and (a.archived_at is null or london_date(a.archived_at) >= d)
$$;

create function account_balances(p_as_of date default london_today())
returns table (account_id uuid, name text, type account_type, counts_as_cash boolean, balance_pence bigint)
language sql stable as $$
  select a.id, a.name, a.type, a.counts_as_cash,
         (a.opening_balance_pence + coalesce((
            select sum(e.delta_pence) from txn_effects e
             where e.account_id = a.id and e.occurred_on <= p_as_of), 0))::bigint
    from accounts a
   where account_live_on(a, p_as_of)
   order by a.sort_order, a.created_at
$$;

create function available_cash(p_as_of date default london_today())
returns bigint language sql stable as $$
  select coalesce(sum(b.balance_pence), 0)::bigint from account_balances(p_as_of) b where b.counts_as_cash
$$;

-- Opening + income - spend + set aside + adjustments = closing.
-- "Opening" also includes pool accounts that start inside the period, at their opening balance,
-- so the equation always balances (the PRD's owner formula when nothing else happens).
create function cash_flow(p_from date, p_to date)
returns table (opening_pence bigint, income_pence bigint, spend_pence bigint,
               set_aside_pence bigint, adjust_pence bigint, closing_pence bigint)
language sql stable as $$
  with flows as (
    select e.type, e.delta_pence, coalesce(o.counts_as_cash, false) as other_in_pool
      from txn_effects e
      join accounts a on a.id = e.account_id and a.counts_as_cash
      left join accounts o on o.id = e.other_account_id
     where e.occurred_on between p_from and p_to
  )
  select
    (available_cash(p_from - 1) + coalesce((
        select sum(a.opening_balance_pence) from accounts a
         where a.counts_as_cash and a.opening_date between p_from and p_to), 0))::bigint,
    coalesce(sum(delta_pence) filter (where type = 'income'), 0)::bigint,
    coalesce(-sum(delta_pence) filter (where type = 'expense'), 0)::bigint,
    coalesce(sum(delta_pence) filter (where type = 'transfer' and not other_in_pool), 0)::bigint,
    coalesce(sum(delta_pence) filter (where type = 'adjustment'), 0)::bigint,
    available_cash(p_to)
  from flows
$$;

-- Available cash for each day in a range (the S7 scrubber line).
create function cash_series(p_from date, p_to date)
returns table (day date, cash_pence bigint)
language sql stable as $$
  with base as (select available_cash(p_from - 1) as b),
  newacc as (
    select a.opening_date, a.opening_balance_pence from accounts a
     where a.counts_as_cash and a.opening_date between p_from and p_to),
  eff as (
    select e.occurred_on, sum(e.delta_pence) as s
      from txn_effects e join accounts a on a.id = e.account_id and a.counts_as_cash
     where e.occurred_on between p_from and p_to group by e.occurred_on)
  select d::date,
         ((select b from base)
          + coalesce((select sum(n.opening_balance_pence) from newacc n where n.opening_date <= d::date), 0)
          + coalesce((select sum(f.s) from eff f where f.occurred_on <= d::date), 0))::bigint
    from generate_series(p_from, p_to, interval '1 day') d
   order by 1
$$;

create function account_balance_series(p_account uuid, p_from date, p_to date)
returns table (day date, balance_pence bigint)
language sql stable as $$
  select d::date,
         (a.opening_balance_pence + coalesce((
            select sum(e.delta_pence) from txn_effects e
             where e.account_id = a.id and e.occurred_on <= d::date), 0))::bigint
    from accounts a, generate_series(greatest(p_from, a.opening_date), p_to, interval '1 day') d
   where a.id = p_account
   order by 1
$$;

-- Shift a date back k whole months, clamping the day (31 Oct -> 30 Sep).
create function months_back(p_d date, k int) returns date
  language sql immutable as $$ select (p_d - make_interval(months => k))::date $$;

-- Spend by category over a period. p_parent null: roll sub-categories up into their parents.
-- p_parent set: that parent's sub-categories (and the parent itself for unassigned spend).
-- norm = median spend over the prior 6 periods at the same day offset (null when there is no history).
create function spend_by_category(p_from date, p_to date, p_parent uuid default null, p_pool_only boolean default false)
returns table (category_id uuid, name text, icon text, color text, parent_id uuid,
               total_pence bigint, txn_count int, norm_pence bigint)
language sql stable as $$
  with scoped as (
    select t.occurred_on, t.amount_pence,
           case when p_parent is null then coalesce(c.parent_id, c.id) else c.id end as gid
      from transactions t
      join categories c on c.id = t.category_id
      left join accounts a on a.id = t.account_id
     where t.deleted_at is null and t.type = 'expense'
       and t.occurred_on >= months_back(p_from, 6) and t.occurred_on <= p_to
       and (not p_pool_only or a.counts_as_cash)
       and (p_parent is null or c.id = p_parent or c.parent_id = p_parent)
  ),
  cur as (
    select gid, sum(amount_pence)::bigint as total, count(*)::int as n from scoped
     where occurred_on between p_from and p_to group by gid
  ),
  first_txn as (select min(occurred_on) as d from transactions where deleted_at is null),
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
  select c.id, c.name, c.icon, c.color, c.parent_id, cur.total, cur.n, norms.norm
    from cur
    join categories c on c.id = cur.gid
    left join norms on norms.gid = cur.gid
   order by cur.total desc, c.name
$$;

-- p_exclude_fixed drops rent-like categories (is_fixed), for charts about behaviour such as the daily rhythm.
create function daily_spend(p_from date, p_to date, p_exclude_fixed boolean default false)
returns table (day date, total_pence bigint, cumulative_pence bigint)
language sql stable as $$
  with d as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  ), s as (
    select t.occurred_on as day, sum(t.amount_pence) as total
      from transactions t
      left join categories c on c.id = t.category_id
     where t.deleted_at is null and t.type = 'expense' and t.occurred_on between p_from and p_to
       and (not p_exclude_fixed or not coalesce(c.is_fixed, false))
     group by t.occurred_on
  )
  select d.day, coalesce(s.total, 0)::bigint,
         (sum(coalesce(s.total, 0)) over (order by d.day))::bigint
    from d left join s on s.day = d.day
   order by d.day
$$;

-- CASH-05: month-to-date spend against last month up to the same day (or its last day).
create function month_pace(p_as_of date default london_today())
returns table (month_start date, day_of_month int, days_in_month int,
               spend_pence bigint, prev_spend_pence bigint, prev_label_day int, prev_total_pence bigint)
language sql stable as $$
  with m as (
    select date_trunc('month', p_as_of)::date as ms,
           (date_trunc('month', p_as_of) + interval '1 month - 1 day')::date as me,
           (date_trunc('month', p_as_of) - interval '1 month')::date as pms
  ), pm as (
    select m.*, extract(day from p_as_of)::int as dom,
           least(extract(day from p_as_of)::int,
                 extract(day from (m.ms - 1))::int) as pdom
      from m
  )
  select pm.ms, pm.dom, extract(day from pm.me)::int,
         coalesce((select sum(t.amount_pence) from transactions t
                    where t.deleted_at is null and t.type = 'expense'
                      and t.occurred_on between pm.ms and p_as_of), 0)::bigint,
         coalesce((select sum(t.amount_pence) from transactions t
                    where t.deleted_at is null and t.type = 'expense'
                      and t.occurred_on between pm.pms and (pm.pms + (pm.pdom - 1))), 0)::bigint,
         pm.pdom,
         coalesce((select sum(t.amount_pence) from transactions t
                    where t.deleted_at is null and t.type = 'expense'
                      and t.occurred_on between pm.pms and (pm.ms - 1)), 0)::bigint
    from pm
$$;

create function monthly_totals(p_months int default 12)
returns table (month date, income_pence bigint, spend_pence bigint)
language sql stable as $$
  with months as (
    select g::date as m from generate_series(
      (date_trunc('month', london_today()) - make_interval(months => p_months - 1))::date,
      date_trunc('month', london_today())::date, interval '1 month') g
  )
  select months.m,
         coalesce(sum(t.amount_pence) filter (where t.type = 'income'), 0)::bigint,
         coalesce(sum(t.amount_pence) filter (where t.type = 'expense'), 0)::bigint
    from months
    left join transactions t on t.deleted_at is null and t.type in ('income','expense')
         and t.occurred_on >= months.m and t.occurred_on < (months.m + interval '1 month')::date
   group by months.m order by months.m
$$;

create function top_payees(p_from date, p_to date, p_limit int default 10, p_category uuid default null)
returns table (payee_id uuid, name text, visits int, total_pence bigint, avg_pence bigint)
language sql stable as $$
  select p.id, p.name, count(*)::int, sum(t.amount_pence)::bigint, round(avg(t.amount_pence))::bigint
    from transactions t join payees p on p.id = t.payee_id
   where t.deleted_at is null and t.type = 'expense' and t.occurred_on between p_from and p_to
     and (p_category is null or t.category_id in (select c.id from categories c where c.id = p_category or c.parent_id = p_category))
   group by p.id, p.name
   order by sum(t.amount_pence) desc, p.name
   limit p_limit
$$;

-- Insight facts (PRD §12.2): everything a card may say is computed here or in lib/ai/facts.ts, never by the model.
-- Spend per parent category for [p_from, p_to] and for each of the prior p_periods periods at the same offset
-- (step = 1 month for monthly digests, 7 days for weekly ones). prior_pence[k] is k periods ago, zero when nothing was spent;
-- periods before the user's first transaction are left out, so a new account has a short history, not a misleading one.
create function category_period_history(p_from date, p_to date, p_periods int default 6, p_step interval default interval '1 month')
returns table (category_id uuid, name text, icon text, parent_id uuid, current_pence bigint, prior_pence bigint[])
language sql stable as $$
  with first_txn as (select min(occurred_on) as d from transactions where deleted_at is null),
  ks as (select k from generate_series(1, p_periods) k, first_txn where (p_from - k * p_step)::date >= first_txn.d),
  scoped as (
    select t.occurred_on, t.amount_pence, coalesce(c.parent_id, c.id) as gid
      from transactions t join categories c on c.id = t.category_id
     where t.deleted_at is null and t.type = 'expense'
       and t.occurred_on >= (p_from - p_periods * p_step)::date and t.occurred_on <= p_to
  ),
  gids as (select distinct gid from scoped)
  select g.gid, c.name, c.icon, c.parent_id,
         coalesce((select sum(s.amount_pence) from scoped s where s.gid = g.gid and s.occurred_on between p_from and p_to), 0)::bigint,
         coalesce((select array_agg(coalesce((select sum(s.amount_pence) from scoped s where s.gid = g.gid
                          and s.occurred_on between (p_from - k.k * p_step)::date and (p_to - k.k * p_step)::date), 0)::bigint order by k.k)
                     from ks k), '{}'::bigint[])
    from gids g join categories c on c.id = g.gid
   order by 5 desc, c.name
$$;

-- Payees first seen in the period (their earliest transaction falls inside it).
create function new_payees(p_from date, p_to date)
returns table (payee_id uuid, name text, amount_pence bigint, occurred_on date, category_name text)
language sql stable as $$
  select p.id, p.name, f.amount_pence, f.occurred_on, c.name
    from payees p
    join lateral (select t.* from transactions t where t.payee_id = p.id and t.deleted_at is null and t.type = 'expense'
                   order by t.occurred_on, t.created_at limit 1) f on true
    left join categories c on c.id = f.category_id
   where f.occurred_on between p_from and p_to
   order by f.amount_pence desc
$$;

-- The biggest single expenses of the period, leaving out rent-like fixed costs (those are never news).
create function top_transactions(p_from date, p_to date, p_limit int default 3)
returns table (id uuid, payee_name text, category_name text, amount_pence bigint, occurred_on date)
language sql stable as $$
  select t.id, p.name, c.name, t.amount_pence, t.occurred_on
    from transactions t
    left join payees p on p.id = t.payee_id
    left join categories c on c.id = t.category_id
   where t.deleted_at is null and t.type = 'expense' and t.occurred_on between p_from and p_to and not coalesce(c.is_fixed, false)
   order by t.amount_pence desc, t.occurred_on desc
   limit p_limit
$$;

-- Calendar heatmap + weekday averages need nothing beyond daily_spend. Category history for AN-07:
create function category_monthly(p_category uuid, p_months int default 12)
returns table (month date, total_pence bigint, txn_count int)
language sql stable as $$
  with months as (
    select g::date as m from generate_series(
      (date_trunc('month', london_today()) - make_interval(months => p_months - 1))::date,
      date_trunc('month', london_today())::date, interval '1 month') g
  ), ids as (
    select c.id from categories c where c.id = p_category or c.parent_id = p_category
  )
  select months.m, coalesce(sum(t.amount_pence), 0)::bigint, count(t.id)::int
    from months
    left join transactions t on t.deleted_at is null and t.type = 'expense'
         and t.category_id in (select id from ids)
         and t.occurred_on >= months.m and t.occurred_on < (months.m + interval '1 month')::date
   group by months.m order by months.m
$$;

-- ACT-01..03: the Activity list. Keyset pagination on (occurred_on, created_at, id).
-- A page always ends on a day boundary (it is extended to the end of its last day), so the per-day
-- totals shown in the day headers are never partial. Pages are capped at 1000 rows.
create function list_transactions(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_limit int default 40, p_after_on date default null, p_after_created timestamptz default null,
  p_after_id uuid default null)
returns table (
  id uuid, client_id uuid, type txn_type, amount_pence bigint,
  account_id uuid, account_name text, counter_account_id uuid, counter_account_name text,
  category_id uuid, category_name text, parent_category_id uuid, parent_category_name text, category_icon text,
  payee_id uuid, payee_name text, note text, tags text[], occurred_on date, occurred_at timestamptz,
  source txn_source, needs_review boolean, created_at timestamptz)
language sql stable as $$
  with f as (
    select t.id, t.client_id, t.type, t.amount_pence,
           t.account_id, a.name as account_name, t.counter_account_id, b.name as counter_account_name,
           t.category_id, c.name as category_name, c.parent_id as parent_category_id, pc.name as parent_category_name,
           coalesce(c.icon, pc.icon) as category_icon,
           t.payee_id, p.name as payee_name, t.note, t.tags, t.occurred_on, t.occurred_at,
           t.source, t.needs_review, t.created_at,
           row_number() over (order by t.occurred_on desc, t.created_at desc, t.id desc) as rn
      from transactions t
      join accounts a on a.id = t.account_id
      left join accounts b on b.id = t.counter_account_id
      left join categories c on c.id = t.category_id
      left join categories pc on pc.id = c.parent_id
      left join payees p on p.id = t.payee_id
     where t.deleted_at is null
       and (p_types is null or t.type = any(p_types))
       and (p_category_ids is null or t.category_id = any(p_category_ids))
       and (p_account_ids is null or t.account_id = any(p_account_ids) or t.counter_account_id = any(p_account_ids))
       and (p_from is null or t.occurred_on >= p_from)
       and (p_to is null or t.occurred_on <= p_to)
       and (p_min is null or abs(t.amount_pence) >= p_min)
       and (p_max is null or abs(t.amount_pence) <= p_max)
       and (p_amount is null or abs(t.amount_pence) = p_amount)
       and (p_needs_review is null or t.needs_review = p_needs_review)
       and (p_payee is null or t.payee_id = p_payee)
       and (p_q is null or p_q = '' or
            p.name ilike '%' || p_q || '%' or t.note ilike '%' || p_q || '%'
            or c.name ilike '%' || p_q || '%' or pc.name ilike '%' || p_q || '%'
            or extensions.similarity(coalesce(p.name_norm, ''), lower(p_q)) > 0.3
            or exists (select 1 from unnest(t.tags) tg where tg ilike '%' || p_q || '%'))
       and (p_after_on is null or (t.occurred_on, t.created_at, t.id) < (p_after_on, p_after_created, p_after_id))
  )
  select f.id, f.client_id, f.type, f.amount_pence, f.account_id, f.account_name, f.counter_account_id,
         f.counter_account_name, f.category_id, f.category_name, f.parent_category_id, f.parent_category_name,
         f.category_icon, f.payee_id, f.payee_name, f.note, f.tags, f.occurred_on, f.occurred_at,
         f.source, f.needs_review, f.created_at
    from f
   where f.occurred_on >= coalesce(
           (select x.occurred_on from f x where x.rn = least(greatest(coalesce(p_limit, 40), 1), 200)),
           '0001-01-01'::date)
   order by f.occurred_on desc, f.created_at desc, f.id desc
   limit 1000
$$;

create function transaction_totals(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null)
returns table (txn_count int, spend_pence bigint, income_pence bigint)
language sql stable as $$
  select count(*)::int,
         coalesce(sum(t.amount_pence) filter (where t.type = 'expense'), 0)::bigint,
         coalesce(sum(t.amount_pence) filter (where t.type = 'income'), 0)::bigint
    from transactions t
    left join categories c on c.id = t.category_id
    left join categories pc on pc.id = c.parent_id
    left join payees p on p.id = t.payee_id
   where t.deleted_at is null
     and (p_types is null or t.type = any(p_types))
     and (p_category_ids is null or t.category_id = any(p_category_ids))
     and (p_account_ids is null or t.account_id = any(p_account_ids) or t.counter_account_id = any(p_account_ids))
     and (p_from is null or t.occurred_on >= p_from)
     and (p_to is null or t.occurred_on <= p_to)
     and (p_min is null or abs(t.amount_pence) >= p_min)
     and (p_max is null or abs(t.amount_pence) <= p_max)
     and (p_amount is null or abs(t.amount_pence) = p_amount)
     and (p_needs_review is null or t.needs_review = p_needs_review)
     and (p_payee is null or t.payee_id = p_payee)
     and (p_q is null or p_q = '' or
          p.name ilike '%' || p_q || '%' or t.note ilike '%' || p_q || '%'
          or c.name ilike '%' || p_q || '%' or pc.name ilike '%' || p_q || '%'
          or extensions.similarity(coalesce(p.name_norm, ''), lower(p_q)) > 0.3
          or exists (select 1 from unnest(t.tags) tg where tg ilike '%' || p_q || '%'))
$$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
