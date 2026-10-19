-- Sterling: one-off pots (e.g. "Home purchase"). A transaction in a pot is real money: it moves account balances and available
-- cash like any other. But it is not part of the user's usual spending, so every analytic, pace figure and insight leaves it
-- out. Pots are tracked on their own screen. Only expenses and income may sit in a pot (refunds, gifts towards a deposit).

create table pots (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  target_pence bigint check (target_pence is null or target_pence > 0),
  closed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create unique index pots_name on pots (user_id, lower(btrim(name)));

alter table pots enable row level security;
create policy pots_select on pots for select using (user_id = auth.uid());
create policy pots_insert on pots for insert with check (user_id = auth.uid());
create policy pots_update on pots for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy pots_delete on pots for delete using (user_id = auth.uid());

alter table transactions add column pot_id uuid references pots on delete restrict;
alter table transactions add constraint txn_pot_type check (pot_id is null or type in ('expense','income'));
create index txn_user_pot on transactions (user_id, pot_id, occurred_on) where deleted_at is null and pot_id is not null;

-- A FK does not prove ownership, so check it here. A closed pot takes no new transactions.
create function transactions_pot_guard() returns trigger language plpgsql as $$
declare p pots%rowtype;
begin
  if new.pot_id is null or new.deleted_at is not null then return new; end if;
  select * into p from pots where id = new.pot_id and user_id = new.user_id;
  if p.id is null then raise exception 'Pot not found' using errcode = 'foreign_key_violation'; end if;
  if p.closed_at is not null and (tg_op = 'INSERT' or new.pot_id is distinct from old.pot_id) then
    raise exception 'The pot "%" is closed', p.name using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger transactions_pot_guard before insert or update on transactions
  for each row execute function transactions_pot_guard();

-- Effects carry the pot, so balances stay complete while analytics can tell the two apart.
create or replace view txn_effects with (security_invoker = true) as
  select t.id as txn_id, t.user_id, t.account_id, t.counter_account_id as other_account_id,
         t.occurred_on, t.type, t.category_id, t.payee_id, t.amount_pence,
         case t.type when 'expense' then -t.amount_pence
                     when 'income' then t.amount_pence
                     when 'transfer' then -t.amount_pence
                     else t.amount_pence end as delta_pence,
         t.pot_id
    from transactions t
   where t.deleted_at is null
  union all
  select t.id, t.user_id, t.counter_account_id, t.account_id,
         t.occurred_on, t.type, null::uuid, null::uuid, t.amount_pence, t.amount_pence, null::uuid
    from transactions t
   where t.deleted_at is null and t.type = 'transfer';

-- Opening + income - spend + pot + set aside + adjustments = closing. `pot` is the net of pot income and expenses.
drop function cash_flow(date, date);
create function cash_flow(p_from date, p_to date)
returns table (opening_pence bigint, income_pence bigint, spend_pence bigint, pot_pence bigint,
               set_aside_pence bigint, adjust_pence bigint, closing_pence bigint)
language sql stable as $$
  with flows as (
    select e.type, e.delta_pence, e.pot_id, coalesce(o.counts_as_cash, false) as other_in_pool
      from txn_effects e
      join accounts a on a.id = e.account_id and a.counts_as_cash
      left join accounts o on o.id = e.other_account_id
     where e.occurred_on between p_from and p_to
  )
  select
    (available_cash(p_from - 1) + coalesce((
        select sum(a.opening_balance_pence) from accounts a
         where a.counts_as_cash and a.opening_date between p_from and p_to), 0))::bigint,
    coalesce(sum(delta_pence) filter (where type = 'income' and pot_id is null), 0)::bigint,
    coalesce(-sum(delta_pence) filter (where type = 'expense' and pot_id is null), 0)::bigint,
    coalesce(sum(delta_pence) filter (where type in ('income', 'expense') and pot_id is not null), 0)::bigint,
    coalesce(sum(delta_pence) filter (where type = 'transfer' and not other_in_pool), 0)::bigint,
    coalesce(sum(delta_pence) filter (where type = 'adjustment'), 0)::bigint,
    available_cash(p_to)
  from flows
$$;

-- Everything below is "usual spending": the same bodies as before with `pot_id is null` added.
create or replace function spend_by_category(p_from date, p_to date, p_parent uuid default null, p_pool_only boolean default false)
returns table (category_id uuid, name text, icon text, color text, parent_id uuid,
               total_pence bigint, txn_count int, norm_pence bigint)
language sql stable as $$
  with scoped as (
    select t.occurred_on, t.amount_pence,
           case when p_parent is null then coalesce(c.parent_id, c.id) else c.id end as gid
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
  select c.id, c.name, c.icon, c.color, c.parent_id, cur.total, cur.n, norms.norm
    from cur
    join categories c on c.id = cur.gid
    left join norms on norms.gid = cur.gid
   order by cur.total desc, c.name
$$;

create or replace function daily_spend(p_from date, p_to date, p_exclude_fixed boolean default false)
returns table (day date, total_pence bigint, cumulative_pence bigint)
language sql stable as $$
  with d as (
    select g::date as day from generate_series(p_from, p_to, interval '1 day') g
  ), s as (
    select t.occurred_on as day, sum(t.amount_pence) as total
      from transactions t
      left join categories c on c.id = t.category_id
     where t.deleted_at is null and t.type = 'expense' and t.pot_id is null and t.occurred_on between p_from and p_to
       and (not p_exclude_fixed or not coalesce(c.is_fixed, false))
     group by t.occurred_on
  )
  select d.day, coalesce(s.total, 0)::bigint,
         (sum(coalesce(s.total, 0)) over (order by d.day))::bigint
    from d left join s on s.day = d.day
   order by d.day
$$;

create or replace function month_pace(p_as_of date default london_today())
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
                    where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
                      and t.occurred_on between pm.ms and p_as_of), 0)::bigint,
         coalesce((select sum(t.amount_pence) from transactions t
                    where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
                      and t.occurred_on between pm.pms and (pm.pms + (pm.pdom - 1))), 0)::bigint,
         pm.pdom,
         coalesce((select sum(t.amount_pence) from transactions t
                    where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
                      and t.occurred_on between pm.pms and (pm.ms - 1)), 0)::bigint
    from pm
$$;

create or replace function monthly_totals(p_months int default 12)
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
    left join transactions t on t.deleted_at is null and t.pot_id is null and t.type in ('income','expense')
         and t.occurred_on >= months.m and t.occurred_on < (months.m + interval '1 month')::date
   group by months.m order by months.m
$$;

create or replace function top_payees(p_from date, p_to date, p_limit int default 10, p_category uuid default null)
returns table (payee_id uuid, name text, visits int, total_pence bigint, avg_pence bigint)
language sql stable as $$
  select p.id, p.name, count(*)::int, sum(t.amount_pence)::bigint, round(avg(t.amount_pence))::bigint
    from transactions t join payees p on p.id = t.payee_id
   where t.deleted_at is null and t.type = 'expense' and t.pot_id is null and t.occurred_on between p_from and p_to
     and (p_category is null or t.category_id in (select c.id from categories c where c.id = p_category or c.parent_id = p_category))
   group by p.id, p.name
   order by sum(t.amount_pence) desc, p.name
   limit p_limit
$$;

create or replace function category_period_history(p_from date, p_to date, p_periods int default 6, p_step interval default interval '1 month')
returns table (category_id uuid, name text, icon text, parent_id uuid, current_pence bigint, prior_pence bigint[])
language sql stable as $$
  with first_txn as (select min(occurred_on) as d from transactions where deleted_at is null and pot_id is null),
  ks as (select k from generate_series(1, p_periods) k, first_txn where (p_from - k * p_step)::date >= first_txn.d),
  scoped as (
    select t.occurred_on, t.amount_pence, coalesce(c.parent_id, c.id) as gid
      from transactions t join categories c on c.id = t.category_id
     where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
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

create or replace function new_payees(p_from date, p_to date)
returns table (payee_id uuid, name text, amount_pence bigint, occurred_on date, category_name text)
language sql stable as $$
  select p.id, p.name, f.amount_pence, f.occurred_on, c.name
    from payees p
    join lateral (select t.* from transactions t where t.payee_id = p.id and t.deleted_at is null and t.type = 'expense' and t.pot_id is null
                   order by t.occurred_on, t.created_at limit 1) f on true
    left join categories c on c.id = f.category_id
   where f.occurred_on between p_from and p_to
   order by f.amount_pence desc
$$;

create or replace function top_transactions(p_from date, p_to date, p_limit int default 3)
returns table (id uuid, payee_name text, category_name text, amount_pence bigint, occurred_on date)
language sql stable as $$
  select t.id, p.name, c.name, t.amount_pence, t.occurred_on
    from transactions t
    left join payees p on p.id = t.payee_id
    left join categories c on c.id = t.category_id
   where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
     and t.occurred_on between p_from and p_to and not coalesce(c.is_fixed, false)
   order by t.amount_pence desc, t.occurred_on desc
   limit p_limit
$$;

create or replace function category_monthly(p_category uuid, p_months int default 12)
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
    left join transactions t on t.deleted_at is null and t.type = 'expense' and t.pot_id is null
         and t.category_id in (select id from ids)
         and t.occurred_on >= months.m and t.occurred_on < (months.m + interval '1 month')::date
   group by months.m order by months.m
$$;

-- Activity: the ledger shows pot transactions (with their pot), and can filter by them.
--   p_pot_id: only that pot · p_pots: 'only' = any pot, 'exclude' = usual spending only, null = everything.
drop function list_transactions(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid, int, date, timestamptz, uuid);
create function list_transactions(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_limit int default 40, p_after_on date default null, p_after_created timestamptz default null,
  p_after_id uuid default null, p_pot_id uuid default null, p_pots text default null)
returns table (
  id uuid, client_id uuid, type txn_type, amount_pence bigint,
  account_id uuid, account_name text, counter_account_id uuid, counter_account_name text,
  category_id uuid, category_name text, parent_category_id uuid, parent_category_name text, category_icon text,
  payee_id uuid, payee_name text, note text, tags text[], occurred_on date, occurred_at timestamptz,
  source txn_source, needs_review boolean, created_at timestamptz, pot_id uuid, pot_name text)
language sql stable as $$
  with f as (
    select t.id, t.client_id, t.type, t.amount_pence,
           t.account_id, a.name as account_name, t.counter_account_id, b.name as counter_account_name,
           t.category_id, c.name as category_name, c.parent_id as parent_category_id, pc.name as parent_category_name,
           coalesce(c.icon, pc.icon) as category_icon,
           t.payee_id, p.name as payee_name, t.note, t.tags, t.occurred_on, t.occurred_at,
           t.source, t.needs_review, t.created_at, t.pot_id, o.name as pot_name,
           row_number() over (order by t.occurred_on desc, t.created_at desc, t.id desc) as rn
      from transactions t
      join accounts a on a.id = t.account_id
      left join accounts b on b.id = t.counter_account_id
      left join categories c on c.id = t.category_id
      left join categories pc on pc.id = c.parent_id
      left join payees p on p.id = t.payee_id
      left join pots o on o.id = t.pot_id
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
       and (p_pot_id is null or t.pot_id = p_pot_id)
       and (p_pots is null or (p_pots = 'only' and t.pot_id is not null) or (p_pots = 'exclude' and t.pot_id is null))
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
         f.source, f.needs_review, f.created_at, f.pot_id, f.pot_name
    from f
   where f.occurred_on >= coalesce(
           (select x.occurred_on from f x where x.rn = least(greatest(coalesce(p_limit, 40), 1), 200)),
           '0001-01-01'::date)
   order by f.occurred_on desc, f.created_at desc, f.id desc
   limit 1000
$$;

-- spend/income are usual spending only; pot_pence is the net of pot income and expenses in the same filter.
drop function transaction_totals(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid);
create function transaction_totals(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_pot_id uuid default null, p_pots text default null)
returns table (txn_count int, spend_pence bigint, income_pence bigint, pot_pence bigint)
language sql stable as $$
  select count(*)::int,
         coalesce(sum(t.amount_pence) filter (where t.type = 'expense' and t.pot_id is null), 0)::bigint,
         coalesce(sum(t.amount_pence) filter (where t.type = 'income' and t.pot_id is null), 0)::bigint,
         coalesce(sum(case t.type when 'income' then t.amount_pence when 'expense' then -t.amount_pence end) filter (where t.pot_id is not null), 0)::bigint
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
     and (p_pot_id is null or t.pot_id = p_pot_id)
     and (p_pots is null or (p_pots = 'only' and t.pot_id is not null) or (p_pots = 'exclude' and t.pot_id is null))
     and (p_q is null or p_q = '' or
          p.name ilike '%' || p_q || '%' or t.note ilike '%' || p_q || '%'
          or c.name ilike '%' || p_q || '%' or pc.name ilike '%' || p_q || '%'
          or extensions.similarity(coalesce(p.name_norm, ''), lower(p_q)) > 0.3
          or exists (select 1 from unnest(t.tags) tg where tg ilike '%' || p_q || '%'))
$$;

-- Writes gain p_pot_id (expenses and income only; ignored for transfers).
drop function create_transaction(uuid, txn_type, bigint, uuid, uuid, uuid, text, text, text[], date, timestamptz, txn_source, boolean, boolean);
create function create_transaction(
  p_client_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null,
  p_source txn_source default 'app', p_needs_review boolean default false,
  p_account_manual boolean default false, p_pot_id uuid default null)
returns transactions language plpgsql as $$
declare
  v_uid uuid := auth.uid(); v_row transactions; v_payee uuid;
  v_def uuid; v_cand uuid; v_count smallint;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, category_id,
                            note, tags, occurred_on, occurred_at, source, needs_review, pot_id)
    values (v_uid, p_client_id, p_type, p_amount_pence, p_account_id, p_counter_account_id, p_category_id,
            nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_tags, '{}'),
            coalesce(p_occurred_on, london_today()), p_occurred_at, p_source, coalesce(p_needs_review, false),
            case when p_type in ('expense', 'income') then p_pot_id end)
    on conflict (user_id, client_id) do nothing
    returning * into v_row;

  if v_row.id is null then            -- a retry: return what is already stored
    select * into v_row from transactions where user_id = v_uid and client_id = p_client_id;
    return v_row;
  end if;

  if p_type in ('expense', 'income') then
    v_payee := touch_payee(p_payee, p_category_id, p_account_id);
    if v_payee is not null then
      update transactions set payee_id = v_payee where id = v_row.id returning * into v_row;
    end if;
  end if;

  -- ACC-02: after 3 consecutive manual picks of the same other account, make it the default.
  if p_type = 'expense' then
    select id into v_def from accounts where user_id = v_uid and is_default and archived_at is null;
    select acct_switch_candidate, acct_switch_count into v_cand, v_count from profiles where id = v_uid;
    if p_account_manual and p_account_id is distinct from v_def then
      v_count := case when v_cand = p_account_id then coalesce(v_count, 0) + 1 else 1 end;
      if v_count >= 3 then
        update accounts set is_default = true where id = p_account_id;
        update profiles set acct_switch_candidate = null, acct_switch_count = 0 where id = v_uid;
      else
        update profiles set acct_switch_candidate = p_account_id, acct_switch_count = v_count where id = v_uid;
      end if;
    elsif v_count > 0 then
      update profiles set acct_switch_candidate = null, acct_switch_count = 0 where id = v_uid;
    end if;
  end if;
  return v_row;
end $$;

drop function update_transaction(uuid, txn_type, bigint, uuid, uuid, uuid, text, text, text[], date, timestamptz);
create function update_transaction(
  p_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null, p_pot_id uuid default null)
returns transactions language plpgsql as $$
declare v_row transactions; v_old_payee text; v_new text := clean_payee(p_payee); v_payee uuid;
begin
  select p.name into v_old_payee from transactions t left join payees p on p.id = t.payee_id where t.id = p_id;
  if p_type in ('expense', 'income') then
    v_payee := touch_payee(p_payee, p_category_id, p_account_id,
                           p_bump => v_new is not null and lower(v_new) is distinct from lower(coalesce(v_old_payee, '')));
  end if;
  update transactions set
      type = p_type, amount_pence = p_amount_pence, account_id = p_account_id,
      counter_account_id = case when p_type = 'transfer' then p_counter_account_id end,
      category_id = case when p_type in ('expense','income') then p_category_id end,
      pot_id = case when p_type in ('expense','income') then p_pot_id end,
      payee_id = v_payee, note = nullif(btrim(coalesce(p_note, '')), ''), tags = coalesce(p_tags, '{}'),
      occurred_on = coalesce(p_occurred_on, occurred_on), occurred_at = p_occurred_at, needs_review = false
    where id = p_id and deleted_at is null
    returning * into v_row;
  if v_row.id is null then raise exception 'Transaction not found' using errcode = 'no_data_found'; end if;
  return v_row;
end $$;

-- One row per pot: what has gone out, what has come in, and the net still to fund (spent - received).
create function pot_summary(p_pot uuid default null)
returns table (pot_id uuid, name text, target_pence bigint, closed_at timestamptz,
               spent_pence bigint, received_pence bigint, net_pence bigint, txn_count int,
               first_on date, last_on date)
language sql stable as $$
  select o.id, o.name, o.target_pence, o.closed_at,
         coalesce(sum(t.amount_pence) filter (where t.type = 'expense'), 0)::bigint,
         coalesce(sum(t.amount_pence) filter (where t.type = 'income'), 0)::bigint,
         (coalesce(sum(t.amount_pence) filter (where t.type = 'expense'), 0)
          - coalesce(sum(t.amount_pence) filter (where t.type = 'income'), 0))::bigint,
         count(t.id)::int, min(t.occurred_on), max(t.occurred_on)
    from pots o
    left join transactions t on t.pot_id = o.id and t.deleted_at is null
   where p_pot is null or o.id = p_pot
   group by o.id
   order by (o.closed_at is not null), o.created_at
$$;

-- A pot's expenses by category (parents rolled up).
create function pot_by_category(p_pot uuid)
returns table (category_id uuid, name text, icon text, color text, total_pence bigint, txn_count int)
language sql stable as $$
  select c.id, c.name, c.icon, c.color, sum(t.amount_pence)::bigint, count(*)::int
    from transactions t
    join categories x on x.id = t.category_id
    join categories c on c.id = coalesce(x.parent_id, x.id)
   where t.pot_id = p_pot and t.deleted_at is null and t.type = 'expense'
   group by c.id, c.name, c.icon, c.color
   order by sum(t.amount_pence) desc, c.name
$$;

create or replace function delete_all_my_data() returns void language plpgsql as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from insight_feedback where user_id = v_uid;
  delete from insight_runs where user_id = v_uid;
  delete from budgets where user_id = v_uid;
  delete from recurring_rules where user_id = v_uid;
  delete from no_spend_days where user_id = v_uid;
  delete from transactions where user_id = v_uid;
  delete from pots where user_id = v_uid;
  delete from payees where user_id = v_uid;
  delete from accounts where user_id = v_uid;
  delete from categories where parent_id is not null and user_id = v_uid;
  delete from categories where user_id = v_uid;
  update profiles set onboarded_at = null, acct_switch_candidate = null, acct_switch_count = 0,
                      last_reminder_on = null, reminder_prompted = false where id = v_uid;
  perform seed_default_categories(v_uid);
end $$;

grant select, insert, update, delete on pots to authenticated, service_role;
revoke all on pots from anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
