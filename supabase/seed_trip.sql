-- Sterling trip demo data (development and tests only): PRD Appendix A.2, the "USA" trip, 6–20 March 2027, viewed on Fri 12 March (day 7).
-- Tracking started on 18 Oct 2026, so the July flight is before tracking and does not move any balance.
--   Booked before £2,460.20 · on the trip £1,101.31 ($1,394.05 at 1 USD = 0.7900 GBP) · spent £3,561.51 of £5,000
-- Run on a database that has an owner and no data (supabase/seed.sql is the other demo set; they are not meant to be combined).
do $seed$
declare
  u uuid; monzo uuid; hsbc uuid; cash uuid; amex uuid; marcus uuid; usa uuid; other_t uuid;
  r record;
begin
  select id into u from auth.users order by created_at limit 1;
  if u is null then
    insert into auth.users (email, raw_user_meta_data) values ('demo@sterling.local', '{"display_name":"Saurabh"}') returning id into u;
  end if;
  delete from transactions where user_id = u;
  delete from trips where user_id = u;
  delete from payees where user_id = u;
  delete from accounts where user_id = u;
  update profiles set display_name = 'Saurabh', onboarded_at = now(), reminder_prompted = true where id = u;

  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order, is_default)
    values (u, 'Monzo', 'Monzo', 'current', 321408, '2026-10-18', true, 1, true) returning id into monzo;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'HSBC Premier', 'HSBC', 'current', 248620, '2026-10-18', true, 2) returning id into hsbc;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'Cash', 'cash', 25000, '2026-10-18', true, 3) returning id into cash;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'Amex Gold', 'American Express', 'credit_card', -118473, '2026-10-18', true, 4) returning id into amex;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'Marcus', 'Goldman Sachs', 'savings', 1240000, '2026-10-18', false, 5) returning id into marcus;

  -- the taxonomy has no "Other transport"; the mock-ups use it, so the owner has made it
  insert into categories (user_id, parent_id, kind, name, icon, color, sort_order)
    select u, p.id, 'expense', 'Other transport', 'train-front', p.color, 99 from categories p where p.user_id = u and p.name = 'Transport' and p.parent_id is null;

  insert into trips (user_id, name, country_code, currency, start_on, end_on, budget_pence, auto_tag)
    values (u, 'USA', 'US', 'USD', '2027-03-06', '2027-03-20', 500000, true) returning id into usa;
  insert into trip_stops (user_id, trip_id, name, start_on, end_on, sort) values
    (u, usa, 'Chicago', '2027-03-06', '2027-03-08', 1), (u, usa, 'New York', '2027-03-09', '2027-03-15', 2), (u, usa, 'Miami', '2027-03-16', '2027-03-20', 3);

  create temp table seed_t (on_date date, payee text, cat text, pence bigint, minor bigint, origin text, note text) on commit drop;
  insert into seed_t values
    -- booked before (GBP)
    ('2026-07-14', 'United', 'Flights', 17620, null, 'booking', 'ORD–LGA'),
    ('2026-12-02', 'British Airways', 'Flights', 118460, null, 'booking', 'LHR–ORD, MIA–LHR'),
    ('2026-12-09', 'Aviva Travel', 'Visas & insurance', 3890, null, 'booking', 'Annual multi-trip'),
    ('2027-01-14', 'The Hoxton Williamsburg', 'Hotels', 64200, null, 'booking', 'New York · 7 nights'),
    ('2027-02-03', 'Kimpton Angler''s', 'Hotels', 41850, null, 'booking', 'Miami · 4 nights'),
    -- on the trip (USD → GBP at 0.7900)
    ('2027-03-06', 'Uber', 'Taxis', 4614, 5840, 'auto', null),
    ('2027-03-06', 'Au Cheval', 'Restaurants', 7600, 9620, 'auto', null),
    ('2027-03-07', 'Art Institute of Chicago', 'Events & culture', 5056, 6400, 'auto', null),
    ('2027-03-07', 'Lou Malnati''s', 'Restaurants', 5712, 7230, 'auto', null),
    ('2027-03-07', 'CTA Ventra', 'Other transport', 1580, 2000, 'auto', null),
    ('2027-03-08', 'Gift for hosts', 'Gifts', 6715, 8500, 'auto', null),
    ('2027-03-08', 'Intelligentsia', 'Coffee & snacks', 980, 1240, 'auto', null),
    ('2027-03-09', 'Uber', 'Taxis', 3697, 4680, 'auto', null),
    ('2027-03-09', 'O''Hare Terminal 1', 'Coffee & snacks', 1936, 2450, 'auto', null),
    ('2027-03-09', 'Uber', 'Taxis', 5443, 6890, 'auto', null),
    ('2027-03-10', 'Joe''s Pizza', 'Restaurants', 1422, 1800, 'auto', null),
    ('2027-03-10', 'MoMA', 'Events & culture', 4740, 6000, 'auto', null),
    ('2027-03-10', 'OMNY', 'Other transport', 2686, 3400, 'auto', null),
    ('2027-03-10', 'Carbone', 'Restaurants', 16590, 21000, 'auto', null),
    ('2027-03-11', 'Russ & Daughters', 'Restaurants', 4641, 5875, 'auto', null),
    ('2027-03-11', 'Uniqlo Fifth Avenue', 'Clothing & shoes', 11265, 14260, 'auto', null),
    ('2027-03-11', 'Hamilton · Broadway', 'Events & culture', 22831, 28900, 'auto', null),
    ('2027-03-12', 'Blue Bottle', 'Coffee & snacks', 932, 1180, 'auto', null),
    ('2027-03-12', 'Ess-a-Bagel', 'Restaurants', 1691, 2140, 'auto', null);

  insert into payees (user_id, name) select distinct u, s.payee from seed_t s;
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, note, occurred_on, source, trip_id, trip_origin,
                            original_amount_minor, original_currency, fx_rate, fx_rate_on, fx_source)
  select u, gen_random_uuid(), 'expense', s.pence, amex, c.id, p.id, s.note, s.on_date, 'app', usa, s.origin,
         s.minor, case when s.minor is null then null else 'USD' end, case when s.minor is null then null else 0.79 end, case when s.minor is null then null else s.on_date end,
         case when s.minor is null then null else 'auto' end
    from seed_t s
    join categories c on c.user_id = u and c.name = s.cat
    join payees p on p.user_id = u and p.name = s.payee
   order by s.on_date;

  -- the usual month-to-month life, so monthly totals, norms and "Exclude trips" have something to compare with
  create temp table seed_n (on_date date, payee text, cat text, pence bigint) on commit drop;
  insert into seed_n
    select d::date, 'Tesco', 'Supermarket', 20000 from generate_series('2026-11-05'::date, '2027-03-05', interval '1 month') d
    union all select d::date, 'Wagamama', 'Restaurants', 6000 from generate_series('2026-11-12'::date, '2027-03-02', interval '1 month') d
    union all select '2027-03-26', 'Wagamama', 'Restaurants', 6000
    union all select '2026-10-22', 'Tesco', 'Supermarket', 15000;
  insert into payees (user_id, name) select distinct u, n.payee from seed_n n on conflict do nothing;
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source)
  select u, gen_random_uuid(), 'expense', n.pence, monzo, c.id, p.id, n.on_date, 'app'
    from seed_n n join categories c on c.user_id = u and c.name = n.cat join payees p on p.user_id = u and p.name = n.payee;

  -- past trips (the list only): one transaction each, with the total the mock-up shows
  insert into trips (user_id, name, country_code, currency, start_on, end_on, auto_tag) values (u, 'Lisbon', 'PT', 'EUR', '2026-06-12', '2026-06-15', true) returning id into other_t;
  insert into payees (user_id, name) values (u, 'Lisbon trip');
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, trip_id, trip_origin)
    select u, gen_random_uuid(), 'expense', 124080, amex, (select id from categories where user_id = u and name = 'Holiday spending'), (select id from payees where user_id = u and name = 'Lisbon trip'), '2026-06-13', 'app', other_t, 'manual';
  insert into trips (user_id, name, country_code, currency, start_on, end_on, auto_tag) values (u, 'Edinburgh', 'GB', 'GBP', '2025-08-22', '2025-08-25', true) returning id into other_t;
  insert into payees (user_id, name) values (u, 'Edinburgh trip');
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, trip_id, trip_origin)
    select u, gen_random_uuid(), 'expense', 68420, amex, (select id from categories where user_id = u and name = 'Holiday spending'), (select id from payees where user_id = u and name = 'Edinburgh trip'), '2025-08-23', 'app', other_t, 'manual';
  insert into trips (user_id, name, country_code, currency, start_on, end_on, auto_tag) values (u, 'Goa', 'IN', 'INR', '2024-12-20', '2024-12-30', true) returning id into other_t;
  insert into payees (user_id, name) values (u, 'Goa trip');
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, trip_id, trip_origin)
    select u, gen_random_uuid(), 'expense', 231560, amex, (select id from categories where user_id = u and name = 'Holiday spending'), (select id from payees where user_id = u and name = 'Goa trip'), '2024-12-22', 'app', other_t, 'manual';

  -- cached reference rates for the fixed seed
  insert into fx_rates (on_date, currency, gbp_per_unit)
    select d::date, 'USD', 0.79 from generate_series('2027-02-01'::date, '2027-03-31'::date, interval '1 day') d
    on conflict do nothing;
end
$seed$;
