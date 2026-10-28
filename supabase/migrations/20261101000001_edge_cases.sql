-- Edge-case register (PRD v1.6 §18): behaviours that were missing.

-- EC-K2 / EC-C4: merging a category. A parent's sub-categories move under the target parent (a name clash is combined or kept as
-- "‹name› (2)"), whatever was on the source itself moves to the target, and the merge is remembered in category_redirects so that
-- an entry queued before the merge still lands in the right place.
drop function merge_category(uuid, uuid);
create function merge_category(p_from uuid, p_into uuid, p_clash text default 'combine') returns void
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
  update budgets b set category_id = p_into where category_id = p_from
    and not exists (select 1 from budgets x where x.category_id = p_into and x.starts_on = b.starts_on);
  delete from budgets where category_id = p_from;
  update trip_category_budgets b set category_id = p_into where category_id = p_from
    and not exists (select 1 from trip_category_budgets x where x.trip_id = b.trip_id and x.category_id = p_into);
  delete from trip_category_budgets where category_id = p_from;
  update category_redirects set to_id = p_into where to_id = p_from;
  insert into category_redirects (user_id, from_id, to_id) values (auth.uid(), p_from, p_into)
    on conflict (from_id) do update set to_id = excluded.to_id, merged_at = now();
  update categories set archived_at = coalesce(archived_at, now()) where id = p_from;
end $$;

-- EC-C4: an entry that names a merged category lands in the category it was merged into. Archived categories still accept writes.
create function transactions_redirect_category() returns trigger language plpgsql as $$
declare v uuid;
begin
  if new.category_id is not null then
    select to_id into v from category_redirects where from_id = new.category_id;
    if v is not null then new.category_id := v; end if;
  end if;
  return new;
end $$;
create trigger a_redirect_category before insert or update of category_id on transactions
  for each row execute function transactions_redirect_category();

-- EC-D5: a future-dated entry is allowed, up to 12 months ahead.
create function transactions_future_limit() returns trigger language plpgsql as $$
begin
  if new.occurred_on > london_today() + 366 then
    raise exception 'Choose a date within the next 12 months' using errcode = 'check_violation';
  end if;
  return new;
end $$;
create trigger a_future_limit before insert or update of occurred_on on transactions for each row execute function transactions_future_limit();

-- EC-A8: when the default account is archived, the default moves to the most-used active account.
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
      where id = (select a.id from accounts a where a.user_id = auth.uid() and a.archived_at is null
                  order by (select count(*) from transactions t where t.account_id = a.id and t.deleted_at is null) desc, a.sort_order, a.created_at limit 1);
  end if;
  return v_row;
end $$;

-- EC-A5: when an account joins or leaves available cash the whole history is recomputed (the cash functions read the current
-- membership), and the day it changed is remembered so the cash screen can say so.
alter table accounts add column pool_changed_on date;
create function accounts_pool_changed() returns trigger language plpgsql as $$
begin
  if new.counts_as_cash is distinct from old.counts_as_cash then new.pool_changed_on := london_today(); end if;
  return new;
end $$;
create trigger a_pool_changed before update of counts_as_cash on accounts for each row execute function accounts_pool_changed();

-- EC-D4: back-dating into a period whose insights were already generated marks those cards stale; the next run regenerates them.
alter table insight_runs add column stale boolean not null default false;
create function mark_insights_stale() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.occurred_on < london_today() and (tg_op = 'INSERT' or new.occurred_on is distinct from old.occurred_on or new.amount_pence is distinct from old.amount_pence
       or new.category_id is distinct from old.category_id or new.deleted_at is distinct from old.deleted_at) then
    update insight_runs set stale = true
     where user_id = new.user_id and trip_id is null and not stale and period_start <= new.occurred_on and new.occurred_on <= period_end;
  end if;
  return null;
end $$;
create trigger transactions_stale_insights after insert or update on transactions for each row execute function mark_insights_stale();


-- EC-C7: payee variants ("Gail's", "GAILS LTD") are one payee. Compared on a key with punctuation and company suffixes removed, then by
-- trigram similarity of at least 0.6. The owner can also merge payees by hand.
create function payee_key(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(lower(regexp_replace(coalesce(p, ''), '[''’`]', '', 'g')), '[^a-z0-9]+', ' ', 'g'), '\m(ltd|limited|plc|inc|llc|uk)\M', ' ', 'g'))
$$;

create or replace function touch_payee(p_name text, p_category uuid, p_account uuid, p_bump boolean default true)
returns uuid language plpgsql as $$
declare v_id uuid; v_name text := clean_payee(p_name); v_key text;
begin
  if v_name is null then return null; end if;
  v_key := regexp_replace(payee_key(v_name), '\s+', ' ', 'g');
  select id into v_id from payees
   where user_id = auth.uid() and v_key <> ''
     and (regexp_replace(payee_key(name), '\s+', ' ', 'g') = v_key or extensions.similarity(regexp_replace(payee_key(name), '\s+', ' ', 'g'), v_key) >= 0.6)
   order by (regexp_replace(payee_key(name), '\s+', ' ', 'g') = v_key) desc, extensions.similarity(regexp_replace(payee_key(name), '\s+', ' ', 'g'), v_key) desc, use_count desc limit 1;
  if v_id is not null then
    update payees set use_count = use_count + case when p_bump then 1 else 0 end, last_used_at = now(),
           default_category_id = coalesce(p_category, default_category_id), default_account_id = coalesce(p_account, default_account_id)
     where id = v_id;
    return v_id;
  end if;
  insert into payees (user_id, name, default_category_id, default_account_id, use_count, last_used_at)
    values (auth.uid(), v_name, p_category, p_account, case when p_bump then 1 else 0 end, now())
    on conflict (user_id, name_norm) do update
      set use_count = payees.use_count + case when p_bump then 1 else 0 end,
          last_used_at = now(),
          default_category_id = coalesce(excluded.default_category_id, payees.default_category_id),
          default_account_id = coalesce(excluded.default_account_id, payees.default_account_id)
    returning id into v_id;
  return v_id;
end $$;

create function merge_payees(p_from uuid, p_into uuid) returns void language plpgsql as $$
begin
  if p_from = p_into then raise exception 'Choose a different payee' using errcode = 'check_violation'; end if;
  if not exists (select 1 from payees where id = p_from) or not exists (select 1 from payees where id = p_into) then raise exception 'Payee not found' using errcode = 'no_data_found'; end if;
  update transactions set payee_id = p_into where payee_id = p_from;
  update recurring_items set payee_id = p_into where payee_id = p_from;
  update payees t set use_count = t.use_count + f.use_count, last_used_at = greatest(t.last_used_at, f.last_used_at)
    from payees f where f.id = p_from and t.id = p_into;
  delete from recurring_dismissed where payee_id = p_from;
  delete from payees where id = p_from;
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

revoke execute on function payee_key(text), merge_payees(uuid, uuid), delete_all_my_data() from anon, public;
revoke execute on function merge_category(uuid, uuid, text), transactions_redirect_category(), accounts_pool_changed(), mark_insights_stale(), transactions_future_limit() from public, anon;
grant execute on function merge_category(uuid, uuid, text) to authenticated, service_role;
grant execute on function payee_key(text), merge_payees(uuid, uuid), touch_payee(text, uuid, uuid, boolean), delete_all_my_data() to authenticated, service_role;

-- EC-P6 / CAP-08: the Shortcuts capture endpoint. A token is stored only as a hash, revoking it takes effect at once, and each token is
-- limited to 60 captures an hour.
alter table api_tokens add column window_started_at timestamptz, add column window_count int not null default 0;

create function api_token_hit(p_hash text) returns table (user_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare t api_tokens;
begin
  select * into t from api_tokens where token_hash = p_hash for update;
  if t.id is null or t.revoked_at is not null then return query select null::uuid, 'unauthorised'::text; return; end if;
  if t.window_started_at is null or t.window_started_at < now() - interval '1 hour' then
    update api_tokens set window_started_at = now(), window_count = 1, last_used_at = now() where id = t.id;
  elsif t.window_count >= 60 then
    return query select t.user_id, 'rate_limited'::text; return;
  else
    update api_tokens set window_count = window_count + 1, last_used_at = now() where id = t.id;
  end if;
  return query select t.user_id, 'ok'::text;
end $$;

create function capture_expense(p_user uuid, p_amount bigint, p_payee text, p_category text, p_account text, p_note text, p_at timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cat uuid; v_acc uuid; v_row transactions;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select id into v_acc from accounts where user_id = p_user and archived_at is null and (p_account is null or lower(name) = lower(p_account))
    order by is_default desc, sort_order limit 1;
  if v_acc is null then raise exception 'No matching account' using errcode = 'no_data_found'; end if;
  if p_category is not null then
    select id into v_cat from categories where user_id = p_user and kind = 'expense' and archived_at is null and lower(name) = lower(p_category) order by (parent_id is not null) desc limit 1;
  end if;
  if v_cat is null and p_payee is not null then
    select default_category_id into v_cat from payees where user_id = p_user and name_norm = lower(btrim(p_payee));
  end if;
  if v_cat is null then
    select id into v_cat from categories where user_id = p_user and kind = 'expense' and archived_at is null and parent_id is null order by (name ilike 'other%') desc, sort_order limit 1;
  end if;
  select * into v_row from create_transaction(p_client_id => gen_random_uuid(), p_type => 'expense', p_amount_pence => p_amount, p_account_id => v_acc,
    p_category_id => v_cat, p_payee => p_payee, p_note => p_note, p_occurred_on => (coalesce(p_at, now()) at time zone 'Europe/London')::date,
    p_occurred_at => coalesce(p_at, now()), p_source => 'shortcut', p_needs_review => true);
  return v_row.id;
end $$;
revoke all on function api_token_hit(text), capture_expense(uuid, bigint, text, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function api_token_hit(text), capture_expense(uuid, bigint, text, text, text, text, timestamptz) to service_role;
