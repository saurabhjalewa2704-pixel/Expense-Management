-- Sterling month-close demo data (development and tests only): MONTH-CLOSE-PRD §15, viewed on Tue 1 Dec 2026, closing November 2026.
-- Rent is paid on the 2nd (not the 1st) so that opening the app on 1 December does not catch up December's rent and move the balances.
-- Run on a fresh database with the user already created (the harness reset does that). Every figure below is chosen so that, after the close
-- steps of §15 are answered, the review reads £4,178.12 spent, £221.88 under a £4,400 budget, and Cash ends at £160.00.
do $seed$
declare
  u uuid; monzo uuid; hsbc uuid; cash uuid; amex uuid; marcus uuid;
  days date[]; c int := 0;
  p_octopus uuid; p_o2 uuid; p_pret uuid; p_jl uuid; p_rent uuid; p_council uuid; p_netflix uuid; p_spotify uuid; p_gym uuid; p_salary uuid;
  r_rent uuid; r_council uuid; r_octopus uuid; r_netflix uuid; r_spotify uuid; r_gym uuid; r_o2 uuid; t uuid;
  cat_rent uuid; cat_council uuid; cat_energy uuid; cat_stream uuid; cat_gym uuid; cat_mobile uuid; cat_coffee uuid; cat_homeware uuid; cat_salary uuid; cat_interest uuid;
  d date;
begin
  select id into u from auth.users order by created_at limit 1;
  update profiles set onboarded_at = now(), display_name = 'Saurabh' where id = u;

  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, is_default, sort_order) values (u, 'Monzo', 'current', 0, '2026-10-01', true, 1) returning id into monzo;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, sort_order) values (u, 'HSBC Premier', 'current', 0, '2026-10-01', 2) returning id into hsbc;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, sort_order) values (u, 'Cash', 'cash', 0, '2026-10-01', 3) returning id into cash;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, sort_order) values (u, 'Amex Gold', 'credit_card', 0, '2026-10-01', 4) returning id into amex;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash, sort_order) values (u, 'Marcus', 'savings', 1240000, '2026-10-01', false, 5) returning id into marcus;
  update profiles set tracking_started_on = '2026-10-01' where id = u;

  select id into cat_rent from categories where name = 'Rent & mortgage';
  select id into cat_council from categories where name = 'Council tax';
  select id into cat_energy from categories where name = 'Energy';
  select id into cat_stream from categories where name = 'Streaming & apps';
  select id into cat_gym from categories where name = 'Gym & fitness';
  select id into cat_mobile from categories where name = 'Mobile';
  select id into cat_coffee from categories where name = 'Coffee & snacks';
  select id into cat_homeware from categories where name = 'Homeware';
  select id into cat_salary from categories where name = 'Salary' and kind = 'income';
  select id into cat_interest from categories where name = 'Interest & dividends';

  insert into payees (user_id, name) values (u, 'Octopus Energy') returning id into p_octopus;
  insert into payees (user_id, name) values (u, 'O2') returning id into p_o2;
  insert into payees (user_id, name) values (u, 'Pret A Manger') returning id into p_pret;
  insert into payees (user_id, name) values (u, 'John Lewis') returning id into p_jl;
  insert into payees (user_id, name) values (u, 'Rent') returning id into p_rent;
  insert into payees (user_id, name) values (u, 'Council tax') returning id into p_council;
  insert into payees (user_id, name) values (u, 'Netflix') returning id into p_netflix;
  insert into payees (user_id, name) values (u, 'Spotify') returning id into p_spotify;
  insert into payees (user_id, name) values (u, 'Gym') returning id into p_gym;

  -- the 28 days that get something logged: every day of November except the 5th and the 14th
  select array_agg(x::date order by x) into days from generate_series('2026-11-01'::date, '2026-11-30'::date, interval '1 day') x where x::date not in ('2026-11-05', '2026-11-14');

  -- recurring rules and the November occurrences (rent, council tax, gym, Netflix, Spotify logged; Octopus an estimate; O2 waiting for the owner)
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on) values (u, 'expense', 199500, hsbc, cat_rent, p_rent, 'monthly', 2, '2026-10-02', '2026-12-02') returning id into r_rent;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on) values (u, 'expense', 15799, hsbc, cat_council, p_council, 'monthly', 3, '2026-10-03', '2026-12-03') returning id into r_council;
  insert into recurring_items (user_id, type, amount_pence, amount_varies, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on) values (u, 'expense', 6800, true, monzo, cat_energy, p_octopus, 'monthly', 20, '2026-10-20', '2026-12-20') returning id into r_octopus;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on) values (u, 'expense', 1099, amex, cat_stream, p_netflix, 'monthly', 12, '2026-10-12', '2026-12-12') returning id into r_netflix;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on) values (u, 'expense', 1199, amex, cat_stream, p_spotify, 'monthly', 15, '2026-10-15', '2026-12-15') returning id into r_spotify;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on) values (u, 'expense', 4254, monzo, cat_gym, p_gym, 'monthly', 8, '2026-10-08', '2026-12-08') returning id into r_gym;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on, auto_log) values (u, 'expense', 1800, hsbc, cat_mobile, p_o2, 'monthly', 7, '2026-10-07', '2026-12-07', false) returning id into r_o2;

  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, recurring_id) values (u, gen_random_uuid(), 'expense', 199500, hsbc, cat_rent, p_rent, '2026-11-02', 'recurring', r_rent) returning id into t;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (u, r_rent, '2026-11-02', '2026-11-02', 'logged', t, 199500);
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, recurring_id) values (u, gen_random_uuid(), 'expense', 15799, hsbc, cat_council, p_council, '2026-11-03', 'recurring', r_council) returning id into t;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (u, r_council, '2026-11-03', '2026-11-03', 'logged', t, 15799);
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, recurring_id) values (u, gen_random_uuid(), 'expense', 4254, monzo, cat_gym, p_gym, '2026-11-08', 'recurring', r_gym) returning id into t;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (u, r_gym, '2026-11-08', '2026-11-08', 'logged', t, 4254);
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, recurring_id) values (u, gen_random_uuid(), 'expense', 1099, amex, cat_stream, p_netflix, '2026-11-12', 'recurring', r_netflix) returning id into t;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (u, r_netflix, '2026-11-12', '2026-11-12', 'logged', t, 1099);
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, recurring_id) values (u, gen_random_uuid(), 'expense', 1199, amex, cat_stream, p_spotify, '2026-11-15', 'recurring', r_spotify) returning id into t;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (u, r_spotify, '2026-11-15', '2026-11-15', 'logged', t, 1199);
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, source, recurring_id, is_estimate) values (u, gen_random_uuid(), 'expense', 6800, monzo, cat_energy, p_octopus, '2026-11-20', 'recurring', r_octopus, true) returning id into t;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (u, r_octopus, '2026-11-20', '2026-11-20', 'estimate', t, 6800);
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, amount_pence) values (u, r_o2, '2026-11-07', '2026-11-07', 'pending', 1800);

  -- everyday spending, spread over the 28 days. The cents of each category are split so the totals are exact.
  create temp table _spread (l1 text, sub text, total bigint, parts int, acct uuid) on commit drop;
  insert into _spread values
    ('Groceries', 'Supermarket', 51240, 8, monzo), ('Eating out', 'Restaurants', 49035, 8, amex), ('Shopping', 'Clothing & shoes', 18320, 5, monzo),
    ('Transport', 'TfL & rail', 28630, 6, monzo), ('Family & giving', 'Gifts', 16313, 3, hsbc), ('Health', 'Pharmacy', 3346, 2, monzo),
    ('Entertainment', 'Events & culture', 4102, 2, amex), ('Bills', 'Bank fees & interest', 1399, 1, hsbc);
  declare s record; i int; part bigint; cid uuid; amt bigint;
  begin
    for s in select * from _spread loop
      select c.id into cid from categories c join categories pc on pc.id = c.parent_id where pc.name = s.l1 and c.name = s.sub;
      for i in 1..s.parts loop
        amt := case when i < s.parts then s.total / s.parts else s.total - (s.total / s.parts) * (s.parts - 1) end;
        c := c + 1;
        insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, occurred_at, source)
          values (u, gen_random_uuid(), 'expense', amt, s.acct, cid, days[(c % 28) + 1], days[(c % 28) + 1] + time '12:30', 'app');
      end loop;
    end loop;
  end;
  -- the two Pret A Manger coffees two minutes apart, and John Lewis (the large purchase)
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, occurred_at, source) values
    (u, gen_random_uuid(), 'expense', 420, monzo, cat_coffee, p_pret, '2026-11-10', '2026-11-10 08:14', 'app'),
    (u, gen_random_uuid(), 'expense', 420, monzo, cat_coffee, p_pret, '2026-11-10', '2026-11-10 08:16', 'app'),
    (u, gen_random_uuid(), 'expense', 11800, amex, cat_homeware, p_jl, '2026-11-25', '2026-11-25 14:05', 'app');
  -- October history for Shopping: the five tickets that make £100 the large-purchase threshold (3 x the £30 median)
  for d in select generate_series('2026-10-05'::date, '2026-10-25'::date, interval '5 days')::date loop
    insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, source)
      values (u, gen_random_uuid(), 'expense', 3000, monzo, (select c.id from categories c where c.name = 'Clothing & shoes'), d, 'app');
  end loop;
  -- money in
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on, source) values
    (u, gen_random_uuid(), 'income', 538000, monzo, cat_salary, '2026-11-25', 'app'), (u, gen_random_uuid(), 'income', 3240, monzo, cat_interest, '2026-11-30', 'app');

  -- budget: £4,400 overall and five limits
  insert into budgets (user_id, category_id, amount_pence, effective_from) values (u, null, 440000, '2026-10-01');
  insert into budgets (user_id, category_id, amount_pence, effective_from) select u, c.id, v.amt, '2026-10-01' from (values ('Groceries', 75000), ('Eating out', 40000), ('Shopping', 35000), ('Transport', 45000), ('Entertainment', 15000)) v(n, amt) join categories c on c.name = v.n and c.parent_id is null;

  -- the forecast's snapshots on the 1st, 8th, 15th and 22nd, and its usual per day (£61.14) on the 1st
  insert into forecast_snapshots (user_id, day, scope, point_pence, usual_per_day_pence) values (u, '2026-11-01', 'all', 413871, 6114), (u, '2026-11-08', 'all', 402978, null), (u, '2026-11-15', 'all', 402601, null), (u, '2026-11-22', 'all', 412425, null);

  -- opening balances are worked out last, so that today's balances are exactly the figures on the screen: Monzo £2,846.12, HSBC £4,102.55, Cash £180.00, Amex £1,436.80 owed
  update accounts a set opening_balance_pence = a.opening_balance_pence + (v.target - (select b.balance_pence from account_balances('2026-12-01') b where b.account_id = a.id))
    from (values (monzo, 284612::bigint), (hsbc, 410255::bigint), (cash, 18000::bigint), (amex, -143680::bigint)) v(id, target) where a.id = v.id;
end $seed$;
