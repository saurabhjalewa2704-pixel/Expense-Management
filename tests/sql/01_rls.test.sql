-- RLS: a second user can read and change nothing of the first user's, on every table (PRD §10.3, §16).
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc uuid; cat uuid; run uuid; rec uuid; n int; t text; denied boolean;
begin
  -- every public table has RLS switched on
  assert not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity),
    'a public table has RLS disabled: ' || (select string_agg(tablename, ',') from pg_tables where schemaname = 'public' and not rowsecurity);

  insert into auth.users (id, email) values (ua, 'a@test.local'), (ub, 'b@test.local');
  assert (select count(*) from profiles where id in (ua, ub)) = 2, 'profiles are created by trigger';
  assert (select count(*) from categories where user_id = ua) = 69, 'default taxonomy: 12 parents + 50 subs + 7 income';

  -- user A writes one row into every table that can be written by hand
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('A current', 'current', 100000, '2026-01-01') returning id into acc;
  select id into cat from categories where name = 'Groceries' and parent_id is null;
  perform create_transaction(gen_random_uuid(), 'expense', 1250, acc, null, cat, 'Tesco', null, '{}', '2026-02-01');
  insert into budgets (category_id, amount_pence, starts_on) values (cat, 50000, '2026-02-01');
  insert into recurring_items (type, amount_pence, account_id, category_id, frequency, day_of_month, starts_on, next_due_on)
    values ('expense', 5000, acc, cat, 'monthly', 1, '2026-03-01', '2026-03-01') returning id into rec;
  insert into recurring_occurrences (item_id, due_on, scheduled_on, status, amount_pence) values (rec, '2026-03-01', '2026-03-01', 'skipped', 5000);
  insert into recurring_dismissed (payee_id) select id from payees limit 1;
  insert into api_tokens (name, token_hash) values ('t', 'hash-a');
  insert into push_subscriptions (endpoint, p256dh, auth) values ('https://push.example/a', 'p', 'a');
  insert into no_spend_days (day) values ('2026-02-02');
  insert into pots (name) values ('Home purchase');
  insert into ask_turns (question, answer, model) values ('q', 'a', 'x');
  reset role;
  insert into insight_runs (user_id, scope, period_start, period_end, facts, cards, model)
    values (ua, 'weekly', '2026-02-02', '2026-02-08', '{}', '[]', 'x') returning id into run;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into insight_feedback (run_id, card_key, card_type, action) values (run, 'k', 'pace', 'helpful');
  assert (select count(*) from transactions) = 1, 'A sees own transaction';
  reset role;

  -- user B sees nothing, anywhere
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach t in array array['accounts','payees','transactions','recurring_items','recurring_occurrences','recurring_dismissed','budgets','insight_runs',
                           'insight_feedback','api_tokens','push_subscriptions','no_spend_days','pots','ask_turns'] loop
    execute format('select count(*) from %I', t) into n;
    assert n = 0, 'B can read ' || t;
  end loop;
  assert (select count(*) from profiles) = 1 and (select id from profiles) = ub, 'B sees only own profile';
  assert (select count(*) from categories where user_id = ua) = 0, 'B cannot read A categories';
  assert (select count(*) from txn_effects) = 0, 'view is security invoker';
  assert available_cash() = 0, 'available_cash ignores other users';
  assert (select count(*) from account_balances()) = 0, 'balances ignore other users';
  assert (select count(*) from list_transactions()) = 0, 'activity list ignores other users';
  assert (select count(*) from spend_by_category('2026-01-01', '2026-12-31')) = 0, 'analytics ignore other users';

  -- B cannot change or delete A's rows
  update accounts set name = 'hacked' where id = acc; get diagnostics n = row_count; assert n = 0, 'B updated A account';
  delete from accounts where id = acc; get diagnostics n = row_count; assert n = 0, 'B deleted A account';
  update transactions set note = 'x'; get diagnostics n = row_count; assert n = 0, 'B updated A txn';

  -- B cannot insert as A, and cannot hang a transaction off A's account or category
  denied := false;
  begin insert into accounts (user_id, name, type) values (ua, 'planted', 'current'); exception when others then denied := true; end;
  assert denied, 'B inserted a row owned by A';
  denied := false;
  begin perform create_transaction(gen_random_uuid(), 'expense', 100, acc, null, cat, null, null, '{}', '2026-02-03'); exception when others then denied := true; end;
  assert denied, 'B attached a transaction to A account';
  reset role;

  -- anon (no session) has no access to the data API at all
  set local role anon;
  denied := false;
  begin perform count(*) from accounts; exception when insufficient_privilege then denied := true; end;
  assert denied, 'anon can read accounts';
  denied := false;
  begin perform available_cash(); exception when insufficient_privilege then denied := true; end;
  assert denied, 'anon can call available_cash';
  reset role;
end $$;
