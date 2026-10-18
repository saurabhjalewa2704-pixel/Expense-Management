-- Analytics roll-ups, the 6-period norm, merge, Activity search + paging, pace, and Europe/London dates.
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.raises(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

do $$
declare
  u uuid := gen_random_uuid(); acc uuid; eating uuid; coffee uuid; rest uuid; groceries uuid; super uuid; salary uuid;
  r record; n int; i int; cnt int;
begin
  ---------------- Europe/London dates (BST change weekends: 29 Mar and 25 Oct 2026) ----------------
  assert london_date('2026-03-28 23:30+00') = '2026-03-28', 'still GMT the night before the clocks go forward';
  assert london_date('2026-03-29 00:30+00') = '2026-03-29', 'GMT at 00:30 on 29 Mar';
  assert london_date('2026-03-29 23:30+00') = '2026-03-30', 'BST: 23:30 UTC on 29 Mar is already 30 Mar';
  assert london_date('2026-10-24 23:30+00') = '2026-10-25', 'BST: 23:30 UTC on 24 Oct is already 25 Oct';
  assert london_date('2026-10-25 23:30+00') = '2026-10-25', 'GMT again: 23:30 UTC on 25 Oct is still 25 Oct';
  assert london_date('2026-06-30 23:00+00') = '2026-07-01', 'summer midnight';

  insert into auth.users (id, email) values (u, 'analytics@test.local');
  perform pg_temp.as_user(u);
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Main', 'current', 1000000, '2026-01-01') returning id into acc;
  select id into eating from categories where name = 'Eating out' and parent_id is null;
  select id into coffee from categories where name = 'Coffee & snacks';
  select id into rest from categories where name = 'Restaurants';
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  select id into super from categories where name = 'Supermarket';
  select id into salary from categories where name = 'Salary';

  -- Eating out: £50 on the 1st-10th of each of the last six months (so the norm is £50 by day 18),
  -- then £75 this October (sub-category rows) -> the roll-up shows £75 against a £50 norm.
  for i in 1..6 loop
    insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on)
      values (gen_random_uuid(), 'expense', 3000, acc, rest, make_date(2026, 10 - i, 3)),
             (gen_random_uuid(), 'expense', 2000, acc, coffee, make_date(2026, 10 - i, 9)),
             (gen_random_uuid(), 'expense', 99900, acc, groceries, make_date(2026, 10 - i, 25));  -- after day 18: outside the norm window
  end loop;
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on)
    values (gen_random_uuid(), 'expense', 5000, acc, rest, '2026-10-04'),
           (gen_random_uuid(), 'expense', 2500, acc, coffee, '2026-10-12'),
           (gen_random_uuid(), 'expense', 4872, acc, super, '2026-10-17'),
           (gen_random_uuid(), 'income', 12160, acc, salary, '2026-10-16');

  select * into r from spend_by_category('2026-10-01', '2026-10-18') where category_id = eating;
  assert r.total_pence = 7500 and r.txn_count = 2, 'sub-categories roll up into the parent: ' || r::text;
  assert r.norm_pence = 5000, 'norm is the median of the prior 6 periods at the same day offset: ' || r::text;
  assert (select count(*) from spend_by_category('2026-10-01', '2026-10-18')) = 2, 'parents only: Eating out and Groceries';
  select * into r from spend_by_category('2026-10-01', '2026-10-18') where category_id = groceries;
  assert r.total_pence = 4872 and r.norm_pence = 0, 'no prior spend inside the window -> norm 0, not null: ' || r::text;
  assert (select count(*) from spend_by_category('2026-10-01', '2026-10-18', eating)) = 2, 'drill-down lists the sub-categories';
  assert (select total_pence from spend_by_category('2026-10-01', '2026-10-18', eating) where category_id = coffee) = 2500;

  -- history shorter than the norm window -> no norm at all
  assert (select norm_pence from spend_by_category('2026-01-01', '2026-01-31') limit 1) is null, 'cold start has no norm';

  ---------------- insight facts ----------------
  select * into r from category_period_history('2026-10-01', '2026-10-18') where category_id = eating;
  assert r.current_pence = 7500 and r.prior_pence = array[5000, 5000, 5000, 5000, 5000]::bigint[], 'history per period (the 6th period starts before the first transaction, so it is left out): ' || r::text;
  select * into r from category_period_history('2026-10-01', '2026-10-18') where category_id = groceries;
  assert r.current_pence = 4872 and r.prior_pence = array[0,0,0,0,0]::bigint[], 'prior zero-fills: ' || r::text;
  assert (select count(*) from category_period_history('2026-10-19', '2026-10-25', 4, interval '7 days')) >= 0, 'weekly step works';
  assert (select array_length(prior_pence, 1) from category_period_history('2026-04-01', '2026-04-18') limit 1) is null
      or (select array_length(prior_pence, 1) from category_period_history('2026-04-01', '2026-04-18') limit 1) = 0, 'no history before the first transaction';
  assert (select count(*) from top_transactions('2026-10-01', '2026-10-18', 3)) = 3;
  assert (select amount_pence from top_transactions('2026-10-01', '2026-10-18', 1)) = 5000, 'biggest expense first';
  assert (select count(*) from new_payees('2026-10-01', '2026-10-18')) = 0, 'a payee seen before is not new';

  ---------------- daily_spend / pace / monthly / payees ----------------
  select * into r from month_pace('2026-10-18');
  assert r.day_of_month = 18 and r.days_in_month = 31 and r.spend_pence = 12372, 'MTD spend: ' || r::text;
  assert r.prev_spend_pence = 5000, 'last month up to day 18 only: ' || r::text;
  assert r.prev_total_pence = 5000 + 99900, 'last month in full (the scale of the pace bar): ' || r::text;
  assert (select cumulative_pence from daily_spend('2026-10-01', '2026-10-18') where day = '2026-10-18') = 12372;
  assert (select count(*) from daily_spend('2026-10-01', '2026-10-31')) = 31, 'a row for every day';
  assert (select spend_pence from monthly_totals(3) where month = '2026-10-01') = 12372;
  assert (select income_pence from monthly_totals(3) where month = '2026-10-01') = 12160;
  -- 31 Mar vs a 28-day February: the comparison point clamps to the last day
  assert (select prev_label_day from month_pace('2026-03-31')) = 28, 'clamps to the last day of February';
  assert (select prev_label_day from month_pace('2026-10-31')) = 30, 'clamps to the last day of September';

  ---------------- merge ----------------
  perform merge_category(rest, coffee);
  assert (select count(*) from transactions where category_id = rest) = 0, 'merge re-points every transaction';
  assert (select archived_at is not null from categories where id = rest), 'merge archives the source';
  assert (select total_pence from spend_by_category('2026-10-01', '2026-10-18') where category_id = eating) = 7500, 'totals unchanged by merge';
  assert pg_temp.raises(format('select merge_category(%L, %L)', coffee, salary)), 'merge across kinds';
  assert pg_temp.raises(format('select merge_category(%L, %L)', coffee, coffee)), 'merge into itself';
  assert pg_temp.raises(format('select merge_category(%L, %L)', eating, coffee)), 'merge a parent into its own sub-category';
  assert pg_temp.raises(format('delete from categories where id = %L', coffee)), 'delete with transactions must be refused';
  perform reorder_categories(array[groceries, eating]);
  assert (select sort_order from categories where id = groceries) = 1 and (select sort_order from categories where id = eating) = 2;

  ---------------- Activity: search, filters, keyset paging ----------------
  for i in 1..120 loop    -- many rows on the same day, so paging has to break ties properly
    perform create_transaction(gen_random_uuid(), 'expense', 100 + i, acc, null, super, case when i % 3 = 0 then 'Waitrose' else 'Tesco Express' end, null, '{}', '2026-09-20');
  end loop;
  select count(*) into cnt from list_transactions(p_limit => 200);
  assert cnt = (select count(*) from transactions where deleted_at is null), 'unpaged list holds everything';

  -- walk every page with the keyset cursor and compare with the unpaged list
  declare
    all_ids uuid[] := '{}'; page_ids uuid[]; ao date; ac timestamptz; ai uuid; rr record;
    pmax date; pmin date; prev_min date;
  begin
    loop
      select array_agg(x.id order by x.occurred_on desc, x.created_at desc, x.id desc), max(x.occurred_on), min(x.occurred_on)
        into page_ids, pmax, pmin
        from list_transactions(p_limit => 17, p_after_on => ao, p_after_created => ac, p_after_id => ai) x;
      exit when page_ids is null;
      -- a page ends on a day boundary: its newest day is strictly older than the previous page's oldest day
      assert prev_min is null or pmax < prev_min, format('day %s appears on two pages', pmax);
      prev_min := pmin;
      all_ids := all_ids || page_ids;
      select x.occurred_on, x.created_at, x.id into rr from list_transactions(p_limit => 17, p_after_on => ao, p_after_created => ac, p_after_id => ai) x
        order by x.occurred_on, x.created_at, x.id limit 1;
      ao := rr.occurred_on; ac := rr.created_at; ai := rr.id;
    end loop;
    assert array_length(all_ids, 1) = cnt, format('paging returned %s rows, expected %s', array_length(all_ids, 1), cnt);
    assert (select count(distinct v) from unnest(all_ids) v) = cnt, 'paging returned a row twice';
  end;

  assert (select count(*) from list_transactions(p_q => 'waitrose', p_limit => 200)) = 40, 'payee search';
  assert (select count(*) from list_transactions(p_q => 'waitros', p_limit => 200)) = 40, 'typo-tolerant payee search (trigram)';
  assert (select count(*) from list_transactions(p_q => 'supermarket', p_limit => 200)) = 121, 'category-name search';
  assert (select count(*) from list_transactions(p_amount => 4872)) = 1, 'exact amount';
  assert (select count(*) from list_transactions(p_min => 10000, p_limit => 200)) = (select count(*) from transactions where amount_pence >= 10000 and deleted_at is null);
  assert (select count(*) from list_transactions(p_types => array['income']::txn_type[])) = 1, 'type filter';
  assert (select txn_count from transaction_totals(p_q => 'waitrose')) = 40;
  assert (select spend_pence from transaction_totals(p_q => 'waitrose')) = (select sum(100 + g.k) from generate_series(1, 120) g(k) where g.k % 3 = 0), 'filtered total';

  ---------------- purge + wipe ----------------
  update transactions set deleted_at = now() - interval '31 days' where client_id in (select client_id from transactions order by created_at limit 3);
  update transactions set deleted_at = now() - interval '5 days' where client_id in (select client_id from transactions where deleted_at is null order by created_at limit 2);
  reset role;
  assert purge_deleted_transactions() = 3, 'only transactions soft-deleted over 30 days ago are purged';
  perform pg_temp.as_user(u);
  perform delete_all_my_data();
  assert (select count(*) from transactions) = 0 and (select count(*) from accounts) = 0 and (select count(*) from payees) = 0;
  assert (select count(*) from categories) = 69, 'default categories are back after a wipe';
  assert (select onboarded_at is null from profiles), 'a wipe returns to first-run';
  reset role;
end $$;
