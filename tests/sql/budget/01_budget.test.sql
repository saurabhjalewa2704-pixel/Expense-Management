-- Budgets (PRD §6.13, Appendix A.3): the inputs the forecast engine receives, on the seeded Sunday 18 October 2026.
-- The formula itself lives in lib/forecast.ts and is tested in tests/unit/forecast.test.ts (FC-1 to FC-10).
do $$
declare u uuid; r record; f record; med numeric; q25 numeric; q75 numeric; limits_spent bigint := 0;
begin
  select id into u from auth.users order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- BUD-04 / A.3: the overall inputs
  select * into r from forecast_inputs('2026-10-01', null, '2026-10-18');
  assert r.spent_pence = 323685, 'BUD-04 spent £3,236.85: ' || r.spent_pence;
  assert r.recurring_logged_pence = 198882, 'A.3 recurring logged by the 18th £1,988.82: ' || r.recurring_logged_pence;
  assert r.discretionary_pence = 124803, 'A.3 discretionary so far £1,248.03: ' || r.discretionary_pence;
  assert r.discretionary_today_pence = 640, 'A.3 today''s discretionary £6.40';
  assert r.covers = 'all', 'A.3 the budget covers all spending';
  assert r.qualifying_months = array['2026-09-01', '2026-08-01', '2026-07-01']::date[], 'FC-4 the three prior months qualify (tracking began in April)';
  assert cardinality(r.history_daily) = 41, 'the same remaining days (18th to month end) of July, August and September: 14 + 14 + 13';
  select percentile_cont(0.5) within group (order by x), percentile_cont(0.25) within group (order by x), percentile_cont(0.75) within group (order by x)
    into med, q25, q75 from unnest(r.history_daily) x;
  assert med = 9200 and q25 = 6000 and q75 = 10500, 'A.3 history median £92.00 · 25th £60.00 · 75th £105.00: ' || med || '/' || q25 || '/' || q75;

  -- A.3: the five limits (spent, discretionary, and the category's late-month median per day)
  for r in select * from (values ('Groceries', 38625, 38625, 2600), ('Eating out', 31260, 31260, 1600), ('Transport', 21480, 21480, 1500),
                                 ('Shopping', 17890, 17890, 900), ('Entertainment', 7497, 7198, 250)) v(name, spent, disc, med) loop
    select * into f from forecast_inputs('2026-10-01', (select id from categories where name = r.name and parent_id is null and user_id = u), '2026-10-18');
    assert f.spent_pence = r.spent and f.discretionary_pence = r.disc, 'A.3 ' || r.name || ' spent/discretionary: ' || f.spent_pence || '/' || f.discretionary_pence;
    select percentile_cont(0.5) within group (order by x) into med from unnest(f.history_daily) x;
    assert med = r.med, 'A.3 ' || r.name || ' late-month median per day: ' || med;
    limits_spent := limits_spent + f.spent_pence;
  end loop;
  assert (select discretionary_today_pence from forecast_inputs('2026-10-01', (select id from categories where name = 'Eating out' and user_id = u), '2026-10-18')) = 640,
    'A.3 Eating out''s £6.40 today is already logged';
  assert 323685 - limits_spent = 206933, 'A.3 Everything else spent £2,069.33';

  -- the effective amounts
  assert (select amount_pence from budget_for_month('2026-10-01') where category_id is null) = 440000, 'A.3 overall £4,400.00';
  assert (select count(*) from budget_for_month('2026-10-01') where category_id is not null) = 5, 'A.3 five limits';
  assert (select sum(amount_pence) from budget_for_month('2026-10-01') where category_id is not null) = 75000 + 40000 + 45000 + 35000 + 15000, 'A.3 limits total £2,100.00 (Everything else £2,300.00)';

  -- BUD-11 history: the last six months, each against the budget in force (none before October)
  assert (select count(*) from budget_history(6, '2026-10-18')) = 6, 'BUD-11 six months';
  assert (select budget_pence from budget_history(6, '2026-10-18') where month = '2026-10-01') = 440000, 'BUD-11 October against £4,400';
  assert (select spent_pence from budget_history(6, '2026-10-18') where month = '2026-10-01') = 323685, 'BUD-11 October spent to date';
  assert (select count(*) from budget_history(6, '2026-10-18') where budget_pence is null) = 5, 'BUD-11 no budget before October';

  -- the demo's balances are untouched by the budget seed (budgets never move money)
  assert (select balance_pence from account_balances('2026-10-18') b join accounts a on a.id = b.account_id where a.name = 'Monzo') = 321408, 'balances unchanged';
  reset role;
end $$;
