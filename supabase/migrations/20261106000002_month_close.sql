-- Month-end close (MONTH-CLOSE-PRD.md): tables, column changes, the changed-since-close trigger and the server functions.
-- Run 20261106000001_month_close_enum.sql first (it adds the 'close' transaction source).

create type close_status as enum ('open', 'in_progress', 'closed', 'closed_with_skips', 'closed_quick');
create type close_item as enum ('missing_day', 'missing_run', 'bill', 'balance', 'duplicate', 'large', 'one_off');
create type recon_resolution as enum ('match', 'untracked_spend', 'untracked_income', 'adjustment');

create table month_closes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null check (extract(day from month) = 1),
  status close_status not null default 'open',
  step_state jsonb not null default '{}',                    -- {"missing_days":"done","bills":"skipped",…}
  started_at timestamptz, closed_at timestamptz, duration_s int,
  snapshot jsonb, snapshot_rev int not null default 0,
  changed_since_close boolean not null default false, last_changed_at timestamptz,
  reopened_count int not null default 0,
  active_s int not null default 0, last_active_at timestamptz,             -- time spent, ignoring gaps of more than 10 minutes (MC-63)
  notified_ready_at timestamptz, notified_reminder_at timestamptz,         -- at most two notifications a month (MC-80)
  summary text,                                                            -- the validated AI summary, once it has arrived
  created_at timestamptz not null default now(),
  unique (user_id, month)
);

create table month_close_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null,
  item_type close_item not null,
  item_key text not null,                                    -- date, occurrence id, account id, sorted txn ids…
  answer text not null,
  payload jsonb, answered_at timestamptz not null default now(),
  unique (user_id, month, item_type, item_key)
);

create table account_reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  account_id uuid not null references accounts on delete cascade,
  as_at timestamptz not null default now(),
  sterling_balance bigint not null, bank_balance bigint not null,
  difference bigint generated always as (bank_balance - sterling_balance) stored,
  resolution recon_resolution not null,
  transaction_id uuid references transactions on delete set null,
  source text not null default 'close'
);
create index account_reconciliations_account on account_reconciliations (user_id, account_id, as_at desc);

do $$
declare t text;
begin
  foreach t in array array['month_closes', 'month_close_answers', 'account_reconciliations']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;
grant select, insert, update, delete on month_closes, month_close_answers, account_reconciliations to authenticated, service_role;

-- ── Changes to existing structures ───────────────────────────────────────────────────────────────────────────────────────────────────
-- "Nothing to log" and "I didn't log, can't remember" share the marker table; `source` records who wrote it (the evening reminder or the close).
alter table no_spend_days add column kind text not null default 'no_spend' check (kind in ('no_spend', 'not_tracked')),
                          add column source text not null default 'app' check (source in ('app', 'close'));
alter table profiles add column close_notify boolean not null default true,
                     add column close_notify_time time not null default '09:00',
                     add column close_check_savings boolean not null default false,
                     add column close_since date;                          -- the first month ever offered: older months are never prompted (MC-04)
alter table forecast_snapshots add column usual_per_day_pence bigint;       -- the forecast's usual per day at the end of that day (review: everyday vs usual)

-- Forecast: days marked "not tracked" are not evidence (excluded like a logging gap) and are not a confirmed £0 day.
drop function forecast_daily_facts(date, date, timestamptz);
create function forecast_daily_facts(p_from date, p_to date, p_cutoff timestamptz default null)
returns table (d date, discretionary bigint, by_cat jsonb, by_cat_all jsonb, by_cat_rec jsonb, by_cat_trip jsonb,
               recurring bigint, trip bigint, oneoff bigint, has_activity boolean, confirmed_zero boolean, trip_day boolean, not_tracked boolean)
language sql stable as $$
  with t as (
    select x.occurred_on as dd, x.type, x.amount_pence as amt, x.recurring_id, x.trip_id, coalesce(x.is_one_off, false) as one_off, x.pot_id, x.refund_category_id,
           coalesce(c.parent_id, c.id) as l1, coalesce(rc.parent_id, rc.id) as rl1
      from transactions x left join categories c on c.id = x.category_id left join categories rc on rc.id = x.refund_category_id
     where x.deleted_at is null and x.occurred_on between p_from and p_to and (p_cutoff is null or x.created_at <= p_cutoff)
  ),
  lines as (                                                                 -- every counted line: expenses, and refunds linked to a category (negative)
    select dd, l1 as cat, amt, recurring_id is not null as rec, trip_id is not null as trp, one_off from t where type = 'expense' and pot_id is null
    union all
    select dd, rl1, -amt, false, false, false from t where type = 'income' and refund_category_id is not null and pot_id is null
  ),
  bycat as (
    select dd, cat,
           sum(amt) filter (where not rec and not trp and not one_off) as disc,
           sum(amt) as allv, sum(amt) filter (where rec) as recv, sum(amt) filter (where trp and not rec) as trpv
      from lines group by dd, cat
  ),
  perday as (
    select dd, coalesce(sum(disc), 0)::bigint disc, coalesce(sum(recv), 0)::bigint rec, coalesce(sum(trpv), 0)::bigint trp,
           (coalesce(sum(allv), 0) - coalesce(sum(disc), 0) - coalesce(sum(recv), 0) - coalesce(sum(trpv), 0))::bigint oneoff,
           jsonb_object_agg(cat::text, coalesce(disc, 0)) filter (where cat is not null) as j_disc,
           jsonb_object_agg(cat::text, coalesce(allv, 0)) filter (where cat is not null) as j_all,
           jsonb_object_agg(cat::text, coalesce(recv, 0)) filter (where cat is not null and recv is not null) as j_rec,
           jsonb_object_agg(cat::text, coalesce(trpv, 0)) filter (where cat is not null and trpv is not null) as j_trp
      from bycat group by dd
  ),
  act as (select dd, count(*) > 0 as a from t group by dd)
  select g.d, coalesce(p.disc, 0), coalesce(p.j_disc, '{}'), coalesce(p.j_all, '{}'), coalesce(p.j_rec, '{}'), coalesce(p.j_trp, '{}'),
         coalesce(p.rec, 0), coalesce(p.trp, 0), coalesce(p.oneoff, 0),
         coalesce(a.a, false), exists (select 1 from no_spend_days n where n.day = g.d and n.kind = 'no_spend'),
         exists (select 1 from trips tr where g.d between tr.start_on and tr.end_on),
         exists (select 1 from no_spend_days n where n.day = g.d and n.kind = 'not_tracked')
    from (select (p_from + i)::date as d from generate_series(0, greatest(-1, p_to - p_from)) i) g
    left join perday p on p.dd = g.d left join act a on a.dd = g.d
   order by g.d
$$;

create or replace function forecast_input(p_month date, p_today date default london_today(), p_cutoff timestamptz default null)
returns jsonb language plpgsql stable as $$
declare m date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
        v_track date; v_cov text; v_from date; v_to date; v_params record; v_mape numeric; v_band int;
        v_days jsonb; v_trips jsonb; v_future jsonb; v_extras jsonb; v_rec jsonb; v_median bigint; v_ver bigint; v_oneoffs jsonb;
begin
  select coalesce(p.tracking_started_on, (select min(t.occurred_on) from transactions t where t.deleted_at is null and t.pot_id is null))
    into v_track from profiles p where p.id = auth.uid();
  select x.covers into v_cov from budget_base(null, m) x;
  v_cov := coalesce(v_cov, 'all');
  v_track := coalesce(v_track, p_today);
  v_from := greatest(v_track, m - 410);
  v_to := least(p_today, mend);
  select coalesce(jsonb_agg(jsonb_build_object('d', f.d, 'discretionary', f.discretionary, 'by_cat', f.by_cat, 'by_cat_all', f.by_cat_all, 'by_cat_rec', f.by_cat_rec,
           'by_cat_trip', f.by_cat_trip, 'recurring', f.recurring, 'trip', f.trip, 'oneoff', f.oneoff, 'has_activity', f.has_activity,
           'confirmed_zero', f.confirmed_zero, 'trip_day', f.trip_day, 'not_tracked', f.not_tracked) order by f.d), '[]')
    into v_days from forecast_daily_facts(v_from, v_to, p_cutoff) f where v_from <= v_to;

  select coalesce(jsonb_agg(jsonb_build_object('start', tr.start_on, 'end', tr.end_on, 'budget', tr.budget_pence,
           'spent_to_date', (select coalesce(sum(x.amount_pence), 0) from transactions x where x.trip_id = tr.id and x.type = 'expense' and x.deleted_at is null
                                and (p_cutoff is null or x.created_at <= p_cutoff))) order by tr.start_on), '[]')
    into v_trips from trips tr where tr.end_on >= m and tr.start_on <= mend and tr.end_on >= p_today;
  select (percentile_cont(0.5) within group (order by s.per_day))::bigint into v_median from (
    select sum(x.amount_pence)::numeric / (tr.end_on - tr.start_on + 1) as per_day from trips tr join transactions x on x.trip_id = tr.id and x.type = 'expense' and x.deleted_at is null
     where tr.end_on < p_today group by tr.id, tr.start_on, tr.end_on) s;
  if v_median is not null then
    v_trips := coalesce((select jsonb_agg(e || jsonb_build_object('past_trip_daily_median', v_median)) from jsonb_array_elements(v_trips) e), '[]');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('d', x.occurred_on, 'amount', x.amount_pence, 'label', coalesce(py.name, 'Future-dated'), 'kind', 'future_dated',
           'category', coalesce(c.parent_id, c.id), 'varies', false) order by x.occurred_on), '[]')
    into v_future from transactions x left join payees py on py.id = x.payee_id left join categories c on c.id = x.category_id
   where x.type = 'expense' and x.deleted_at is null and x.pot_id is null and x.recurring_id is null and x.occurred_on > p_today and x.occurred_on <= mend
     and x.occurred_on >= m and (p_cutoff is null or x.created_at <= p_cutoff);
  select coalesce(jsonb_agg(jsonb_build_object('d', x.occurred_on, 'amount', x.amount_pence, 'label', 'Bill', 'kind', 'bill', 'category', coalesce(c.parent_id, c.id), 'varies', false)
           order by x.occurred_on), '[]')
    into v_rec from transactions x left join categories c on c.id = x.category_id
   where x.type = 'expense' and x.deleted_at is null and x.recurring_id is not null and x.occurred_on > p_today and x.occurred_on <= mend and x.occurred_on >= m;
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'label', e.label, 'amount', e.amount_pence, 'd', e.on_date, 'category', e.category_id) order by e.created_at), '[]')
    into v_extras from planned_extras e where e.month = m;

  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'd', x.occurred_on, 'amount', x.amount_pence, 'label', coalesce(py.name, c.name, 'An expense'), 'category', coalesce(c.parent_id, c.id))
           order by x.occurred_on), '[]')
    into v_oneoffs from transactions x left join payees py on py.id = x.payee_id left join categories c on c.id = x.category_id
   where x.type = 'expense' and x.deleted_at is null and x.is_one_off and x.occurred_on between m and least(p_today, mend) and x.trip_id is null;

  select k, half_life, z90, version into v_params from forecast_params where user_id = auth.uid();
  v_band := case when extract(day from p_today) <= 7 then 1 when extract(day from p_today) <= 14 then 2 when extract(day from p_today) <= 21 then 3 else 4 end;
  select avg(abs(b.point_pence - b.actual_pence)::numeric / nullif(b.actual_pence, 0)) into v_mape from forecast_backtest b
   where case when b.day <= 7 then 1 when b.day <= 14 then 2 when b.day <= 21 then 3 else 4 end = v_band;
  select coalesce(floor(extract(epoch from greatest((select max(updated_at) from transactions), (select max(created_at) from planned_extras))))::bigint, 0) into v_ver;

  return jsonb_build_object(
    'tracking_started_on', v_track, 'covers', v_cov, 'days', v_days, 'trips', v_trips, 'future_dated', v_future, 'recurring_after', v_rec, 'planned_extras', v_extras, 'one_offs', v_oneoffs,
    'params', case when v_params.k is null then null else jsonb_build_object('k_base', v_params.k, 'half_life', v_params.half_life, 'z90', v_params.z90) end,
    'params_version', coalesce(v_params.version, 'default'), 'backtest_mape', v_mape, 'data_version', v_ver,
    'params_changed', (select jsonb_build_object('on', l.changed_on, 'k', l.k_after, 'half_life', l.half_life_after) from forecast_param_log l order by l.created_at desc limit 1));
end $$;

revoke execute on function forecast_daily_facts(date, date, timestamptz), forecast_input(date, date, timestamptz) from anon, public;
grant execute on function forecast_daily_facts(date, date, timestamptz), forecast_input(date, date, timestamptz) to authenticated, service_role;

-- MC-70: a change to a closed month's spending is tracked, never blocked. Bills logged into it by catch-up count too.
create function transactions_close_changed() returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid; m1 date; m2 date;
begin
  if tg_op = 'DELETE' then
    if old.type not in ('expense', 'income') then return null; end if;
    uid := old.user_id; m1 := date_trunc('month', old.occurred_on)::date; m2 := m1;
  elsif tg_op = 'INSERT' then
    if new.type not in ('expense', 'income') then return null; end if;
    uid := new.user_id; m1 := date_trunc('month', new.occurred_on)::date; m2 := m1;
  else
    if old.type not in ('expense', 'income') and new.type not in ('expense', 'income') then return null; end if;
    uid := new.user_id; m1 := date_trunc('month', old.occurred_on)::date; m2 := date_trunc('month', new.occurred_on)::date;
  end if;
  update month_closes set changed_since_close = true, last_changed_at = now()
   where user_id = uid and month in (m1, m2) and status in ('closed', 'closed_with_skips', 'closed_quick');
  return null;
end $$;
create trigger transactions_close_changed after insert or delete or update of amount_pence, occurred_on, category_id, type, deleted_at, pot_id, trip_id, refund_category_id
  on transactions for each row execute function transactions_close_changed();

-- ── Helpers ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create function close_guard(p_month date, p_today date) returns date language plpgsql stable as $$
declare m date := date_trunc('month', p_month)::date;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if m >= date_trunc('month', p_today)::date then
    raise exception 'A month can only be closed once it has ended' using errcode = 'check_violation';           -- EC-MC1
  end if;
  return m;
end $$;

-- Creates the close row on first use, marks it in progress and adds the time since the last touch (gaps of over 10 minutes do not count).
create function close_touch(p_month date) returns month_closes language plpgsql as $$
declare m date := date_trunc('month', p_month)::date; r month_closes;
begin
  insert into month_closes (user_id, month) values (auth.uid(), m) on conflict (user_id, month) do nothing;
  select * into r from month_closes where user_id = auth.uid() and month = m for update;
  if r.status in ('closed', 'closed_with_skips', 'closed_quick') then return r; end if;
  update month_closes set
    status = case when r.status = 'open' then 'in_progress'::close_status else r.status end,
    started_at = coalesce(r.started_at, now()),
    active_s = r.active_s + case when r.last_active_at is not null and now() - r.last_active_at <= interval '10 minutes'
                                 then extract(epoch from now() - r.last_active_at)::int else 0 end,
    last_active_at = now()
   where id = r.id returning * into r;
  return r;
end $$;

-- ── Step 1-4 items, in one call ──────────────────────────────────────────────────────────────────────────────────────────────────────
create function month_close_checks(p_month date, p_today date default london_today()) returns jsonb
language plpgsql stable as $$
declare
  m date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_track date; v_from date; v_missing jsonb; v_bills jsonb; v_bal jsonb; v_dups jsonb := '[]'; v_large jsonb := '[]'; v_auto jsonb;
  r record; cl uuid[]; linked boolean; p_id uuid; p_acc uuid; p_amt bigint; p_pn text; p_at timestamptz; p_on date; p_pname text; p_aname text; n int; med numeric; th bigint; ans text; k text;
begin
  select p.tracking_started_on into v_track from profiles p where p.id = auth.uid();
  v_from := greatest(m, coalesce(v_track, m));

  -- Step 1 (MC-10): days with no user-entered transaction of any type (expense, income, transfer) and no earlier no-spend marker.
  -- A bill logged by the schedule is not the owner logging, an adjustment is not spending, and days before tracking began are never listed.
  select coalesce(jsonb_agg(jsonb_build_object('day', g.d, 'answer', a.answer) order by g.d), '[]') into v_missing
    from (select (v_from + i)::date as d from generate_series(0, greatest(-1, mend - v_from)) i) g
    left join month_close_answers a on a.user_id = auth.uid() and a.month = m and a.item_type = 'missing_day' and a.item_key = g.d::text
   where not exists (select 1 from transactions t where t.occurred_on = g.d and t.deleted_at is null and t.source <> 'recurring' and t.type <> 'adjustment')
     and (a.id is not null or not exists (select 1 from no_spend_days n where n.day = g.d));

  -- Step 2 (MC-20): estimates never confirmed, and payments waiting for the owner. Expenses of rules still running only.
  select coalesce(jsonb_agg(jsonb_build_object('occurrence_id', o.id, 'item_id', i.id, 'payee', coalesce(py.name, c.name, 'Bill'), 'status', o.status,
           'due_on', o.due_on, 'amount_pence', coalesce(t.amount_pence, o.amount_pence), 'account_name', a.name, 'transaction_id', o.transaction_id,
           'logged_on', t.occurred_on, 'varies', i.amount_varies, 'answer', ans.answer) order by o.due_on, o.id), '[]') into v_bills
    from recurring_occurrences o
    join recurring_items i on i.id = o.item_id
    join accounts a on a.id = i.account_id
    left join payees py on py.id = i.payee_id
    left join categories c on c.id = i.category_id
    left join transactions t on t.id = o.transaction_id and t.deleted_at is null
    left join month_close_answers ans on ans.user_id = auth.uid() and ans.month = m and ans.item_type = 'bill' and ans.item_key = o.id::text
   where i.type = 'expense' and o.due_on between m and mend and i.paused_at is null
     and (i.ended_at is null or i.ended_at <= o.created_at + interval '5 seconds')         -- a rule stopped later by the owner is not listed (EC-MC10)
     and (o.status in ('estimate', 'pending') or ans.id is not null);

  -- Step 3 (MC-30/31): every live account with the balance Sterling shows now. The app filters savings by the toggle.
  select coalesce(jsonb_agg(jsonb_build_object('account_id', b.account_id, 'name', b.name, 'type', b.type, 'counts_as_cash', b.counts_as_cash,
           'sterling_pence', b.balance_pence, 'answer', ans.answer, 'payload', ans.payload) order by ac.sort_order, ac.created_at), '[]') into v_bal
    from account_balances(p_today) b join accounts ac on ac.id = b.account_id
    left join month_close_answers ans on ans.user_id = auth.uid() and ans.month = m and ans.item_type = 'balance' and ans.item_key = b.account_id::text;

  -- Step 4a (MC-40): the same amount to the same payee on the same account within 10 minutes (or on one date when either has no time).
  cl := '{}';
  for r in
    select t.id, t.account_id, t.amount_pence, t.occurred_on, t.occurred_at, lower(btrim(regexp_replace(py.name, '\s+', ' ', 'g'))) as pn, py.name as pname, a.name as aname
      from transactions t join payees py on py.id = t.payee_id join accounts a on a.id = t.account_id
     where t.type = 'expense' and t.deleted_at is null and t.source <> 'recurring' and t.occurred_on between m and mend
     order by t.account_id, t.amount_pence, lower(btrim(regexp_replace(py.name, '\s+', ' ', 'g'))), t.occurred_on, t.occurred_at nulls last, t.id
  loop
    linked := p_id is not null and p_acc = r.account_id and p_amt = r.amount_pence and p_pn = r.pn
              and ((p_at is not null and r.occurred_at is not null and abs(extract(epoch from r.occurred_at - p_at)) <= 600)
                   or ((p_at is null or r.occurred_at is null) and p_on = r.occurred_on));
    if not linked and coalesce(array_length(cl, 1), 0) >= 2 then
      k := (select string_agg(x::text, '|' order by x::text) from unnest(cl) x);
      select a2.answer into ans from month_close_answers a2 where a2.user_id = auth.uid() and a2.item_type = 'duplicate' and a2.item_key = k and a2.answer = 'both_real' order by (a2.month = m) desc limit 1;
      if ans is null or exists (select 1 from month_close_answers a3 where a3.user_id = auth.uid() and a3.month = m and a3.item_type = 'duplicate' and a3.item_key = k and a3.answer = 'both_real') then
        v_dups := v_dups || jsonb_build_array(jsonb_build_object('key', k, 'payee', p_pname, 'amount_pence', p_amt, 'account_name', p_aname, 'answer', ans,
          'txns', (select jsonb_agg(jsonb_build_object('id', x.id, 'occurred_on', x.occurred_on, 'occurred_at', x.occurred_at) order by x.occurred_on, x.occurred_at nulls last, x.id)
                     from transactions x where x.id = any(cl))));
      end if;
    end if;
    if not linked then cl := array[r.id]; else cl := cl || r.id; end if;
    p_id := r.id; p_acc := r.account_id; p_amt := r.amount_pence; p_pn := r.pn; p_at := r.occurred_at; p_on := r.occurred_on; p_pname := r.pname; p_aname := r.aname;
  end loop;
  if coalesce(array_length(cl, 1), 0) >= 2 then
    k := (select string_agg(x::text, '|' order by x::text) from unnest(cl) x);
    select a2.answer into ans from month_close_answers a2 where a2.user_id = auth.uid() and a2.item_type = 'duplicate' and a2.item_key = k and a2.answer = 'both_real' order by (a2.month = m) desc limit 1;
    if ans is null or exists (select 1 from month_close_answers a3 where a3.user_id = auth.uid() and a3.month = m and a3.item_type = 'duplicate' and a3.item_key = k and a3.answer = 'both_real') then
      v_dups := v_dups || jsonb_build_array(jsonb_build_object('key', k, 'payee', p_pname, 'amount_pence', p_amt, 'account_name', p_aname, 'answer', ans,
        'txns', (select jsonb_agg(jsonb_build_object('id', x.id, 'occurred_on', x.occurred_on, 'occurred_at', x.occurred_at) order by x.occurred_on, x.occurred_at nulls last, x.id)
                   from transactions x where x.id = any(cl))));
    end if;
  end if;

  -- Step 4b (MC-41): expenses of at least max(£100, 3 x the median ticket of their L1 category over the previous 180 days), £250 with fewer than 5
  -- tickets, that are not one-offs, recurring, on a trip or in a pot. An answer already given keeps them listed, as answered.
  for r in
    select t.id, t.amount_pence, t.occurred_on, py.name as pname, c.name as cname, pc.name as parent_name, coalesce(c.parent_id, c.id) as l1, a.name as aname, ans2.answer as answer
      from transactions t join categories c on c.id = t.category_id left join categories pc on pc.id = c.parent_id
      left join payees py on py.id = t.payee_id join accounts a on a.id = t.account_id
      left join month_close_answers ans2 on ans2.user_id = auth.uid() and ans2.month = m and ans2.item_type = 'large' and ans2.item_key = t.id::text
     where t.type = 'expense' and t.deleted_at is null and t.pot_id is null and t.recurring_id is null and t.trip_id is null and t.source <> 'recurring'
       and t.occurred_on between m and mend
       and (ans2.id is not null or (coalesce(t.is_one_off, false) = false and t.one_off_source is distinct from 'user'))
  loop
    select count(*), percentile_cont(0.5) within group (order by x.amount_pence) into n, med
      from transactions x join categories cc on cc.id = x.category_id
     where x.user_id = auth.uid() and x.type = 'expense' and x.deleted_at is null and x.pot_id is null and x.recurring_id is null and x.id <> r.id
       and coalesce(cc.parent_id, cc.id) = r.l1 and x.occurred_on >= r.occurred_on - 180 and x.occurred_on <= r.occurred_on;
    th := case when n < 5 then 25000 else greatest(10000, (3 * med)::bigint) end;
    if r.amount_pence >= th or r.answer is not null then
      v_large := v_large || jsonb_build_array(jsonb_build_object('id', r.id, 'payee', coalesce(r.pname, r.cname), 'amount_pence', r.amount_pence, 'occurred_on', r.occurred_on,
        'category', coalesce(r.parent_name || ' › ' || r.cname, r.cname), 'account_name', r.aname, 'answer', r.answer));
    end if;
  end loop;

  -- Step 4c (MC-42): what the app flagged as one-offs on its own this month.
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'payee', coalesce(py.name, c.name), 'amount_pence', t.amount_pence, 'occurred_on', t.occurred_on,
           'category', coalesce(pc.name || ' › ' || c.name, c.name), 'account_name', a.name, 'answer', ans.answer) order by t.amount_pence desc), '[]') into v_auto
    from transactions t join categories c on c.id = t.category_id left join categories pc on pc.id = c.parent_id
    left join payees py on py.id = t.payee_id join accounts a on a.id = t.account_id
    left join month_close_answers ans on ans.user_id = auth.uid() and ans.month = m and ans.item_type = 'one_off' and ans.item_key = t.id::text
   where t.type = 'expense' and t.deleted_at is null and t.occurred_on between m and mend
     and ((t.is_one_off and t.one_off_source = 'auto') or ans.id is not null);

  return jsonb_build_object('month', m, 'from', v_from, 'to', mend, 'partial', v_from > m, 'tracking_started_on', v_track,
    'missing_days', v_missing, 'bills', v_bills, 'balances', v_bal, 'duplicates', v_dups, 'large', v_large, 'one_offs', v_auto);
end $$;

-- ── Step 5: the review, live (MC-50). Every figure is an existing function's. ──────────────────────────────────────────────────────────
create function month_close_summary(p_month date, p_today date default london_today()) returns jsonb
language plpgsql stable as $$
declare
  m date := date_trunc('month', p_month)::date; mend date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_track date; v_from date; v_days int; v_spent bigint; v_income bigint; v_budget bigint; v_cov text; v_spent_cov bigint; v_bills bigint; v_every bigint;
  v_usual bigint; v_by jsonb; v_limits jsonb; v_fc jsonb; v_sources jsonb; v_first boolean; d date; v_rec jsonb;
begin
  select p.tracking_started_on into v_track from profiles p where p.id = auth.uid();
  v_from := greatest(m, coalesce(v_track, m));
  v_days := mend - v_from + 1;
  v_first := v_from > m;
  v_spent := budget_spent(m, mend, null, 'all');
  select coalesce(sum(t.amount_pence), 0)::bigint into v_income from transactions t
   where t.type = 'income' and t.deleted_at is null and t.pot_id is null and t.refund_category_id is null and t.occurred_on between m and mend;
  select coalesce(jsonb_agg(x.name order by x.total desc), '[]') into v_sources from (
    select c.name, sum(t.amount_pence) as total from transactions t join categories c on c.id = t.category_id
     where t.type = 'income' and t.deleted_at is null and t.pot_id is null and t.refund_category_id is null and t.occurred_on between m and mend group by c.name order by sum(t.amount_pence) desc limit 3) x;

  select b.amount_pence, b.covers into v_budget, v_cov from budget_for_month(m) b where b.category_id is null;
  v_spent_cov := case when v_budget is null then null else budget_spent(m, mend, null, coalesce(v_cov, 'all')) end;

  select coalesce(jsonb_object_agg(c.id::text, s.v) filter (where s.v <> 0), '{}') into v_by
    from categories c, lateral (select budget_spent(m, mend, c.id, 'all') as v) s where c.parent_id is null and c.kind = 'expense';
  select coalesce(jsonb_agg(jsonb_build_object('category_id', b.category_id, 'limit', b.amount_pence, 'actual', budget_spent(m, mend, b.category_id, coalesce(v_cov, 'all')))), '[]') into v_limits
    from budget_for_month(m) b where b.category_id is not null;

  select coalesce(sum(f.discretionary), 0)::bigint, coalesce(sum(f.recurring), 0)::bigint into v_every, v_bills from forecast_daily_facts(m, mend) f;
  -- what part of each category was recurring payments, with the sub-categories they sit in (a category made only of them is shown as a line, not a bar)
  select coalesce(jsonb_object_agg(x.l1::text, jsonb_build_object('total', x.total, 'names', x.names)), '{}') into v_rec from (
    select coalesce(c.parent_id, c.id) as l1, sum(t.amount_pence)::bigint as total, array_agg(distinct c.name) as names
      from transactions t join categories c on c.id = t.category_id
     where t.type = 'expense' and t.deleted_at is null and t.pot_id is null and t.recurring_id is not null and t.occurred_on between m and mend group by 1) x;

  -- Usual: the forecast's usual per day, from its snapshot on the 1st, times the tracked days in the month (hidden in a first, partial month)
  select s.usual_per_day_pence * v_days into v_usual from forecast_snapshots s
   where s.user_id = auth.uid() and s.scope = 'all' and s.category_id is null and s.day = m and s.usual_per_day_pence is not null;
  if v_first then v_usual := null; end if;

  -- Forecast accuracy: the snapshot on the 1st, 8th, 15th and 22nd (the nearest earlier one in the month when one is missing)
  select coalesce(jsonb_agg(jsonb_build_object('date', x.d, 'snapshot_day', x.sd, 'point', x.pt) order by x.d), '[]') into v_fc from (
    select dd as d, s.day as sd, s.point_pence as pt from (select (m + k)::date as dd from unnest(array[0, 7, 14, 21]) k) dts
      cross join lateral (select fs.day, fs.point_pence from forecast_snapshots fs
        where fs.user_id = auth.uid() and fs.scope = 'all' and fs.category_id is null and fs.day <= dts.dd and fs.day >= m and fs.point_pence is not null
        order by fs.day desc limit 1) s
  ) x where not v_first;

  return jsonb_build_object('month', m, 'partial', v_first, 'days', v_days, 'spent', v_spent, 'income', v_income, 'kept', v_income - v_spent,
    'budget', v_budget, 'covers', v_cov, 'budget_spent', v_spent_cov,
    'budget_status', case when v_budget is null then null when v_spent_cov <= v_budget then 'within' else 'over' end,
    'everyday', v_every, 'bills_regular', v_bills, 'usual_estimate', v_usual, 'by_l1', v_by, 'limits', v_limits, 'forecasts', v_fc, 'income_sources', v_sources, 'recurring_l1', v_rec);
end $$;

-- ── Step 3 write (MC-34), one database transaction ────────────────────────────────────────────────────────────────────────────────────
-- Named close_reconcile_account because the app already has reconcile_account(account, actual, on) for the Settings reconcile.
create function close_reconcile_account(p_month date, p_account uuid, p_bank_balance bigint, p_resolution recon_resolution, p_category uuid default null,
                                        p_date date default null, p_today date default london_today()) returns jsonb
language plpgsql as $$
declare
  m date := close_guard(p_month, p_today); mend date := (m + interval '1 month - 1 day')::date;
  a accounts; v_sterling bigint; v_diff bigint; v_txn uuid; v_cat uuid; v_on date; v_after bigint; v_parent uuid; v_name text;
begin
  perform close_touch(m);
  select * into a from accounts where id = p_account and archived_at is null;
  if a.id is null then raise exception 'Account not found' using errcode = 'no_data_found'; end if;
  select b.balance_pence into v_sterling from account_balances(p_today) b where b.account_id = p_account;
  if v_sterling is null then raise exception 'Account not found' using errcode = 'no_data_found'; end if;
  v_diff := p_bank_balance - v_sterling;

  if p_resolution = 'match' and v_diff <> 0 then raise exception 'The balance does not match' using errcode = 'check_violation'; end if;
  if p_resolution = 'untracked_spend' and v_diff >= 0 then raise exception 'There is no missing spending to log' using errcode = 'check_violation'; end if;
  if p_resolution = 'untracked_income' and v_diff <= 0 then raise exception 'There is no missing income to log' using errcode = 'check_violation'; end if;
  if p_resolution = 'adjustment' and v_diff = 0 then raise exception 'There is nothing to adjust' using errcode = 'check_violation'; end if;
  v_on := least(coalesce(p_date, mend), p_today);

  if p_resolution = 'untracked_spend' then
    v_cat := p_category;
    if v_cat is null then
      select id into v_parent from categories where kind = 'expense' and parent_id is null and archived_at is null and lower(name) = 'other' limit 1;
      if v_parent is null then
        insert into categories (kind, name, icon, color, sort_order) values ('expense', 'Other', 'circle-ellipsis', 'stone', 99) returning id into v_parent;
      end if;
      v_name := case when a.type = 'cash' then 'Untracked cash' else 'Untracked' end;
      select id into v_cat from categories where parent_id = v_parent and lower(name) = lower(v_name) limit 1;
      if v_cat is null then
        insert into categories (kind, name, icon, color, parent_id, sort_order) values ('expense', v_name, 'circle-ellipsis', 'stone', v_parent, 99) returning id into v_cat;
      end if;
    end if;
    insert into transactions (client_id, type, amount_pence, account_id, category_id, note, occurred_on, source, counts_in_balance, balance_flag_source)
      values (gen_random_uuid(), 'expense', -v_diff, p_account, v_cat, 'Month close: spending not logged', v_on, 'close', true, 'manual') returning id into v_txn;
  elsif p_resolution = 'untracked_income' then
    v_cat := p_category;
    if v_cat is null then
      select id into v_cat from categories where kind = 'income' and parent_id is null and archived_at is null and lower(name) = 'untracked income' limit 1;
      if v_cat is null then
        insert into categories (kind, name, icon, color, sort_order) values ('income', 'Untracked income', 'plus', 'stone', 99) returning id into v_cat;
      end if;
    end if;
    insert into transactions (client_id, type, amount_pence, account_id, category_id, note, occurred_on, source, counts_in_balance, balance_flag_source)
      values (gen_random_uuid(), 'income', v_diff, p_account, v_cat, 'Month close: income not logged', v_on, 'close', true, 'manual') returning id into v_txn;
  elsif p_resolution = 'adjustment' then
    insert into transactions (client_id, type, amount_pence, account_id, note, occurred_on, source, is_reconcile, counts_in_balance, balance_flag_source)
      values (gen_random_uuid(), 'adjustment', v_diff, p_account, 'Balance adjustment', p_today, 'close', true, true, 'manual') returning id into v_txn;
  end if;

  insert into account_reconciliations (account_id, as_at, sterling_balance, bank_balance, resolution, transaction_id)
    values (p_account, now(), v_sterling, p_bank_balance, p_resolution, v_txn);
  update accounts set last_reconciled_on = greatest(coalesce(last_reconciled_on, p_today), p_today) where id = p_account;

  select b.balance_pence into v_after from account_balances(p_today) b where b.account_id = p_account;
  if v_after is distinct from p_bank_balance then
    raise exception 'The balance after saving (%) is not the bank figure (%)', v_after, p_bank_balance using errcode = 'check_violation';     -- the whole transaction rolls back (EC-MC18)
  end if;

  insert into month_close_answers (month, item_type, item_key, answer, payload)
    values (m, 'balance', p_account::text, p_resolution::text,
            jsonb_build_object('account_id', p_account, 'sterling', v_sterling, 'bank', p_bank_balance, 'difference', v_diff, 'resolution', p_resolution::text, 'transaction_id', v_txn))
    on conflict (user_id, month, item_type, item_key) do update set answer = excluded.answer, payload = excluded.payload, answered_at = now();
  return jsonb_build_object('difference', v_diff, 'transaction_id', v_txn, 'balance_after', v_after);
end $$;

-- ── Answers ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
create function close_answer(p_month date, p_type close_item, p_key text, p_answer text, p_payload jsonb default null, p_today date default london_today()) returns void
language plpgsql as $$
declare m date := close_guard(p_month, p_today); d date; ids uuid[];
begin
  perform close_touch(m);
  if p_answer = 'reset' then                                                -- "Re-enter": take the answer back
    if p_type = 'missing_day' then
      delete from no_spend_days where day = p_key::date and source = 'close';
    end if;
    delete from month_close_answers where user_id = auth.uid() and month = m and item_type = p_type and item_key = p_key;
    return;
  end if;

  if p_type = 'missing_day' then
    d := p_key::date;
    if d < m or d > (m + interval '1 month - 1 day')::date then raise exception 'That day is not in the month' using errcode = 'check_violation'; end if;
    if p_answer not in ('no_spend', 'not_tracked') then raise exception 'Unknown answer' using errcode = 'check_violation'; end if;
    insert into no_spend_days (day, kind, source) values (d, p_answer, 'close')
      on conflict (user_id, day) do update set kind = excluded.kind, source = 'close';
  elsif p_type = 'large' then
    if p_answer not in ('one_off', 'normal') then raise exception 'Unknown answer' using errcode = 'check_violation'; end if;
    update transactions set is_one_off = (p_answer = 'one_off'), one_off_source = 'user' where id = p_key::uuid and type = 'expense';       -- the owner's choice (MC-41)
  elsif p_type = 'one_off' then
    if p_answer not in ('keep', 'normal') then raise exception 'Unknown answer' using errcode = 'check_violation'; end if;
    update transactions set is_one_off = (p_answer = 'keep'), one_off_source = 'user' where id = p_key::uuid and type = 'expense';
  elsif p_type = 'duplicate' then
    if p_answer not in ('both_real', 'deleted') then raise exception 'Unknown answer' using errcode = 'check_violation'; end if;
  elsif p_type not in ('bill', 'balance', 'missing_run') then
    raise exception 'Unknown item' using errcode = 'check_violation';
  end if;
  insert into month_close_answers (month, item_type, item_key, answer, payload) values (m, p_type, p_key, p_answer, p_payload)
    on conflict (user_id, month, item_type, item_key) do update set answer = excluded.answer, payload = excluded.payload, answered_at = now();
end $$;

-- Several days at once (a run, or "Mark all as not tracked").
create function close_answer_days(p_month date, p_days date[], p_answer text, p_today date default london_today()) returns int
language plpgsql as $$
declare d date; n int := 0;
begin
  foreach d in array p_days loop
    perform close_answer(p_month, 'missing_day', d::text, p_answer, null, p_today);
    n := n + 1;
  end loop;
  return n;
end $$;

-- A bill answered inside the close: the app's own recurring_resolve, plus the answer, atomically (MC-21, MC-22).
create function close_resolve_bill(p_month date, p_occurrence uuid, p_action text, p_amount bigint default null, p_today date default london_today()) returns recurring_occurrences
language plpgsql as $$
declare m date := close_guard(p_month, p_today); o recurring_occurrences; v_answer text;
begin
  perform close_touch(m);
  o := recurring_resolve(p_occurrence, p_action, p_amount);
  v_answer := case p_action when 'confirm' then 'confirmed' when 'skip' then 'skipped' when 'log' then case when p_amount is null then 'paid' else 'paid_different' end end;
  insert into month_close_answers (month, item_type, item_key, answer, payload)
    values (m, 'bill', p_occurrence::text, v_answer, jsonb_build_object('amount_pence', o.amount_pence))
    on conflict (user_id, month, item_type, item_key) do update set answer = excluded.answer, payload = excluded.payload, answered_at = now();
  return o;
end $$;

create function close_set_step(p_month date, p_step text, p_state text, p_today date default london_today()) returns month_closes
language plpgsql as $$
declare m date := close_guard(p_month, p_today); r month_closes;
begin
  if p_step not in ('missing_days', 'bills', 'balances', 'tidy_up', 'review', 'next_month') or p_state not in ('done', 'skipped', 'nothing') then
    raise exception 'Unknown step' using errcode = 'check_violation';
  end if;
  r := close_touch(m);
  update month_closes set step_state = step_state || jsonb_build_object(p_step, p_state) where id = r.id returning * into r;
  return r;
end $$;

-- ── Closing (MC-63), the snapshot (§10.1), reopening and updating ────────────────────────────────────────────────────────────────────
create function close_build_snapshot(p_month date, p_today date, p_skipped text[]) returns jsonb language plpgsql stable as $$
declare m date := date_trunc('month', p_month)::date; s jsonb := month_close_summary(p_month, p_today); v_bal jsonb; v_fix jsonb;
begin
  select coalesce(jsonb_agg(a.payload order by a.answered_at), '[]') into v_bal from month_close_answers a
   where a.user_id = auth.uid() and a.month = m and a.item_type = 'balance';
  select jsonb_build_object(
    'days_no_spend', (select count(*) from month_close_answers a where a.user_id = auth.uid() and a.month = m and a.item_type = 'missing_day' and a.answer = 'no_spend'),
    'days_not_tracked', (select count(*) from month_close_answers a where a.user_id = auth.uid() and a.month = m and a.item_type = 'missing_day' and a.answer = 'not_tracked'),
    'bills_confirmed', (select count(*) from month_close_answers a where a.user_id = auth.uid() and a.month = m and a.item_type = 'bill' and a.answer in ('confirmed', 'paid', 'paid_different')),
    'duplicates_removed', (select count(*) from month_close_answers a where a.user_id = auth.uid() and a.month = m and a.item_type = 'duplicate' and a.answer = 'deleted'
                             and exists (select 1 from transactions t where t.id = any(string_to_array(a.item_key, '|')::uuid[]) and t.deleted_at is not null)),
    'one_offs_changed', (select count(*) from month_close_answers a where a.user_id = auth.uid() and a.month = m and a.item_type in ('large', 'one_off')))
    into v_fix;
  return jsonb_build_object('v', 1, 'month', m, 'spent', s->'spent', 'income', s->'income', 'kept', s->'kept', 'budget', s->'budget', 'budget_status', s->'budget_status',
    'everyday', s->'everyday', 'usual_estimate', s->'usual_estimate', 'by_l1', s->'by_l1', 'limits', s->'limits',
    'forecasts', (select coalesce(jsonb_agg(jsonb_build_object('date', f->>'date', 'point', (f->>'point')::bigint)), '[]') from jsonb_array_elements(s->'forecasts') f),
    'balances', v_bal, 'fixes', v_fix, 'skipped_steps', to_jsonb(p_skipped));
end $$;

create function close_month(p_month date, p_today date default london_today(), p_quick boolean default false) returns month_closes
language plpgsql as $$
declare m date := close_guard(p_month, p_today); r month_closes; v_skipped text[]; v_snap jsonb; v_status close_status; v_active int;
begin
  r := close_touch(m);
  if r.status in ('closed', 'closed_with_skips', 'closed_quick') then return r; end if;                 -- idempotent (EC-MC28)
  if p_quick then
    v_skipped := '{}'; v_status := 'closed_quick';
  else
    select coalesce(array_agg(k order by k), '{}') into v_skipped from jsonb_each_text(r.step_state) e(k, v) where v = 'skipped';
    v_status := case when coalesce(array_length(v_skipped, 1), 0) > 0 then 'closed_with_skips' else 'closed' end;
  end if;
  v_snap := close_build_snapshot(m, p_today, v_skipped);
  v_active := r.active_s + case when r.last_active_at is not null and now() - r.last_active_at <= interval '10 minutes' then extract(epoch from now() - r.last_active_at)::int else 0 end;
  update month_closes set status = v_status, snapshot = v_snap || jsonb_build_object('closed_at', now()),
         closed_at = now(), duration_s = v_active, active_s = v_active, snapshot_rev = 1, changed_since_close = false, last_changed_at = null,
         reopened_count = reopened_count + case when r.closed_at is not null then 1 else 0 end
   where id = r.id returning * into r;
  return r;
end $$;

create function reopen_month(p_month date, p_today date default london_today()) returns month_closes language plpgsql as $$
declare m date := close_guard(p_month, p_today); r month_closes;
begin
  update month_closes set status = 'in_progress', last_active_at = null where user_id = auth.uid() and month = m
     and status in ('closed', 'closed_with_skips', 'closed_quick') returning * into r;
  if r.id is null then raise exception 'That month is not closed' using errcode = 'no_data_found'; end if;
  return r;
end $$;

create function update_close_snapshot(p_month date, p_today date default london_today()) returns month_closes language plpgsql as $$
declare m date := close_guard(p_month, p_today); r month_closes; v_skipped text[];
begin
  select * into r from month_closes where user_id = auth.uid() and month = m for update;
  if r.id is null or r.status not in ('closed', 'closed_with_skips', 'closed_quick') then raise exception 'That month is not closed' using errcode = 'no_data_found'; end if;
  v_skipped := coalesce(array(select jsonb_array_elements_text(r.snapshot->'skipped_steps')), '{}');
  update month_closes set snapshot = close_build_snapshot(m, p_today, v_skipped) || jsonb_build_object('closed_at', r.closed_at),
         snapshot_rev = r.snapshot_rev + 1, changed_since_close = false, last_changed_at = null where id = r.id returning * into r;
  return r;
end $$;

-- MC-71: what moved since the month was closed.
create function close_changes(p_month date, p_today date default london_today()) returns jsonb language plpgsql stable as $$
declare m date := date_trunc('month', p_month)::date; mend date := (m + interval '1 month - 1 day')::date; r month_closes; s jsonb; cats jsonb; txns jsonb;
begin
  select * into r from month_closes where user_id = auth.uid() and month = m;
  if r.id is null or r.snapshot is null then return null; end if;
  s := month_close_summary(m, p_today);
  select coalesce(jsonb_agg(jsonb_build_object('category_id', k, 'before', coalesce((r.snapshot->'by_l1'->>k)::bigint, 0), 'now', coalesce((s->'by_l1'->>k)::bigint, 0))), '[]') into cats
    from (select jsonb_object_keys(r.snapshot->'by_l1') as k union select jsonb_object_keys(s->'by_l1')) ks
   where coalesce((r.snapshot->'by_l1'->>k)::bigint, 0) <> coalesce((s->'by_l1'->>k)::bigint, 0);
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'kind', case when t.deleted_at > r.closed_at then 'deleted' when t.created_at > r.closed_at then 'added' else 'edited' end,
           'payee', coalesce(py.name, c.name), 'amount_pence', t.amount_pence, 'type', t.type, 'occurred_on', t.occurred_on, 'at', greatest(t.created_at, t.updated_at, t.deleted_at))
           order by greatest(t.created_at, t.updated_at, t.deleted_at) desc), '[]') into txns
    from transactions t left join payees py on py.id = t.payee_id left join categories c on c.id = t.category_id
   where t.type in ('expense', 'income') and t.occurred_on between m and mend and (t.created_at > r.closed_at or t.updated_at > r.closed_at or t.deleted_at > r.closed_at)
     and not (t.deleted_at is not null and t.created_at > r.closed_at);
  return jsonb_build_object('closed_at', r.closed_at, 'spent_before', r.snapshot->'spent', 'spent_now', s->'spent',
    'difference', (s->>'spent')::bigint - (r.snapshot->>'spent')::bigint, 'categories', cats, 'transactions', txns);
end $$;

-- What the Home card, the Analytics chips and Settings need: every month that can be closed, with its state. The first call decides which month
-- was the first one offered (the latest completed month); older months are never prompted (MC-04).
create function month_close_state(p_today date default london_today()) returns jsonb language plpgsql as $$
declare cur date := date_trunc('month', p_today)::date; v_track date; v_since date; first_m date; out jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  select p.tracking_started_on, p.close_since into v_track, v_since from profiles p where p.id = auth.uid();
  if v_track is null then return jsonb_build_object('current', cur, 'since', null, 'months', '[]'::jsonb, 'closed_count', 0); end if;
  first_m := date_trunc('month', v_track)::date;
  if v_since is null and first_m < cur then
    v_since := (cur - interval '1 month')::date;
    update profiles set close_since = v_since where id = auth.uid();
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('month', g.mm, 'status', coalesce(c.status::text, 'open'), 'step_state', coalesce(c.step_state, '{}'::jsonb),
           'started_at', c.started_at, 'closed_at', c.closed_at, 'changed_since_close', coalesce(c.changed_since_close, false),
           'spent', c.snapshot->'spent', 'snapshot_rev', c.snapshot_rev, 'prompted', (v_since is not null and g.mm >= v_since),
           'partial', g.mm = first_m and v_track > g.mm, 'duration_s', c.duration_s, 'reopened_count', c.reopened_count) order by g.mm), '[]') into out
    from (select (first_m + make_interval(months => i))::date as mm from generate_series(0, greatest(-1, (extract(year from age(cur, first_m)) * 12 + extract(month from age(cur, first_m)))::int - 1)) i) g
    left join month_closes c on c.user_id = auth.uid() and c.month = g.mm;
  return jsonb_build_object('current', cur, 'since', v_since, 'months', out, 'closed_count', (select count(*) from month_closes where user_id = auth.uid() and status in ('closed', 'closed_with_skips', 'closed_quick')));
end $$;

revoke execute on function close_guard(date, date), close_touch(date), month_close_checks(date, date), month_close_summary(date, date),
  close_reconcile_account(date, uuid, bigint, recon_resolution, uuid, date, date), close_answer(date, close_item, text, text, jsonb, date), close_answer_days(date, date[], text, date),
  close_resolve_bill(date, uuid, text, bigint, date), close_set_step(date, text, text, date), close_build_snapshot(date, date, text[]), close_month(date, date, boolean),
  reopen_month(date, date), update_close_snapshot(date, date), close_changes(date, date), month_close_state(date), transactions_close_changed() from anon, public;
grant execute on function close_guard(date, date), close_touch(date), month_close_checks(date, date), month_close_summary(date, date),
  close_reconcile_account(date, uuid, bigint, recon_resolution, uuid, date, date), close_answer(date, close_item, text, text, jsonb, date), close_answer_days(date, date[], text, date),
  close_resolve_bill(date, uuid, text, bigint, date), close_set_step(date, text, text, date), close_build_snapshot(date, date, text[]), close_month(date, date, boolean),
  reopen_month(date, date), update_close_snapshot(date, date), close_changes(date, date), month_close_state(date) to authenticated, service_role;
