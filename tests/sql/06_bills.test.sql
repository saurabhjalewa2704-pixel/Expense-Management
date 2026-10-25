-- Bills (PRD §6.9): logging is atomic and at-most-once, estimates, skips, reminders, duplicates, suggestions, isolation.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc uuid; acc2 uuid; streaming uuid; energy uuid; it uuid; it2 uuid; itv uuid; pay uuid; r record; o uuid; n int; denied boolean; t uuid;
begin
  insert into auth.users (id, email) values (ua, 'ba@test.local'), (ub, 'bb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Amex', 'credit_card', 0, '2026-01-01') returning id into acc;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Savings', 'savings', 0, '2026-01-01') returning id into acc2;
  select id into streaming from categories where name = 'Streaming & apps';
  select id into energy from categories where name = 'Energy';
  insert into payees (name) values ('Netflix') returning id into pay;
  insert into recurring_items (type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
    values ('expense', 1299, acc, streaming, pay, 'monthly', 27, '2026-10-27', '2026-10-27') returning id into it;
  reset role;

  -- 1 · the engine (service role) logs one transaction, and a re-run logs nothing
  select * into r from recurring_log(it, '2026-10-27', '2026-10-27', '2026-11-27');
  assert r.status = 'logged' and r.amount_pence = 1299 and r.transaction_id is not null, 'logged: ' || r::text;
  assert (select count(*) from recurring_log(it, '2026-10-27', '2026-10-27', '2026-11-27')) = 0, 'a re-run creates nothing';
  assert (select count(*) from transactions where recurring_id = it) = 1, 'exactly one transaction';
  assert (select occurred_on from transactions where recurring_id = it) = '2026-10-27' and (select source from transactions where recurring_id = it) = 'recurring';
  assert (select next_due_on from recurring_items where id = it) = '2026-11-27', 'next_due_on moved on';
  assert (select count(*) from recurring_occurrences where item_id = it) = 1;

  -- 4 · catch-up: three missed days are logged with their original dates
  select * into r from recurring_log(it, '2026-11-27', '2026-11-27', '2026-12-27');
  assert r.status = 'logged';
  assert (select array_agg(occurred_on order by occurred_on) from transactions where recurring_id = it) = array['2026-10-27', '2026-11-27']::date[];

  -- 5 · a varying bill: first at the rule's amount as an estimate, then the last confirmed amount
  set local role authenticated;
  insert into recurring_items (type, amount_pence, amount_varies, account_id, category_id, frequency, day_of_month, starts_on, next_due_on)
    values ('expense', 4000, true, acc, energy, 'monthly', 5, '2026-10-05', '2026-10-05') returning id into itv;
  reset role;
  select * into r from recurring_log(itv, '2026-10-05', '2026-10-05', '2026-11-05');
  assert r.status = 'estimate' and r.amount_pence = 4000 and (select is_estimate from transactions where id = r.transaction_id), 'estimate: ' || r::text;
  o := r.occurrence_id;
  set local role authenticated;
  perform recurring_resolve(o, 'confirm', 4840);                                 -- "Change amount" via confirm
  reset role;
  assert (select amount_pence from transactions where recurring_id = itv) = 4840 and not (select is_estimate from transactions where recurring_id = itv);
  assert (select status from recurring_occurrences where id = o) = 'confirmed';
  select * into r from recurring_log(itv, '2026-11-05', '2026-11-05', '2026-12-05');
  assert r.status = 'estimate' and r.amount_pence = 4840, 'next estimate is the last confirmed amount';
  -- editing the amount of an estimate transaction confirms it, too (CAP-04 "Change amount")
  set local role authenticated;
  update transactions set amount_pence = 5110 where id = r.transaction_id;
  reset role;
  assert (select status from recurring_occurrences where transaction_id = r.transaction_id) = 'confirmed' and
         not (select is_estimate from transactions where id = r.transaction_id), 'editing an estimate confirms it';
  assert (select amount_pence from recurring_log(itv, '2026-12-05', '2026-12-05', '2027-01-05')) = 5110;

  -- 6 · skip the next one: nothing is logged for it
  set local role authenticated;
  perform recurring_skip(it, '2026-12-27', '2026-12-27', '2027-01-27');
  reset role;
  assert (select count(*) from recurring_log(it, '2026-12-27', '2026-12-27', '2027-01-27')) = 0, 'a skipped occurrence is never logged';
  assert (select status from recurring_occurrences where item_id = it and scheduled_on = '2026-12-27') = 'skipped';
  assert (select count(*) from transactions where recurring_id = it) = 2;

  -- 7 · paused rules generate nothing
  update recurring_items set paused_at = now() where id = it;
  assert (select count(*) from recurring_log(it, '2027-01-27', '2027-01-27', '2027-02-27')) = 0, 'paused';
  update recurring_items set paused_at = null where id = it;

  -- remind mode: a pending occurrence with no transaction, then Log it / Skip
  set local role authenticated;
  insert into recurring_items (type, amount_pence, account_id, category_id, frequency, day_of_month, auto_log, starts_on, next_due_on)
    values ('expense', 2500, acc, streaming, 'monthly', 10, false, '2026-10-10', '2026-10-10') returning id into it2;
  reset role;
  select * into r from recurring_log(it2, '2026-10-10', '2026-10-10', '2026-11-10');
  assert r.status = 'pending' and r.transaction_id is null, 'remind mode makes no transaction';
  set local role authenticated;
  perform recurring_resolve(r.occurrence_id, 'log', null);
  reset role;
  assert (select status from recurring_occurrences where id = r.occurrence_id) = 'logged' and (select count(*) from transactions where recurring_id = it2) = 1;
  select * into r from recurring_log(it2, '2026-11-10', '2026-11-10', '2026-12-10');
  set local role authenticated;
  perform recurring_resolve(r.occurrence_id, 'skip', null);
  reset role;
  assert (select status from recurring_occurrences where id = r.occurrence_id) = 'skipped' and (select count(*) from transactions where recurring_id = it2) = 1;

  -- an archived account makes it pending instead of failing
  update accounts set archived_at = now() where id = acc2;
  insert into recurring_items (user_id, type, amount_pence, account_id, counter_account_id, frequency, day_of_month, starts_on, next_due_on)
    values (ua, 'transfer', 50000, acc2, acc, 'monthly', 26, '2026-10-26', '2026-10-26') returning id into t;
  select * into r from recurring_log(t, '2026-10-26', '2026-10-26', '2026-11-26');
  assert r.status = 'pending' and r.transaction_id is null, 'archived account → pending: ' || r::text;
  update accounts set archived_at = null where id = acc2;

  -- the rule ends when p_next is null
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, frequency, day_of_month, max_occurrences, starts_on, next_due_on)
    values (ua, 'expense', 100, acc, streaming, 'monthly', 1, 1, '2026-11-01', '2026-11-01') returning id into t;
  perform recurring_log(t, '2026-11-01', '2026-11-01', null);
  assert (select ended_at is not null from recurring_items where id = t), 'ended';
  assert (select count(*) from recurring_log(t, '2026-12-01', '2026-12-01', '2027-01-01')) = 0, 'ended rules log nothing';

  -- unskip, until the due date
  set local role authenticated;
  select id into o from recurring_occurrences where item_id = it and status = 'skipped';
  perform recurring_unskip(o);                                                    -- 27 Dec 2026 is still ahead: allowed
  assert not exists (select 1 from recurring_occurrences where id = o) and (select next_due_on from recurring_items where id = it) = '2026-12-27', 'unskipped';
  reset role;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, amount_pence) values (ua, it, '2020-01-27', '2020-01-27', 'skipped', 1299) returning id into o;
  set local role authenticated;
  denied := false; begin perform recurring_unskip(o); exception when others then denied := true; end;
  assert denied, 'a skip cannot be undone once its date has passed';
  reset role;

  -- 8 · editing the amount changes the next occurrence only
  update recurring_items set amount_pence = 1499 where id = it;
  assert (select amount_pence from recurring_log(it, '2027-01-27', '2027-01-27', '2027-02-27')) = 1499;
  assert (select amount_pence from transactions where recurring_id = it and occurred_on = '2026-10-27') = 1299, 'earlier transactions never change';

  -- 9 · deleting a rule keeps its transactions
  n := (select count(*) from transactions where recurring_id = it);
  delete from recurring_items where id = it;
  assert (select count(*) from transactions where amount_pence in (1299, 1499) and source = 'recurring') = n, 'transactions survive';
  assert (select count(*) from transactions where recurring_id is not null and source = 'recurring' and amount_pence in (1299, 1499)) = 0, 'recurring_id cleared';

  -- Activity filter and columns
  set local role authenticated;
  assert (select count(*) from list_transactions(p_recurring => true)) >= 1, 'the filter finds recurring transactions';
  assert (select count(*) from list_transactions(p_recurring => true)) + (select count(*) from list_transactions(p_recurring => false)) = (select count(*) from list_transactions()), 'true + false = all';
  assert (select bool_and(recurring_id is not null) from list_transactions(p_recurring => true)), 'recurring filter';
  assert (select count(*) from list_transactions(p_recurring => true)) = (select txn_count from transaction_totals(p_recurring => true)), 'totals use the same filter';
  reset role;

  -- 10 · duplicate guard (REC-08)
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
    values (ua, 'expense', 1299, acc, streaming, pay, 'monthly', 27, '2026-10-27', '2026-10-27');
  assert (select count(*) from recurring_duplicate(pay, '2026-10-25')) = 1 and (select count(*) from recurring_duplicate(pay, '2026-10-30')) = 1, '±3 days';
  assert (select count(*) from recurring_duplicate(pay, '2026-10-20')) = 0, 'outside the window';

  -- suggestions (REC-07): a payee seen monthly three times within ±10%, no rule yet; dismissed ones never return
  insert into payees (name) values ('Spotify') returning id into t;
  insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, payee_id, occurred_on)
    select ua, gen_random_uuid(), 'expense', 1199 + g, acc, streaming, t, (current_date - 90 + 30 * g)::date from generate_series(0, 2) g;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert exists (select 1 from recurring_suggestions() where payee_name = 'Spotify' and frequency = 'monthly'), 'monthly series is suggested';
  insert into recurring_dismissed (payee_id) values (t);
  assert not exists (select 1 from recurring_suggestions() where payee_name = 'Spotify'), 'dismissed suggestions never return';
  reset role;

  -- bank holidays: readable by users, writable only by the service role
  insert into bank_holidays values ('2026-12-25', 'Christmas Day'), ('2026-12-28', 'Boxing Day (substitute day)');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from bank_holidays) = 2;
  denied := false; begin insert into bank_holidays values ('2026-01-01', 'x'); exception when others then denied := true; end;
  assert denied, 'users cannot write bank holidays';
  denied := false; begin perform recurring_log(it2, '2026-12-10', '2026-12-10', '2027-01-10'); exception when others then denied := true; end;
  assert denied, 'users cannot call the engine';
  reset role;

  -- user B sees none of it and cannot resolve A's occurrences
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from recurring_items) = 0 and (select count(*) from recurring_occurrences) = 0 and (select count(*) from recurring_suggestions()) = 0;
  denied := false; begin perform recurring_resolve(o, 'confirm', 100); exception when others then denied := true; end;
  assert denied, 'B cannot resolve A occurrence';
  reset role;
end $$;
