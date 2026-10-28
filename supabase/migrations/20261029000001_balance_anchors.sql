-- Balance anchors and past-dated entries (PRD v1.6 §6.2a).
-- A transaction moves a balance only if it happened AFTER the moment that balance was last set by the owner (the account's opening
-- date or its latest reconcile). Anything earlier is already inside the balance the owner typed. Analytics, trips and AI ignore the flag.

alter table transactions
  add column counts_in_balance         boolean not null default true,
  add column counter_counts_in_balance boolean,                                        -- transfers only: the receiving side
  add column balance_flag_source       text not null default 'auto' check (balance_flag_source in ('auto', 'manual')),
  add column is_reconcile              boolean not null default false,                  -- the adjustment written by a reconcile (display)
  add column occurred_tz               text;                                            -- IANA zone where it happened (EC-D1)
update transactions set counter_counts_in_balance = true where type = 'transfer';
alter table transactions add constraint counter_flag_for_transfers check ((type = 'transfer') = (counter_counts_in_balance is not null));

alter table accounts add column last_reconciled_on date;                              -- set by every reconcile, even with no difference
alter table profiles add column tracking_started_on date;                             -- the earliest opening date of a live account

-- existing reconcile adjustments become anchors
update transactions set is_reconcile = true where type = 'adjustment' and note = 'Balance adjustment';
update accounts a set last_reconciled_on = (select max(t.occurred_on) from transactions t where t.account_id = a.id and t.is_reconcile and t.deleted_at is null);

create view account_anchors with (security_invoker = true) as
  select id as account_id, greatest(opening_date, coalesce(last_reconciled_on, opening_date)) as anchor_on from accounts;

-- BAL-03: does a transaction dated d move this account's balance?
create function balance_flag(a accounts, d date) returns boolean language sql immutable as $$
  select case
    when d < a.opening_date then false                                          -- before Sterling knew the account: already in the opening balance
    when d = a.opening_date then true                                           -- ambiguous: counts, with a toggle in the app
    when d <= coalesce(a.last_reconciled_on, a.opening_date) then false         -- before or on the last reconcile: assumed to be in it already
    else true end
$$;

-- BAL-03/04 for every write path (app, outbox, Shortcuts, Bills, trips). Only 'auto' rows are computed; 'manual' answers are kept.
create function set_balance_flags() returns trigger language plpgsql as $$
declare a accounts; b accounts; changed boolean;
begin
  if new.type = 'adjustment' then
    new.counts_in_balance := true; new.counter_counts_in_balance := null; new.balance_flag_source := 'auto';
    return new;
  end if;
  if new.type <> 'transfer' then new.counter_counts_in_balance := null; end if;
  if new.balance_flag_source = 'manual' then
    if new.type = 'transfer' and new.counter_counts_in_balance is null then new.counter_counts_in_balance := true; end if;
    return new;
  end if;
  changed := tg_op = 'INSERT' or new.occurred_on is distinct from old.occurred_on or new.account_id is distinct from old.account_id
          or new.counter_account_id is distinct from old.counter_account_id or new.type is distinct from old.type;
  if not changed then return new; end if;
  select * into a from accounts where id = new.account_id;
  new.counts_in_balance := coalesce(balance_flag(a, new.occurred_on), true);
  if new.type = 'transfer' then
    select * into b from accounts where id = new.counter_account_id;
    new.counter_counts_in_balance := coalesce(balance_flag(b, new.occurred_on), true);
  end if;
  return new;
end $$;
create trigger transactions_balance_flags before insert or update on transactions
  for each row execute function set_balance_flags();

-- An entry from before the account existed is no longer refused: it is saved, and simply does not move the balance.
create or replace function transactions_guard() returns trigger language plpgsql as $$
declare a accounts%rowtype; b accounts%rowtype; c categories%rowtype;
begin
  new.updated_at := now();

  -- History on an archived account is frozen: its balance was zero when it left, and must stay so.
  if tg_op = 'UPDATE' and old.deleted_at is null
     and exists (select 1 from accounts x where x.id in (old.account_id, old.counter_account_id) and x.archived_at is not null)
     and (new.deleted_at is not null or new.amount_pence <> old.amount_pence or new.type <> old.type
          or new.occurred_on <> old.occurred_on or new.account_id <> old.account_id
          or new.counter_account_id is distinct from old.counter_account_id) then
    raise exception 'This transaction belongs to an archived account and can no longer change'
      using errcode = 'check_violation';
  end if;

  if new.deleted_at is not null then return new; end if;

  select * into a from accounts where id = new.account_id;
  if a.id is null then raise exception 'Account not found' using errcode = 'foreign_key_violation'; end if;
  if a.archived_at is not null and (tg_op = 'INSERT' or new.account_id is distinct from old.account_id) then
    raise exception 'Account "%" is archived', a.name using errcode = 'check_violation';
  end if;

  if new.counter_account_id is not null then
    select * into b from accounts where id = new.counter_account_id;
    if b.id is null then raise exception 'Account not found' using errcode = 'foreign_key_violation'; end if;
    if b.archived_at is not null and (tg_op = 'INSERT' or new.counter_account_id is distinct from old.counter_account_id) then
      raise exception 'Account "%" is archived', b.name using errcode = 'check_violation';
    end if;
  end if;

  if new.category_id is not null then
    select * into c from categories where id = new.category_id;
    if c.id is null then raise exception 'Category not found' using errcode = 'foreign_key_violation'; end if;
    if c.kind::text <> new.type::text then
      raise exception 'A % needs a % category', new.type, new.type using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- BAL-03 recalculation when an account's opening date or balance changes (EC-A6). Returns how many rows changed. Manual flags stay.
create function recompute_balance_flags(p_account uuid) returns int language plpgsql as $$
declare a accounts; n int := 0; m int := 0;
begin
  select * into a from accounts where id = p_account;
  update transactions t set counts_in_balance = balance_flag(a, t.occurred_on)
   where t.account_id = p_account and t.type <> 'adjustment' and t.balance_flag_source = 'auto' and t.counts_in_balance is distinct from balance_flag(a, t.occurred_on);
  get diagnostics n = row_count;
  update transactions t set counter_counts_in_balance = balance_flag(a, t.occurred_on)
   where t.counter_account_id = p_account and t.type = 'transfer' and t.balance_flag_source = 'auto' and t.counter_counts_in_balance is distinct from balance_flag(a, t.occurred_on);
  get diagnostics m = row_count;
  return n + m;
end $$;

-- The archive check and the opening-date rule, now flag-aware: only rows that count are in the balance.
create or replace function accounts_guard() returns trigger language plpgsql as $$
declare bal bigint;
begin
  -- ACC-03: archiving needs a zero balance (archive_account() writes the adjustment first).
  if tg_op = 'UPDATE' and old.archived_at is null and new.archived_at is not null then
    select new.opening_balance_pence + coalesce(sum(case
        when t.account_id = new.id and t.counts_in_balance then (case t.type when 'expense' then -t.amount_pence when 'income' then t.amount_pence
                                                     when 'transfer' then -t.amount_pence else t.amount_pence end)
        when t.counter_account_id = new.id and coalesce(t.counter_counts_in_balance, false) then t.amount_pence
        else 0 end), 0)
      into bal
      from transactions t
     where t.deleted_at is null and (t.account_id = new.id or t.counter_account_id = new.id);
    if bal <> 0 then
      raise exception 'Account balance must be £0 before archiving (use "write off remaining balance")'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create function accounts_after_change() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.opening_date is distinct from old.opening_date or new.opening_balance_pence is distinct from old.opening_balance_pence) then
    perform recompute_balance_flags(new.id);
  end if;
  update profiles set tracking_started_on = (select min(opening_date) from accounts where user_id = coalesce(new.user_id, old.user_id) and archived_at is null)
   where id = coalesce(new.user_id, old.user_id);
  return null;
end $$;
create trigger accounts_after_change after insert or update of opening_date, opening_balance_pence, archived_at or delete on accounts
  for each row execute function accounts_after_change();
update profiles p set tracking_started_on = (select min(opening_date) from accounts a where a.user_id = p.id and a.archived_at is null);

-- Balances use only rows that count (BAL-02). Every balance, cash and series function reads this view.
create or replace view txn_effects with (security_invoker = true) as
  select t.id as txn_id, t.user_id, t.account_id, t.counter_account_id as other_account_id,
         t.occurred_on, t.type, t.category_id, t.payee_id, t.amount_pence,
         case t.type when 'expense' then -t.amount_pence
                     when 'income' then t.amount_pence
                     when 'transfer' then -t.amount_pence
                     else t.amount_pence end as delta_pence,
         t.pot_id
    from transactions t
   where t.deleted_at is null and t.counts_in_balance
  union all
  select t.id, t.user_id, t.counter_account_id, t.account_id,
         t.occurred_on, t.type, null::uuid, null::uuid, t.amount_pence, t.amount_pence, null::uuid
    from transactions t
   where t.deleted_at is null and t.type = 'transfer' and t.counter_counts_in_balance;

-- ACC-05: the typed balance becomes the truth as at p_on. The difference is a signed adjustment (only when there is one);
-- either way the reconcile date becomes the account's anchor (EC-A10). Non-balance rows are not in the figure compared (EC-A9).
create or replace function reconcile_account(p_account_id uuid, p_actual_pence bigint, p_on date default null)
returns transactions language plpgsql as $$
declare v_on date := coalesce(p_on, london_today()); v_bal bigint; v_diff bigint; v_row transactions;
begin
  select balance_pence into v_bal from account_balances(v_on) where account_id = p_account_id;
  if v_bal is null then raise exception 'Account not found' using errcode = 'no_data_found'; end if;
  v_diff := p_actual_pence - v_bal;
  if v_diff <> 0 then
    insert into transactions (user_id, client_id, type, amount_pence, account_id, note, occurred_on, is_reconcile)
      values (auth.uid(), gen_random_uuid(), 'adjustment', v_diff, p_account_id, 'Balance adjustment', v_on, true)
      returning * into v_row;
  end if;
  update accounts set last_reconciled_on = greatest(coalesce(last_reconciled_on, v_on), v_on) where id = p_account_id;
  return v_row;
end $$;

create or replace function archive_account(p_account_id uuid, p_write_off boolean default false, p_on date default null)
returns accounts language plpgsql as $$
declare v_on date := coalesce(p_on, london_today()); v_bal bigint; v_row accounts; v_was_default boolean;
begin
  select balance_pence into v_bal from account_balances(v_on) where account_id = p_account_id;
  if v_bal is null then raise exception 'Account not found' using errcode = 'no_data_found'; end if;
  if v_bal <> 0 then
    if not p_write_off then
      raise exception 'Account balance must be £0 before archiving' using errcode = 'check_violation';
    end if;
    insert into transactions (user_id, client_id, type, amount_pence, account_id, note, occurred_on)
      values (auth.uid(), gen_random_uuid(), 'adjustment', -v_bal, p_account_id, 'Balance written off', greatest(v_on, (select opening_date from accounts where id = p_account_id)));
  end if;
  select is_default into v_was_default from accounts where id = p_account_id;
  update accounts set archived_at = now(), is_default = false where id = p_account_id returning * into v_row;
  if v_was_default then
    update accounts set is_default = true
      where id = (select id from accounts where user_id = auth.uid() and archived_at is null
                  order by sort_order, created_at limit 1);
  end if;
  return v_row;
end $$;

-- Capture and edit accept an explicit answer for the balance flag, and the zone where it happened.
drop function create_transaction(uuid, txn_type, bigint, uuid, uuid, uuid, text, text, text[], date, timestamptz, txn_source, boolean, boolean, uuid);
create function create_transaction(
  p_client_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null,
  p_source txn_source default 'app', p_needs_review boolean default false,
  p_account_manual boolean default false, p_pot_id uuid default null,
  p_counts_in_balance boolean default null, p_counter_counts_in_balance boolean default null, p_occurred_tz text default null)
returns transactions language plpgsql as $$
declare
  v_uid uuid := auth.uid(); v_row transactions; v_payee uuid;
  v_def uuid; v_cand uuid; v_count smallint;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, category_id,
                            note, tags, occurred_on, occurred_at, source, needs_review, pot_id,
                            counts_in_balance, counter_counts_in_balance, balance_flag_source, occurred_tz)
    values (v_uid, p_client_id, p_type, p_amount_pence, p_account_id, p_counter_account_id, p_category_id,
            nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_tags, '{}'),
            coalesce(p_occurred_on, london_today()), p_occurred_at, p_source, coalesce(p_needs_review, false),
            case when p_type in ('expense', 'income') then p_pot_id end,
            coalesce(p_counts_in_balance, true), p_counter_counts_in_balance, case when p_counts_in_balance is null then 'auto' else 'manual' end, nullif(btrim(coalesce(p_occurred_tz, '')), ''))
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

drop function update_transaction(uuid, txn_type, bigint, uuid, uuid, uuid, text, text, text[], date, timestamptz, uuid);
create function update_transaction(
  p_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null, p_pot_id uuid default null,
  p_counts_in_balance boolean default null, p_counter_counts_in_balance boolean default null)
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


-- Activity: each row says whether it counts in a balance.
drop function list_transactions(text, txn_type[], uuid[], uuid[], date, date, bigint, bigint, bigint, boolean, uuid, int, date, timestamptz, uuid, uuid, text, boolean);
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
  source txn_source, needs_review boolean, created_at timestamptz, pot_id uuid, pot_name text, recurring_id uuid, is_estimate boolean,
  counts_in_balance boolean, counter_counts_in_balance boolean, is_reconcile boolean, occurred_tz text)
language sql stable as $$
  with f as (
    select t.id, t.client_id, t.type, t.amount_pence,
           t.account_id, a.name as account_name, t.counter_account_id, b.name as counter_account_name,
           t.category_id, c.name as category_name, c.parent_id as parent_category_id, pc.name as parent_category_name,
           coalesce(c.icon, pc.icon) as category_icon,
           t.payee_id, p.name as payee_name, t.note, t.tags, t.occurred_on, t.occurred_at,
           t.source, t.needs_review, t.created_at, t.pot_id, o.name as pot_name, t.recurring_id, t.is_estimate, t.counts_in_balance, t.counter_counts_in_balance, t.is_reconcile, t.occurred_tz,
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
         f.source, f.needs_review, f.created_at, f.pot_id, f.pot_name, f.recurring_id, f.is_estimate, f.counts_in_balance, f.counter_counts_in_balance, f.is_reconcile, f.occurred_tz
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



-- Norms start at tracking start, so back-filled months never count as history (BAL-07).
create or replace function spend_by_category(p_from date, p_to date, p_parent uuid default null, p_pool_only boolean default false,
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


grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
-- BAL-06: spending in the period that was paid for before it could change a balance, for the footnote on the Available cash screen.
-- pre_tracking: dated before the account existed in Sterling · pre_reconcile: on or before its last reconcile (already in a balance the owner typed).
create function non_balance_spend(p_from date, p_to date)
returns table (pre_tracking_pence bigint, pre_reconcile_pence bigint)
language sql stable as $$
  select coalesce(sum(t.amount_pence) filter (where t.occurred_on < a.opening_date), 0)::bigint,
         coalesce(sum(t.amount_pence) filter (where t.occurred_on >= a.opening_date), 0)::bigint
    from transactions t join accounts a on a.id = t.account_id and a.counts_as_cash
   where t.type = 'expense' and t.deleted_at is null and t.pot_id is null and not t.counts_in_balance and t.occurred_on between p_from and p_to
$$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function recurring_log(uuid, date, date, date), recurring_log_impl(uuid, date, date, date) from authenticated;
