-- Trip tagging and foreign amounts at write time (PRD TRIP-04, TRIP-06; EC-T4, EC-T5, EC-C8, EC-B9).
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc uuid; acc2 uuid; groceries uuid; flights uuid; salary uuid; trip uuid; other_trip uuid; r transactions; item uuid; tid uuid; denied boolean;
begin
  insert into auth.users (id, email) values (ua, 'tripa@test.local'), (ub, 'tripb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  select id into flights from categories where name = 'Flights';
  select id into salary from categories where kind = 'income' limit 1;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Amex', 'credit_card', 0, '2026-10-18') returning id into acc;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Savings', 'savings', 0, '2026-10-18') returning id into acc2;
  insert into trips (name, country_code, currency, start_on, end_on, budget_pence) values ('Spain', 'ES', 'EUR', '2027-05-10', '2027-05-20', 200000) returning id into trip;

  -- AC1 / EC-T4: an expense dated inside the trip is tagged automatically
  select * into r from create_transaction(gen_random_uuid(), 'expense', 4000, acc, null, groceries, 'Mercadona', null, '{}', '2027-05-12');
  assert r.trip_id = trip and r.trip_origin = 'auto', 'AC1 auto-tagged inside the trip dates';
  select * into r from create_transaction(gen_random_uuid(), 'expense', 4000, acc, null, groceries, 'Mercadona', null, '{}', '2027-05-09');
  assert r.trip_id is null, 'AC1 the day before is not tagged';
  select * into r from create_transaction(gen_random_uuid(), 'expense', 4000, acc, null, groceries, 'Mercadona', null, '{}', '2027-05-21');
  assert r.trip_id is null, 'AC1 the day after is not tagged';
  -- untagging via the chip saves it with no trip
  select * into r from create_transaction(gen_random_uuid(), 'expense', 4000, acc, null, groceries, 'Mercadona', null, '{}', '2027-05-13', null, 'app', false, false, null, null, null, null, null, null, true);
  assert r.trip_id is null and r.trip_origin is null, 'AC1 untagged on purpose';
  -- EC-T4: a chip set by hand or from "Add to Spain" is locked on for any date: before the start it is a booking, otherwise manual
  select * into r from create_transaction(gen_random_uuid(), 'expense', 12000, acc, null, flights, 'Iberia', null, '{}', '2026-12-05', null, 'app', false, false, null, null, null, null, trip);
  assert r.trip_id = trip and r.trip_origin = 'booking', 'EC-T4 a booking dated months before the trip';
  select * into r from create_transaction(gen_random_uuid(), 'expense', 900, acc, null, groceries, 'Kiosk', null, '{}', '2027-05-25', null, 'app', false, false, null, null, null, null, trip);
  assert r.trip_id = trip and r.trip_origin = 'manual', 'EC-T4 a manual tag after the trip stays';
  -- EC-T5: income and transfers are not auto-tagged; a refund can be tagged by hand
  select * into r from create_transaction(gen_random_uuid(), 'income', 2500, acc, null, salary, 'Iberia', null, '{}', '2027-05-14');
  assert r.trip_id is null, 'EC-T5 income is never auto-tagged';
  select * into r from create_transaction(gen_random_uuid(), 'transfer', 5000, acc, acc2, null, null, null, '{}', '2027-05-14');
  assert r.trip_id is null, 'EC-T5 transfers are never auto-tagged';
  select * into r from create_transaction(gen_random_uuid(), 'income', 2500, acc, null, salary, 'Iberia', null, '{}', '2027-05-14', null, 'app', false, false, null, null, null, null, trip);
  assert r.trip_id = trip, 'EC-T5 a refund can be tagged by hand';
  assert (select spent_pence from trip_summary(trip, '2027-05-15')) = 4000 + 12000 + 900 - 2500, 'EC-T18 the refund reduces the trip total';

  -- EC-B9: a bill logged during the trip is never tagged
  reset role;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, frequency, day_of_month, starts_on, next_due_on)
    values (ua, 'expense', 5000, acc, groceries, 'monthly', 15, '2027-05-15', '2027-05-15') returning id into item;
  select l.transaction_id into tid from recurring_log(item, '2027-05-15', '2027-05-15', '2027-06-15') l;
  assert (select trip_id from transactions where id = tid) is null, 'EC-B9 a bill during a trip is never auto-tagged';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- foreign amounts are all-or-none, and the original currency is kept upper-case
  select * into r from create_transaction(gen_random_uuid(), 'expense', 3839, acc, null, groceries, 'Walmart', null, '{}', '2027-05-16', null, 'app', false, false, null, null, null, null, null, null, false, 4860, 'usd', 0.79, '2027-05-16', 'auto');
  assert r.original_amount_minor = 4860 and r.original_currency = 'USD' and r.fx_rate = 0.79 and r.fx_source = 'auto', 'TRIP-06 original amount stored';
  denied := false;
  begin
    insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, original_currency) values (gen_random_uuid(), 'expense', 100, acc, groceries, '2027-05-16', 'USD');
  exception when check_violation then denied := true; end;
  assert denied, 'TRIP-06 an original currency needs its amount and rate';

  -- editing: the chip, the £ figure, and a changed type (EC-C8)
  select * into r from update_transaction(r.id, 'expense', 3910, acc, null, groceries, 'Walmart', null, '{}', '2027-05-16', null, null, null, null, false, null, null, true, 4860, 'USD', 0.79, '2027-05-16', 'manual');
  assert r.amount_pence = 3910 and r.fx_source = 'manual', 'AC2 correcting the £ figure marks the rate manual';
  select * into r from update_transaction(r.id, 'expense', 3910, acc, null, groceries, 'Walmart', null, '{}', '2027-05-16', null, null, null, null, true, null, null);
  assert r.trip_id is null and r.trip_origin is null, 'AC1 the chip removed in the editor';
  select * into r from update_transaction(r.id, 'expense', 3910, acc, null, groceries, 'Walmart', null, '{}', '2027-05-16', null, null, null, null, true, trip, null);
  assert r.trip_id = trip and r.trip_origin = 'manual', 'AC1 the chip set in the editor';
  select * into r from update_transaction(r.id, 'income', 3910, acc, null, salary, 'Walmart', null, '{}', '2027-05-16');
  assert r.trip_id = trip, 'EC-C8 a manual tag survives a change of type';
  select * into r from create_transaction(gen_random_uuid(), 'expense', 1000, acc, null, groceries, 'Auto one', null, '{}', '2027-05-17');
  assert r.trip_origin = 'auto';
  select * into r from update_transaction(r.id, 'income', 1000, acc, null, salary, 'Auto one', null, '{}', '2027-05-17');
  assert r.trip_id is null, 'EC-C8 turning an expense into income removes its automatic trip tag';
  select * into r from update_transaction(r.id, 'transfer', 1000, acc, acc2);
  assert r.trip_id is null, 'EC-C8 a transfer has no trip';

  -- the trip belongs to its owner (a foreign key alone would not prove it)
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  denied := false;
  begin
    insert into accounts (name, type, opening_balance_pence, opening_date) values ('B acc', 'current', 0, '2026-10-18');
    perform create_transaction(gen_random_uuid(), 'expense', 100, (select id from accounts where name = 'B acc'), null, groceries, 'x', null, '{}', '2027-05-12', null, 'app', false, false, null, null, null, null, trip);
  exception when others then denied := true; end;
  assert denied, 'EC-P7 B cannot tag A''s trip';
  assert (select count(*) from trips) = 0 and (select count(*) from trip_stops) = 0 and (select count(*) from trip_category_budgets) = 0, 'B sees no trips';
  reset role;
end $$;
