-- Bills and recurring payments (PRD v1.4 §6.9): recurring_items replaces recurring_rules, with occurrences, bank holidays,
-- estimates, the logging functions the cron calls, suggestions and the manual-entry duplicate guard.

create type recur_freq   as enum ('weekly', 'monthly', 'quarterly', 'yearly');
create type occur_status as enum ('logged', 'estimate', 'confirmed', 'pending', 'skipped');

-- the unused v1 table goes (nothing wrote to it); everything that touched it is re-issued below
drop table recurring_rules;

create table recurring_items (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid() references auth.users on delete cascade,
  type               txn_type not null check (type in ('expense', 'income', 'transfer')),
  amount_pence       bigint not null check (amount_pence > 0),
  amount_varies      boolean not null default false,
  account_id         uuid not null references accounts,
  counter_account_id uuid references accounts,
  category_id        uuid references categories,
  payee_id           uuid references payees,
  note               text check (char_length(note) <= 280),
  frequency          recur_freq not null default 'monthly',
  day_of_month       smallint check (day_of_month between 1 and 31),
  last_day           boolean not null default false,
  weekday            smallint check (weekday between 1 and 7),
  month_of_year      smallint check (month_of_year between 1 and 12),
  working_day_rule   text not null default 'on_day' check (working_day_rule in ('on_day', 'next_working_day')),
  starts_on          date not null,
  ends_on            date,
  max_occurrences    int check (max_occurrences > 0),
  auto_log           boolean not null default true,
  paused_at          timestamptz,
  ended_at           timestamptz,
  next_due_on        date not null,
  created_at         timestamptz not null default now(),
  check ((type = 'transfer') = (counter_account_id is not null)),
  check ((type in ('expense', 'income')) = (category_id is not null)),
  check (counter_account_id is distinct from account_id),
  check (case frequency
           when 'weekly' then weekday is not null
           when 'yearly' then month_of_year is not null and (day_of_month is not null or last_day)
           else day_of_month is not null or last_day end)
);
create index recurring_items_due on recurring_items (user_id, next_due_on) where ended_at is null;

create table recurring_occurrences (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references auth.users on delete cascade,
  item_id        uuid not null references recurring_items on delete cascade,
  due_on         date not null,
  scheduled_on   date not null,
  status         occur_status not null,
  transaction_id uuid references transactions on delete set null,
  amount_pence   bigint not null,
  created_at     timestamptz not null default now(),
  unique (item_id, scheduled_on)
);
create index recurring_occurrences_due on recurring_occurrences (user_id, due_on);

-- suggestions the owner turned down: they never come back for that payee
create table recurring_dismissed (
  user_id  uuid not null default auth.uid() references auth.users on delete cascade,
  payee_id uuid not null references payees on delete cascade,
  primary key (user_id, payee_id)
);

-- England & Wales bank holidays (gov.uk), refreshed by the cron; the same for everyone, so no user_id
create table bank_holidays (day date primary key, title text not null);

alter table transactions add column is_estimate boolean not null default false;
alter table transactions add constraint transactions_recurring_fk foreign key (recurring_id) references recurring_items (id) on delete set null;
create index transactions_recurring on transactions (recurring_id) where recurring_id is not null;

do $$
declare t text;
begin
  foreach t in array array['recurring_items', 'recurring_occurrences', 'recurring_dismissed']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;
alter table bank_holidays enable row level security;
create policy bank_holidays_select on bank_holidays for select to authenticated using (true);
revoke insert, update, delete on bank_holidays from authenticated;
revoke all on bank_holidays from anon;

-- Changing the amount of an estimate confirms it: the flag goes and the occurrence is confirmed at the new amount.
create function transactions_estimate_clear() returns trigger language plpgsql as $$
begin
  if old.is_estimate and new.amount_pence <> old.amount_pence then
    new.is_estimate := false;
    update recurring_occurrences set status = 'confirmed', amount_pence = new.amount_pence where transaction_id = new.id and status = 'estimate';
  end if;
  return new;
end $$;
create trigger transactions_estimate_clear before update on transactions
  for each row execute function transactions_estimate_clear();

-- The amount a varying bill is logged at: what the last confirmed payment actually was, else the rule's own amount.
create function recurring_estimate(p_item uuid) returns bigint language sql stable as $$
  select coalesce(
    (select coalesce(t.amount_pence, o.amount_pence) from recurring_occurrences o left join transactions t on t.id = o.transaction_id and t.deleted_at is null
      where o.item_id = p_item and o.status = 'confirmed' order by o.due_on desc limit 1),
    (select amount_pence from recurring_items where id = p_item))
$$;

-- REC-04: log one occurrence, atomically and at most once (unique item + scheduled date). Called by the cron only (service role).
-- Returns a row when it created the occurrence, nothing when it already existed or the rule is paused/ended.
-- p_next is the following due date (null = the rule has no more), so next_due_on moves in the same transaction.
create function recurring_log_impl(p_item uuid, p_scheduled date, p_due date, p_next date)
returns table (occurrence_id uuid, transaction_id uuid, status occur_status, amount_pence bigint)
language plpgsql security definer set search_path = public, extensions as $$
declare
  it recurring_items; v_amount bigint; v_status occur_status; v_txn uuid; v_occ uuid; v_pending boolean;
begin
  select * into it from recurring_items where id = p_item for update;
  if it.id is null or it.paused_at is not null or it.ended_at is not null then return; end if;

  if exists (select 1 from recurring_occurrences o where o.item_id = p_item and o.scheduled_on = p_scheduled) then
    update recurring_items set next_due_on = coalesce(p_next, next_due_on), ended_at = case when p_next is null then now() else ended_at end where id = p_item;
    return;
  end if;

  v_amount := case when it.amount_varies then recurring_estimate(p_item) else it.amount_pence end;
  -- an archived account or category cannot take a transaction: wait for the owner instead of failing quietly
  v_pending := not it.auto_log
    or exists (select 1 from accounts a where a.id in (it.account_id, it.counter_account_id) and a.archived_at is not null)
    or exists (select 1 from categories c where c.id = it.category_id and c.archived_at is not null);

  if not v_pending then
    begin
      insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, category_id, payee_id, note,
                                occurred_on, source, recurring_id, is_estimate)
      values (it.user_id, gen_random_uuid(), it.type, v_amount, it.account_id, it.counter_account_id, it.category_id, it.payee_id, it.note,
              p_due, 'recurring', it.id, it.amount_varies)
      returning id into v_txn;
    exception when others then
      v_pending := true; v_txn := null;       -- e.g. the account did not exist yet on that date
    end;
  end if;
  v_status := case when v_pending then 'pending' when it.amount_varies then 'estimate' else 'logged' end;

  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence)
  values (it.user_id, it.id, p_due, p_scheduled, v_status, v_txn, v_amount) returning id into v_occ;

  update recurring_items set next_due_on = coalesce(p_next, next_due_on), ended_at = case when p_next is null then now() else ended_at end where id = it.id;
  return query select v_occ, v_txn, v_status, v_amount;
end $$;
revoke execute on function recurring_log_impl(uuid, date, date, date) from public, anon, authenticated;

-- The cron's entry point (service role only) ...
create function recurring_log(p_item uuid, p_scheduled date, p_due date, p_next date)
returns table (occurrence_id uuid, transaction_id uuid, status occur_status, amount_pence bigint)
language sql security definer set search_path = public, extensions as $$ select * from recurring_log_impl(p_item, p_scheduled, p_due, p_next) $$;
revoke execute on function recurring_log(uuid, date, date, date) from public, anon, authenticated;
grant execute on function recurring_log(uuid, date, date, date) to service_role;

-- ... and the owner's, for the catch-up prompt ("Rent was due on the 1st. Log October's now?"): their own rules only.
create function recurring_log_now(p_item uuid, p_scheduled date, p_due date, p_next date)
returns table (occurrence_id uuid, transaction_id uuid, status occur_status, amount_pence bigint)
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from recurring_items where id = p_item and user_id = auth.uid()) then
    raise exception 'Recurring payment not found' using errcode = 'no_data_found';
  end if;
  return query select * from recurring_log_impl(p_item, p_scheduled, p_due, p_next);
end $$;

-- The owner's answer to an occurrence: confirm an estimate ("Looks right"), log or skip a reminder.
create function recurring_resolve(p_occurrence uuid, p_action text, p_amount bigint default null)
returns recurring_occurrences language plpgsql as $$
declare o recurring_occurrences; it recurring_items; v_txn uuid; v_amount bigint;
begin
  select * into o from recurring_occurrences where id = p_occurrence for update;
  if o.id is null then raise exception 'Occurrence not found' using errcode = 'no_data_found'; end if;
  select * into it from recurring_items where id = o.item_id;
  v_amount := coalesce(p_amount, o.amount_pence);
  if v_amount <= 0 then raise exception 'Amount must be more than zero' using errcode = 'check_violation'; end if;

  if p_action = 'confirm' and o.status = 'estimate' then
    update transactions set amount_pence = v_amount, is_estimate = false where id = o.transaction_id;
    update recurring_occurrences set status = 'confirmed', amount_pence = v_amount where id = o.id returning * into o;
  elsif p_action = 'log' and o.status = 'pending' then
    insert into transactions (client_id, type, amount_pence, account_id, counter_account_id, category_id, payee_id, note, occurred_on, source, recurring_id)
    values (gen_random_uuid(), it.type, v_amount, it.account_id, it.counter_account_id, it.category_id, it.payee_id, it.note, o.due_on, 'recurring', it.id)
    returning id into v_txn;
    update recurring_occurrences set status = case when it.amount_varies then 'confirmed' else 'logged' end::occur_status, transaction_id = v_txn, amount_pence = v_amount
     where id = o.id returning * into o;
  elsif p_action = 'skip' and o.status = 'pending' then
    update recurring_occurrences set status = 'skipped' where id = o.id returning * into o;
  else
    raise exception 'Nothing to % on this payment', p_action using errcode = 'check_violation';
  end if;
  return o;
end $$;

-- Skip the next payment: record it as skipped (so the engine leaves it alone) and move on.
create function recurring_skip(p_item uuid, p_scheduled date, p_due date, p_next date)
returns recurring_occurrences language plpgsql as $$
declare it recurring_items; o recurring_occurrences;
begin
  select * into it from recurring_items where id = p_item for update;
  if it.id is null then raise exception 'Recurring payment not found' using errcode = 'no_data_found'; end if;
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, amount_pence)
  values (it.id, p_due, p_scheduled, 'skipped', it.amount_pence) on conflict (item_id, scheduled_on) do nothing returning * into o;
  update recurring_items set next_due_on = coalesce(p_next, next_due_on), ended_at = case when p_next is null then now() else ended_at end where id = it.id;
  return o;
end $$;

-- Undo a skip, until its due date.
create function recurring_unskip(p_occurrence uuid) returns void language plpgsql as $$
declare o recurring_occurrences;
begin
  select * into o from recurring_occurrences where id = p_occurrence and status = 'skipped' for update;
  if o.id is null then raise exception 'Nothing to undo' using errcode = 'no_data_found'; end if;
  if o.due_on <= london_today() then raise exception 'That payment is already past its date' using errcode = 'check_violation'; end if;
  delete from recurring_occurrences where id = o.id;
  update recurring_items set next_due_on = o.due_on, ended_at = null where id = o.item_id and next_due_on > o.due_on or (id = o.item_id and ended_at is not null);
end $$;

-- REC-08: an active automatic payment for this payee that is due, or was logged, within three days of a manual entry.
create function recurring_duplicate(p_payee uuid, p_on date)
returns table (item_id uuid, payee_name text, due_on date)
language sql stable as $$
  select i.id, p.name, d.due_on
    from recurring_items i
    join payees p on p.id = i.payee_id
    cross join lateral (
      select x.due_on from (
        select i.next_due_on as due_on
        union all select o.due_on from recurring_occurrences o where o.item_id = i.id and o.status <> 'skipped'
      ) x where x.due_on between p_on - 3 and p_on + 3 order by abs(x.due_on - p_on) limit 1) d
   where i.payee_id = p_payee and i.type = 'expense' and i.auto_log and i.paused_at is null and i.ended_at is null
   limit 1
$$;

-- REC-07: repeating payments that are not bills yet. Same payee, amounts within ±10% of their median, a steady interval,
-- seen at least three times. Computed on request from the transactions themselves (no nightly table to go stale).
create function recurring_suggestions()
returns table (payee_id uuid, payee_name text, category_id uuid, account_id uuid, amount_pence bigint,
               frequency recur_freq, day_of_month int, weekday int, month_of_year int, seen int, last_on date)
language sql stable as $$
  with t as (
    select x.payee_id, x.category_id, x.account_id, x.amount_pence, x.occurred_on,
           x.occurred_on - lag(x.occurred_on) over (partition by x.payee_id order by x.occurred_on) as gap,
           row_number() over (partition by x.payee_id order by x.occurred_on desc) as rn
      from transactions x
     where x.type = 'expense' and x.deleted_at is null and x.pot_id is null and x.payee_id is not null and x.source <> 'recurring'
       and x.occurred_on >= london_today() - 800
  ),
  recent as (select * from t where rn <= 6),
  agg as (
    select payee_id, count(*) as seen, max(occurred_on) as last_on,
           percentile_cont(0.5) within group (order by amount_pence) as med,
           min(amount_pence) as lo, max(amount_pence) as hi,
           min(gap) filter (where gap is not null) as gmin, max(gap) as gmax,
           (array_agg(category_id order by occurred_on desc))[1] as cat,
           (array_agg(account_id order by occurred_on desc))[1] as acct,
           (array_agg(amount_pence order by occurred_on desc))[1] as latest,
           (array_agg(occurred_on order by occurred_on desc))[1] as last_date
      from recent group by payee_id
  ),
  shaped as (
    select a.*, case
             when gmin >= 28 and gmax <= 31 then 'monthly'
             when gmin >= 6 and gmax <= 8 and seen >= 4 then 'weekly'
             when gmin >= 89 and gmax <= 92 then 'quarterly'
             when gmin >= 364 and gmax <= 366 then 'yearly' end::recur_freq as freq
      from agg a
     where seen >= 3 and lo >= med * 0.9 and hi <= med * 1.1
  )
  select s.payee_id, p.name, s.cat, s.acct, s.latest::bigint, s.freq,
         extract(day from s.last_date)::int, extract(isodow from s.last_date)::int, extract(month from s.last_date)::int, s.seen::int, s.last_on
    from shaped s
    join payees p on p.id = s.payee_id
   where s.freq is not null and s.cat is not null and s.last_on >= london_today() - case s.freq when 'weekly' then 21 when 'monthly' then 70 when 'quarterly' then 130 else 400 end
     and not exists (select 1 from recurring_items i where i.payee_id = s.payee_id and i.ended_at is null)
     and not exists (select 1 from recurring_dismissed d where d.payee_id = s.payee_id)
   order by s.latest desc
$$;

-- Everything that used to touch recurring_rules
create or replace function merge_category(p_from uuid, p_into uuid) returns void
language plpgsql as $$
declare f categories; t categories; v_ids uuid[];
begin
  select * into f from categories where id = p_from;
  select * into t from categories where id = p_into;
  if f.id is null or t.id is null then raise exception 'Category not found' using errcode = 'no_data_found'; end if;
  if f.id = t.id then raise exception 'Choose a different category to merge into' using errcode = 'check_violation'; end if;
  if f.kind <> t.kind then raise exception 'Categories must be the same type' using errcode = 'check_violation'; end if;
  if t.parent_id = f.id then raise exception 'Cannot merge a category into its own sub-category' using errcode = 'check_violation'; end if;
  select array_agg(id) into v_ids from categories where id = p_from or parent_id = p_from;
  update transactions set category_id = p_into where category_id = any(v_ids);
  update payees set default_category_id = p_into where default_category_id = any(v_ids);
  update recurring_items set category_id = p_into where category_id = any(v_ids);
  update budgets b set category_id = p_into where category_id = any(v_ids)
    and not exists (select 1 from budgets x where x.category_id = p_into and x.starts_on = b.starts_on);
  delete from budgets where category_id = any(v_ids);
  update categories set archived_at = coalesce(archived_at, now()) where id = any(v_ids);
end $$;

create or replace function delete_all_my_data() returns void language plpgsql as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from ask_turns where user_id = v_uid;
  delete from insight_feedback where user_id = v_uid;
  delete from insight_runs where user_id = v_uid;
  delete from budgets where user_id = v_uid;
  delete from recurring_dismissed where user_id = v_uid;
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

-- Activity: a "Recurring" filter, and the repeat glyph / EST tag need recurring_id and is_estimate on each row.
drop function list_transactions(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid, int, date, timestamptz, uuid, uuid, text);
create function list_transactions(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_limit int default 40, p_after_on date default null, p_after_created timestamptz default null,
  p_after_id uuid default null, p_pot_id uuid default null, p_pots text default null, p_recurring boolean default null)
returns table (
  id uuid, client_id uuid, type txn_type, amount_pence bigint,
  account_id uuid, account_name text, counter_account_id uuid, counter_account_name text,
  category_id uuid, category_name text, parent_category_id uuid, parent_category_name text, category_icon text,
  payee_id uuid, payee_name text, note text, tags text[], occurred_on date, occurred_at timestamptz,
  source txn_source, needs_review boolean, created_at timestamptz, pot_id uuid, pot_name text, recurring_id uuid, is_estimate boolean)
language sql stable as $$
  with f as (
    select t.id, t.client_id, t.type, t.amount_pence,
           t.account_id, a.name as account_name, t.counter_account_id, b.name as counter_account_name,
           t.category_id, c.name as category_name, c.parent_id as parent_category_id, pc.name as parent_category_name,
           coalesce(c.icon, pc.icon) as category_icon,
           t.payee_id, p.name as payee_name, t.note, t.tags, t.occurred_on, t.occurred_at,
           t.source, t.needs_review, t.created_at, t.pot_id, o.name as pot_name, t.recurring_id, t.is_estimate,
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
       and (p_recurring is null or (t.recurring_id is not null) = p_recurring)
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
         f.source, f.needs_review, f.created_at, f.pot_id, f.pot_name, f.recurring_id, f.is_estimate
    from f
   where f.occurred_on >= coalesce(
           (select x.occurred_on from f x where x.rn = least(greatest(coalesce(p_limit, 40), 1), 200)),
           '0001-01-01'::date)
   order by f.occurred_on desc, f.created_at desc, f.id desc
   limit 1000
$$;

-- spend/income are usual spending only; pot_pence is the net of pot income and expenses in the same filter.
drop function transaction_totals(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid, uuid, text);
create function transaction_totals(
  p_q text default null, p_types txn_type[] default null, p_category_ids uuid[] default null,
  p_account_ids uuid[] default null, p_from date default null, p_to date default null,
  p_min bigint default null, p_max bigint default null, p_amount bigint default null,
  p_needs_review boolean default null, p_payee uuid default null,
  p_pot_id uuid default null, p_pots text default null, p_recurring boolean default null)
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


grant select, insert, update, delete on recurring_items, recurring_occurrences, recurring_dismissed to authenticated, service_role;
grant select on bank_holidays to authenticated;
grant select, insert, update, delete on bank_holidays to service_role;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function recurring_log(uuid, date, date, date), recurring_log_impl(uuid, date, date, date) from authenticated;

-- REC-05: "Bills logged / due" can be switched off in Settings → Reminders (one switch for the three notifications)
alter table profiles add column bills_notify boolean not null default true;
