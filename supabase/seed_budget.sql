-- Sterling budget demo data (development and tests only): PRD Appendix A.3, viewed on Sun 18 Oct 2026 (day 18 of 31).
-- Run AFTER supabase/seed.sql, on the same database. It changes the Appendix A ledger in the ways A.3 needs, and nothing else:
--   * bills: October's logged bills are the eight A.3 lists (£1,988.82); Netflix and Apple One become ordinary hand-logged payments,
--     Apple One drops to £25.99 and iCloud+ (£2.99, the 12th) is a logged bill, so Entertainment is still £74.97; the 27th bill is Netflix
--   * the late-month history of July, August and September (days 18 to month end, 41 days) is replaced by a designed daily pattern, so the
--     engine's inputs are exactly A.3's: overall median £92.00 (25th percentile £60.00, 75th £105.00), and the category medians
--     Groceries £26.00 · Eating out £16.00 · Transport £15.00 · Shopping £9.00 · Entertainment £2.50
--   * the budget: £4,400.00 covering all spending, and limits on Groceries £750 · Eating out £400 · Transport £450 · Shopping £350 · Entertainment £150
do $seed$
declare
  u uuid; amex uuid; monzo uuid; hsbc uuid; cash uuid; marcus uuid;
  netflix_p uuid; icloud_p uuid; cat_streaming uuid; i_netflix uuid; i_icloud uuid; i_yt uuid;
  kinds int[]; totals bigint[]; idx int; k int; d date; mth date; nd int; day_i int := 0; pos int; kind int; tot bigint;
  g bigint; e bigint; t bigint; s bigint; n bigint; rem bigint;
begin
  select id into u from auth.users order by created_at limit 1;
  select id into monzo from accounts where user_id = u and name = 'Monzo';
  select id into hsbc from accounts where user_id = u and name = 'HSBC Premier';
  select id into cash from accounts where user_id = u and name = 'Cash';
  select id into amex from accounts where user_id = u and name = 'Amex Gold';
  select id into marcus from accounts where user_id = u and name = 'Marcus';
  select id into cat_streaming from categories where user_id = u and name = 'Streaming & apps';

  -- ---- bills ----
  delete from budgets where user_id = u;
  update transactions set recurring_id = null, source = 'app'
   where user_id = u and payee_id in (select id from payees where user_id = u and name in ('Netflix', 'Apple One')) and recurring_id is not null;
  delete from recurring_items where user_id = u and payee_id in (select id from payees where user_id = u and name in ('Netflix', 'Apple One'));
  update transactions set amount_pence = 2599
   where user_id = u and payee_id = (select id from payees where user_id = u and name = 'Apple One') and occurred_on = '2026-10-05';

  -- the 27th bill is Netflix (A.3), not YouTube Premium
  select id into netflix_p from payees where user_id = u and name = 'Netflix';
  select id into i_yt from recurring_items where user_id = u and payee_id = (select id from payees where user_id = u and name = 'YouTube Premium');
  update transactions set recurring_id = null, source = 'app' where recurring_id = i_yt;
  delete from recurring_occurrences where item_id = i_yt;
  update recurring_items set payee_id = netflix_p, starts_on = '2026-10-27', next_due_on = '2026-10-27' where id = i_yt;

  insert into payees (user_id, name, default_category_id) values (u, 'iCloud+', cat_streaming) returning id into icloud_p;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
    values (u, 'expense', 299, amex, cat_streaming, icloud_p, 'monthly', 12, '2026-10-12', '2026-11-12') returning id into i_icloud;
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, occurred_at, source, recurring_id)
    values (u, gen_random_uuid(), 'expense', 299, amex, cat_streaming, icloud_p, '2026-10-12', '2026-10-12 06:00 Europe/London', 'recurring', i_icloud);
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence)
    select u, i_icloud, '2026-10-12', '2026-10-12', 'logged', t.id, 299 from transactions t where t.recurring_id = i_icloud;

  -- ---- late-month history, July to September ----
  create temp table hist_before on commit drop as
    select date_trunc('month', t.occurred_on)::date as mth, coalesce(c.parent_id, c.id) as l1, sum(t.amount_pence)::bigint as amt
      from transactions t join categories c on c.id = t.category_id
     where t.user_id = u and t.type = 'expense' and t.recurring_id is null
       and t.occurred_on >= '2026-07-18' and t.occurred_on <= '2026-09-30' and extract(day from t.occurred_on) >= 18
     group by 1, 2;
  delete from transactions
   where user_id = u and type = 'expense' and recurring_id is null
     and occurred_on >= '2026-07-18' and occurred_on <= '2026-09-30'
     and extract(day from occurred_on) >= 18
     and date_trunc('month', occurred_on) in ('2026-07-01', '2026-08-01', '2026-09-01');
  delete from transactions
   where user_id = u and type = 'expense' and occurred_on >= '2026-07-18' and occurred_on <= '2026-09-30' and extract(day from occurred_on) >= 18 and recurring_id is not null
     and payee_id in (select id from payees where user_id = u and name in ('Netflix', 'Apple One', 'YouTube Premium'));

  -- 41 days: 12 low (£60) · 8 at £70 · 2 at £92 · 8 at £104 · 2 at £105 · 9 at £140. kind 0 = low, 1 = middle, 2 = high.
  kinds  := array[0,0,0,0,0,0,0,0,0,0,0,0, 1,1,1,1,1,1,1,1,1,1, 2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2];
  totals := array[6000,6000,6000,6000,6000,6000,6000,6000,6000,6000,6000,6000, 7000,7000,7000,7000,7000,7000,7000,7000, 9200,9200,
                  10400,10400,10400,10400,10400,10400,10400,10400, 10500,10500, 14000,14000,14000,14000,14000,14000,14000,14000,14000];
  for mth in select unnest(array['2026-07-01', '2026-08-01', '2026-09-01']::date[]) loop
    nd := extract(day from (mth + interval '1 month - 1 day'))::int;
    for d in select (mth + x)::date from generate_series(17, nd - 1) x loop
      pos := (day_i * 17) % 41;                               -- 17 is coprime to 41, so the 41 days take the 41 values in a fixed shuffled order
      day_i := day_i + 1;
      kind := kinds[pos + 1]; tot := totals[pos + 1];
      if kind = 0 then g := 2000; e := 1000; t := 1000; s := 500;  n := 0;
      elsif kind = 1 then g := 2600; e := 1600; t := 1500; s := 900;  n := 250;
      else g := 3000; e := 2000; t := 2000; s := 1200; n := 400; end if;
      rem := tot - (g + e + t + s + n);
      insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, occurred_at, source, is_one_off)
      select u, gen_random_uuid(), 'expense', v.amt, monzo, (select id from categories where user_id = u and name = v.cat), d,
             (d::text || ' 12:00 Europe/London')::timestamptz, 'app', false
        from (values (g, 'Supermarket'), (e, 'Coffee & snacks'), (t, 'TfL & rail'), (s, 'Online & general'), (n, 'Events & culture'), (rem, 'Pharmacy')) v(amt, cat)
       where v.amt > 0;
    end loop;
  end loop;

  -- The designed pattern is lighter than the original late-month spending, so each month's total, and each category's, is topped back up with a
  -- single marked one-off on the 28th (excluded from the run-rate, still counted as spent). Months and categories keep their Appendix A totals.
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, occurred_at, source, is_one_off, note)
  select u, gen_random_uuid(), 'expense', b.amt - coalesce(a.amt, 0), monzo, b.l1, (b.mth + 27)::date, ((b.mth + 27)::text || ' 12:00 Europe/London')::timestamptz, 'app', true, 'History balance'
    from hist_before b
    left join (select date_trunc('month', t.occurred_on)::date as mth, coalesce(c.parent_id, c.id) as l1, sum(t.amount_pence)::bigint as amt
                 from transactions t join categories c on c.id = t.category_id
                where t.user_id = u and t.type = 'expense' and t.recurring_id is null and t.is_one_off is not true
                  and t.occurred_on >= '2026-07-18' and t.occurred_on <= '2026-09-30' and extract(day from t.occurred_on) >= 18 group by 1, 2) a using (mth, l1)
   where b.amt - coalesce(a.amt, 0) > 0;

  -- October's larger tickets (a £142.60 TfL pass, a £33.00 cinema night, a £53.31 Amazon order) are ordinary spending, not one-offs: the owner
  -- has overridden the automatic one-off marking on them (BUD-05), so A.3's discretionary figures hold.
  update transactions set is_one_off = false where user_id = u and type = 'expense' and occurred_on >= '2026-10-01';

  -- ---- the budget ----
  insert into budgets (user_id, category_id, amount_pence, effective_from)
  select u, null, 440000, '2026-10-01';
  insert into budgets (user_id, category_id, amount_pence, effective_from)
  select u, c.id, v.amt, '2026-10-01' from (values ('Groceries', 75000), ('Eating out', 40000), ('Transport', 45000), ('Shopping', 35000), ('Entertainment', 15000)) v(name, amt)
    join categories c on c.user_id = u and c.name = v.name and c.parent_id is null;

  -- balances stay exactly the mock-up figures
  update accounts a set opening_balance_pence = a.opening_balance_pence + v.target - coalesce((select b.balance_pence from account_balances('2026-10-18') b where b.account_id = a.id), 0)
    from (values (monzo, 321408::bigint), (hsbc, 248620::bigint), (cash, 25000::bigint), (amex, -118473::bigint), (marcus, 1240000::bigint)) as v(id, target)
   where a.id = v.id;
end
$seed$;
