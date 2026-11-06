-- Month-end close (MONTH-CLOSE-PRD.md): isolation, item selection for each step, reconcile, snapshot, changes after closing, edge cases EC-MC*.
create function pg_temp.as_user(u uuid) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;

-- ── Isolation: each person's closes, answers and reconciliations are their own ───────────────────────────────────────────────────────
do $$
declare ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); acc uuid; n int; denied boolean;
begin
  insert into auth.users (id, email) values (ua, 'mca@test.local'), (ub, 'mcb@test.local');
  assert not exists (select 1 from pg_tables where schemaname = 'public' and tablename in ('month_closes', 'month_close_answers', 'account_reconciliations') and not rowsecurity), 'RLS is on for the three new tables';
  perform pg_temp.as_user(ua); set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Cash', 'cash', 18000, '2026-10-01') returning id into acc;
  update profiles set tracking_started_on = '2026-10-01' where id = ua;
  perform close_answer('2026-11-01', 'missing_day', '2026-11-05', 'no_spend', null, '2026-12-01');
  perform close_reconcile_account('2026-11-01', acc, 16000, 'untracked_spend', null, null, '2026-12-01');
  assert (select count(*) from month_closes) = 1 and (select count(*) from month_close_answers) = 2 and (select count(*) from account_reconciliations) = 1, 'A has own rows';
  reset role;
  perform pg_temp.as_user(ub); set local role authenticated;
  assert (select count(*) from month_closes) = 0 and (select count(*) from month_close_answers) = 0 and (select count(*) from account_reconciliations) = 0, 'B sees none of A''s closes, answers or reconciliations';
  update month_closes set status = 'closed'; get diagnostics n = row_count; assert n = 0, 'B cannot change A''s close';
  delete from month_close_answers; get diagnostics n = row_count; assert n = 0, 'B cannot delete A''s answers';
  denied := false;
  begin insert into month_closes (user_id, month) values (ua, '2026-09-01'); exception when others then denied := true; end;
  assert denied, 'B cannot insert a close as A';
  denied := false;
  begin perform close_reconcile_account('2026-11-01', acc, 1, 'adjustment', null, null, '2026-12-01'); exception when others then denied := true; end;
  assert denied, 'B cannot reconcile A''s account';
  reset role;
end $$;

-- ── The scenario of MONTH-CLOSE-PRD §15, and the edge cases that can be checked in the database ──────────────────────────────────────────
do $$
declare
  u uuid := gen_random_uuid(); cash uuid; monzo uuid; amex uuid; late uuid; arch uuid; other_user uuid := gen_random_uuid();
  groc uuid; shop uuid; eat uuid; sal uuid; py uuid; py2 uuid; tx uuid; tx2 uuid; d date; r jsonb; s jsonb; denied boolean; n int; item uuid; occ uuid; rec uuid; paused uuid; ended uuid;
  mc month_closes; bal bigint; t1 uuid; t2 uuid; snap jsonb; sh uuid;
begin
  insert into auth.users (id, email) values (u, 'mcc@test.local'), (other_user, 'mcd@test.local');
  perform pg_temp.as_user(u); set local role authenticated;
  select id into groc from categories where name = 'Groceries' and parent_id is null;
  select id into shop from categories where name = 'Shopping' and parent_id is null;
  select id into eat from categories where name = 'Eating out' and parent_id is null;
  select id into sal from categories where name = 'Salary' and kind = 'income';
  insert into accounts (name, type, opening_balance_pence, opening_date, is_default) values ('Monzo', 'current', 300000, '2026-10-01', true) returning id into monzo;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Cash', 'cash', 20000, '2026-10-01') returning id into cash;
  insert into accounts (name, type, opening_balance_pence, opening_date, counts_as_cash) values ('Amex', 'credit_card', -150000, '2026-10-01', true) returning id into amex;
  insert into accounts (name, type, opening_balance_pence, opening_date, counts_as_cash) values ('Marcus', 'savings', 1240000, '2026-10-01', false) returning id into arch;
  update profiles set tracking_started_on = '2026-10-01' where id = u;
  insert into payees (name) values ('Pret A Manger') returning id into py;
  insert into payees (name) values ('John Lewis') returning id into py2;

  -- EC-MC1 the month must have ended
  denied := false;
  begin perform month_close_checks('2026-12-01', '2026-12-01'); perform close_answer('2026-12-01', 'missing_day', '2026-12-01', 'no_spend', null, '2026-12-01'); exception when others then denied := true; end;
  assert denied, 'EC-MC1 a month cannot be closed before it ends';
  denied := false;
  begin perform close_month('2026-12-01', '2026-12-15'); exception when others then denied := true; end;
  assert denied, 'EC-MC1 and close_month refuses it too';

  -- EC-MC3 a month with no transactions at all: every day is missing
  assert jsonb_array_length(month_close_checks('2026-10-01', '2026-12-01')->'missing_days') = 31, 'EC-MC3 a month with nothing logged lists every day';
  s := month_close_summary('2026-10-01', '2026-12-01');
  assert (s->>'spent')::bigint = 0 and (s->>'income')::bigint = 0 and (s->>'budget') is null, 'EC-MC3 and the review is £0 with no budget (EC-MC24)';

  -- November: a user-entered expense on every day but the 5th and the 14th
  for d in select generate_series('2026-11-01'::date, '2026-11-30'::date, interval '1 day')::date loop
    continue when d in ('2026-11-05', '2026-11-14', '2026-11-07', '2026-11-09', '2026-11-20');
    insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, occurred_at, source)
      values (gen_random_uuid(), 'expense', 1000 + extract(day from d)::int, monzo, groc, d, d + time '12:00', 'app');
  end loop;
  -- EC-MC4 only an automatically logged bill that day; EC-MC6 only a transfer; and a day with only an earlier no-spend marker
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 1800, monzo, groc, '2026-11-07', 'recurring');
  insert into transactions (client_id, type, amount_pence, account_id, counter_account_id, occurred_on, source) values (gen_random_uuid(), 'transfer', 5000, monzo, cash, '2026-11-09', 'app');
  insert into no_spend_days (day) values ('2026-11-20');
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert (select array_agg(x->>'day' order by x->>'day') from jsonb_array_elements(r->'missing_days') x) = array['2026-11-05', '2026-11-07', '2026-11-14'],
    'EC-MC4/6 missing days: the 5th, the 14th and the 7th (only a bill); the 9th (a transfer) and the 20th (marker) are not listed';
  assert (r->>'partial')::boolean = false, 'a month tracked from its first day is whole';

  -- EC-MC7 days before tracking started are never listed (a second person who started on the 18th)
  perform pg_temp.as_user(other_user);
  update profiles set tracking_started_on = '2026-11-18' where id = other_user;
  assert (select min(x->>'day') from jsonb_array_elements(month_close_checks('2026-11-01', '2026-12-01')->'missing_days') x) = '2026-11-18', 'EC-MC7 nothing before the tracking start is listed';
  assert (month_close_checks('2026-11-01', '2026-12-01')->>'partial')::boolean and (month_close_summary('2026-11-01', '2026-12-01')->>'partial')::boolean, 'EC-MC33 a first, partial month says so';
  assert (month_close_summary('2026-11-01', '2026-12-01')->>'usual_estimate') is null and jsonb_array_length(month_close_summary('2026-11-01', '2026-12-01')->'forecasts') = 0, 'EC-MC33 and hides everyday-vs-usual and the forecast table';
  perform pg_temp.as_user(u);

  -- step 1 answers: nothing to log, not tracked; EC-MC5 a day fixed outside the flow disappears; runs are answered day by day
  perform close_answer('2026-11-01', 'missing_day', '2026-11-05', 'no_spend', null, '2026-12-01');
  assert (select source from no_spend_days where day = '2026-11-05') = 'close', 'the close writes the same marker as the reminder, source close';
  assert not (select confirmed_zero from forecast_daily_facts('2026-11-05', '2026-11-05')) is null, 'sanity';
  perform close_answer('2026-11-01', 'missing_day', '2026-11-14', 'not_tracked', null, '2026-12-01');
  assert (select not_tracked and not confirmed_zero from forecast_daily_facts('2026-11-14', '2026-11-14')), 'a not-tracked day is not a confirmed £0 day';
  assert (select confirmed_zero and not not_tracked from forecast_daily_facts('2026-11-05', '2026-11-05')), 'a no-spend day is a confirmed £0 day';
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, occurred_at, source) values (gen_random_uuid(), 'expense', 450, monzo, groc, '2026-11-07', '2026-11-07 09:00', 'app');
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert not exists (select 1 from jsonb_array_elements(r->'missing_days') x where x->>'day' = '2026-11-07'), 'EC-MC5 a day fixed through Quick Add is no longer listed';
  assert (select count(*) from jsonb_array_elements(r->'missing_days') x where x->>'answer' is not null) = 2, 'answered days stay in the list, as answered';

  -- step 2: an estimated bill and a payment waiting for the owner; EC-MC10 paused and stopped rules; EC-MC9 a bill dated in the next month
  insert into payees (name) values ('Octopus Energy') returning id into item;
  insert into recurring_items (type, amount_pence, amount_varies, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
    values ('expense', 6800, true, monzo, groc, item, 'monthly', 20, '2026-10-20', '2026-12-20') returning id into rec;
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source, recurring_id, is_estimate)
    values (gen_random_uuid(), 'expense', 6800, monzo, groc, '2026-11-20', 'recurring', rec, true) returning id into tx;
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (rec, '2026-11-20', '2026-11-20', 'estimate', tx, 6800) returning id into occ;
  insert into recurring_items (type, amount_pence, account_id, category_id, frequency, day_of_month, starts_on, next_due_on, paused_at) values ('expense', 1500, monzo, groc, 'monthly', 12, '2026-10-12', '2026-12-12', now()) returning id into paused;
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source, recurring_id, is_estimate) values (gen_random_uuid(), 'expense', 1500, monzo, groc, '2026-11-12', 'recurring', paused, true) returning id into tx2;
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, transaction_id, amount_pence) values (paused, '2026-11-12', '2026-11-12', 'estimate', tx2, 1500);
  insert into recurring_items (type, amount_pence, account_id, category_id, frequency, day_of_month, starts_on, next_due_on, ended_at) values ('expense', 2500, monzo, groc, 'monthly', 13, '2026-10-13', '2026-12-13', now() + interval '1 hour') returning id into ended;
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, amount_pence) values (ended, '2026-11-13', '2026-11-13', 'pending', 2500);
  insert into payees (name) values ('O2') returning id into item;
  insert into recurring_items (type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on, auto_log)
    values ('expense', 1800, monzo, groc, item, 'monthly', 7, '2026-10-07', '2026-12-07', false) returning id into rec;
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, amount_pence) values (rec, '2026-11-07', '2026-11-07', 'pending', 1800);
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, amount_pence) values (rec, '2026-12-01', '2026-12-01', 'pending', 1800);   -- EC-MC9: dated in December
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert jsonb_array_length(r->'bills') = 2, 'EC-MC9/10 two bills: the estimate and the waiting payment; paused, stopped and December-dated ones are not listed';
  assert (select array_agg(x->>'status' order by x->>'due_on') from jsonb_array_elements(r->'bills') x) = array['pending', 'estimate'], 'a waiting payment and an estimate';

  -- confirming and logging, with the answers recorded (MC-21, MC-22)
  perform close_resolve_bill('2026-11-01', occ, 'confirm', 7136, '2026-12-01');
  assert (select amount_pence from transactions where id = tx) = 7136 and not (select is_estimate from transactions where id = tx), 'MC-21 confirming updates the transaction itself';
  perform close_resolve_bill('2026-11-01', (select o.id from recurring_occurrences o where o.item_id = rec and o.due_on = '2026-11-07'), 'log', null, '2026-12-01');
  assert exists (select 1 from transactions where recurring_id = rec and occurred_on = '2026-11-07' and amount_pence = 1800), 'MC-22 It was paid logs the rule amount on the due date';
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert (select count(*) from jsonb_array_elements(r->'bills') x where x->>'answer' in ('confirmed', 'paid')) = 2, 'both bills are answered';

  -- step 3: EC-MC11 an account opened after the month, EC-MC12 an archived one, savings flagged separately
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Joint', 'current', 10000, '2026-12-01') returning id into late;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Old', 'current', 0, '2026-10-01') returning id into item;
  update accounts set archived_at = now() where id = item;
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert exists (select 1 from jsonb_array_elements(r->'balances') x where x->>'name' = 'Joint'), 'EC-MC11 an account opened after the month is included';
  assert not exists (select 1 from jsonb_array_elements(r->'balances') x where x->>'name' = 'Old'), 'EC-MC12 an archived account is excluded';
  assert (select (x->>'counts_as_cash')::boolean from jsonb_array_elements(r->'balances') x where x->>'name' = 'Marcus') = false, 'savings are marked as not counting towards cash';

  -- MC-34: the cash account is £20.00 short; the resolving expense counts even though it is back-dated to November (EC-MC17)
  select balance_pence into bal from account_balances('2026-12-01') where account_id = cash;
  r := close_reconcile_account('2026-11-01', cash, bal - 2000, 'untracked_spend', null, null, '2026-12-01');
  assert (r->>'balance_after')::bigint = bal - 2000 and (select balance_pence from account_balances('2026-12-01') where account_id = cash) = bal - 2000, 'MC-34 the balance now equals the bank figure';
  assert (select counts_in_balance and occurred_on = '2026-11-30' and amount_pence = 2000 from transactions where id = (r->>'transaction_id')::uuid), 'EC-MC17 the resolving transaction is dated 30 Nov and counts in the balance';
  assert (select name from categories where id = (select category_id from transactions where id = (r->>'transaction_id')::uuid)) = 'Untracked cash', 'MC-33 the default category is Other › Untracked cash';
  assert (select pc.name from categories c join categories pc on pc.id = c.parent_id where c.name = 'Untracked cash') = 'Other', 'under Other';
  assert (select last_reconciled_on from accounts where id = cash) = '2026-12-01', 'the account is marked as checked on the day';
  -- EC-MC16 a back-dated expense added after reconciling is already in the bank balance
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 700, cash, groc, '2026-11-15', 'app') returning id into tx2;
  assert not (select counts_in_balance from transactions where id = tx2) and (select balance_pence from account_balances('2026-12-01') where account_id = cash) = bal - 2000, 'EC-MC16 a back-dated expense after reconciling does not move the balance again';
  delete from transactions where id = tx2;
  -- EC-MC18 a failure part-way writes nothing (a category that does not exist)
  denied := false;
  begin perform close_reconcile_account('2026-11-01', monzo, 1, 'untracked_spend', gen_random_uuid(), null, '2026-12-01'); exception when others then denied := true; end;
  assert denied and (select count(*) from account_reconciliations where account_id = monzo) = 0 and (select last_reconciled_on from accounts where id = monzo) is null, 'EC-MC18 nothing is written when the reconcile fails';
  -- a match (EC-MC15: the figure equals Sterling's) and the wrong resolution is refused
  select balance_pence into bal from account_balances('2026-12-01') where account_id = monzo;
  r := close_reconcile_account('2026-11-01', monzo, bal, 'match', null, null, '2026-12-01');
  assert (r->>'difference')::bigint = 0 and (select count(*) from transactions where source = 'close' and account_id = monzo) = 0, 'a match writes no transaction';
  denied := false;
  begin perform close_reconcile_account('2026-11-01', monzo, bal + 5, 'match', null, null, '2026-12-01'); exception when others then denied := true; end;
  assert denied, 'a match must be a match';
  -- EC-MC13 a card in credit: the bank shows £200.00 in credit against Sterling's £1,500.00 owed
  select balance_pence into bal from account_balances('2026-12-01') where account_id = amex;
  r := close_reconcile_account('2026-11-01', amex, 20000, 'untracked_income', null, null, '2026-12-01');
  assert (select balance_pence from account_balances('2026-12-01') where account_id = amex) = 20000 and bal = -150000, 'EC-MC13 a card can end in credit';
  assert (select name from categories where id = (select category_id from transactions where id = (r->>'transaction_id')::uuid)) = 'Untracked income', 'income difference goes to Untracked income';
  -- just correct the balance: an adjustment dated today
  select balance_pence into bal from account_balances('2026-12-01') where account_id = late;
  r := close_reconcile_account('2026-11-01', late, bal + 100, 'adjustment', null, null, '2026-12-01');
  assert (select type = 'adjustment' and occurred_on = '2026-12-01' and is_reconcile from transactions where id = (r->>'transaction_id')::uuid), 'an adjustment is dated now';

  -- step 4: MC-40 duplicates (EC-MC19 other account not flagged, 10 minute window), MC-41 large (EC-MC22, EC-MC23), MC-42 auto one-offs
  insert into transactions (client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, occurred_at, source) values
    (gen_random_uuid(), 'expense', 420, monzo, eat, py, '2026-11-10', '2026-11-10 08:14', 'app'),
    (gen_random_uuid(), 'expense', 420, monzo, eat, py, '2026-11-10', '2026-11-10 08:16', 'app'),
    (gen_random_uuid(), 'expense', 420, monzo, eat, py, '2026-11-10', '2026-11-10 08:40', 'app'),     -- 24 minutes later: not part of it
    (gen_random_uuid(), 'expense', 420, cash, eat, py, '2026-11-10', '2026-11-10 08:15', 'app');       -- another account: not flagged (EC-MC19)
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert jsonb_array_length(r->'duplicates') = 1 and jsonb_array_length(r->'duplicates'->0->'txns') = 2, 'MC-40 one pair: same account, amount and payee within 10 minutes (EC-MC19)';
  select (r->'duplicates'->0->'txns'->0->>'id')::uuid, (r->'duplicates'->0->'txns'->1->>'id')::uuid into t1, t2;
  perform close_answer('2026-11-01', 'duplicate', r->'duplicates'->0->>'key', 'both_real', null, '2026-12-01');
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert jsonb_array_length(r->'duplicates') = 1 and r->'duplicates'->0->>'answer' = 'both_real', 'EC-MC20 Both are real is remembered: the pair is answered, never open again';
  assert (select count(*) from jsonb_array_elements(month_close_checks('2026-11-01', '2026-12-05')->'duplicates') x where x->>'answer' is null) = 0, 'EC-MC20 including on a later look';
  -- EC-MC21 deleting one and undoing it brings the pair back
  perform close_answer('2026-11-01', 'duplicate', r->'duplicates'->0->>'key', 'reset', null, '2026-12-01');
  update transactions set deleted_at = now() where id = t2;
  assert jsonb_array_length(month_close_checks('2026-11-01', '2026-12-01')->'duplicates') = 0, 'EC-MC21 a deleted duplicate is gone from the list';
  update transactions set deleted_at = null where id = t2;
  assert jsonb_array_length(month_close_checks('2026-11-01', '2026-12-01')->'duplicates') = 1, 'EC-MC21 undo: the pair reappears';
  perform close_answer('2026-11-01', 'duplicate', month_close_checks('2026-11-01', '2026-12-01')->'duplicates'->0->>'key', 'both_real', null, '2026-12-01');

  -- large purchases: five £30 shopping tickets in October make the threshold £100 (3 x £30 = £90)
  for d in select generate_series('2026-10-05'::date, '2026-10-25'::date, interval '5 days')::date loop
    insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 3000, monzo, shop, d, 'app');
  end loop;
  insert into transactions (client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on, occurred_at, source) values (gen_random_uuid(), 'expense', 11800, monzo, shop, py2, '2026-11-25', '2026-11-25 14:00', 'app') returning id into tx;
  assert not (select is_one_off from transactions where id = tx), 'the app does not flag £118 on its own';
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert exists (select 1 from jsonb_array_elements(r->'large') x where (x->>'id')::uuid = tx), 'MC-41 £118 is above max(£100, 3 x the £30 median)';
  -- EC-MC22 a category with fewer than 5 tickets needs £250; EC-MC23 a trip-tagged purchase is not listed
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source)
    select gen_random_uuid(), 'expense', a, monzo, (select id from categories where name = 'Transport' and parent_id is null), '2026-11-12', 'app' from unnest(array[20000, 25000]) a;
  r := month_close_checks('2026-11-01', '2026-12-01');
  assert not exists (select 1 from jsonb_array_elements(r->'large') x where (x->>'amount_pence')::bigint = 20000) and exists (select 1 from jsonb_array_elements(r->'large') x where (x->>'amount_pence')::bigint = 25000),
    'EC-MC22 with fewer than 5 past tickets the threshold is £250 (an exact £250.00 is above the threshold and below the automatic flag)';
  insert into trips (name, currency, start_on, end_on) values ('Rome', 'EUR', '2026-11-20', '2026-11-24') returning id into item;
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source, trip_id) values (gen_random_uuid(), 'expense', 40000, monzo, shop, '2026-11-21', 'app', item);
  assert not exists (select 1 from jsonb_array_elements(month_close_checks('2026-11-01', '2026-12-01')->'large') x where (x->>'amount_pence')::bigint = 40000), 'EC-MC23 a trip purchase is not listed';
  -- answering is the owner's choice and an automatic re-flag never overrides it
  perform close_answer('2026-11-01', 'large', tx::text, 'normal', null, '2026-12-01');
  assert (select is_one_off = false and one_off_source = 'user' from transactions where id = tx), 'MC-41 It''s normal spending is recorded as the owner''s choice';
  update transactions set amount_pence = 90000 where id = tx;
  assert (select is_one_off = false and one_off_source = 'user' from transactions where id = tx), 'an automatic re-flag does not override it';
  update transactions set amount_pence = 11800 where id = tx;
  -- MC-42 automatic one-offs
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 300000, monzo, eat, '2026-11-18', 'app') returning id into tx2;
  assert (select is_one_off and one_off_source = 'auto' from transactions where id = tx2), 'a very large expense is flagged automatically';
  assert exists (select 1 from jsonb_array_elements(month_close_checks('2026-11-01', '2026-12-01')->'one_offs') x where (x->>'id')::uuid = tx2), 'MC-42 and listed';
  perform close_answer('2026-11-01', 'one_off', tx2::text, 'keep', null, '2026-12-01');
  assert (select one_off_source = 'user' and is_one_off from transactions where id = tx2), 'Keep as one-off is the owner''s choice';
  delete from transactions where id = tx2;
  delete from transactions where amount_pence in (20000, 25000, 40000) and type = 'expense';

  -- step 5: the review (MC-50) from the existing functions; a budget, a limit, income and snapshots
  insert into budgets (category_id, amount_pence, effective_from) values (null, 440000, '2026-10-01');
  insert into budgets (category_id, amount_pence, effective_from) values (eat, 40000, '2026-10-01');
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'income', 538000, monzo, sal, '2026-11-25', 'app');
  s := month_close_summary('2026-11-01', '2026-12-01');
  assert (s->>'spent')::bigint = (select sum(amount_pence) from transactions where type = 'expense' and deleted_at is null and occurred_on between '2026-11-01' and '2026-11-30'), 'the month''s spend is the sum of its expenses';
  assert (select sum(v::bigint) from jsonb_each_text(s->'by_l1') e(k, v)) = (s->>'spent')::bigint, 'the categories add up to the total';
  assert (s->>'income')::bigint = 538000 + 170000 and (s->>'kept')::bigint = (s->>'income')::bigint - (s->>'spent')::bigint, 'money in (the salary and the income the close added for the card) and kept';
  assert (s->>'budget')::bigint = 440000 and s->>'budget_status' = case when (s->>'spent')::bigint <= 440000 then 'within' else 'over' end, 'budget and status';
  assert (select (x->>'limit')::bigint from jsonb_array_elements(s->'limits') x where (x->>'category_id')::uuid = eat) = 40000, 'limits come with the month';
  assert (s->>'everyday')::bigint > 0 and (s->>'usual_estimate') is null and jsonb_array_length(s->'forecasts') = 0, 'EC-MC26 with no forecast snapshots there is no usual and no forecast table';
  insert into forecast_snapshots (day, scope, point_pence, usual_per_day_pence) values ('2026-11-01', 'all', 413871, 6114), ('2026-11-08', 'all', 402978, 6000), ('2026-11-22', 'all', 412425, 6200);
  s := month_close_summary('2026-11-01', '2026-12-01');
  assert (s->>'usual_estimate')::bigint = 6114 * 30, 'usual is the forecast''s usual per day on the 1st times the days in the month';
  assert (select array_agg((x->>'snapshot_day') order by x->>'date') from jsonb_array_elements(s->'forecasts') x) = array['2026-11-01', '2026-11-08', '2026-11-08', '2026-11-22'],
    'EC-MC26 the 15th has no snapshot, so the nearest earlier one (the 8th) is used';

  -- step 6 / closing: a skipped step makes it closed_with_skips (EC-MC8)
  perform close_set_step('2026-11-01', 'missing_days', 'done', '2026-12-01');
  perform close_set_step('2026-11-01', 'bills', 'skipped', '2026-12-01');
  perform close_set_step('2026-11-01', 'balances', 'done', '2026-12-01');
  perform close_set_step('2026-11-01', 'tidy_up', 'done', '2026-12-01');
  perform close_set_step('2026-11-01', 'review', 'done', '2026-12-01');
  perform close_set_step('2026-11-01', 'next_month', 'done', '2026-12-01');
  -- everything so far happened "now" inside this one transaction; age it so that "since the close" means something
  reset role;
  set local session_replication_role = replica;
  update transactions set created_at = now() - interval '2 days', updated_at = now() - interval '2 days' where user_id = u;
  set local session_replication_role = origin;
  perform pg_temp.as_user(u); set local role authenticated;
  mc := close_month('2026-11-01', '2026-12-01');
  reset role; update month_closes set closed_at = now() - interval '1 hour' where user_id = u and month = '2026-11-01'; perform pg_temp.as_user(u); set local role authenticated;
  select * into mc from month_closes where month = '2026-11-01';
  assert mc.status = 'closed_with_skips' and mc.snapshot->'skipped_steps' = '["bills"]'::jsonb, 'EC-MC8 a skipped step closes the month as closed_with_skips';
  snap := mc.snapshot;
  assert snap->>'v' = '1' and snap->>'month' = '2026-11-01' and (snap->>'spent')::bigint = (s->>'spent')::bigint and snap ? 'by_l1' and snap ? 'limits' and snap ? 'forecasts' and snap ? 'balances' and snap ? 'fixes' and snap ? 'closed_at',
    '§10.1 the snapshot has the documented shape';
  assert (snap->'fixes'->>'days_no_spend')::int = 1 and (snap->'fixes'->>'days_not_tracked')::int = 1 and (snap->'fixes'->>'bills_confirmed')::int = 2 and (snap->'fixes'->>'one_offs_changed')::int = 2, 'the fixes are counted';
  assert jsonb_array_length(snap->'balances') = 4 and exists (select 1 from jsonb_array_elements(snap->'balances') b where b->>'resolution' = 'untracked_spend' and (b->>'difference')::bigint = -2000), 'the balances checked, with the cash difference';
  assert mc.snapshot_rev = 1 and mc.closed_at is not null and mc.duration_s is not null and not mc.changed_since_close, 'closed once, duration recorded';
  -- EC-MC28 closing again returns the same snapshot
  assert (close_month('2026-11-01', '2026-12-01')).closed_at = mc.closed_at and (close_month('2026-11-01', '2026-12-01')).snapshot_rev = 1, 'EC-MC28 a second close returns the existing snapshot';

  -- EC-MC29 / 30 changes after closing are tracked, never blocked
  assert not (select changed_since_close from month_closes where month = '2026-11-01'), 'unchanged since close';
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 999, monzo, groc, '2026-11-03', 'app') returning id into tx2;
  assert (select changed_since_close and last_changed_at is not null from month_closes where month = '2026-11-01'), 'EC-MC29 adding to a closed month flags it';
  update transactions set amount_pence = 1999 where id = tx2;
  r := close_changes('2026-11-01', '2026-12-01');
  assert (r->>'difference')::bigint = 1999 and exists (select 1 from jsonb_array_elements(r->'transactions') x where x->>'kind' = 'added'), 'MC-71 the changes: the difference in spend and the transaction added';
  assert jsonb_array_length(r->'categories') = 1, 'and the category that moved';
  mc := update_close_snapshot('2026-11-01', '2026-12-01');
  assert mc.snapshot_rev = 2 and not mc.changed_since_close and mc.closed_at is not null and (mc.snapshot->>'spent')::bigint = (s->>'spent')::bigint + 1999, 'MC-71 Update the snapshot: revision 2, flag cleared, closed_at kept';
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 500, monzo, groc, '2026-12-03', 'app');
  assert not (select changed_since_close from month_closes where month = '2026-11-01'), 'a December entry does not flag November';
  insert into transactions (client_id, type, amount_pence, account_id, category_id, occurred_on, source) values (gen_random_uuid(), 'expense', 300, monzo, groc, '2026-11-28', 'recurring');
  assert (select changed_since_close from month_closes where month = '2026-11-01'), 'EC-MC30 a bill caught up into a closed month flags it too';
  update transactions set deleted_at = now() where id = tx2;
  assert (close_changes('2026-11-01', '2026-12-01')->>'difference')::bigint = 300 - 1999, 'deleting is tracked as well: the £300 bill added and the £19.99 entry removed since the snapshot was updated';

  -- EC-MC34 a limit changed for next month leaves the closing month's snapshot as it was
  insert into budgets (category_id, amount_pence, effective_from) values (eat, 45000, '2026-12-01');
  assert (select (x->>'limit')::bigint from jsonb_array_elements((select snapshot from month_closes where month = '2026-11-01')->'limits') x where (x->>'category_id')::uuid = eat) = 40000, 'EC-MC34 the snapshot keeps the limit the month had';

  -- reopening (MC-72) and closing again; EC-MC31 reopening after a later month closed; EC-MC32 close without review
  mc := reopen_month('2026-11-01', '2026-12-01');
  assert mc.status = 'in_progress' and (select count(*) from month_close_answers where month = '2026-11-01') > 0, 'MC-72 reopening keeps the answers as defaults';
  mc := close_month('2026-11-01', '2026-12-01');
  assert mc.reopened_count = 1 and mc.status = 'closed_with_skips' and mc.snapshot_rev = 1, 'MC-72 closing again replaces the snapshot and counts the reopening';
  mc := close_month('2026-10-01', '2026-12-01', true);
  assert mc.status = 'closed_quick' and mc.snapshot is not null and (select count(*) from month_close_answers where month = '2026-10-01') = 0, 'EC-MC32 Close without review: closed_quick, snapshot as it stands, no answers';
  mc := reopen_month('2026-10-01', '2026-12-01');
  assert mc.status = 'in_progress' and (select status from month_closes where month = '2026-11-01') = 'closed_with_skips', 'EC-MC31 reopening an older month does not touch the newer one';

  -- month_close_state: the first month ever offered is the latest completed one (MC-04)
  r := month_close_state('2026-12-01');
  assert (r->>'since') = '2026-11-01' and (select (x->>'prompted')::boolean from jsonb_array_elements(r->'months') x where x->>'month' = '2026-11-01') and
         not (select (x->>'prompted')::boolean from jsonb_array_elements(r->'months') x where x->>'month' = '2026-10-01'), 'MC-04 only the most recent completed month is prompted on first release';
  assert (r->>'closed_count')::int = 1, 'the running count of months closed';
  reset role;
end $$;
