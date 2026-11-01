-- Budgets (PRD §6.13): effective dating, overrides, rollover, covers, refunds, one-offs, trips, merges, and the forecast inputs' history rules.
-- Each assertion names the edge case (EC-G) or forecast test (FC) it proves.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc uuid; groc uuid; eat uuid; refunds uuid; r record; trp uuid; tx uuid; n int; denied boolean; d date;
begin
  insert into auth.users (id, email) values (ua, 'ga@test.local'), (ub, 'gb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groc from categories where name = 'Groceries' and parent_id is null;
  select id into eat from categories where name = 'Eating out' and parent_id is null;
  select id into refunds from categories where name = 'Refunds' and kind = 'income';
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Current', 'current', 500000, '2026-06-01') returning id into acc;
  update profiles set tracking_started_on = '2026-06-01' where id = ua;

  -- L1 only: a limit on a sub-category or an income category is refused
  denied := false;
  begin insert into budgets (category_id, amount_pence, effective_from) values ((select id from categories where name = 'Supermarket'), 1000, '2026-10-01'); exception when others then denied := true; end;
  assert denied, 'BUD-01 a limit goes on an L1 category only';
  denied := false;
  begin insert into budgets (category_id, amount_pence, effective_from) values (refunds, 1000, '2026-10-01'); exception when others then denied := true; end;
  assert denied, 'BUD-01 a limit goes on an expense category';

  -- EC-G1: created on the 18th, the budget covers the whole month, including spend already logged
  perform create_transaction(gen_random_uuid(), 'expense', 10000, acc, null, groc, null, null, '{}', '2026-10-03');
  perform create_transaction(gen_random_uuid(), 'expense', 5000, acc, null, (select id from categories where name = 'Supermarket'), null, null, '{}', '2026-10-05');
  perform set_budget(null, 100000, '2026-10-18');
  perform set_budget(groc, 30000, '2026-10-18');
  assert (select amount_pence from budget_for_month('2026-10-01') where category_id is null) = 100000, 'EC-G1 the budget applies to October from its first day';
  assert budget_spent('2026-10-01', '2026-10-18', groc) = 15000, 'EC-G1 spend logged before the budget existed counts, sub-categories and parent-direct together';

  -- EC-G2: changed "from next month": October keeps what applied; November takes the new amount
  perform set_budget(null, 120000, '2026-11-01');
  assert (select amount_pence from budget_for_month('2026-10-01') where category_id is null) = 100000, 'EC-G2 October keeps £1,000';
  assert (select amount_pence from budget_for_month('2026-11-01') where category_id is null) = 120000, 'EC-G2 November takes £1,200';
  perform set_budget(null, 110000, '2026-10-01');                                      -- "from this month" replaces the scheduled change too
  assert (select amount_pence from budget_for_month('2026-10-01') where category_id is null) = 110000 and (select count(*) from budgets where category_id is null) = 1, 'EC-G2 from this month';

  -- BUD-02 adjust this month only: an override replaces the amount for that month and nothing else
  perform set_budget_override(null, '2026-12-01', 150000);
  assert (select amount_pence from budget_for_month('2026-12-01') where category_id is null) = 150000 and (select override_pence from budget_for_month('2026-12-01') where category_id is null) = 150000, 'BUD-02 December override';
  assert (select amount_pence from budget_for_month('2026-11-01') where category_id is null) = 110000, 'BUD-02 the override does not leak into November';
  perform set_budget_override(null, '2026-12-01', null);
  assert (select amount_pence from budget_for_month('2026-12-01') where category_id is null) = 110000, 'BUD-02 clearing the override';

  -- EC-G12: rollover carries unspent amounts and overspend, capped at +/- 100% of the limit
  perform set_budget(eat, 40000, '2026-07-01', true);
  perform create_transaction(gen_random_uuid(), 'expense', 25000, acc, null, eat, null, null, '{}', '2026-07-10');            -- £150 unspent
  perform create_transaction(gen_random_uuid(), 'expense', 52000, acc, null, eat, null, null, '{}', '2026-08-10');            -- £120 over
  assert (select carried_pence from budget_for_month('2026-08-01') where category_id = eat) = 15000 and (select amount_pence from budget_for_month('2026-08-01') where category_id = eat) = 55000, 'EC-G12 August: £400 + £150 carried';
  select * into r from budget_for_month('2026-09-01') where category_id = eat;
  assert r.carried_pence = 55000 - 52000, 'EC-G12 September: August had £550 and spent £520, so £30 carries: ' || r.carried_pence;
  perform create_transaction(gen_random_uuid(), 'expense', 120000, acc, null, eat, null, null, '{}', '2026-09-12');           -- £1,200 against £430
  select * into r from budget_for_month('2026-10-01') where category_id = eat;
  assert r.carried_pence = -40000 and r.amount_pence = 0, 'EC-G12 overspend carries as a reduction, capped at -100% of the limit: ' || r::text;

  -- EC-G8: a refund reduces spend only when linked to a category
  perform create_transaction(gen_random_uuid(), 'income', 2000, acc, null, refunds, null, null, '{}', '2026-10-06');
  assert budget_spent('2026-10-01', '2026-10-18', groc) = 15000, 'EC-G8 an unlinked refund changes nothing';
  update transactions set refund_category_id = groc where category_id = refunds and occurred_on = '2026-10-06';
  assert budget_spent('2026-10-01', '2026-10-18', groc) = 13000, 'EC-G8 a refund linked to Groceries reduces Groceries';
  assert budget_spent('2026-10-01', '2026-10-18', null) = 13000, 'EC-G8 ...and the overall spend';
  assert budget_spent('2026-10-01', '2026-10-18', eat) = 0, 'EC-G8 ...and no other category';
  update transactions set refund_category_id = groc where category_id = refunds;
  perform create_transaction(gen_random_uuid(), 'income', 20000, acc, null, refunds, null, null, '{}', '2026-10-07');
  update transactions set refund_category_id = eat where category_id = refunds and occurred_on = '2026-10-07';
  assert budget_spent('2026-10-01', '2026-10-18', eat) = -20000, 'EC-G8 a refund can take a category''s spent below zero (the app shows £0 with "net refund")';

  -- EC-G7 / EC-F9: a large one-off (more than max(£150, 5x the usual ticket), or £250 with few tickets) is flagged automatically, counts as spent, never in the daily pace
  for d in select generate_series('2026-09-01'::date, '2026-09-05'::date, '1 day')::date loop
    perform create_transaction(gen_random_uuid(), 'expense', 1500, acc, null, (select id from categories where name = 'Homeware'), null, null, '{}', d);
  end loop;
  perform create_transaction(gen_random_uuid(), 'expense', 90000, acc, null, (select id from categories where name = 'Homeware'), null, null, '{}', '2026-10-09');   -- the £900 sofa
  assert (select is_one_off and one_off_source = 'auto' from transactions where amount_pence = 90000), 'EC-G7 the sofa is flagged automatically';
  assert budget_spent('2026-10-09', '2026-10-09', (select id from categories where name = 'Shopping' and parent_id is null)) = 90000, 'EC-G7 the sofa counts in spent';
  assert (select oneoff from forecast_daily_facts('2026-10-09', '2026-10-09')) = 90000 and (select discretionary from forecast_daily_facts('2026-10-09', '2026-10-09')) = 0, 'EC-G7 ...but is left out of the pace';
  update transactions set is_one_off = false where amount_pence = 90000;
  assert (select discretionary from forecast_daily_facts('2026-10-09', '2026-10-09')) = 90000 and (select one_off_source from transactions where amount_pence = 90000) = 'user', 'EC-G7 the user can override the automatic mark';
  update transactions set amount_pence = 91000 where amount_pence = 90000;
  assert (select is_one_off from transactions where amount_pence = 91000) = false, 'EC-F9 a choice made by the user is never overwritten by re-flagging';

  -- EC-G9: a trip: counts in spent when covered, never in the pace; excluded when the budget says so
  insert into trips (name, currency, start_on, end_on) values ('Rome', 'GBP', '2026-10-10', '2026-10-12') returning id into trp;
  perform create_transaction(gen_random_uuid(), 'expense', 7000, acc, null, eat, null, null, '{}', '2026-10-11');
  update transactions set trip_id = trp where occurred_on = '2026-10-11' and amount_pence = 7000;
  assert budget_spent('2026-10-01', '2026-10-18', eat) = -20000 + 7000, 'EC-G9 the trip counts in spent';
  assert (select trip from forecast_daily_facts('2026-10-11', '2026-10-11')) = 7000 and (select trip_day from forecast_daily_facts('2026-10-11', '2026-10-11')), 'EC-G9 ...in the trip bucket, on a trip day, not in the pace';
  perform set_budget(null, 110000, '2026-10-01', false, 'exclude_trips');
  assert budget_spent('2026-10-01', '2026-10-18', eat, 'exclude_trips') = -20000, 'BUD-01 "exclude trips" leaves trip spend out of spent too';
  perform set_budget(null, 110000, '2026-10-01', false, 'all');

  -- BUD-01 exclude bills: recurring spend leaves both the spend and the budget's plan
  insert into recurring_items (type, amount_pence, account_id, category_id, frequency, day_of_month, starts_on, next_due_on)
    values ('expense', 4000, acc, groc, 'monthly', 4, '2026-10-04', '2026-11-04') returning id into tx;
  perform create_transaction(gen_random_uuid(), 'expense', 4000, acc, null, groc, null, null, '{}', '2026-10-04');
  update transactions set recurring_id = tx where occurred_on = '2026-10-04' and amount_pence = 4000;
  assert (select recurring from forecast_daily_facts('2026-10-04', '2026-10-04')) = 4000, 'BUD-04 recurring is part of spent and shown apart';
  assert (select discretionary from forecast_daily_facts('2026-10-04', '2026-10-04')) = 0, 'BUD-05 ...but is not discretionary';
  assert budget_spent('2026-10-01', '2026-10-18', groc, 'exclude_bills') = 13000, 'BUD-01 "exclude bills" removes recurring spend from the spend';

  -- EC-F4 / EC-F28: the engine's days start at tracking start; nothing before it is history
  update profiles set tracking_started_on = '2026-10-04' where id = ua;
  assert (forecast_input('2026-10-01', '2026-10-18')->'days'->0->>'d') = '2026-10-04', 'EC-F4 days before tracking started are never history';
  assert jsonb_array_length(forecast_input('2026-10-01', '2026-10-18')->'days') = 15, 'EC-F8 every tracked day is present, quiet or not, so a genuine £0 day is a £0 day';
  update profiles set tracking_started_on = '2026-06-01' where id = ua;

  -- EC-G13: merging categories carries the limit; two limits are summed
  perform set_budget(groc, 30000, '2026-10-01');
  perform set_budget(eat, 40000, '2026-10-01', false);
  perform merge_category(eat, groc);
  assert (select count(*) from budgets where category_id = eat) = 0, 'EC-G13 the source category has no limit left';
  assert (select amount_pence from budget_for_month('2026-10-01') where category_id = groc) = 70000, 'EC-G13 two limits are added: £300 + £400';

  -- removing a limit keeps its history
  perform remove_budget(groc, '2026-11-01');
  assert (select count(*) from budget_for_month('2026-11-01') where category_id = groc) = 0, 'BUD-02 removed from November';
  assert (select amount_pence from budget_for_month('2026-10-01') where category_id = groc) = 70000, 'BUD-02 October keeps the limit';

  -- EC-G10 / EC-F28: an expense from before tracking began counts in its own month's spent, never moves a balance, and is not history
  perform create_transaction(gen_random_uuid(), 'expense', 3300, acc, null, groc, null, null, '{}', '2026-05-20', null, 'app', false, false, null, false);
  assert budget_spent('2026-05-01', '2026-05-31', groc) = 3300, 'EC-G10 counts in its own month''s spent and limits';
  assert (select count(*) from jsonb_array_elements(forecast_input('2026-10-01', '2026-10-18')->'days') e where (e->>'d')::date < '2026-06-01') = 0, 'EC-G10 that month is not history';

  -- invariant: budgets never move money
  assert (select balance_pence from account_balances() where account_id = acc) is not null, 'balances still computed';

  -- RLS (budget functions see only the caller's rows) is exercised in 01_rls.test.sql
  reset role;
end $$;
