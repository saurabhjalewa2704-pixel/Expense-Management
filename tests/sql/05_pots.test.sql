-- One-off pots: real money (balances, available cash) but never usual spending (analytics, pace, insights); isolated per user.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc uuid; groceries uuid; legal uuid; pot uuid; r record; before_cash bigint;
begin
  insert into auth.users (id, email) values (ua, 'pa@test.local'), (ub, 'pb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Current', 'current', 10000000, '2026-01-01') returning id into acc;
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  select id into legal from categories where name = 'Home' and parent_id is null;
  insert into pots (name, target_pence) values ('Home purchase', 5000000) returning id into pot;

  -- regular spending: £100 groceries on 5 Oct, and £60 on 8 Sep (history)
  perform create_transaction(gen_random_uuid(), 'expense', 10000, acc, null, groceries, 'Tesco', null, '{}', '2026-10-05');
  perform create_transaction(gen_random_uuid(), 'expense', 6000, acc, null, groceries, 'Tesco', null, '{}', '2026-09-08');
  before_cash := available_cash('2026-10-18');
  -- one-off: stamp duty £12,500 and a gift towards the deposit £2,000, both in the pot
  perform create_transaction(gen_random_uuid(), 'expense', 1250000, acc, null, legal, 'HMRC', null, '{}', '2026-10-10', null, 'app', false, false, pot);
  perform create_transaction(gen_random_uuid(), 'income', 200000, acc, null, (select id from categories where kind = 'income' limit 1), 'Mum', null, '{}', '2026-10-11', null, 'app', false, false, pot);

  -- real money: balances and available cash move
  assert available_cash('2026-10-18') = before_cash - 1250000 + 200000, 'pot transactions must move available cash';
  assert (select balance_pence from account_balances('2026-10-18') where account_id = acc) = 10000000 - 10000 - 6000 - 1250000 + 200000;

  -- the cash equation still balances, with the pot as its own term
  select * into r from cash_flow('2026-10-01', '2026-10-18');
  assert r.spend_pence = 10000 and r.income_pence = 0, 'income/spend exclude the pot: ' || r::text;
  assert r.pot_pence = -1050000, 'pot net is -12,500 + 2,000: ' || r.pot_pence;
  assert r.opening_pence + r.income_pence - r.spend_pence + r.pot_pence + r.set_aside_pence + r.adjust_pence = r.closing_pence, 'equation balances';

  -- usual-spending analytics never see it
  assert (select sum(total_pence) from spend_by_category('2026-10-01', '2026-10-18')) = 10000, 'spend_by_category';
  assert not exists (select 1 from spend_by_category('2026-10-01', '2026-10-18') where name = 'Home'), 'no Home spend';
  assert (select max(cumulative_pence) from daily_spend('2026-10-01', '2026-10-18')) = 10000, 'daily_spend';
  select * into r from month_pace('2026-10-18');
  assert r.spend_pence = 10000, 'month_pace spend: ' || r.spend_pence;
  assert (select spend_pence from monthly_totals(2) order by month desc limit 1) = 10000, 'monthly_totals spend';
  assert (select income_pence from monthly_totals(2) order by month desc limit 1) = 0, 'monthly_totals income';
  assert not exists (select 1 from top_payees('2026-10-01', '2026-10-18') where name = 'HMRC'), 'top_payees';
  assert not exists (select 1 from top_transactions('2026-10-01', '2026-10-18', 10) where amount_pence = 1250000), 'top_transactions';
  assert not exists (select 1 from new_payees('2026-10-01', '2026-10-18') where name = 'HMRC'), 'new_payees';
  assert not exists (select 1 from category_period_history('2026-10-01', '2026-10-18', 3) where name = 'Home'), 'category_period_history';
  assert (select coalesce(sum(total_pence), 0) from category_monthly(legal, 3)) = 0, 'category_monthly';

  -- Activity shows them, with the pot, and can filter
  assert (select count(*) from list_transactions()) = 4, 'ledger shows everything';
  assert (select pot_name from list_transactions(p_q => 'HMRC')) = 'Home purchase';
  assert (select count(*) from list_transactions(p_pots => 'only')) = 2, 'only pots';
  assert (select count(*) from list_transactions(p_pots => 'exclude')) = 2, 'exclude pots';
  assert (select count(*) from list_transactions(p_pot_id => pot)) = 2, 'one pot';
  select * into r from transaction_totals();
  assert r.spend_pence = 16000 and r.income_pence = 0 and r.pot_pence = -1050000, 'totals split: ' || r::text;

  -- the pot's own figures
  select * into r from pot_summary(pot);
  assert r.spent_pence = 1250000 and r.received_pence = 200000 and r.net_pence = 1050000 and r.txn_count = 2, 'pot_summary: ' || r::text;
  assert (select count(*) from pot_by_category(pot)) = 1 and (select total_pence from pot_by_category(pot)) = 1250000;
end $$;

do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc uuid; accb uuid; cat uuid; pota uuid; potb uuid; denied boolean; tx transactions; n int;
begin
  insert into auth.users (id, email) values (ua, 'qa@test.local'), (ub, 'qb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('A', 'current', 1000000, '2026-01-01') returning id into acc;
  select id into cat from categories where name = 'Groceries' and parent_id is null;
  insert into pots (name) values ('A pot') returning id into pota;
  -- a transfer is never a pot transaction: the RPC drops the pot, and a direct insert is refused
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('A savings', 'savings', 0, '2026-01-01') returning id into accb;
  tx := create_transaction(gen_random_uuid(), 'transfer', 100, acc, accb, null, null, null, '{}', '2026-02-02', null, 'app', false, false, pota);
  assert tx.pot_id is null, 'transfers are never pot transactions';
  denied := false;
  begin update transactions set pot_id = pota where id = tx.id; exception when check_violation then denied := true; end;
  assert denied, 'a transfer cannot be put in a pot directly';
  reset role;

  -- user B: cannot see A's pot, cannot put a transaction in it, cannot touch it
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('B', 'current', 1000000, '2026-01-01') returning id into accb;
  select id into cat from categories where name = 'Groceries' and parent_id is null and user_id = ub;
  assert (select count(*) from pots) = 0, 'B sees A pots';
  assert (select count(*) from pot_summary()) = 0, 'B pot_summary';
  denied := false;
  begin perform create_transaction(gen_random_uuid(), 'expense', 100, accb, null, cat, null, null, '{}', '2026-02-03', null, 'app', false, false, pota); exception when others then denied := true; end;
  assert denied, 'B put a transaction in A pot';
  update pots set name = 'hacked' where id = pota; get diagnostics n = row_count; assert n = 0, 'B renamed A pot';
  delete from pots where id = pota; get diagnostics n = row_count; assert n = 0, 'B deleted A pot';
  denied := false;
  begin insert into pots (user_id, name) values (ua, 'planted'); exception when others then denied := true; end;
  assert denied, 'B inserted a pot for A';
  insert into pots (name) values ('B pot') returning id into potb;
  reset role;

  -- closed pots take no new transactions, but history stays editable; pots with history cannot be deleted
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into cat from categories where name = 'Groceries' and parent_id is null and user_id = ua;
  tx := create_transaction(gen_random_uuid(), 'expense', 500, acc, null, cat, null, null, '{}', '2026-02-03', null, 'app', false, false, pota);
  assert tx.pot_id = pota;
  denied := false;
  begin delete from pots where id = pota; exception when foreign_key_violation then denied := true; end;
  assert denied, 'a pot with transactions cannot be deleted';
  update pots set closed_at = now() where id = pota;
  denied := false;
  begin perform create_transaction(gen_random_uuid(), 'expense', 500, acc, null, cat, null, null, '{}', '2026-02-04', null, 'app', false, false, pota); exception when check_violation then denied := true; end;
  assert denied, 'a closed pot takes no new transactions';
  perform update_transaction(tx.id, 'expense', 700, acc, null, cat, null, null, '{}', '2026-02-03', null, pota);
  assert (select amount_pence from transactions where id = tx.id) = 700, 'history in a closed pot can still be edited';
  perform update_transaction(tx.id, 'expense', 700, acc, null, cat, null, null, '{}', '2026-02-03', null, null);
  assert (select pot_id from transactions where id = tx.id) is null, 'a transaction can leave a pot';

  -- a duplicate pot name is refused; wiping data removes pots
  denied := false;
  begin insert into pots (name) values (' a POT '); exception when unique_violation then denied := true; end;
  assert denied, 'pot names are unique per user';
  perform delete_all_my_data();
  assert (select count(*) from pots) = 0, 'delete_all_my_data removes pots';
  reset role;
end $$;

-- largest_transactions: usual spending only, biggest first, limited; ask_turns are private per user.
do $$
declare ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); acc uuid; cat uuid; pot uuid; n int; denied boolean;
begin
  insert into auth.users (id, email) values (ua, 'ra@test.local'), (ub, 'rb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('A', 'current', 10000000, '2026-01-01') returning id into acc;
  select id into cat from categories where name = 'Groceries' and parent_id is null;
  insert into pots (name) values ('P') returning id into pot;
  perform create_transaction(gen_random_uuid(), 'expense', 3000, acc, null, cat, 'Small', null, '{}', '2026-10-02');
  perform create_transaction(gen_random_uuid(), 'expense', 9000, acc, null, cat, 'Big', null, '{}', '2026-10-03');
  perform create_transaction(gen_random_uuid(), 'expense', 900000, acc, null, cat, 'Deposit', null, '{}', '2026-10-04', null, 'app', false, false, pot);
  assert (select count(*) from largest_transactions('2026-10-01', '2026-10-31', 10)) = 2, 'pot transactions are not usual spending';
  assert (select payee_name from largest_transactions('2026-10-01', '2026-10-31', 10) limit 1) = 'Big', 'biggest first';
  assert (select count(*) from largest_transactions('2026-10-01', '2026-10-31', 1)) = 1, 'limit';
  insert into ask_turns (question, answer, model, facts) values ('How much?', 'About that much.', 'x', '[{"label":"a","display":"£1.00"}]');
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from ask_turns) = 0, 'B sees A questions';
  update ask_turns set answer = 'x'; get diagnostics n = row_count; assert n = 0, 'B edited A turns';
  delete from ask_turns; get diagnostics n = row_count; assert n = 0, 'B deleted A turns';
  denied := false;
  begin insert into ask_turns (user_id, question, answer, model) values (ua, 'q', 'a', 'm'); exception when others then denied := true; end;
  assert denied, 'B inserted a turn for A';
  assert (select count(*) from largest_transactions('2026-01-01', '2026-12-31', 10)) = 0, 'B sees A transactions';
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform delete_all_my_data();
  assert (select count(*) from ask_turns) = 0, 'delete_all_my_data removes ask turns';
  reset role;
end $$;
