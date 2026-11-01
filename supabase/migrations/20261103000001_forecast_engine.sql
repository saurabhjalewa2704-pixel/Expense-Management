-- Forecasting engine (FORECASTING-ENGINE-PRD §6.14). The formula lives in /lib/forecast; the database supplies facts and keeps the engine's memory
-- (parameters, backtests, snapshots, planned extras). This replaces forecast_inputs() and budget_ticket_stats() from the earlier budgets migration.

drop function if exists forecast_inputs(date, uuid, date);
drop function if exists budget_ticket_stats();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- One-offs (§6.14.3): an expense above max(£150, 5 x the median ticket of its L1 category over the prior 180 days), or £250 when the category has
-- fewer than 10 tickets, is flagged automatically. A choice made by the user is never overwritten.
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table transactions add column one_off_source text check (one_off_source in ('auto', 'user'));
update transactions set one_off_source = 'user' where is_one_off is not null;

create function one_off_threshold(p_user uuid, p_l1 uuid, p_on date, p_exclude uuid default null) returns bigint
language sql stable as $$
  with t as (
    select x.amount_pence from transactions x join categories c on c.id = x.category_id
     where x.user_id = p_user and x.type = 'expense' and x.deleted_at is null and x.pot_id is null and x.recurring_id is null
       and coalesce(c.parent_id, c.id) = p_l1 and x.occurred_on >= p_on - 180 and x.occurred_on <= p_on and x.id is distinct from p_exclude
  )
  select case when (select count(*) from t) < 10 then 25000
              else greatest(15000, (5 * (select percentile_cont(0.5) within group (order by amount_pence) from t))::bigint) end
$$;

create function transactions_one_off() returns trigger language plpgsql as $$
declare l1 uuid;
begin
  if new.type <> 'expense' or new.pot_id is not null or new.recurring_id is not null then
    new.is_one_off := null; new.one_off_source := null; return new;
  end if;
  if tg_op = 'INSERT' then
    if new.is_one_off is not null then new.one_off_source := 'user'; end if;
  elsif new.is_one_off is distinct from old.is_one_off and new.one_off_source is not distinct from old.one_off_source then
    new.one_off_source := 'user';                                           -- the owner flipped it
  end if;
  if new.one_off_source is distinct from 'user' then
    select coalesce(c.parent_id, c.id) into l1 from categories c where c.id = new.category_id;
    new.is_one_off := new.amount_pence > one_off_threshold(new.user_id, l1, new.occurred_on, new.id);
    new.one_off_source := 'auto';
  end if;
  return new;
end $$;
create trigger transactions_one_off before insert or update of amount_pence, category_id, occurred_on, is_one_off, type, deleted_at on transactions
  for each row execute function transactions_one_off();
-- flag what is already there
update transactions set one_off_source = null where one_off_source = 'auto';
update transactions t set amount_pence = amount_pence where t.type = 'expense' and t.one_off_source is null and t.deleted_at is null;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Memory of the engine
-- ---------------------------------------------------------------------------------------------------------------------------------
create table forecast_params (
  user_id    uuid primary key default auth.uid() references auth.users on delete cascade,
  k          numeric not null default 7 check (k between 1 and 30),
  half_life  int not null default 60 check (half_life between 7 and 365),
  z90        numeric not null default 1.2816 check (z90 between 1.0 and 2.0),
  version    text not null default 'default',
  updated_at timestamptz not null default now()
);
create table forecast_param_log (                                           -- audit of every change, with before and after (EC-F29)
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade,
  changed_on date not null, k_before numeric, k_after numeric, half_life_before int, half_life_after int, z_before numeric, z_after numeric,
  mape_before numeric, mape_after numeric, note text, created_at timestamptz not null default now()
);
create table forecast_backtest (
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null, day smallint not null, point_pence bigint not null, low_pence bigint, high_pence bigint, actual_pence bigint not null,
  params_version text, created_at timestamptz not null default now(), unique (user_id, month, day)
);
create table forecast_snapshots (                                           -- one forecast per day per scope and category, at 23:59 London
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade,
  day date not null, scope text not null default 'all', category_id uuid, point_pence bigint, low_pence bigint, high_pence bigint,
  regime text, confidence text, created_at timestamptz not null default now()
);
create unique index forecast_snapshots_one on forecast_snapshots (user_id, day, scope, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table planned_extras (                                               -- "Christmas presents £300" (§6.14.8)
  id uuid primary key default gen_random_uuid(), user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month date not null check (date_trunc('month', month)::date = month), label text not null check (char_length(label) between 1 and 60),
  amount_pence bigint not null check (amount_pence > 0), on_date date, category_id uuid references categories, created_at timestamptz not null default now()
);
create index planned_extras_month on planned_extras (user_id, month);
create table planned_extra_answers (                                        -- each expense is asked about at most once (EC-F30)
  transaction_id uuid not null references transactions on delete cascade, extra_id uuid references planned_extras on delete set null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade, answer text not null check (answer in ('still_to_spend', 'all_of_it', 'no')),
  answered_at timestamptz not null default now(), primary key (transaction_id)
);

do $$
declare t text;
begin
  foreach t in array array['forecast_params', 'forecast_param_log', 'forecast_backtest', 'forecast_snapshots', 'planned_extras', 'planned_extra_answers']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;
grant select, insert, update, delete on forecast_params, forecast_param_log, forecast_backtest, forecast_snapshots, planned_extras, planned_extra_answers to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Daily facts (§6.14.14). A function over the ledger, so there is nothing to keep in step: the same query serves live forecasts and backtests
-- (with p_cutoff, only what had been logged by then).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function forecast_daily_facts(p_from date, p_to date, p_cutoff timestamptz default null)
returns table (d date, discretionary bigint, by_cat jsonb, by_cat_all jsonb, by_cat_rec jsonb, by_cat_trip jsonb,
               recurring bigint, trip bigint, oneoff bigint, has_activity boolean, confirmed_zero boolean, trip_day boolean)
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
         coalesce(a.a, false), exists (select 1 from no_spend_days n where n.day = g.d),
         exists (select 1 from trips tr where g.d between tr.start_on and tr.end_on)
    from (select (p_from + i)::date as d from generate_series(0, greatest(-1, p_to - p_from)) i) g
    left join perday p on p.dd = g.d left join act a on a.dd = g.d
   order by g.d
$$;

-- The feed for the engine: facts, trips, future-dated entries, planned extras, parameters and the backtest error, as one JSON document.
create function forecast_input(p_month date, p_today date default london_today(), p_cutoff timestamptz default null)
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
           'confirmed_zero', f.confirmed_zero, 'trip_day', f.trip_day) order by f.d), '[]')
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

-- The accuracy the Budget health tile shows (BUD-11): mean absolute % error of the nightly backtests, and the months behind it.
create function forecast_accuracy() returns table (mape numeric, bias numeric, coverage numeric, months int)
language sql stable as $$
  select avg(abs(point_pence - actual_pence)::numeric / nullif(actual_pence, 0)), avg((point_pence - actual_pence)::numeric / nullif(actual_pence, 0)),
         avg(case when actual_pence between low_pence and high_pence then 1.0 else 0.0 end), count(distinct month)::int
    from forecast_backtest
$$;

revoke execute on function forecast_daily_facts(date, date, timestamptz), forecast_input(date, date, timestamptz), forecast_accuracy(), one_off_threshold(uuid, uuid, date, uuid),
  transactions_one_off() from anon, public;
grant execute on function forecast_daily_facts(date, date, timestamptz), forecast_input(date, date, timestamptz), forecast_accuracy(), one_off_threshold(uuid, uuid, date, uuid)
  to authenticated, service_role;
