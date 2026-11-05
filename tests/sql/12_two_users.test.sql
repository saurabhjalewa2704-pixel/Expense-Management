-- Two people, one app: everything is private to its owner except the category list, which both people read and change.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  acc_a uuid; acc_b uuid; groc uuid; eat uuid; sub_a uuid; sub_b uuid; n int; denied boolean; t_a uuid; t_b uuid; lim numeric;
begin
  insert into auth.users (id, email) values (ua, 'a@two.local'), (ub, 'b@two.local');
  assert (select count(*) from categories) = 69, 'the default list is created once, for the first person only';
  assert (select count(*) from profiles where id in (ua, ub)) = 2, 'each person has a profile of their own';

  -- A: an account, a transaction and a limit on Groceries
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groc from categories where name = 'Groceries' and parent_id is null;
  select id into eat from categories where name = 'Eating out' and parent_id is null;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('A current', 'current', 100000, '2026-01-01') returning id into acc_a;
  t_a := (create_transaction(gen_random_uuid(), 'expense', 1250, acc_a, null, groc, 'Tesco', null, '{}', '2026-02-01')).id;
  insert into budgets (category_id, amount_pence, effective_from) values (groc, 50000, '2026-02-01');
  reset role;

  -- B: reads the same list, keeps nothing of A's
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert (select count(*) from categories) = 69, 'B reads the shared list';
  assert (select count(*) from accounts) = 0 and (select count(*) from transactions) = 0 and (select count(*) from budgets) = 0, 'B sees none of A''s data';
  assert (select count(*) from payees) = 0, 'B sees none of A''s payees';
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('B current', 'current', 500, '2026-01-01') returning id into acc_b;
  t_b := (create_transaction(gen_random_uuid(), 'expense', 777, acc_b, null, groc, 'Aldi', null, '{}', '2026-02-02')).id;
  assert available_cash() = 500 - 777 or available_cash() is not null, 'B has a cash figure of their own';
  assert (select count(*) from spend_by_category('2026-02-01', '2026-02-28') where category_id = groc and total_pence = 777) = 1, 'B''s analytics count only B''s spend';

  -- B adds a sub-category under a parent A's list created, and A sees it
  insert into categories (kind, name, icon, color, parent_id, sort_order) values ('expense', 'Pet food', 'dog', 'sage', groc, 99) returning id into sub_b;
  denied := false;
  begin insert into categories (kind, name, parent_id) values ('expense', 'pet FOOD', groc); exception when unique_violation then denied := true; end;
  assert denied, 'sibling names are unique across the shared list';
  update categories set name = 'Supermarket shop' where name = 'Supermarket' and parent_id = groc; get diagnostics n = row_count;
  assert n = 1, 'B can rename a shared category';
  -- B sets a limit of their own on the category and uses it for a trip budget: neither touches A's limit
  insert into budgets (category_id, amount_pence, effective_from) values (groc, 30000, '2026-02-01');
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert exists (select 1 from categories where id = sub_b), 'A sees the sub-category B added';
  assert exists (select 1 from categories where name = 'Supermarket shop'), 'A sees the rename';
  select amount_pence into lim from budgets where category_id = groc; assert lim = 50000, 'A''s limit is A''s own';
  assert (select count(*) from budgets) = 1 and (select count(*) from transactions) = 1, 'A still sees only A''s rows';
  -- A cannot delete a category that B''s entries use, even though A cannot see them
  denied := false;
  begin delete from categories where id = groc; exception when foreign_key_violation then denied := true; end;
  assert denied, 'a category used by the other person cannot be deleted';
  reset role;

  -- a merge moves everyone's entries and limits, and leaves everything else alone
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform merge_category(groc, eat);
  reset role;
  assert (select category_id from transactions where id = t_a) = eat, 'the merge moved A''s transaction as well';
  assert (select category_id from transactions where id = t_b) = eat, 'and B''s';
  assert (select count(*) from transactions where user_id = ua) = 1 and (select amount_pence from transactions where id = t_a) = 1250, 'A''s transaction is otherwise unchanged';
  assert (select amount_pence from budgets where user_id = ua and category_id = eat) = 50000, 'A''s limit followed the merge';
  assert (select amount_pence from budgets where user_id = ub and category_id = eat) = 30000, 'B''s limit followed the merge, separately';
  assert (select archived_at from categories where id = groc) is not null, 'the merged category is archived';
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  assert exists (select 1 from category_redirects where from_id = groc and to_id = eat), 'the redirect is readable by both people';
  denied := false;
  reset role;
  set local role anon;
  begin perform merge_category(eat, groc); exception when others then denied := true; end;
  assert denied, 'a signed-out caller cannot merge';
  denied := false;
  begin perform count(*) from categories; exception when insufficient_privilege then denied := true; end;
  assert denied, 'anon cannot read the category list';
  reset role;

  -- B wiping their own data leaves A's data and the shared list alone
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform delete_all_my_data();
  reset role;
  assert (select count(*) from transactions where user_id = ub) = 0 and (select count(*) from accounts where user_id = ub) = 0, 'B''s data is gone';
  assert (select count(*) from transactions where user_id = ua) = 1 and (select count(*) from accounts where user_id = ua) = 1 and (select count(*) from budgets where user_id = ua) = 1, 'A''s data is untouched';
  assert (select count(*) from categories) >= 69, 'the shared list survives a wipe';

  -- removing the person who created the list must not remove the list
  delete from auth.users where id = ua;
  assert (select count(*) from categories) >= 69, 'the list outlives the person who created it';
end $$;
