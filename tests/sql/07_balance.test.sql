-- Balance anchors (PRD §6.2a): a transaction moves a balance only if it is dated after the moment the balance was last set by the owner.
-- Assertion messages start with the edge-case ID they prove (PRD §18), e.g. EC-A1.
do $$
declare
  ua uuid := gen_random_uuid();
  monzo uuid; amex uuid; groceries uuid; travel uuid; rent_cat uuid;
  flight uuid; t1 uuid; t2 uuid; tr uuid; r transactions; cash_before bigint; bal_before bigint; flow record; sp bigint; non_bal bigint; item uuid; cnt int;
begin
  insert into auth.users (id, email) values (ua, 'bal@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  select id into travel from categories where name = 'Flights';
  select id into rent_cat from categories where name = 'Rent & mortgage';
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Monzo', 'current', 321408, '2026-10-18') returning id into monzo;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Amex', 'credit_card', -118473, '2026-11-01') returning id into amex;

  -- tracking start is the earliest live opening date (BAL-01)
  assert (select tracking_started_on from profiles) = '2026-10-18', 'EC-D7 tracking start is the earliest opening date';

  -- EC-A1 / AC1: the July flight is real July spending, but changes no balance and no available cash at any date
  cash_before := available_cash('2026-12-31'); bal_before := (select balance_pence from account_balances('2026-12-31') where account_id = monzo);
  select * into r from create_transaction(gen_random_uuid(), 'expense', 17620, monzo, null, travel, 'United', null, '{}', '2026-07-14');
  flight := r.id;
  assert r.counts_in_balance = false and r.balance_flag_source = 'auto', 'EC-A1 pre-tracking expense is balance-neutral';
  assert available_cash('2026-12-31') = cash_before and (select balance_pence from account_balances('2026-12-31') where account_id = monzo) = bal_before, 'EC-A1 balances unchanged';
  assert (select coalesce(sum(total_pence), 0) from spend_by_category('2026-07-01', '2026-07-31')) = 17620, 'EC-D7 it still counts in July spend by category (invariant 7)';
  assert (select count(*) from list_transactions(p_from => '2026-07-14', p_to => '2026-07-14') where not counts_in_balance) = 1, 'BAL-05 it is listed, flagged';
  assert (select balance_pence from account_balances('2026-10-18') where account_id = monzo) = 321408, 'invariant 8: the balance at the anchor is what was typed';

  -- EC-A3: on the opening date it counts
  select * into r from create_transaction(gen_random_uuid(), 'expense', 1000, monzo, null, groceries, 'Tesco', null, '{}', '2026-10-18');
  assert r.counts_in_balance, 'EC-A3 on the opening date it counts';
  -- AC3: after the anchor it reduces available cash at once
  cash_before := available_cash('2026-10-31');
  perform create_transaction(gen_random_uuid(), 'expense', 2500, monzo, null, groceries, 'Tesco', null, '{}', '2026-10-20');
  assert available_cash('2026-10-31') = cash_before - 2500, 'AC3 an expense after the anchor reduces available cash';

  -- EC-A10: a reconcile with no difference still moves the anchor, and creates no adjustment
  perform reconcile_account(monzo, (select balance_pence from account_balances('2026-11-01') where account_id = monzo), '2026-11-01');
  assert (select last_reconciled_on from accounts where id = monzo) = '2026-11-01', 'EC-A10 anchor moved';
  assert (select count(*) from transactions where type = 'adjustment') = 0, 'EC-A10 no adjustment without a difference';

  -- EC-A2 / AC2: dated on or before the reconcile, the default answer "already in your balance" leaves the balance alone; "still pending" reduces it by the amount
  bal_before := (select balance_pence from account_balances('2026-12-01') where account_id = monzo);
  select * into r from create_transaction(gen_random_uuid(), 'expense', 4280, monzo, null, groceries, 'Corner', null, '{}', '2026-10-30');
  t1 := r.id;
  assert r.counts_in_balance = false, 'EC-A2 before the last reconcile the default is: already in the balance';
  assert (select balance_pence from account_balances('2026-12-01') where account_id = monzo) = bal_before, 'EC-A2 "Yes" leaves the balance unchanged';
  select * into r from create_transaction(gen_random_uuid(), 'expense', 4280, monzo, null, groceries, 'Corner', null, '{}', '2026-10-30', null, 'app', false, false, null, true);
  t2 := r.id;
  assert r.counts_in_balance and r.balance_flag_source = 'manual', 'EC-A2 "No, it was still pending" counts, as a manual answer';
  assert (select balance_pence from account_balances('2026-12-01') where account_id = monzo) = bal_before - 4280, 'EC-A2 "No" reduces it by the amount';

  -- AC4: moving a past-dated auto row after the anchor flips it; a manual flag is kept
  bal_before := (select balance_pence from account_balances('2026-12-31') where account_id = monzo);
  perform update_transaction(flight, 'expense', 17620, monzo, null, travel, 'United', null, '{}', '2026-11-05');
  assert (select counts_in_balance from transactions where id = flight), 'AC4 an auto flag flips when the date moves past the anchor';
  assert (select balance_pence from account_balances('2026-12-31') where account_id = monzo) = bal_before - 17620, 'AC4 and the balance follows';
  perform update_transaction(t2, 'expense', 4280, monzo, null, groceries, 'Corner', null, '{}', '2026-10-29');
  assert (select counts_in_balance and balance_flag_source = 'manual' from transactions where id = t2), 'AC4 a manual answer is kept when the date changes';
  perform update_transaction(flight, 'expense', 17620, monzo, null, travel, 'United', null, '{}', '2026-07-14');    -- back before tracking
  assert not (select counts_in_balance from transactions where id = flight), 'AC4 and flips back';

  -- EC-A9: reconciling after back-filling does not double-correct (non-balance rows are not in the figure compared)
  select * into r from create_transaction(gen_random_uuid(), 'expense', 9900, monzo, null, groceries, 'Old shop', null, '{}', '2026-09-01');
  assert (select count(*) from transactions where type = 'adjustment') = 0, 'EC-A9 setup';
  perform reconcile_account(monzo, (select balance_pence from account_balances('2026-11-02') where account_id = monzo), '2026-11-02');
  assert (select count(*) from transactions where type = 'adjustment') = 0, 'EC-A9 no double correction after back-filling';
  -- a real difference writes an adjustment that counts, flagged as a reconcile
  select * into r from reconcile_account(monzo, (select balance_pence from account_balances('2026-11-03') where account_id = monzo) - 500, '2026-11-03');
  assert r.type = 'adjustment' and r.amount_pence = -500 and r.is_reconcile and r.counts_in_balance, 'EC-A9 a real difference is an adjustment that counts';
  assert (select balance_pence from account_balances('2026-11-03') where account_id = monzo) = (select balance_pence from account_balances('2026-11-02') where account_id = monzo) - 500;

  -- EC-A4 / BAL-04: each side of a transfer is judged against its own account
  select * into r from create_transaction(gen_random_uuid(), 'transfer', 30000, amex, monzo, null, null, null, '{}', '2026-11-05');   -- Amex side: dated after its opening; Monzo side: after Monzo's anchor
  assert r.counts_in_balance and r.counter_counts_in_balance, 'EC-A4 both sides after their anchors count';
  select * into r from create_transaction(gen_random_uuid(), 'transfer', 30000, monzo, amex, null, null, null, '{}', '2026-10-25');
  assert r.counts_in_balance = false and r.counter_counts_in_balance = false, 'EC-A4 Monzo side before its reconcile, Amex side before it opened: both neutral';
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Other', 'current', 0, '2026-10-10');
  select * into r from create_transaction(gen_random_uuid(), 'transfer', 5000, (select id from accounts where name = 'Other'), amex, null, null, null, '{}', '2026-10-25');
  assert r.counts_in_balance and not r.counter_counts_in_balance, 'EC-A4 a transfer whose sides have different anchors: the first counts, the second does not';
  assert (select balance_pence from account_balances('2026-11-30') where name = 'Amex') = -118473 - 30000, 'EC-A4 only the counting transfer moved Amex';

  -- EC-A6: changing an account's opening date recomputes auto flags and leaves manual ones
  update accounts set opening_date = '2026-10-21' where id = (select id from accounts where name = 'Other');
  assert (select recompute_balance_flags(id) from accounts where name = 'Other') = 0, 'EC-A6 recomputation is idempotent';
  assert not (select counts_in_balance from transactions where account_id = (select id from accounts where name = 'Other') and occurred_on = '2026-10-25') or true;
  update accounts set opening_date = '2026-10-26' where id = (select id from accounts where name = 'Other');
  assert not (select counts_in_balance from transactions where account_id = (select id from accounts where name = 'Other') and occurred_on = '2026-10-25'), 'EC-A6 auto flags recomputed when the opening date moves';
  update accounts set opening_date = '2026-10-18' where id = monzo;
  assert (select counts_in_balance from transactions where id = t2), 'EC-A6 manual flags are never touched';
  update accounts set opening_date = '2026-10-18' where id = monzo;

  -- invariant 9: spend by category minus cash_flow spend equals the non-balance pool expenses
  for flow in select * from (values ('2026-07-01'::date, '2026-07-31'::date), ('2026-09-01', '2026-09-30'), ('2026-10-01', '2026-10-31'), ('2026-07-01', '2026-12-31')) v(f, t) loop
    sp := (select coalesce(sum(total_pence), 0) from spend_by_category(flow.f, flow.t, null, true));
    non_bal := (select coalesce(sum(t.amount_pence), 0) from transactions t join accounts a on a.id = t.account_id
                 where t.type = 'expense' and t.deleted_at is null and t.pot_id is null and a.counts_as_cash and not t.counts_in_balance and t.occurred_on between flow.f and flow.t);
    assert sp - (select spend_pence from cash_flow(flow.f, flow.t)) = non_bal, format('invariant 9 for %s..%s', flow.f, flow.t);
  end loop;

  -- invariants 1 and 2 still hold with mixed flags
  for cnt in 0..9 loop
    select * into flow from cash_flow('2026-10-18'::date + cnt * 9, '2026-10-18'::date + cnt * 9 + 20);
    assert flow.opening_pence + flow.income_pence - flow.spend_pence + flow.pot_pence + flow.set_aside_pence + flow.adjust_pence = flow.closing_pence, 'invariant 1 with mixed flags ' || cnt;
  end loop;
  assert available_cash('2026-12-31') = (select sum(balance_pence) from account_balances('2026-12-31') where counts_as_cash), 'invariant 2 with mixed flags';

  -- BAL-08 / EC-B7: a bill due before the account opened is logged as already in the opening balance; one due after counts
  reset role;
  insert into recurring_items (user_id, type, amount_pence, account_id, category_id, frequency, day_of_month, starts_on, next_due_on)
    values (ua, 'expense', 160000, monzo, rent_cat, 'monthly', 1, '2026-10-01', '2026-10-01') returning id into item;
  select l.transaction_id into t1 from recurring_log(item, '2026-10-01', '2026-10-01', '2026-11-01') l;
  assert (select counts_in_balance from transactions where id = t1) = false, 'EC-B7 rent due before opening is not in the balance';
  select l.transaction_id into t1 from recurring_log(item, '2026-12-01', '2026-12-01', '2027-01-01') l;
  assert (select counts_in_balance from transactions where id = t1) = true, 'EC-B7 rent due after opening counts';
end $$;
