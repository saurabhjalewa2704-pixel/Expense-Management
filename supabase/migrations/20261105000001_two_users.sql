-- Two people, one app: every person's data stays their own (accounts, payees, transactions, budgets, trips, pots, bills, insights,
-- settings, devices, tokens), and the category list is shared. Categories are the only table both people can read and change.
-- Nothing else about row-level security changes: all other tables keep "user_id = auth.uid()".

-- ── The category list is shared ──────────────────────────────────────────────────────────────────────────────────────────────────────
drop policy categories_select on categories;
drop policy categories_insert on categories;
drop policy categories_update on categories;
drop policy categories_delete on categories;
create policy categories_select on categories for select to authenticated using (true);
create policy categories_insert on categories for insert to authenticated with check (true);
create policy categories_update on categories for update to authenticated using (true) with check (true);
create policy categories_delete on categories for delete to authenticated using (true);

-- user_id on a category now only records who created it. Removing that person must not take the shared list with it.
alter table categories alter column user_id drop not null;
alter table categories drop constraint categories_user_id_fkey;
alter table categories add constraint categories_user_id_fkey foreign key (user_id) references auth.users on delete set null;

-- sibling names are unique across the shared list, not per person
drop index categories_sibling_name;
create unique index categories_sibling_name on categories
  (kind, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- a sub-category may be added by either person under a category the other one created
create or replace function categories_guard() returns trigger language plpgsql as $$
declare par categories%rowtype;
begin
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A category cannot be its own parent' using errcode = 'check_violation'; end if;
    select * into par from categories where id = new.parent_id;
    if par.id is null then raise exception 'Parent category not found' using errcode = 'foreign_key_violation'; end if;
    if par.parent_id is not null then
      raise exception 'Categories are at most two levels deep' using errcode = 'check_violation';
    end if;
    if par.kind <> new.kind then
      raise exception 'A sub-category must have the same type as its parent' using errcode = 'check_violation';
    end if;
    if new.kind = 'income' then
      raise exception 'Income categories are a single level' using errcode = 'check_violation';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from categories where parent_id = new.id) then
      raise exception 'A category with sub-categories cannot move under another category' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

-- the default list is created once, for whoever signs in first; later people simply use it
create or replace function profiles_seed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from categories) then perform seed_default_categories(new.id); end if;
  return new;
end $$;

-- a merge is remembered for everyone, so an entry queued by either person lands in the category it was merged into (EC-C4)
drop policy category_redirects_select on category_redirects;
create policy category_redirects_select on category_redirects for select to authenticated using (true);

-- Foreign keys do not prove ownership, so the guards check it; a category belongs to everyone now, a trip or a limit to one person.
create or replace function trip_budgets_guard() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from trips t where t.id = new.trip_id and t.user_id = new.user_id) then raise exception 'Trip not found' using errcode = 'foreign_key_violation'; end if;
  if not exists (select 1 from categories c where c.id = new.category_id and c.parent_id is null and c.kind = 'expense') then
    raise exception 'A category budget needs a main expense category' using errcode = 'check_violation';
  end if;
  return new;
end $$;

create or replace function budgets_guard() returns trigger language plpgsql as $$
declare c categories;
begin
  if new.category_id is not null then
    select * into c from categories where id = new.category_id;
    if c.id is null then raise exception 'Category not found' using errcode = 'foreign_key_violation'; end if;
    if c.parent_id is not null or c.kind <> 'expense' then
      raise exception 'A limit goes on a top-level expense category' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;

create or replace function transactions_refund_guard() returns trigger language plpgsql as $$
begin
  if new.refund_category_id is not null then
    if new.type <> 'income' then new.refund_category_id := null; end if;                              -- only a refund (income) is linked
    if new.refund_category_id is not null and not exists (select 1 from categories c where c.id = new.refund_category_id and c.kind = 'expense') then
      raise exception 'Category not found' using errcode = 'foreign_key_violation';
    end if;
  end if;
  if new.type <> 'expense' then new.is_one_off := null; end if;
  return new;
end $$;

-- the shortcut capture finds a category by name in the shared list
create or replace function capture_expense(p_user uuid, p_amount bigint, p_payee text, p_category text, p_account text, p_note text, p_at timestamptz)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_cat uuid; v_acc uuid; v_row transactions;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  select id into v_acc from accounts where user_id = p_user and archived_at is null and (p_account is null or lower(name) = lower(p_account))
    order by is_default desc, sort_order limit 1;
  if v_acc is null then raise exception 'No matching account' using errcode = 'no_data_found'; end if;
  if p_category is not null then
    select id into v_cat from categories where kind = 'expense' and archived_at is null and lower(name) = lower(p_category) order by (parent_id is not null) desc limit 1;
  end if;
  if v_cat is null and p_payee is not null then
    select default_category_id into v_cat from payees where user_id = p_user and name_norm = lower(btrim(p_payee));
  end if;
  if v_cat is null then
    select id into v_cat from categories where kind = 'expense' and archived_at is null and parent_id is null order by (name ilike 'other%') desc, sort_order limit 1;
  end if;
  select * into v_row from create_transaction(p_client_id => gen_random_uuid(), p_type => 'expense', p_amount_pence => p_amount, p_account_id => v_acc,
    p_category_id => v_cat, p_payee => p_payee, p_note => p_note, p_occurred_on => (coalesce(p_at, now()) at time zone 'Europe/London')::date,
    p_occurred_at => coalesce(p_at, now()), p_source => 'shortcut', p_needs_review => true);
  return v_row.id;
end $$;

-- Merging moves every person's entries, limits and bills to the surviving category, so it must see and change rows of both people.
-- That is why it runs with the owner's rights; the signed-in check below is the only gate, and it only ever re-points category ids.
create or replace function merge_category(p_from uuid, p_into uuid, p_clash text default 'combine') returns void
language plpgsql security definer set search_path = public as $$
declare f categories; t categories; s categories; sib uuid; v_name text; n int;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '28000'; end if;
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

-- SET-05 wipes the signed-in person's own data. The shared category list is not theirs to delete.
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
  -- the category list is shared between the people using this app, so one person wiping their data never touches it
  update profiles set onboarded_at = null, acct_switch_candidate = null, acct_switch_count = 0,
                      last_reminder_on = null, reminder_prompted = false,
                      budget_alert_forecast = true, budget_alert_pct80 = true, budget_alert_reached = true, budget_alert_weekly = false where id = v_uid;
  if not exists (select 1 from categories) then perform seed_default_categories(v_uid); end if;
end $$;

revoke execute on function merge_category(uuid, uuid, text) from public, anon;
grant execute on function merge_category(uuid, uuid, text) to authenticated, service_role;
