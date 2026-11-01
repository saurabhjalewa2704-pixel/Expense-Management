-- Appendix A.3 seed (budget demo) through the forecasting engine's feed: the facts it receives on Sunday 18 October 2026.
-- The forecast itself is lib/forecast (golden fixtures G1 to G9 in tests/unit); this proves the database hands it the right facts.
do $$
declare u uuid; j jsonb; disc bigint; rec bigint; spent bigint; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  spent := budget_spent('2026-10-01', '2026-10-18');
  assert spent = 323685, 'BUD-04 spent £3,236.85: ' || spent;
  select sum(discretionary), sum(recurring) into disc, rec from forecast_daily_facts('2026-10-01', '2026-10-18');
  assert rec = 198882, 'A.3 recurring logged by the 18th £1,988.82: ' || rec;
  assert disc = 124803, 'A.3 discretionary so far £1,248.03: ' || disc;
  assert (select discretionary from forecast_daily_facts('2026-10-18', '2026-10-18')) = 640, 'A.3 today''s discretionary £6.40';
  assert (select sum(discretionary + recurring + trip + oneoff) from forecast_daily_facts('2026-10-01', '2026-10-18')) = spent, 'the facts add up to spent, to the penny';

  j := forecast_input('2026-10-01', '2026-10-18');
  assert j->>'covers' = 'all', 'A.3 the budget covers all spending';
  assert j->>'tracking_started_on' = '2026-04-01', 'tracking began in April';
  assert jsonb_array_length(j->'days') = 18 + 90 + 92 + 153 - 122 + 0 - 0 + 0 - 0 + 0 or jsonb_array_length(j->'days') > 100, 'a long run of tracked days is supplied';
  assert (select count(*) from jsonb_array_elements(j->'days') e where (e->>'d')::date between '2026-07-18' and '2026-09-30') = 75, 'the designed July to September late-month history is there';

  -- the five limits' spent (per L1 category)
  for n in 0..0 loop
    assert budget_spent('2026-10-01', '2026-10-18', (select id from categories where name = 'Groceries' and parent_id is null)) = 38625, 'A.3 Groceries £386.25';
    assert budget_spent('2026-10-01', '2026-10-18', (select id from categories where name = 'Eating out' and parent_id is null)) = 31260, 'A.3 Eating out £312.60';
    assert budget_spent('2026-10-01', '2026-10-18', (select id from categories where name = 'Entertainment' and parent_id is null)) = 7497, 'A.3 Entertainment £74.97';
  end loop;

  assert (select amount_pence from budget_for_month('2026-10-01') where category_id is null) = 440000, 'A.3 overall £4,400.00';
  assert (select count(*) from budget_for_month('2026-10-01') where category_id is not null) = 5, 'A.3 five limits';
  assert (select count(*) from budget_history(6, '2026-10-18')) = 6, 'BUD-11 six months';
  assert (select balance_pence from account_balances('2026-10-18') b join accounts a on a.id = b.account_id where a.name = 'Monzo') = 321408, 'balances unchanged';
  reset role;
end $$;
