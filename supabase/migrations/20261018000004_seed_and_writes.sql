-- Sterling: default taxonomy (PRD §6.4 / §10.5), sign-up triggers, and the write RPCs.

create function seed_default_categories(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  tax jsonb := $json$[
    {"n":"Home","i":"house","c":"stone","s":[
      ["Rent & mortgage","key-round",true],["Council tax","landmark",true],["Energy","zap",true],["Water","droplets",true],
      ["Broadband & TV","wifi",true],["Home insurance","shield",true],["Repairs & furnishing","hammer",false]]},
    {"n":"Groceries","i":"shopping-cart","c":"sage","s":[
      ["Supermarket","shopping-cart",false],["Specialist shops","store",false],["Household supplies","spray-can",false]]},
    {"n":"Eating out","i":"utensils","c":"clay","s":[
      ["Restaurants","utensils",false],["Takeaway & delivery","bike",false],["Coffee & snacks","coffee",false],
      ["Work lunches","sandwich",false],["Drinks","wine",false]]},
    {"n":"Transport","i":"train-front","c":"sky","s":[
      ["TfL & rail","train-front",false],["Taxis","car-taxi-front",false],["Fuel & charging","fuel",false],
      ["Parking & tolls","square-parking",false],["Car costs","car",false]]},
    {"n":"Shopping","i":"shopping-bag","c":"plum","s":[
      ["Clothing & shoes","shirt",false],["Electronics","laptop",false],["Homeware","lamp",false],["Online & general","package",false]]},
    {"n":"Health","i":"heart-pulse","c":"rose","s":[
      ["Gym & fitness","dumbbell",false],["Pharmacy","pill",false],["Medical & dental","stethoscope",false],["Personal care","scissors",false]]},
    {"n":"Entertainment","i":"clapperboard","c":"slate","s":[
      ["Streaming & apps","tv",false],["Events & culture","ticket",false],["Hobbies","palette",false],["Books & media","book-open",false]]},
    {"n":"Travel","i":"plane","c":"sand","s":[
      ["Flights","plane",false],["Hotels","bed-double",false],["Holiday spending","tree-palm",false],["Visas & insurance","id-card",false]]},
    {"n":"Bills","i":"receipt","c":"moss","s":[
      ["Mobile","smartphone",true],["Insurance","shield-check",true],["Bank fees & interest","landmark",false],["Professional fees","briefcase",false]]},
    {"n":"Family & giving","i":"gift","c":"ochre","s":[
      ["Gifts","gift",false],["Charity","hand-heart",false],["Celebrations","party-popper",false],["Family support","users",false]]},
    {"n":"Learning","i":"graduation-cap","c":"sky","s":[
      ["Courses","notebook-pen",false],["Memberships","badge",false],["Subscriptions (professional)","repeat",false]]},
    {"n":"Other","i":"circle-ellipsis","c":"stone","s":[
      ["Cash withdrawals","banknote",false],["Fees & fines","triangle-alert",false],["Miscellaneous","circle-ellipsis",false]]}
  ]$json$;
  inc jsonb := $json$[
    ["Salary","briefcase-business","sage"],["Bonus","sparkles","ochre"],["Freelance & consulting","laptop","sky"],
    ["Interest & dividends","percent","moss"],["Refunds","undo-2","clay"],["Gifts received","gift","rose"],["Other income","plus","stone"]]$json$;
  p jsonb; s jsonb; pid uuid; i int := 0; j int;
begin
  if exists (select 1 from categories where user_id = p_user) then return; end if;
  for p in select * from jsonb_array_elements(tax) loop
    i := i + 1;
    insert into categories (user_id, kind, name, icon, color, sort_order)
      values (p_user, 'expense', p->>'n', p->>'i', p->>'c', i) returning id into pid;
    j := 0;
    for s in select * from jsonb_array_elements(p->'s') loop
      j := j + 1;
      insert into categories (user_id, parent_id, kind, name, icon, color, sort_order, is_fixed)
        values (p_user, pid, 'expense', s->>0, s->>1, p->>'c', j, (s->>2)::boolean);
    end loop;
  end loop;
  i := 0;
  for s in select * from jsonb_array_elements(inc) loop
    i := i + 1;
    insert into categories (user_id, kind, name, icon, color, sort_order)
      values (p_user, 'income', s->>0, s->>1, s->>2, i);
  end loop;
end $$;

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'display_name', initcap(split_part(new.email, '@', 1))))
    on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create function profiles_seed() returns trigger
language plpgsql security definer set search_path = public as $$
begin perform seed_default_categories(new.id); return new; end $$;
create trigger profiles_seed after insert on profiles for each row execute function profiles_seed();

-- One default account per user, always (ACC-02).
create function accounts_default() returns trigger language plpgsql as $$
begin
  if new.archived_at is not null then new.is_default := false; return new; end if;
  if tg_op = 'INSERT' and not exists (
       select 1 from accounts where user_id = new.user_id and is_default and archived_at is null) then
    new.is_default := true;
  end if;
  if new.is_default then
    update accounts set is_default = false where user_id = new.user_id and is_default and id <> new.id;
  end if;
  return new;
end $$;
create trigger accounts_default before insert or update of is_default, archived_at on accounts
  for each row execute function accounts_default();

-- ---------- writes ----------

create function clean_payee(p text) returns text language sql immutable as $$
  select nullif(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')), '')
$$;

-- Payee memory: remember the last category/account used with this payee.
create function touch_payee(p_name text, p_category uuid, p_account uuid, p_bump boolean default true)
returns uuid language plpgsql as $$
declare v_id uuid; v_name text := clean_payee(p_name);
begin
  if v_name is null then return null; end if;
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

-- CAP-05: idempotent on (user_id, client_id), so outbox retries never duplicate.
create function create_transaction(
  p_client_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null,
  p_source txn_source default 'app', p_needs_review boolean default false,
  p_account_manual boolean default false)
returns transactions language plpgsql as $$
declare
  v_uid uuid := auth.uid(); v_row transactions; v_payee uuid;
  v_def uuid; v_cand uuid; v_count smallint;
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;

  insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, category_id,
                            note, tags, occurred_on, occurred_at, source, needs_review)
    values (v_uid, p_client_id, p_type, p_amount_pence, p_account_id, p_counter_account_id, p_category_id,
            nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_tags, '{}'),
            coalesce(p_occurred_on, london_today()), p_occurred_at, p_source, coalesce(p_needs_review, false))
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

create function update_transaction(
  p_id uuid, p_type txn_type, p_amount_pence bigint, p_account_id uuid,
  p_counter_account_id uuid default null, p_category_id uuid default null,
  p_payee text default null, p_note text default null, p_tags text[] default '{}',
  p_occurred_on date default null, p_occurred_at timestamptz default null)
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
      payee_id = v_payee, note = nullif(btrim(coalesce(p_note, '')), ''), tags = coalesce(p_tags, '{}'),
      occurred_on = coalesce(p_occurred_on, occurred_on), occurred_at = p_occurred_at, needs_review = false
    where id = p_id and deleted_at is null
    returning * into v_row;
  if v_row.id is null then raise exception 'Transaction not found' using errcode = 'no_data_found'; end if;
  return v_row;
end $$;

-- ACC-05: type what the bank says; the difference becomes a signed adjustment dated today.
create function reconcile_account(p_account_id uuid, p_actual_pence bigint, p_on date default null)
returns transactions language plpgsql as $$
declare v_bal bigint; v_diff bigint; v_row transactions;
begin
  select balance_pence into v_bal from account_balances('9999-12-31'::date) where account_id = p_account_id;
  if v_bal is null then raise exception 'Account not found' using errcode = 'no_data_found'; end if;
  v_diff := p_actual_pence - v_bal;
  if v_diff = 0 then return null; end if;
  insert into transactions (user_id, client_id, type, amount_pence, account_id, note, occurred_on)
    values (auth.uid(), gen_random_uuid(), 'adjustment', v_diff, p_account_id, 'Balance adjustment', coalesce(p_on, london_today()))
    returning * into v_row;
  return v_row;
end $$;

-- ACC-03
create function archive_account(p_account_id uuid, p_write_off boolean default false, p_on date default null)
returns accounts language plpgsql as $$
declare v_bal bigint; v_row accounts; v_was_default boolean;
begin
  select balance_pence into v_bal from account_balances('9999-12-31'::date) where account_id = p_account_id;
  if v_bal is null then raise exception 'Account not found' using errcode = 'no_data_found'; end if;
  if v_bal <> 0 then
    if not p_write_off then
      raise exception 'Account balance must be £0 before archiving' using errcode = 'check_violation';
    end if;
    insert into transactions (user_id, client_id, type, amount_pence, account_id, note, occurred_on)
      values (auth.uid(), gen_random_uuid(), 'adjustment', -v_bal, p_account_id, 'Balance written off',
              greatest(coalesce(p_on, london_today()), (select opening_date from accounts where id = p_account_id)));
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

create function set_default_account(p_account_id uuid) returns void language sql as $$
  update accounts set is_default = true where id = p_account_id and archived_at is null
$$;

-- CAT-04
create function merge_category(p_from uuid, p_into uuid) returns void
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
  update recurring_rules set category_id = p_into where category_id = any(v_ids);
  update budgets b set category_id = p_into where category_id = any(v_ids)
    and not exists (select 1 from budgets x where x.category_id = p_into and x.starts_on = b.starts_on);
  delete from budgets where category_id = any(v_ids);
  update categories set archived_at = coalesce(archived_at, now()) where id = any(v_ids);
end $$;

create function reorder_categories(p_ids uuid[]) returns void language sql as $$
  update categories c set sort_order = u.ord from unnest(p_ids) with ordinality as u(id, ord) where c.id = u.id
$$;

create function onboarding_complete() returns void language sql as $$
  update profiles set onboarded_at = now() where id = auth.uid() and onboarded_at is null
$$;

-- SET-05: wipe everything and return to first-run (the default categories come back).
create function delete_all_my_data() returns void language plpgsql as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from insight_feedback where user_id = v_uid;
  delete from insight_runs where user_id = v_uid;
  delete from budgets where user_id = v_uid;
  delete from recurring_rules where user_id = v_uid;
  delete from no_spend_days where user_id = v_uid;
  delete from transactions where user_id = v_uid;
  delete from payees where user_id = v_uid;
  delete from accounts where user_id = v_uid;
  delete from categories where parent_id is not null and user_id = v_uid;
  delete from categories where user_id = v_uid;
  update profiles set onboarded_at = null, acct_switch_candidate = null, acct_switch_count = 0,
                      last_reminder_on = null, reminder_prompted = false where id = v_uid;
  perform seed_default_categories(v_uid);
end $$;

-- Soft-deleted transactions are removed for good after 30 days (CAP-01). Run by cron (service role).
create function purge_deleted_transactions() returns int language plpgsql as $$
declare n int;
begin
  delete from transactions where deleted_at is not null and deleted_at < now() - interval '30 days';
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
alter default privileges in schema public grant execute on functions to authenticated, service_role;
