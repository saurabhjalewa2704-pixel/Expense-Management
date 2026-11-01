-- Budgets (PRD v1.7.1 §6.13, M4e). Replaces the earlier P1 'budgets' table, which nothing in the app used.
--
-- The forecast itself is computed in /lib/forecast.ts (BUD-05, BUD-05a): one formula, in one place. The database supplies the facts it
-- needs (`forecast_inputs`), the effective budget amounts (`budget_for_month`) and the history (`budget_history`).

drop table budgets cascade;

-- The old trend projection is replaced by the single forecast engine (lib/forecast.ts, BUD-05a rule 7).
drop function if exists category_remaining(uuid, date, int, boolean);

create table budgets (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references auth.users on delete cascade,
  category_id     uuid references categories,                 -- null = overall budget; else an L1 expense category
  amount_pence    bigint not null check (amount_pence > 0),
  effective_from  date not null,                              -- first day of a month
  effective_to    date,                                       -- null = open-ended; set when superseded or removed
  rollover        boolean not null default false,             -- category limits only
  covers          text not null default 'all' check (covers in ('all', 'exclude_bills', 'exclude_trips', 'exclude_both')),   -- overall only
  created_at      timestamptz not null default now(),
  check (date_trunc('month', effective_from)::date = effective_from),
  check (effective_to is null or effective_to >= effective_from),
  check (category_id is null or covers = 'all'),
  check (category_id is not null or not rollover)
);
create unique index budgets_one_active on budgets (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);

create table budget_overrides (                               -- "adjust this month only"
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  category_id  uuid references categories,                    -- null = overall
  month        date not null check (date_trunc('month', month)::date = month),
  amount_pence bigint not null check (amount_pence > 0)
);
create unique index budget_overrides_one on budget_overrides (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), month);

create table budget_forecast_log (                            -- nightly snapshot for forecast accuracy, and "forecast_degenerate" notes
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  month          date not null,
  day            smallint not null,
  category_id    uuid,
  spent_pence    bigint not null,
  forecast_pence bigint not null,
  low_pence      bigint,
  high_pence     bigint,
  notes          text,
  created_at     timestamptz not null default now()
);
create unique index budget_forecast_log_one on budget_forecast_log (user_id, month, day, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid));

create table budget_alerts_sent (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid() references auth.users on delete cascade,
  month            date not null,
  category_id      uuid,
  kind             text not null check (kind in ('forecast_over', 'pct80', 'reached')),
  last_value_pence bigint,
  sent_at          timestamptz not null default now()
);
create unique index budget_alerts_sent_one on budget_alerts_sent (user_id, month, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid), kind);

-- Alert choices (BUD-09): on by default except the weekly check.
alter table profiles
  add column budget_alert_forecast boolean not null default true,
  add column budget_alert_pct80    boolean not null default true,
  add column budget_alert_reached  boolean not null default true,
  add column budget_alert_weekly   boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['budgets', 'budget_overrides', 'budget_forecast_log', 'budget_alerts_sent']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

grant select, insert, update, delete on budgets, budget_overrides, budget_forecast_log, budget_alerts_sent to authenticated, service_role;

-- A limit sits on an L1 (top-level) expense category.
create function budgets_guard() returns trigger language plpgsql as $$
declare c categories;
begin
  if new.category_id is not null then
    select * into c from categories where id = new.category_id and user_id = new.user_id;
    if c.id is null then raise exception 'Category not found' using errcode = 'foreign_key_violation'; end if;
    if c.parent_id is not null or c.kind <> 'expense' then
      raise exception 'A limit goes on a top-level expense category' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
create trigger budgets_guard before insert or update on budgets for each row execute function budgets_guard();
create trigger budget_overrides_guard before insert or update on budget_overrides for each row execute function budgets_guard();

-- BUD-01 linked refunds, BUD-05 one-off marker.
alter table transactions
  add column refund_category_id uuid references categories,
  add column is_one_off boolean;                              -- null = decided automatically (> 5x the category's median ticket)
create index txn_refund_cat on transactions (user_id, refund_category_id, occurred_on) where refund_category_id is not null and deleted_at is null;

create function transactions_refund_guard() returns trigger language plpgsql as $$
begin
  if new.refund_category_id is not null then
    if new.type <> 'income' then new.refund_category_id := null; end if;                              -- only a refund (income) is linked
    if new.refund_category_id is not null and not exists (select 1 from categories c where c.id = new.refund_category_id and c.user_id = new.user_id and c.kind = 'expense') then
      raise exception 'Category not found' using errcode = 'foreign_key_violation';
    end if;
  end if;
  if new.type <> 'expense' then new.is_one_off := null; end if;
  return new;
end $$;
create trigger transactions_refund_guard before insert or update on transactions for each row execute function transactions_refund_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Scope helpers. A limit's scope is its L1 category and everything under it (EC-G: parent-direct spend counts).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function budget_in_scope(p_cat uuid, p_scope uuid) returns boolean
language sql stable as $$
  select p_scope is null or p_cat = p_scope or exists (select 1 from categories c where c.id = p_cat and c.parent_id = p_scope)
$$;

-- Counted spend for a scope between two dates (BUD-01): every expense, whether or not it counts in the balance, pots and transfers
-- and adjustments excluded, less income refunds linked to the scope. `p_covers` removes Bills and/or trips from both sides.
create function budget_spent(p_from date, p_to date, p_scope uuid default null, p_covers text default 'all')
returns bigint language sql stable as $$
  select coalesce(sum(case when t.type = 'expense' then t.amount_pence else -t.amount_pence end), 0)::bigint
    from transactions t
   where t.deleted_at is null and t.pot_id is null
     and t.occurred_on between p_from and p_to
     and ((t.type = 'expense' and budget_in_scope(t.category_id, p_scope))
          or (t.type = 'income' and t.refund_category_id is not null and budget_in_scope(t.refund_category_id, p_scope)))
     and (p_covers not in ('exclude_bills', 'exclude_both') or t.recurring_id is null)
     and (p_covers not in ('exclude_trips', 'exclude_both') or t.trip_id is null)
$$;

-- The amount that applies to one limit in one month, before any rollover: the effective-dated amount, replaced by a one-month override.
create function budget_base(p_category uuid, p_month date)
returns table (amount_pence bigint, override_pence bigint, rollover boolean, covers text)
language sql stable as $$
  select coalesce(o.amount_pence, b.amount_pence)::bigint, o.amount_pence::bigint, b.rollover, b.covers
    from budgets b
    left join budget_overrides o on o.month = date_trunc('month', p_month)::date and o.category_id is not distinct from b.category_id
   where b.category_id is not distinct from p_category
     and b.effective_from <= p_month and (b.effective_to is null or b.effective_to >= p_month)
   order by b.effective_from desc
   limit 1
$$;

-- The amounts that apply to a month (BUD-02), overall (category_id null) and per limit: base amount, any one-month override, and the
-- rollover carried in from earlier months (unspent adds, overspend subtracts, capped at +/- 100% of the limit).
create function budget_for_month(p_month date)
returns table (category_id uuid, base_pence bigint, override_pence bigint, carried_pence bigint, amount_pence bigint, rollover boolean, covers text)
language plpgsql stable as $$
declare m date := date_trunc('month', p_month)::date;
        r record; b record; pb record; k date; carry bigint; first_m date; ov_cov text;
begin
  select x.covers into ov_cov from budget_base(null, m) x;
  ov_cov := coalesce(ov_cov, 'all');
  for r in
    select distinct bb.category_id as cat from budgets bb
     where bb.effective_from <= m and (bb.effective_to is null or bb.effective_to >= m)
  loop
    select * into b from budget_base(r.cat, m);
    if b.amount_pence is null then continue; end if;
    carry := 0;
    if b.rollover and r.cat is not null then
      select min(x.effective_from) into first_m from budgets x where x.category_id = r.cat and x.rollover and x.effective_from <= m;
      k := greatest(first_m, (m - interval '24 months')::date);
      while k < m loop
        select * into pb from budget_base(r.cat, k);
        if pb.amount_pence is not null and pb.rollover then
          carry := greatest(least(pb.amount_pence + carry - budget_spent(k, (k + interval '1 month - 1 day')::date, r.cat, ov_cov), pb.amount_pence), -pb.amount_pence);
        else
          carry := 0;
        end if;
        k := (k + interval '1 month')::date;
      end loop;
    end if;
    category_id := r.cat; base_pence := b.amount_pence; override_pence := b.override_pence; carried_pence := carry;
    amount_pence := b.amount_pence + carry; rollover := b.rollover; covers := case when r.cat is null then b.covers else 'all' end;
    return next;
  end loop;
end $$;

-- Writing budgets (BUD-02). A change applies "from this month" or "from next month"; the earlier amount keeps its history.
create function set_budget(p_category uuid, p_amount bigint, p_from date, p_rollover boolean default false, p_covers text default 'all')
returns void language plpgsql as $$
declare f date := date_trunc('month', p_from)::date; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = 'check_violation'; end if;
  if p_covers not in ('all', 'exclude_bills', 'exclude_trips', 'exclude_both') then raise exception 'Unknown cover choice' using errcode = 'check_violation'; end if;
  -- close whatever applied before, and drop anything that was scheduled later than this change
  delete from budgets where user_id = v_uid and category_id is not distinct from p_category and effective_from >= f;
  update budgets set effective_to = (f - interval '1 day')::date
   where user_id = v_uid and category_id is not distinct from p_category and (effective_to is null or effective_to >= f);
  insert into budgets (user_id, category_id, amount_pence, effective_from, rollover, covers)
  values (v_uid, p_category, p_amount, f, case when p_category is null then false else p_rollover end, case when p_category is null then p_covers else 'all' end);
end $$;

-- Removing a limit keeps its history: it simply ends the month before (BUD-02). Removing the overall budget does the same.
create function remove_budget(p_category uuid, p_from date) returns void language plpgsql as $$
declare f date := date_trunc('month', p_from)::date; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from budgets where user_id = v_uid and category_id is not distinct from p_category and effective_from >= f;
  update budgets set effective_to = (f - interval '1 day')::date
   where user_id = v_uid and category_id is not distinct from p_category and (effective_to is null or effective_to >= f);
  delete from budget_overrides where user_id = v_uid and category_id is not distinct from p_category and month >= f;
end $$;

-- "Adjust this month only" (BUD-02). A null amount clears the override.
create function set_budget_override(p_category uuid, p_month date, p_amount bigint) returns void language plpgsql as $$
declare mth date := date_trunc('month', p_month)::date; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from budget_overrides where user_id = v_uid and category_id is not distinct from p_category and month = mth;
  if p_amount is not null then
    if p_amount <= 0 then raise exception 'Enter an amount above zero' using errcode = 'check_violation'; end if;
    insert into budget_overrides (user_id, category_id, month, amount_pence) values (v_uid, p_category, mth, p_amount);
  end if;
end $$;

-- Median ticket per category (BUD-05): an expense above 5x the median of at least five tickets is treated as a one-off.
create function budget_ticket_stats() returns table (cat uuid, med numeric, n int)
language sql stable as $$
  select t.category_id, percentile_cont(0.5) within group (order by t.amount_pence), count(*)::int
    from transactions t
   where t.deleted_at is null and t.pot_id is null and t.type = 'expense' and t.recurring_id is null
   group by t.category_id
$$;

-- The facts the forecast engine needs for one month and one scope (null = the whole month, else an L1 category and its sub-categories).
-- Discretionary spend (BUD-05) leaves out Bills, trip spend and one-offs (marked, or more than 5x the category's median ticket once there
-- are at least five tickets to judge by). The pace runs from max(month start, tracking start) (BUD-05a rule 2). A prior month qualifies
-- only if tracking began on or before its first day (rule 1); the three most recent qualifying months supply the history, and days
-- with no spend inside them count as zero because the days were tracked.
create function forecast_inputs(p_month date, p_scope uuid default null, p_today date default london_today())
returns table (spent_pence bigint, recurring_logged_pence bigint, discretionary_pence bigint, discretionary_today_pence bigint,
               tracking_start date, covers text, qualifying_months date[], history_daily bigint[])
language plpgsql stable as $$
declare m date := date_trunc('month', p_month)::date;
        m_end date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
        upto date := least(p_today, m_end);
        v_track date; v_covers text; v_from date; q date[] := '{}'; k int; d date; hist bigint[] := '{}'; dom int;
        v_spent bigint := 0; v_rec bigint := 0; v_disc bigint := 0; v_today bigint := 0; mm date; nd int; fday date; lday date;
begin
  select coalesce(p.tracking_started_on, (select min(t.occurred_on) from transactions t where t.deleted_at is null and t.pot_id is null))
    into v_track from profiles p where p.id = auth.uid();
  select x.covers into v_covers from budget_base(null, m) x;
  v_covers := coalesce(v_covers, 'all');

  if upto >= m then
    v_spent := budget_spent(m, upto, p_scope, v_covers);
    select coalesce(sum(t.amount_pence), 0) into v_rec from transactions t
     where t.deleted_at is null and t.pot_id is null and t.type = 'expense' and t.recurring_id is not null
       and t.occurred_on between m and upto and budget_in_scope(t.category_id, p_scope)
       and v_covers not in ('exclude_bills', 'exclude_both') and (t.trip_id is null or v_covers not in ('exclude_trips', 'exclude_both'));
    v_from := greatest(m, coalesce(v_track, m));
    if upto >= v_from then
      select coalesce(sum(case when t.type = 'expense' then t.amount_pence else -t.amount_pence end), 0),
             coalesce(sum(case when t.type = 'expense' then t.amount_pence else -t.amount_pence end) filter (where t.occurred_on = p_today), 0)
        into v_disc, v_today
        from transactions t
        left join budget_ticket_stats() ft on ft.cat = t.category_id
       where t.deleted_at is null and t.pot_id is null and t.occurred_on between v_from and upto and t.trip_id is null
         and ((t.type = 'expense' and t.recurring_id is null and budget_in_scope(t.category_id, p_scope)
               and coalesce(t.is_one_off, ft.n >= 5 and t.amount_pence > 5 * ft.med, false) = false)
              or (t.type = 'income' and t.refund_category_id is not null and budget_in_scope(t.refund_category_id, p_scope)));
    end if;
  end if;

  -- History: the last three prior months that were fully tracked, over the same remaining days of the month.
  dom := case when p_today < m then 1 when p_today > m_end then null else extract(day from p_today)::int end;
  if dom is not null then
    for k in 1..24 loop
      exit when coalesce(array_length(q, 1), 0) >= 3;
      mm := (m - make_interval(months => k))::date;
      continue when v_track is null or v_track > mm;
      q := q || mm;
    end loop;
    foreach mm in array q loop
      nd := extract(day from (mm + interval '1 month - 1 day'))::int;
      fday := (mm + (dom - 1) * interval '1 day')::date;
      lday := (mm + (nd - 1) * interval '1 day')::date;
      continue when fday > lday;
      hist := hist || array(
        select coalesce(sum(case when t.type = 'expense' then t.amount_pence else -t.amount_pence end), 0)::bigint
          from (select (fday + x) as dt from generate_series(0, nd - dom) x) g
          left join (select t2.occurred_on, t2.type, t2.amount_pence
                       from transactions t2
                       left join budget_ticket_stats() ft on ft.cat = t2.category_id
                      where t2.deleted_at is null and t2.pot_id is null and t2.trip_id is null
                        and ((t2.type = 'expense' and t2.recurring_id is null and budget_in_scope(t2.category_id, p_scope)
                              and coalesce(t2.is_one_off, ft.n >= 5 and t2.amount_pence > 5 * ft.med, false) = false)
                             or (t2.type = 'income' and t2.refund_category_id is not null and budget_in_scope(t2.refund_category_id, p_scope)))) t
                 on t.occurred_on = g.dt
         group by g.dt order by g.dt);
    end loop;
  end if;

  return query select v_spent, v_rec, v_disc, v_today, v_track, v_covers, q, hist;
end $$;

-- The last p_months months against the budget in force each month (BUD-11). A month with no budget reports null.
create function budget_history(p_months int default 6, p_today date default london_today())
returns table (month date, budget_pence bigint, spent_pence bigint)
language plpgsql stable as $$
declare cur date := date_trunc('month', p_today)::date; k int; mm date; amt bigint; cov text;
begin
  for k in reverse (p_months - 1)..0 loop
    mm := (cur - make_interval(months => k))::date;
    select f.amount_pence into amt from budget_for_month(mm) f where f.category_id is null;
    select x.covers into cov from budget_base(null, mm) x;
    month := mm; budget_pence := amt;
    spent_pence := budget_spent(mm, (mm + interval '1 month - 1 day')::date, null, coalesce(cov, 'all'));
    return next;
  end loop;
end $$;

-- EC-G13 (and the earlier merge rules): merging categories carries the limit across.
create or replace function merge_category(p_from uuid, p_into uuid, p_clash text default 'combine') returns void
language plpgsql as $$
declare f categories; t categories; s categories; sib uuid; v_name text; n int;
begin
  select * into f from categories where id = p_from;
  select * into t from categories where id = p_into;
  if f.id is null or t.id is null then raise exception 'Category not found' using errcode = 'no_data_found'; end if;
  if f.id = t.id then raise exception 'Choose a different category to merge into' using errcode = 'check_violation'; end if;
  if f.kind <> t.kind then raise exception 'Categories must be the same type' using errcode = 'check_violation'; end if;
  if t.parent_id = f.id then raise exception 'Cannot merge a category into its own sub-category' using errcode = 'check_violation'; end if;
  if p_clash not in ('combine', 'keep_both') then raise exception 'Unknown clash choice' using errcode = 'check_violation'; end if;
  if f.parent_id is null and t.parent_id is not null and exists (select 1 from categories where parent_id = f.id) then
    raise exception 'A category with sub-categories can only be merged into a top-level category' using errcode = 'check_violation';
  end if;

  if f.parent_id is null then
    for s in select * from categories where parent_id = f.id order by sort_order, name loop
      select id into sib from categories where parent_id = t.id and lower(name) = lower(s.name) limit 1;
      if sib is not null and p_clash = 'combine' then
        perform merge_category(s.id, sib);
      else
        v_name := s.name; n := 1;
        while sib is not null loop
          n := n + 1; v_name := s.name || ' (' || n || ')';
          select id into sib from categories where parent_id = t.id and lower(name) = lower(v_name) limit 1;
        end loop;
        update categories set parent_id = t.id, name = v_name where id = s.id;
      end if;
    end loop;
  end if;

  update transactions set category_id = p_into where category_id = p_from;
  update payees set default_category_id = p_into where default_category_id = p_from;
  update recurring_items set category_id = p_into where category_id = p_from;
  -- EC-G13: the limit moves to the target; when both had one the amounts are added (same month, same kind); a target that is a
  -- sub-category cannot carry a limit, so the limit is dropped. Linked refunds follow the merge.
  update transactions set refund_category_id = p_into where refund_category_id = p_from;
  if t.parent_id is null then
    update budgets x set amount_pence = x.amount_pence + b.amount_pence
      from budgets b where b.category_id = p_from and x.category_id = p_into and x.effective_from = b.effective_from and x.user_id = b.user_id;
    delete from budgets b where b.category_id = p_from
      and exists (select 1 from budgets x where x.category_id = p_into and x.effective_from = b.effective_from and x.user_id = b.user_id);
    update budgets set category_id = p_into where category_id = p_from;
    update budget_overrides x set amount_pence = x.amount_pence + o.amount_pence
      from budget_overrides o where o.category_id = p_from and x.category_id = p_into and x.month = o.month and x.user_id = o.user_id;
    delete from budget_overrides o where o.category_id = p_from
      and exists (select 1 from budget_overrides x where x.category_id = p_into and x.month = o.month and x.user_id = o.user_id);
    update budget_overrides set category_id = p_into where category_id = p_from;
  else
    delete from budgets where category_id = p_from;
    delete from budget_overrides where category_id = p_from;
  end if;
  delete from budget_forecast_log where category_id = p_from;
  delete from budget_alerts_sent where category_id = p_from;
  update trip_category_budgets b set category_id = p_into where category_id = p_from
    and not exists (select 1 from trip_category_budgets x where x.trip_id = b.trip_id and x.category_id = p_into);
  delete from trip_category_budgets where category_id = p_from;
  update category_redirects set to_id = p_into where to_id = p_from;
  insert into category_redirects (user_id, from_id, to_id) values (auth.uid(), p_from, p_into)
    on conflict (from_id) do update set to_id = excluded.to_id, merged_at = now();
  update categories set archived_at = coalesce(archived_at, now()) where id = p_from;
end $$;

create or replace function delete_all_my_data() returns void language plpgsql as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from push_subscriptions where user_id = v_uid;          -- EC-P8: everything, including devices and shortcut tokens
  delete from api_tokens where user_id = v_uid;
  delete from ask_turns where user_id = v_uid;
  delete from insight_feedback where user_id = v_uid;
  delete from insight_runs where user_id = v_uid;
  delete from budget_alerts_sent where user_id = v_uid;
  delete from budget_forecast_log where user_id = v_uid;
  delete from budget_overrides where user_id = v_uid;
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
                      last_reminder_on = null, reminder_prompted = false,
                      budget_alert_forecast = true, budget_alert_pct80 = true, budget_alert_reached = true, budget_alert_weekly = false where id = v_uid;
  perform seed_default_categories(v_uid);
end $$;

revoke execute on function budget_in_scope(uuid, uuid), budget_spent(date, date, uuid, text), budget_base(uuid, date), budget_for_month(date),
  budget_ticket_stats(), set_budget(uuid, bigint, date, boolean, text), remove_budget(uuid, date), set_budget_override(uuid, date, bigint),
  forecast_inputs(date, uuid, date), budget_history(int, date), budgets_guard(), transactions_refund_guard() from anon, public;
grant execute on function budget_in_scope(uuid, uuid), budget_spent(date, date, uuid, text), budget_base(uuid, date), budget_for_month(date),
  budget_ticket_stats(), set_budget(uuid, bigint, date, boolean, text), remove_budget(uuid, date), set_budget_override(uuid, date, bigint),
  forecast_inputs(date, uuid, date), budget_history(int, date) to authenticated, service_role;
revoke execute on function merge_category(uuid, uuid, text) from anon, public;
