-- PRD §10.4 invariants 1-5, over randomised data with every awkward case mixed in:
-- transfers inside the pool, to and from savings, credit cards, adjustments, soft deletes,
-- an account that starts mid-period and one that is archived mid-period.
do $$
declare
  u uuid := gen_random_uuid();
  cur uuid; cc uuid; cash uuid; sav uuid; late uuid; gone uuid;
  exp_cats uuid[]; inc_cats uuid[]; accts uuid[]; a uuid; b uuid;
  i int; k int; d date; f date; t date; typ int; amt bigint;
  r record; before bigint; flows_before record; flows_after record; checked int := 0;
begin
  insert into auth.users (id, email) values (u, 'inv@test.local');
  perform setseed(0.42);
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash) values
    (u, 'Current', 'current', 786240, '2026-04-01', true) returning id into cur;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash) values
    (u, 'Card', 'credit_card', -118473, '2026-04-01', true) returning id into cc;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash) values
    (u, 'Cash', 'cash', 25000, '2026-04-01', true) returning id into cash;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash) values
    (u, 'Savings', 'savings', 1240000, '2026-04-01', false) returning id into sav;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash) values
    (u, 'Late', 'current', 333300, '2026-07-15', true) returning id into late;
  insert into accounts (user_id, name, type, opening_balance_pence, opening_date, counts_as_cash) values
    (u, 'Gone', 'current', 50000, '2026-04-01', true) returning id into gone;

  select array_agg(id) into exp_cats from categories where user_id = u and kind = 'expense';
  select array_agg(id) into inc_cats from categories where user_id = u and kind = 'income' and parent_id is null;

  -- 600 random transactions across the pool accounts, savings and the late account
  for i in 1..600 loop
    typ := floor(random() * 10)::int;
    d := '2026-04-01'::date + floor(random() * 200)::int;                 -- up to 17 Oct
    amt := 50 + floor(random() * 30000)::bigint;
    accts := array[cur, cc, cash, sav, late, gone];
    a := accts[1 + floor(random() * 6)::int];
    if a = late and d < '2026-07-15' then d := '2026-07-15'::date + floor(random() * 80)::int; end if;
    if a = gone and d > '2026-08-20' then d := '2026-08-20'::date - floor(random() * 100)::int; end if;
    if typ <= 5 then
      insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on)
        values (u, gen_random_uuid(), 'expense', amt, a, exp_cats[1 + floor(random() * array_length(exp_cats, 1))::int], d);
    elsif typ = 6 then
      insert into transactions (user_id, client_id, type, amount_pence, account_id, category_id, occurred_on)
        values (u, gen_random_uuid(), 'income', amt * 5, a, inc_cats[1 + floor(random() * array_length(inc_cats, 1))::int], d);
    elsif typ in (7, 8) then
      b := accts[1 + floor(random() * 6)::int];
      if b = a then b := cur; if a = cur then b := cash; end if; end if;
      if (b = late and d < '2026-07-15') or (a = late and d < '2026-07-15') then d := '2026-08-01'; end if;
      if (b = gone or a = gone) and d > '2026-08-20' then d := '2026-08-01'; end if;
      insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, occurred_on)
        values (u, gen_random_uuid(), 'transfer', amt, a, b, d);
    else
      insert into transactions (user_id, client_id, type, amount_pence, account_id, occurred_on, note)
        values (u, gen_random_uuid(), 'adjustment', (random() * 4000 - 2000)::bigint + 1, a, d, 'Balance adjustment');
    end if;
  end loop;
  -- soft-deleted rows must be invisible to every figure
  update transactions set deleted_at = now() where user_id = u and id in
    (select id from transactions where user_id = u order by random() limit 40);

  -- 'Gone' is written off and archived on 21 Aug (archive_account is the supported path)
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select 1 into i;
  declare bal bigint;
  begin
    select balance_pence into bal from account_balances('9999-12-31') where account_id = gone;
    if bal <> 0 then
      insert into transactions (client_id, type, amount_pence, account_id, occurred_on, note)
        values (gen_random_uuid(), 'adjustment', -bal, gone, '2026-08-21', 'Balance written off');
    end if;
    reset role;
    update accounts set archived_at = '2026-08-21 12:00+01' where id = gone;
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end;

  -- INVARIANT 1 and 2 over 80 random ranges
  for k in 1..80 loop
    f := '2026-04-01'::date + floor(random() * 190)::int;
    t := f + floor(random() * (('2026-10-18'::date - f) + 1))::int;
    select * into r from cash_flow(f, t);
    assert r.closing_pence = available_cash(t), format('closing <> available_cash(%s)', t);
    assert r.opening_pence + r.income_pence - r.spend_pence + r.set_aside_pence + r.adjust_pence = r.closing_pence,
      format('equation does not balance for %s..%s: %s', f, t, r);
    assert (select coalesce(sum(balance_pence), 0) from account_balances(t) where counts_as_cash) = available_cash(t),
      format('pool balances <> available_cash(%s)', t);
  end loop;

  -- the daily line agrees with the point queries
  for r in select * from cash_series('2026-07-01', '2026-10-18') loop
    assert r.cash_pence = available_cash(r.day), format('cash_series differs on %s', r.day);
  end loop;

  -- INVARIANT 3: a transfer inside the pool changes no cash_flow total
  select * into flows_before from cash_flow('2026-09-01', '2026-10-18');
  before := available_cash('2026-10-18');
  insert into transactions (client_id, type, amount_pence, account_id, counter_account_id, occurred_on)
    values (gen_random_uuid(), 'transfer', 50000, cur, cc, '2026-10-05');
  select * into flows_after from cash_flow('2026-09-01', '2026-10-18');
  assert flows_before = flows_after, 'a pool-to-pool transfer changed cash_flow';
  assert available_cash('2026-10-18') = before, 'a pool-to-pool transfer changed available cash';
  assert (select balance_pence from account_balances('2026-10-18') where account_id = cc) is not null;

  -- ...but moving money to savings is "set aside": -amount, and not spend
  select * into flows_before from cash_flow('2026-09-01', '2026-10-18');
  insert into transactions (client_id, type, amount_pence, account_id, counter_account_id, occurred_on)
    values (gen_random_uuid(), 'transfer', 70000, cur, sav, '2026-10-06');
  select * into flows_after from cash_flow('2026-09-01', '2026-10-18');
  assert flows_after.set_aside_pence = flows_before.set_aside_pence - 70000, 'set aside moves by -amount';
  assert flows_after.spend_pence = flows_before.spend_pence, 'savings transfer is not spend';
  assert flows_after.closing_pence = flows_before.closing_pence - 70000;

  -- INVARIANT 4: editing a transaction from three months ago moves today's cash by exactly the delta
  select t.id, t.amount_pence into r from transactions t
   where t.type = 'expense' and t.deleted_at is null and t.account_id = cur and t.occurred_on between '2026-07-01' and '2026-07-31' limit 1;
  before := available_cash('2026-10-18');
  update transactions set amount_pence = r.amount_pence + 12345 where id = r.id;
  assert available_cash('2026-10-18') = before - 12345, 'edit three months back changes today by the delta';
  assert available_cash('2026-07-02') is not null;
  -- ...and so does deleting it
  before := available_cash('2026-10-18');
  update transactions set deleted_at = now() where id = r.id;
  assert available_cash('2026-10-18') = before + r.amount_pence + 12345, 'deleting restores the cash';
  -- ...and an account moving out of the pool
  before := available_cash('2026-10-18');
  update accounts set counts_as_cash = false where id = cash;
  assert available_cash('2026-10-18') = before - (select balance_pence from account_balances('2026-10-18') where account_id = cash),
    'toggling the pool flag moves cash by that account balance';
  update accounts set counts_as_cash = true where id = cash;

  -- INVARIANT 5: everything in the pool and no adjustments -> exactly opening + income - spend
  reset role;
  update accounts set counts_as_cash = true where user_id = u and archived_at is null;
  update transactions set deleted_at = now() where user_id = u and type = 'adjustment' and deleted_at is null and account_id <> gone;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for k in 1..120 loop
    f := '2026-04-01'::date + floor(random() * 190)::int;
    t := f + floor(random() * (('2026-10-18'::date - f) + 1))::int;
    -- the owner's formula is exact only for ranges without corrections
    continue when exists (select 1 from transactions x where x.user_id = u and x.type = 'adjustment'
                             and x.deleted_at is null and x.occurred_on between f and t);
    checked := checked + 1;
    select * into r from cash_flow(f, t);
    assert r.set_aside_pence = 0 and r.adjust_pence = 0, 'no set-aside or adjustments expected';
    assert r.closing_pence = r.opening_pence + r.income_pence - r.spend_pence,
      format('owner formula fails for %s..%s: %s', f, t, r);
  end loop;
  assert checked >= 5, 'too few adjustment-free ranges were checked: ' || checked;
  reset role;
end $$;
