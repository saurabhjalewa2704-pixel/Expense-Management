-- EC-T12: a trip that spans a month end. Each expense counts in its own month; the trip's total is the same either way.
do $$
declare u uuid; tr uuid; acc uuid; groceries uuid; r record;
begin
  select id into u from auth.users order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into acc from accounts where name = 'Amex Gold';
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  insert into trips (name, currency, start_on, end_on) values ('Month end', 'GBP', '2027-03-29', '2027-04-02') returning id into tr;
  perform create_transaction(gen_random_uuid(), 'expense', 4000, acc, null, groceries, 'Shop A', null, '{}', '2027-03-31');
  perform create_transaction(gen_random_uuid(), 'expense', 6000, acc, null, groceries, 'Shop B', null, '{}', '2027-04-01');
  assert (select count(*) from transactions where trip_id = tr) = 2, 'EC-T12 both are tagged to the trip';
  assert (select sum(total_pence) from spend_by_category('2027-03-31', '2027-03-31') where name = 'Groceries') = 4000, 'EC-T12 31 March counts in March';
  assert (select sum(total_pence) from spend_by_category('2027-04-01', '2027-04-01') where name = 'Groceries') = 6000, 'EC-T12 1 April counts in April';
  select * into r from trip_summary(tr, '2027-04-02');
  assert r.on_trip_pence = 10000 and r.spent_pence = 10000, 'EC-T12 the trip total is unaffected by the month end: ' || r::text;
end $$;
