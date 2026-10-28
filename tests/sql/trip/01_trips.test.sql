-- Trips (PRD §6.12, Appendix A.2): the USA trip as it stands on Fri 12 March 2027. Assertion messages name the criterion or edge case.
do $$
declare u uuid; usa uuid; r record; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into usa from trips where name = 'USA';

  -- AC3 / AC4: totals and the numbers behind the overview
  select * into r from trip_summary(usa, '2027-03-12');
  assert r.booked_pence = 246020 and r.on_trip_pence = 110131 and r.spent_pence = 356151, 'AC3 booked £2,460.20, on the trip £1,101.31, spent £3,561.51: ' || r::text;
  assert r.days = 15 and r.day_n = 7 and r.budget_pence = 500000 and r.txn_count = 24, 'AC4 day 7 of 15, £5,000 budget, 24 transactions';
  assert r.local_minor = 139405 and r.local_pence = 110131, 'TRIP-10 $1,394.05 → £1,101.31';

  -- AC4: the daily chart has 7 filled days up to the 12th and the biggest day is Thursday 11th (Hamilton)
  assert (select count(*) from trip_by_day(usa) where total_pence > 0) = 7, 'AC4 seven filled days';
  select * into r from trip_by_day(usa) order by total_pence desc limit 1;
  assert r.day = '2027-03-11' and r.top_payee = 'Hamilton · Broadway' and r.total_pence = 22831 + 11265 + 4641, 'TRIP-07 Thursday was the biggest day: Hamilton';

  -- AC5: by stop
  select * into r from trip_by_stop(usa, '2027-03-12') where name = 'Chicago';
  assert r.total_pence = 32257 and r.days = 3 and r.days_elapsed = 3, 'AC5 Chicago £322.57 over 3 days: ' || r::text;
  select * into r from trip_by_stop(usa, '2027-03-12') where name = 'New York';
  assert r.total_pence = 77874 and r.days_elapsed = 4, 'AC5 New York £778.74, 4 days so far: ' || r::text;
  select * into r from trip_by_stop(usa, '2027-03-12') where name = 'Miami';
  assert r.total_pence = 0 and r.days_elapsed = 0, 'AC5 Miami is upcoming';
  assert (select count(*) from trip_by_stop(usa, '2027-03-12') where name = 'Other') = 0, 'EC-T15 every day is covered here, so no Other row';

  -- where it went: Flights £1,360.80 and Hotels £1,060.50 lead (the mock-up's 68% of the trip)
  select * into r from trip_by_category(usa, 'leaf') limit 1;
  assert r.name = 'Flights' and r.total_pence = 17620 + 118460 and r.parent_name = 'Travel', 'TRIP-07 flights first: ' || r::text;
  assert (select total_pence from trip_by_category(usa, 'leaf') where name = 'Hotels') = 64200 + 41850, 'TRIP-07 hotels';
  assert (select count(*) from trip_by_category(usa, 'leaf')) = 10, 'TRIP-07 "Show all 10"';
  assert (select sum(total_pence) from trip_by_category(usa, 'parent')) = 356151, 'the categories add up to the trip';

  -- AC1: the July flight does not move any balance, but is real July spending and counts in the trip
  assert (select counts_in_balance from transactions where payee_id = (select id from payees where name = 'United')) = false, 'AC1 EC-T3 before tracking: not in balance';
  assert (select sum(total_pence) from spend_by_category('2026-07-01', '2026-07-31')) = 17620, 'EC-T3 it counts in July spend';
  assert available_cash('2027-03-12') = (select sum(balance_pence) from account_balances('2027-03-12') where counts_as_cash), 'invariant 2 with a pre-tracking row';

  -- AC3: the months paid in keep their own figures: December–February hold the bookings, March only the on-trip spend
  assert (select sum(total_pence) from spend_by_category('2026-12-01', '2026-12-31')) = 118460 + 3890 + 20000 + 6000, 'AC3 December holds the two bookings paid then';
  assert (select sum(total_pence) from spend_by_category('2027-01-01', '2027-01-31')) = 64200 + 20000 + 6000, 'AC3 January';
  assert (select sum(total_pence) from spend_by_category('2027-02-01', '2027-02-28')) = 41850 + 20000 + 6000, 'AC3 February';
  assert (select sum(total_pence) from spend_by_category('2027-03-01', '2027-03-31')) = 110131 + 20000 + 6000, 'AC3 March includes only the £1,101.31 spent on the trip';

  -- AC7 / TRIP-09: "Exclude trips" drops exactly the trip's spending, and norms never include it
  assert (select sum(total_pence) from spend_by_category('2027-03-01', '2027-03-31'))
       - (select coalesce(sum(total_pence), 0) from spend_by_category('2027-03-01', '2027-03-31', null, false, 'parent', true)) = 110131, 'AC7 March drops exactly £1,101.31';
  assert (select sum(total_pence) from spend_by_category('2024-01-01', '2027-12-31'))
       - (select sum(total_pence) from spend_by_category('2024-01-01', '2027-12-31', null, false, 'parent', true)) = 246020 + 110131 + 124080 + 68420 + 231560, 'AC7 everything tagged to a trip';
  assert (select norm_pence from spend_by_category('2027-04-01', '2027-04-30', null, false, 'parent', false) where name = 'Eating out' limit 1) is not distinct from
         (select norm_pence from spend_by_category('2027-04-01', '2027-04-30', null, false, 'parent', true) where name = 'Eating out' limit 1), 'AC7 April norms are the same with or without the trip';
  assert (select sum(spend_pence) from monthly_totals(60, true)) <= (select sum(spend_pence) from monthly_totals(60)), 'monthly_totals can leave trips out';
  assert (select sum(total_pence) from daily_spend('2027-03-01', '2027-03-31')) - (select sum(total_pence) from daily_spend('2027-03-01', '2027-03-31', false, true)) = 110131, 'daily_spend can leave trips out';

  -- earlier bookings scan (TRIP-05): untagged travel expenses in the 12 months before the start, never ones already on a trip
  assert (select count(*) from trip_candidates(usa)) = 0, 'every booking is already attached';
  update transactions set trip_id = null, trip_origin = null where trip_origin = 'booking';
  assert (select count(*) from trip_candidates(usa)) = 5, 'TRIP-05 five bookings found (the July flight is within 12 months of 6 March 2027 only if after 6 March 2026)';
  assert exists (select 1 from trip_candidates(usa) where payee_name = 'United' and occurred_on = '2026-07-14'), 'EC-T3 the July flight is a candidate';
  update transactions set trip_id = (select id from trips where name = 'USA'), trip_origin = 'booking'
   where payee_id in (select id from payees where name in ('United','British Airways','Aviva Travel','The Hoxton Williamsburg','Kimpton Angler''s'));

  -- AC6 / EC-T1: overlapping trips are refused
  begin
    insert into trips (name, currency, start_on, end_on) values ('Clash', 'GBP', '2027-03-20', '2027-03-22');
    assert false, 'AC6 an overlapping trip was allowed';
  exception when exclusion_violation then null; end;
  insert into trips (name, currency, start_on, end_on) values ('Adjacent', 'GBP', '2027-03-21', '2027-03-22');     -- touching is fine
  delete from trips where name = 'Adjacent';

  -- stops stay inside the trip and do not overlap (TRIP-03)
  begin insert into trip_stops (trip_id, name, start_on, end_on) values (usa, 'Too early', '2027-03-04', '2027-03-06'); assert false, 'stop outside the trip allowed';
  exception when check_violation then null; end;
  begin insert into trip_stops (trip_id, name, start_on, end_on) values (usa, 'Overlap', '2027-03-08', '2027-03-09'); assert false, 'overlapping stop allowed';
  exception when check_violation then null; end;

  -- AC9 / EC-T17: deleting the trip keeps every transaction, with the link removed
  n := (select count(*) from transactions where trip_id = usa);
  assert n = 24, 'AC9 24 transactions on the trip';
  delete from trips where id = usa;
  assert (select count(*) from transactions where deleted_at is null and payee_id in (select id from payees where name in ('Uber','Carbone','United','Hamilton · Broadway'))) = 6, 'AC9 transactions stay';
  assert (select count(*) from transactions where trip_id is not null and occurred_on >= '2027-03-06' and occurred_on <= '2027-03-20') = 0, 'AC9 and the link is gone';
  assert (select count(*) from trip_stops) = 0, 'its stops go with it';
  reset role;
end $$;
