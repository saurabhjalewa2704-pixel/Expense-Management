-- Business rules enforced in the database: taxonomy depth, guards, idempotent capture, account lifecycle,
-- merge, analytics roll-ups, Activity paging and Europe/London date handling.
create function pg_temp.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.raises(q text) returns boolean language plpgsql as $$
begin execute q; return false; exception when others then return true; end $$;

do $$
declare
  u uuid := gen_random_uuid();
  cur uuid; cc uuid; sav uuid; groceries uuid; eating uuid; coffee uuid; rest uuid; salary uuid; shopping uuid; clothing uuid; bills uuid;
  r record; t1 transactions; t2 transactions; n int; p payees; bal bigint; tx uuid; cid uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (u, 'rules@test.local');
  perform pg_temp.as_user(u);

  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Monzo', 'current', 500000, '2026-09-01') returning id into cur;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Amex', 'credit_card', -100000, '2026-09-01') returning id into cc;
  insert into accounts (name, type, opening_balance_pence, opening_date, counts_as_cash) values ('Marcus', 'savings', 1240000, '2026-09-01', false) returning id into sav;
  assert (select is_default from accounts where id = cur), 'the first account becomes the default';
  assert not (select is_default from accounts where id = cc);

  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  select id into eating from categories where name = 'Eating out' and parent_id is null;
  select id into coffee from categories where name = 'Coffee & snacks';
  select id into rest from categories where name = 'Restaurants';
  select id into shopping from categories where name = 'Shopping' and parent_id is null;
  select id into clothing from categories where name = 'Clothing & shoes';
  select id into bills from categories where name = 'Bills' and parent_id is null;
  select id into salary from categories where name = 'Salary';

  ---------------- CAT-01 taxonomy ----------------
  assert pg_temp.raises(format('insert into categories (parent_id, kind, name) values (%L, ''expense'', ''Too deep'')', coffee)), 'three levels allowed';
  assert pg_temp.raises(format('insert into categories (parent_id, kind, name) values (%L, ''income'', ''Wrong kind'')', groceries)), 'kind mismatch allowed';
  assert pg_temp.raises(format('insert into categories (parent_id, kind, name) values (%L, ''income'', ''Sub income'')', salary)), 'income sub-category allowed';
  assert pg_temp.raises(format('update categories set parent_id = %L where id = %L', groceries, eating)), 'a parent with children moved under another';
  assert pg_temp.raises('insert into categories (kind, name) values (''expense'', ''groceries'')'), 'duplicate sibling name (case-insensitive) allowed';
  insert into categories (kind, name) values ('income', 'Groceries');             -- same name, other kind: fine
  insert into categories (parent_id, kind, name) values (groceries, 'expense', 'Farm shop');
  update categories set parent_id = shopping where name = 'Farm shop';           -- moving a sub-category is allowed
  assert (select parent_id from categories where name = 'Farm shop') = shopping;

  ---------------- guards ----------------
  -- an entry from before the account opened is accepted, and does not move the balance (PRD §6.2a, EC-A1)
  declare before_bal bigint := (select balance_pence from account_balances('2026-09-30') where account_id = cur);
  begin
    insert into transactions (client_id,type,amount_pence,account_id,category_id,occurred_on) values (gen_random_uuid(),'expense',100,cur,groceries,'2026-08-31');
    assert not (select counts_in_balance from transactions where occurred_on = '2026-08-31'), 'before the opening date it is neutral';
    assert (select balance_pence from account_balances('2026-09-30') where account_id = cur) = before_bal, 'and the balance is unchanged';
    delete from transactions where occurred_on = '2026-08-31';
  end;
  assert pg_temp.raises(format('insert into transactions (client_id,type,amount_pence,account_id,category_id,occurred_on) values (gen_random_uuid(),''expense'',100,%L,%L,''2026-09-02'')', cur, salary)),
    'an expense in an income category was allowed';
  assert pg_temp.raises(format('insert into transactions (client_id,type,amount_pence,account_id,occurred_on) values (gen_random_uuid(),''expense'',100,%L,''2026-09-02'')', cur)),
    'an expense without a category was allowed';
  assert pg_temp.raises(format('insert into transactions (client_id,type,amount_pence,account_id,category_id,occurred_on) values (gen_random_uuid(),''expense'',0,%L,%L,''2026-09-02'')', cur, groceries)),
    'a zero amount was allowed';
  assert pg_temp.raises(format('update accounts set opening_date = ''2026-09-10'' where id = %L', cur)) = false, 'no transactions yet, so moving the date is fine';
  update accounts set opening_date = '2026-09-01' where id = cur;

  ---------------- CAP-05 idempotent capture + payee memory ----------------
  t1 := create_transaction(cid, 'expense', 640, cc, null, coffee, '  Gail''s   Bakery ', null, '{}', '2026-10-18');
  t2 := create_transaction(cid, 'expense', 640, cc, null, coffee, 'Gail''s Bakery', null, '{}', '2026-10-18');
  assert t1.id = t2.id, 'retry returned a different row';
  assert (select count(*) from transactions where client_id = cid) = 1, 'retry duplicated the row';
  select * into p from payees where name_norm = 'gail''s bakery';
  assert p.use_count = 1 and p.default_category_id = coffee and p.default_account_id = cc, 'payee memory';
  assert p.name = 'Gail''s Bakery', 'payee name is tidied';
  perform create_transaction(gen_random_uuid(), 'expense', 710, cur, null, coffee, 'GAIL''S BAKERY', null, '{}', '2026-10-17');
  assert (select use_count from payees where name_norm = 'gail''s bakery') = 2, 'a second visit counts';
  assert (select count(*) from payees) = 1, 'payee match is case-insensitive';
  assert (select default_account_id from payees) = cur, 'payee remembers the most recent account';

  ---------------- ACC-02 default account switching ----------------
  assert (select is_default from accounts where id = cur);
  perform create_transaction(gen_random_uuid(), 'expense', 100, cc, null, groceries, null, null, '{}', '2026-10-18', null, 'app', false, true);
  perform create_transaction(gen_random_uuid(), 'expense', 100, cc, null, groceries, null, null, '{}', '2026-10-18', null, 'app', false, true);
  assert (select is_default from accounts where id = cur), 'two manual picks are not enough';
  perform create_transaction(gen_random_uuid(), 'expense', 100, cc, null, groceries, null, null, '{}', '2026-10-18', null, 'app', false, true);
  assert (select is_default from accounts where id = cc) and not (select is_default from accounts where id = cur), 'third manual pick switches the default';
  assert (select count(*) from accounts where is_default) = 1, 'exactly one default';
  perform set_default_account(cur);

  ---------------- transfers ----------------
  perform create_transaction(gen_random_uuid(), 'transfer', 50000, cur, cc, null, null, null, '{}', '2026-10-10');
  assert (select balance_pence from account_balances('2026-10-18') where account_id = cc) = -100000 + 50000 - 300 - 640, 'card balance after repayment and spends';
  assert pg_temp.raises(format('select create_transaction(gen_random_uuid(), ''transfer'', 100, %L, %L, %L)', cur, cur, groceries)), 'transfer to self allowed';

  ---------------- ACC-05 reconcile ----------------
  select balance_pence into bal from account_balances(london_today()) where account_id = cur;
  assert (select reconcile_account(cur, bal)) is null, 'no difference, no adjustment';
  perform reconcile_account(cur, 123456);
  assert (select balance_pence from account_balances(london_today()) where account_id = cur) = 123456, 'balance equals the typed balance to the penny';
  select * into r from transactions where type = 'adjustment' and account_id = cur;
  assert r.note = 'Balance adjustment' and r.occurred_on = london_today();
  assert (select coalesce(sum(total_pence), 0) from spend_by_category('2026-09-01', '2026-12-31')) =
         (select coalesce(sum(amount_pence), 0) from transactions where type = 'expense' and deleted_at is null), 'adjustments are not spend';
  assert (select coalesce(sum(income_pence), 0) from monthly_totals(3)) = 0, 'adjustments are not income';

  ---------------- ACC-03 archive ----------------
  assert pg_temp.raises(format('select archive_account(%L, false)', sav)), 'archived with a balance';
  perform archive_account(sav, true);
  assert (select archived_at is not null from accounts where id = sav);
  assert (select balance_pence from account_balances('9999-12-31') where account_id = sav) is null, 'archived accounts leave the lists';
  assert pg_temp.raises(format('select create_transaction(gen_random_uuid(), ''expense'', 100, %L, null, %L)', sav, groceries)), 'posting to an archived account';
  assert pg_temp.raises(format('update transactions set deleted_at = now() where account_id = %L', sav)), 'archived history is frozen';
  perform archive_account(cur, true);
  assert (select is_default from accounts where id = cc), 'default moves to a live account when the default is archived';

end $$;
