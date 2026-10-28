-- Trips (PRD v1.6 §6.12): a trip is a view over ordinary transactions, never a separate ledger.
create extension if not exists btree_gist with schema extensions;

create table trips (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  name         text not null check (char_length(name) between 1 and 30),
  country_code char(2),
  currency     char(3) not null default 'GBP',
  start_on     date not null,
  end_on       date not null check (end_on >= start_on),
  budget_pence bigint check (budget_pence > 0),
  auto_tag     boolean not null default true,
  created_at   timestamptz not null default now(),
  constraint trips_no_overlap exclude using gist (user_id with =, daterange(start_on, end_on, '[]') with &&)
);

create table trip_stops (
  id       uuid primary key default gen_random_uuid(),
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  trip_id  uuid not null references trips on delete cascade,
  name     text not null check (char_length(name) between 1 and 40),
  start_on date not null,
  end_on   date not null check (end_on >= start_on),
  sort     smallint not null default 0,
  currency char(3)                                                     -- a per-stop default currency (EC-T7)
);
create index trip_stops_trip on trip_stops (trip_id, start_on);

create table trip_category_budgets (
  trip_id      uuid not null references trips on delete cascade,
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid not null references categories,
  amount_pence bigint not null check (amount_pence > 0),
  primary key (trip_id, category_id)
);

-- Stops sit inside their trip and never overlap each other; at most 8 a trip.
create function trip_stops_guard() returns trigger language plpgsql as $$
declare t trips%rowtype;
begin
  select * into t from trips where id = new.trip_id and user_id = new.user_id;
  if t.id is null then raise exception 'Trip not found' using errcode = 'foreign_key_violation'; end if;
  if new.start_on < t.start_on or new.end_on > t.end_on then
    raise exception 'The stop "%" has to sit inside the trip dates', new.name using errcode = 'check_violation';
  end if;
  if exists (select 1 from trip_stops s where s.trip_id = new.trip_id and s.id <> new.id and daterange(s.start_on, s.end_on, '[]') && daterange(new.start_on, new.end_on, '[]')) then
    raise exception 'The stop "%" overlaps another stop', new.name using errcode = 'check_violation';
  end if;
  if tg_op = 'INSERT' and (select count(*) from trip_stops s where s.trip_id = new.trip_id) >= 8 then
    raise exception 'A trip can have up to 8 stops' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trip_stops_guard before insert or update on trip_stops for each row execute function trip_stops_guard();

create function trip_budgets_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from trips t where t.id = new.trip_id and t.user_id = new.user_id) then raise exception 'Trip not found' using errcode = 'foreign_key_violation'; end if;
  if not exists (select 1 from categories c where c.id = new.category_id and c.user_id = new.user_id and c.parent_id is null and c.kind = 'expense') then
    raise exception 'A category budget needs a main expense category' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger trip_budgets_guard before insert or update on trip_category_budgets for each row execute function trip_budgets_guard();

-- Transactions: the trip link, and the original amount when it was paid in another currency (TRIP-06).
alter table transactions
  add column trip_id               uuid references trips on delete set null,
  add column trip_origin           text check (trip_origin in ('auto', 'manual', 'booking')),
  add column original_amount_minor bigint check (original_amount_minor > 0),
  add column original_currency     char(3),
  add column fx_rate               numeric(18, 8) check (fx_rate > 0),
  add column fx_rate_on            date,
  add column fx_source             text check (fx_source in ('auto', 'manual')),
  add constraint fx_all_or_none check ((original_currency is null) = (original_amount_minor is null) and (original_currency is null) = (fx_rate is null));
create index txn_trip on transactions (user_id, trip_id, occurred_on) where trip_id is not null and deleted_at is null;

-- A foreign key does not prove ownership, so check it here.
create function transactions_trip_guard() returns trigger language plpgsql as $$
begin
  if new.trip_id is not null and (tg_op = 'INSERT' or new.trip_id is distinct from old.trip_id)
     and not exists (select 1 from trips t where t.id = new.trip_id and t.user_id = new.user_id) then
    raise exception 'Trip not found' using errcode = 'foreign_key_violation';
  end if;
  if new.type = 'transfer' or new.trip_id is null then new.trip_id := null; new.trip_origin := null; end if;     -- no trip, no origin (also when the trip is deleted)
  return new;
end $$;
create trigger transactions_trip_guard before insert or update on transactions for each row execute function transactions_trip_guard();

alter table accounts add column fx_fee_bps int not null default 0 check (fx_fee_bps between 0 and 1000);
alter table categories add column travel_like boolean not null default false;         -- also scanned for earlier bookings (TRIP-05)

-- Daily reference rates (Frankfurter / ECB), GBP per 1 unit. Readable by signed-in users, written by the cron only.
create table fx_rates (
  on_date      date not null,
  currency     char(3) not null,
  gbp_per_unit numeric(18, 8) not null check (gbp_per_unit > 0),
  primary key (on_date, currency)
);

-- Merged categories keep working for entries that were queued before the merge (EC-C4).
create table category_redirects (
  user_id   uuid not null default auth.uid() references auth.users on delete cascade,
  from_id   uuid primary key,
  to_id     uuid not null references categories,
  merged_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['trips', 'trip_stops', 'trip_category_budgets', 'category_redirects']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;
alter table fx_rates enable row level security;
create policy fx_rates_select on fx_rates for select to authenticated using (true);
revoke insert, update, delete on fx_rates from authenticated;
revoke all on fx_rates from anon;

-- ── Trip numbers (the derived figures, such as the allowance, are computed in lib/tripMath.ts from these sums) ─────────────────────────────
-- Refunds (income tagged to the trip) reduce the total. "Booked before" is anything dated before the trip starts.
create function trip_summary(p_trip uuid, p_as_of date default london_today())
returns table (trip_id uuid, name text, currency char(3), start_on date, end_on date, budget_pence bigint,
               booked_pence bigint, on_trip_pence bigint, spent_pence bigint, refund_pence bigint, txn_count int,
               days int, day_n int, local_minor bigint, local_pence bigint)
language sql stable as $$
  with tr as (select * from trips where id = p_trip),
  s as (
    select t.*, case t.type when 'expense' then t.amount_pence else -t.amount_pence end as signed
      from transactions t, tr
     where t.trip_id = tr.id and t.deleted_at is null and t.type in ('expense', 'income')
  )
  select tr.id, tr.name, tr.currency, tr.start_on, tr.end_on, tr.budget_pence,
         coalesce(sum(s.signed) filter (where s.occurred_on < tr.start_on), 0)::bigint,
         coalesce(sum(s.signed) filter (where s.occurred_on >= tr.start_on), 0)::bigint,
         coalesce(sum(s.signed), 0)::bigint,
         coalesce(sum(s.amount_pence) filter (where s.type = 'income'), 0)::bigint,
         count(s.id)::int,
         (tr.end_on - tr.start_on + 1)::int,
         greatest(0, least((tr.end_on - tr.start_on + 1), p_as_of - tr.start_on + 1))::int,
         coalesce(sum(s.original_amount_minor) filter (where s.type = 'expense' and s.original_currency = tr.currency), 0)::bigint,
         coalesce(sum(s.amount_pence) filter (where s.type = 'expense' and s.original_currency = tr.currency), 0)::bigint
    from tr left join s on true
   group by tr.id, tr.name, tr.currency, tr.start_on, tr.end_on, tr.budget_pence
$$;

-- The list screen: one row per trip with its totals.
create function trips_overview(p_as_of date default london_today())
returns table (trip_id uuid, name text, country_code char(2), currency char(3), start_on date, end_on date, budget_pence bigint,
               booked_pence bigint, on_trip_pence bigint, spent_pence bigint, txn_count int)
language sql stable as $$
  select tr.id, tr.name, tr.country_code, tr.currency, tr.start_on, tr.end_on, tr.budget_pence,
         coalesce(sum(case t.type when 'expense' then t.amount_pence else -t.amount_pence end) filter (where t.occurred_on < tr.start_on), 0)::bigint,
         coalesce(sum(case t.type when 'expense' then t.amount_pence else -t.amount_pence end) filter (where t.occurred_on >= tr.start_on), 0)::bigint,
         coalesce(sum(case t.type when 'expense' then t.amount_pence else -t.amount_pence end), 0)::bigint,
         count(t.id)::int
    from trips tr
    left join transactions t on t.trip_id = tr.id and t.deleted_at is null and t.type in ('expense', 'income')
   group by tr.id
   order by tr.start_on desc
$$;

-- On-trip spending by day (bookings are excluded) and the biggest expense of each day.
create function trip_by_day(p_trip uuid)
returns table (day date, total_pence bigint, top_payee text, top_pence bigint, txn_count int)
language sql stable as $$
  with tr as (select * from trips where id = p_trip),
  d as (select g::date as day from tr, generate_series(tr.start_on, tr.end_on, interval '1 day') g),
  s as (
    select t.occurred_on as day, case t.type when 'expense' then t.amount_pence else -t.amount_pence end as signed, t.amount_pence, t.type, coalesce(p.name, c.name, 'Spending') as label
      from transactions t join tr on t.trip_id = tr.id
      left join payees p on p.id = t.payee_id left join categories c on c.id = t.category_id
     where t.deleted_at is null and t.type in ('expense', 'income') and t.occurred_on >= tr.start_on
  )
  select d.day, coalesce(sum(s.signed), 0)::bigint,
         (array_agg(s.label order by s.amount_pence desc) filter (where s.type = 'expense'))[1],
         (max(s.amount_pence) filter (where s.type = 'expense'))::bigint,
         count(s.day)::int
    from d left join s on s.day = d.day
   group by d.day order by d.day
$$;

-- By stop; days that no stop covers are grouped as "Other" (EC-T15).
create function trip_by_stop(p_trip uuid, p_as_of date default london_today())
returns table (stop_id uuid, name text, start_on date, end_on date, days int, days_elapsed int, total_pence bigint)
language sql stable as $$
  with tr as (select * from trips where id = p_trip),
  spend as (
    select t.occurred_on as day, case t.type when 'expense' then t.amount_pence else -t.amount_pence end as signed
      from transactions t join tr on t.trip_id = tr.id
     where t.deleted_at is null and t.type in ('expense', 'income') and t.occurred_on >= tr.start_on
  ),
  stops as (select s.id, s.name, s.start_on, s.end_on, s.sort from trip_stops s join tr on s.trip_id = tr.id),
  stop_rows as (
    select s.id as stop_id, s.name, s.start_on, s.end_on, s.sort,
           (s.end_on - s.start_on + 1)::int as days,
           greatest(0, least(s.end_on - s.start_on + 1, p_as_of - s.start_on + 1))::int as days_elapsed,
           coalesce((select sum(x.signed) from spend x where x.day between s.start_on and s.end_on), 0)::bigint as total_pence
      from stops s
  ),
  other as (
    select null::uuid as stop_id, 'Other'::text as name, null::date as start_on, null::date as end_on, 32767::smallint as sort,
           ((select (end_on - start_on + 1) from tr) - coalesce((select sum(days) from stop_rows), 0))::int as days,
           0::int as days_elapsed,
           coalesce((select sum(x.signed) from spend x where not exists (select 1 from stops s where x.day between s.start_on and s.end_on)), 0)::bigint as total_pence
  )
  select r.stop_id, r.name, r.start_on, r.end_on, r.days, r.days_elapsed, r.total_pence from stop_rows r
  union all
  select o.stop_id, o.name, o.start_on, o.end_on, o.days, o.days_elapsed, o.total_pence from other o
   where exists (select 1 from stops) and o.days > 0
  order by 3 nulls last, 2
$$;

-- Where the whole trip's money went (bookings included), parents or sub-categories, with the trip's category budgets and netted refunds (EC-T18).
-- A refund is netted against the category of the same payee's expense on this trip; one with no match goes to its own income category line.
create function trip_by_category(p_trip uuid, p_level text default 'parent')
returns table (category_id uuid, name text, icon text, color text, parent_id uuid, total_pence bigint, txn_count int, parent_name text,
               is_parent_direct boolean, budget_pence bigint, net_refund_pence bigint)
language sql stable as $$
  with tr as (select * from trips where id = p_trip),
  base as (
    select t.id, t.type, t.amount_pence, t.payee_id,
           case when t.type = 'expense' then t.category_id
                else (select e.category_id from transactions e where e.trip_id = t.trip_id and e.type = 'expense' and e.deleted_at is null and e.payee_id = t.payee_id
                       order by e.occurred_on desc limit 1) end as cat_id,
           t.category_id as own_cat
      from transactions t join tr on t.trip_id = tr.id
     where t.deleted_at is null and t.type in ('expense', 'income')
  ),
  g as (
    select coalesce(b.cat_id, b.own_cat) as leaf,
           coalesce(sum(b.amount_pence) filter (where b.type = 'expense'), 0) as gross,
           coalesce(sum(b.amount_pence) filter (where b.type = 'income'), 0) as refund,
           count(*)::int as n
      from base b group by 1
  ),
  rolled as (
    select case when p_level = 'leaf' then c.id else coalesce(c.parent_id, c.id) end as gid,
           sum(g.gross) as gross, sum(g.refund) as refund, sum(g.n)::int as n
      from g join categories c on c.id = g.leaf group by 1
  )
  select c.id, c.name, c.icon, c.color, c.parent_id,
         greatest(r.gross - r.refund, 0)::bigint, r.n, pc.name,
         (c.parent_id is null and p_level = 'leaf'),
         (select b.amount_pence from trip_category_budgets b where b.trip_id = p_trip and b.category_id = c.id and p_level = 'parent'),
         greatest(r.refund - r.gross, 0)::bigint
    from rolled r join categories c on c.id = r.gid left join categories pc on pc.id = c.parent_id
   order by 6 desc, c.name
$$;

-- TRIP-05: earlier bookings that look like they belong to this trip (the 12 months before it starts).
create function trip_candidates(p_trip uuid)
returns table (id uuid, occurred_on date, amount_pence bigint, payee_name text, note text, category_name text, parent_name text, account_name text)
language sql stable as $$
  with tr as (select * from trips where id = p_trip)
  select t.id, t.occurred_on, t.amount_pence, p.name, t.note, c.name, pc.name, a.name
    from transactions t join tr on true
    join categories c on c.id = t.category_id
    left join categories pc on pc.id = c.parent_id
    left join payees p on p.id = t.payee_id
    join accounts a on a.id = t.account_id
   where t.deleted_at is null and t.type = 'expense' and t.trip_id is null and t.pot_id is null
     and t.occurred_on >= (tr.start_on - interval '12 months')::date and t.occurred_on < tr.start_on
     and ((pc.name = 'Travel' and c.name in ('Flights', 'Hotels', 'Visas & insurance')) or c.travel_like or coalesce(pc.travel_like, false))
   order by t.occurred_on
$$;

-- Delete everything: trips, redirects and the rest (EC-P8).
create or replace function delete_all_my_data() returns void language plpgsql as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from ask_turns where user_id = v_uid;
  delete from insight_feedback where user_id = v_uid;
  delete from insight_runs where user_id = v_uid;
  delete from budgets where user_id = v_uid;
  delete from recurring_dismissed where user_id = v_uid;
  delete from trips where user_id = v_uid;                    -- stops and category budgets go with them; transactions are deleted just below
  delete from category_redirects where user_id = v_uid;
  delete from recurring_items where user_id = v_uid;
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

-- Capture and edit: the trip chip and the original foreign amount.
drop function create_transaction(uuid, txn_type, bigint, uuid, uuid, uuid, text, text, text[], date, timestamptz, txn_source, boolean, boolean, uuid, boolean, boolean, text);
create function create_transaction(
  p_client_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null,
  p_source txn_source default 'app', p_needs_review boolean default false,
  p_account_manual boolean default false, p_pot_id uuid default null,
  p_counts_in_balance boolean default null, p_counter_counts_in_balance boolean default null, p_occurred_tz text default null,
  p_trip_id uuid default null, p_trip_origin text default null, p_trip_untag boolean default false,
  p_original_amount_minor bigint default null, p_original_currency text default null, p_fx_rate numeric default null, p_fx_rate_on date default null, p_fx_source text default null)
returns transactions language plpgsql as $$
declare
  v_uid uuid := auth.uid(); v_row transactions; v_payee uuid;
  v_def uuid; v_cand uuid; v_count smallint; v_date date := coalesce(p_occurred_on, london_today()); v_trip uuid; v_origin text;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  -- TRIP-04: an expense dated inside an active trip is tagged to it, unless the owner untagged it. Bills, transfers and income are never auto-tagged.
  if p_type in ('expense', 'income') and p_pot_id is null then
    if p_trip_id is not null then
      v_trip := p_trip_id;
      v_origin := coalesce(p_trip_origin, case when v_date < (select t.start_on from trips t where t.id = p_trip_id) then 'booking' else 'manual' end);
    elsif p_type = 'expense' and not coalesce(p_trip_untag, false) and p_source <> 'recurring' then
      select t.id into v_trip from trips t where t.user_id = v_uid and t.auto_tag and v_date between t.start_on and t.end_on;
      if v_trip is not null then v_origin := 'auto'; end if;
    end if;
  end if;

  insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, category_id,
                            note, tags, occurred_on, occurred_at, source, needs_review, pot_id,
                            counts_in_balance, counter_counts_in_balance, balance_flag_source, occurred_tz,
                            trip_id, trip_origin, original_amount_minor, original_currency, fx_rate, fx_rate_on, fx_source)
    values (v_uid, p_client_id, p_type, p_amount_pence, p_account_id, p_counter_account_id, p_category_id,
            nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_tags, '{}'),
            v_date, p_occurred_at, p_source, coalesce(p_needs_review, false),
            case when p_type in ('expense', 'income') then p_pot_id end,
            coalesce(p_counts_in_balance, true), p_counter_counts_in_balance, case when p_counts_in_balance is null then 'auto' else 'manual' end, nullif(btrim(coalesce(p_occurred_tz, '')), ''),
            v_trip, v_origin, p_original_amount_minor, upper(p_original_currency), p_fx_rate, p_fx_rate_on, case when p_original_currency is null then null else coalesce(p_fx_source, 'auto') end)
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

drop function update_transaction(uuid, txn_type, bigint, uuid, uuid, uuid, text, text, text[], date, timestamptz, uuid, boolean, boolean);
create function update_transaction(
  p_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null, p_pot_id uuid default null,
  p_counts_in_balance boolean default null, p_counter_counts_in_balance boolean default null,
  p_trip_set boolean default false, p_trip_id uuid default null, p_trip_origin text default null,
  p_fx_set boolean default false, p_original_amount_minor bigint default null, p_original_currency text default null, p_fx_rate numeric default null, p_fx_rate_on date default null, p_fx_source text default null)
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
      occurred_on = coalesce(p_occurred_on, occurred_on), occurred_at = p_occurred_at, needs_review = false,
      -- the trip chip: set explicitly (null untags); an expense turned into income loses an automatic tag, a transfer loses any (EC-C8)
      trip_id = case when p_type = 'transfer' then null
                     when p_trip_set then p_trip_id
                     when p_type <> type and trip_origin = 'auto' then null else trip_id end,
      trip_origin = case when p_type = 'transfer' then null
                         when p_trip_set then (case when p_trip_id is null then null else coalesce(p_trip_origin,
                              case when coalesce(p_occurred_on, occurred_on) < (select t.start_on from trips t where t.id = p_trip_id) then 'booking' else 'manual' end) end)
                         when p_type <> type and trip_origin = 'auto' then null else trip_origin end,
      original_amount_minor = case when p_fx_set then p_original_amount_minor else original_amount_minor end,
      original_currency = case when p_fx_set then upper(p_original_currency) else original_currency end,
      fx_rate = case when p_fx_set then p_fx_rate else fx_rate end,
      fx_rate_on = case when p_fx_set then p_fx_rate_on else fx_rate_on end,
      fx_source = case when p_fx_set then (case when p_original_currency is null then null else coalesce(p_fx_source, 'auto') end) else fx_source end,
      -- an explicit answer is manual; moving to another account asks again (back to auto); otherwise the flag source is kept
      counts_in_balance = coalesce(p_counts_in_balance, counts_in_balance),
      counter_counts_in_balance = case when p_type = 'transfer' then coalesce(p_counter_counts_in_balance, counter_counts_in_balance, true) end,
      balance_flag_source = case when p_counts_in_balance is not null then 'manual'
                                 when account_id is distinct from p_account_id then 'auto' else balance_flag_source end
    where id = p_id and deleted_at is null
    returning * into v_row;
  if v_row.id is null then raise exception 'Transaction not found' using errcode = 'no_data_found'; end if;
  return v_row;
end $$;



-- Activity: the trip on every row, and a Trip filter.
drop function list_transactions(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid, int, date, timestamptz, uuid, uuid, text, boolean);
create function list_transactions(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_limit int default 40, p_after_on date default null, p_after_created timestamptz default null,
  p_after_id uuid default null, p_pot_id uuid default null, p_pots text default null, p_recurring boolean default null, p_trip text default null)
returns table (
  id uuid, client_id uuid, type txn_type, amount_pence bigint,
  account_id uuid, account_name text, counter_account_id uuid, counter_account_name text,
  category_id uuid, category_name text, parent_category_id uuid, parent_category_name text, category_icon text,
  payee_id uuid, payee_name text, note text, tags text[], occurred_on date, occurred_at timestamptz,
  source txn_source, needs_review boolean, created_at timestamptz, pot_id uuid, pot_name text, recurring_id uuid, is_estimate boolean,
  counts_in_balance boolean, counter_counts_in_balance boolean, is_reconcile boolean, occurred_tz text,
  trip_id uuid, trip_name text, trip_origin text, original_amount_minor bigint, original_currency char(3), fx_rate numeric, fx_rate_on date, fx_source text)
language sql stable as $$
  with f as (
    select t.id, t.client_id, t.type, t.amount_pence,
           t.account_id, a.name as account_name, t.counter_account_id, b.name as counter_account_name,
           t.category_id, c.name as category_name, c.parent_id as parent_category_id, pc.name as parent_category_name,
           coalesce(c.icon, pc.icon) as category_icon,
           t.payee_id, p.name as payee_name, t.note, t.tags, t.occurred_on, t.occurred_at,
           t.source, t.needs_review, t.created_at, t.pot_id, o.name as pot_name, t.recurring_id, t.is_estimate, t.counts_in_balance, t.counter_counts_in_balance, t.is_reconcile, t.occurred_tz, t.trip_id, tp.name as trip_name, t.trip_origin, t.original_amount_minor, t.original_currency, t.fx_rate, t.fx_rate_on, t.fx_source,
           row_number() over (order by t.occurred_on desc, t.created_at desc, t.id desc) as rn
      from transactions t
      join accounts a on a.id = t.account_id
      left join accounts b on b.id = t.counter_account_id
      left join categories c on c.id = t.category_id
      left join categories pc on pc.id = c.parent_id
      left join payees p on p.id = t.payee_id
      left join pots o on o.id = t.pot_id
      left join trips tp on tp.id = t.trip_id
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
       and (p_recurring is null or (t.recurring_id is not null) = p_recurring)
     and (p_trip is null or (p_trip = 'any' and t.trip_id is not null) or (p_trip = 'none' and t.trip_id is null) or t.trip_id::text = p_trip)
       and (p_trip is null or (p_trip = 'any' and t.trip_id is not null) or (p_trip = 'none' and t.trip_id is null) or t.trip_id::text = p_trip)
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
         f.source, f.needs_review, f.created_at, f.pot_id, f.pot_name, f.recurring_id, f.is_estimate, f.counts_in_balance, f.counter_counts_in_balance, f.is_reconcile, f.occurred_tz, f.trip_id, f.trip_name, f.trip_origin, f.original_amount_minor, f.original_currency, f.fx_rate, f.fx_rate_on, f.fx_source
    from f
   where f.occurred_on >= coalesce(
           (select x.occurred_on from f x where x.rn = least(greatest(coalesce(p_limit, 40), 1), 200)),
           '0001-01-01'::date)
   order by f.occurred_on desc, f.created_at desc, f.id desc
   limit 1000
$$;

-- spend/income are usual spending only; pot_pence is the net of pot income and expenses in the same filter.
drop function transaction_totals(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid, uuid, text, boolean);
create function transaction_totals(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_pot_id uuid default null, p_pots text default null, p_recurring boolean default null, p_trip text default null)
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
     and (p_recurring is null or (t.recurring_id is not null) = p_recurring)
     and (p_q is null or p_q = '' or
          p.name ilike '%' || p_q || '%' or t.note ilike '%' || p_q || '%'
          or c.name ilike '%' || p_q || '%' or pc.name ilike '%' || p_q || '%'
          or extensions.similarity(coalesce(p.name_norm, ''), lower(p_q)) > 0.3
          or exists (select 1 from unnest(t.tags) tg where tg ilike '%' || p_q || '%'))
$$;




-- Analytics: "Exclude trips", and norms that never include trip spending.
drop function spend_by_category(date, date, uuid, boolean, text);
create or replace function spend_by_category(p_from date, p_to date, p_parent uuid default null, p_pool_only boolean default false,
                                  p_level text default 'parent', p_exclude_trips boolean default false)
returns table (category_id uuid, name text, icon text, color text, parent_id uuid,
               total_pence bigint, txn_count int, norm_pence bigint,
               parent_name text, is_fixed boolean, is_parent_direct boolean, visits int)
language sql stable as $$
  with scoped as (
    select t.occurred_on, t.amount_pence, t.trip_id,
           case when p_parent is null and p_level = 'parent' then coalesce(c.parent_id, c.id) else c.id end as gid
      from transactions t
      join categories c on c.id = t.category_id
      left join accounts a on a.id = t.account_id
     where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
       and t.occurred_on >= months_back(p_from, 6) and t.occurred_on <= p_to
       and (not p_pool_only or a.counts_as_cash)
       and (p_parent is null or c.id = p_parent or c.parent_id = p_parent)
       and (not p_exclude_trips or t.trip_id is null)
  ),
  cur as (
    select gid, sum(amount_pence)::bigint as total, count(*)::int as n from scoped
     where occurred_on between p_from and p_to group by gid
  ),
  first_txn as (select coalesce((select tracking_started_on from profiles where id = auth.uid()), (select min(occurred_on) from transactions where deleted_at is null and pot_id is null)) as d),
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
           and s.trip_id is null                                            -- trip spending never counts towards "usual" (TRIP-09)
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

create or replace function category_period_history(p_from date, p_to date, p_periods int default 6, p_step interval default interval '1 month')
returns table (category_id uuid, name text, icon text, parent_id uuid, current_pence bigint, prior_pence bigint[])
language sql stable as $$
  with first_txn as (select coalesce((select tracking_started_on from profiles where id = auth.uid()), (select min(occurred_on) from transactions where deleted_at is null and pot_id is null)) as d),
  ks as (select k from generate_series(1, p_periods) k, first_txn where (p_from - k * p_step)::date >= first_txn.d),
  scoped as (
    select t.occurred_on, t.amount_pence, coalesce(c.parent_id, c.id) as gid
      from transactions t join categories c on c.id = t.category_id
     where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
       and t.occurred_on >= (p_from - p_periods * p_step)::date and t.occurred_on <= p_to
       and (t.trip_id is null or t.occurred_on between p_from and p_to)     -- earlier periods leave trip spending out (TRIP-09)
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


drop function daily_spend(date, date, boolean);
create or replace function daily_spend(p_from date, p_to date, p_exclude_fixed boolean default false, p_exclude_trips boolean default false)
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
       and (not p_exclude_trips or t.trip_id is null)
     group by t.occurred_on
  )
  select d.day, coalesce(s.total, 0)::bigint,
         (sum(coalesce(s.total, 0)) over (order by d.day))::bigint
    from d left join s on s.day = d.day
   order by d.day
$$;

drop function monthly_totals(int);
create or replace function monthly_totals(p_months int default 12, p_exclude_trips boolean default false)
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
         and (not p_exclude_trips or t.trip_id is null)
   group by months.m order by months.m
$$;


grant select, insert, update, delete on trips, trip_stops, trip_category_budgets, category_redirects to authenticated, service_role;
grant select on fx_rates to authenticated;
grant select, insert, update, delete on fx_rates to service_role;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function recurring_log(uuid, date, date, date), recurring_log_impl(uuid, date, date, date) from authenticated;
