-- Edge-case register (PRD §18), the rows that live in the database. Every assertion message starts with its ID.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid();
  monzo uuid; sav uuid; groceries uuid; coffee uuid; x uuid; y uuid; pets uuid; animals uuid; vet uuid; food1 uuid; food2 uuid; p1 uuid; p2 uuid;
  r transactions; client uuid := gen_random_uuid(); cash0 bigint; n int; run uuid; tok text := 'abc';
begin
  insert into auth.users (id, email) values (ua, 'ec1@test.local'), (ub, 'ec2@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Monzo', 'current', 100000, '2026-10-01') returning id into monzo;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Savings', 'savings', 500000, '2026-10-01') returning id into sav;
  select id into coffee from categories where name = 'Coffee & snacks';

  -- EC-C1: a retry with the same client_id creates exactly one row
  perform create_transaction(client, 'expense', 450, monzo, null, coffee, 'Gail''s', null, '{}', '2026-10-05');
  perform create_transaction(client, 'expense', 450, monzo, null, coffee, 'Gail''s', null, '{}', '2026-10-05');
  assert (select count(*) from transactions where client_id = client) = 1, 'EC-C1 idempotent on client_id';

  -- EC-D6: created_at is the server's time, whatever the device said
  assert (select abs(extract(epoch from now() - created_at)) from transactions where client_id = client) < 30, 'EC-D6 created_at comes from the server clock';

  -- EC-C7: payee variants are one payee; merging by hand moves everything
  perform create_transaction(gen_random_uuid(), 'expense', 500, monzo, null, coffee, 'GAILS LTD', null, '{}', '2026-10-06');
  assert (select count(distinct payee_id) from transactions where payee_id is not null) = 1, 'EC-C7 "Gail''s" and "GAILS LTD" are the same payee';
  perform create_transaction(gen_random_uuid(), 'expense', 700, monzo, null, coffee, 'Costa Coffee', null, '{}', '2026-10-07');
  perform create_transaction(gen_random_uuid(), 'expense', 800, monzo, null, coffee, 'Cstoa Cofee', null, '{}', '2026-10-08');
  select id into p1 from payees where name = 'Costa Coffee';
  select id into p2 from payees where name = 'Cstoa Cofee';
  if p2 is not null then
    perform merge_payees(p2, p1);
    assert (select count(*) from transactions where payee_id = p1) = 2 and not exists (select 1 from payees where id = p2), 'EC-C7 merge_payees moves the history and removes the duplicate';
  end if;

  -- EC-D5: a future-dated expense changes nothing until its day, and then it does
  cash0 := available_cash(london_today());
  perform create_transaction(gen_random_uuid(), 'expense', 20000, sav, null, groceries, 'Deposit', null, '{}', london_today() + 7);
  assert available_cash(london_today()) = cash0, 'EC-D5 a scheduled expense does not touch today''s cash';
  assert available_cash(london_today() + 7) = available_cash(london_today()) - 20000, 'EC-D5 it counts from its own day';
  begin
    perform create_transaction(gen_random_uuid(), 'expense', 100, monzo, null, groceries, 'Far away', null, '{}', london_today() + 800);
    assert false, 'EC-D5 more than 12 months ahead should be refused';
  exception when check_violation then null;
  end;

  -- EC-A5: moving an account out of the pool recomputes history, and remembers when
  cash0 := available_cash('2026-10-31');
  update accounts set counts_as_cash = false where id = sav;
  assert available_cash('2026-10-31') = cash0 - (select balance_pence from account_balances('2026-10-31') where account_id = sav), 'EC-A5 history uses the current pool: the account''s balance leaves every date';
  assert (select pool_changed_on from accounts where id = sav) = london_today(), 'EC-A5 the day the pool changed is remembered';
  update accounts set counts_as_cash = true where id = sav;
  assert available_cash('2026-10-31') = cash0, 'EC-A5 and back again';

  -- EC-A7: an account with transactions cannot be deleted
  begin
    delete from accounts where id = monzo;
    assert false, 'EC-A7 should not delete an account with transactions';
  exception when foreign_key_violation then null;
  end;

  -- EC-A8: archiving the default account makes the most-used active account the default
  update accounts set is_default = false;
  update accounts set is_default = true where id = monzo;
  perform create_transaction(gen_random_uuid(), 'expense', 100, sav, null, groceries, null, null, '{}', '2026-10-09');
  perform create_transaction(gen_random_uuid(), 'expense', 100, sav, null, groceries, null, null, '{}', '2026-10-10');
  perform archive_account(monzo, true);
  assert (select is_default from accounts where id = sav), 'EC-A8 the default moves to the most-used active account';

  -- EC-K4: sibling names are unique ignoring case
  begin
    insert into categories (kind, name, parent_id, icon, color) values ('expense', 'coffee & SNACKS', (select parent_id from categories where id = coffee), 'coffee', 'stone');
    assert false, 'EC-K4 should reject a duplicate sibling name';
  exception when unique_violation then null;
  end;

  -- EC-K1: a category with transactions cannot be deleted
  begin
    delete from categories where id = coffee;
    assert false, 'EC-K1 should not delete a category with transactions';
  exception when foreign_key_violation then null;
  end;

  -- EC-C4 / EC-K2: merging a parent moves its sub-categories under the target, combines a name clash, and leaves a redirect
  insert into categories (kind, name, icon, color) values ('expense', 'Pets', 'paw-print', 'sage') returning id into pets;
  insert into categories (kind, name, icon, color) values ('expense', 'Animals', 'paw-print', 'sage') returning id into animals;
  insert into categories (kind, name, parent_id, icon, color) values ('expense', 'Vet', pets, 'paw-print', 'sage') returning id into vet;
  insert into categories (kind, name, parent_id, icon, color) values ('expense', 'Food', pets, 'paw-print', 'sage') returning id into food1;
  insert into categories (kind, name, parent_id, icon, color) values ('expense', 'food', animals, 'paw-print', 'sage') returning id into food2;
  perform create_transaction(gen_random_uuid(), 'expense', 1200, sav, null, food1, null, null, '{}', '2026-10-11');
  perform merge_category(pets, animals);
  assert (select parent_id from categories where id = vet) = animals, 'EC-K2 the sub-categories move under the target parent';
  assert (select category_id from transactions where amount_pence = 1200) = food2, 'EC-K2 a name clash is combined: the spend lands on the existing sub-category';
  assert (select archived_at is not null from categories where id = pets), 'EC-K2 the merged parent is archived';
  -- an entry queued before the merge still arrives
  r := create_transaction(gen_random_uuid(), 'expense', 900, sav, null, pets, null, null, '{}', '2026-10-12');
  assert r.category_id = animals, 'EC-C4 an entry for a merged category is redirected to where it went';
  r := create_transaction(gen_random_uuid(), 'expense', 300, sav, null, food1, null, null, '{}', '2026-10-12');
  assert r.category_id = food2, 'EC-C4 and a merged sub-category too';
  -- keep both
  insert into categories (kind, name, icon, color) values ('expense', 'Garden', 'flower-2', 'sage') returning id into x;
  insert into categories (kind, name, icon, color) values ('expense', 'Outdoors', 'flower-2', 'sage') returning id into y;
  insert into categories (kind, name, parent_id, icon, color) values ('expense', 'Tools', x, 'flower-2', 'sage'), ('expense', 'Tools', y, 'flower-2', 'sage');
  perform merge_category(x, y, 'keep_both');
  assert exists (select 1 from categories where parent_id = y and name = 'Tools (2)'), 'EC-K2 keep both renames the clash "Tools (2)"';

  -- EC-D4: back-dating into a period whose insights exist marks them stale
  reset role;
  insert into insight_runs (user_id, scope, period_start, period_end, facts, cards, model) values (ua, 'monthly', '2026-09-01', '2026-09-30', '{}', '[]', 'template') returning id into run;
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform create_transaction(gen_random_uuid(), 'expense', 500, sav, null, groceries, null, null, '{}', '2026-10-13');
  assert not (select stale from insight_runs where id = run), 'EC-D4 an entry outside the period leaves it alone';
  reset role;
  update accounts set opening_date = '2026-08-01' where id = sav;
  set local role authenticated;
  perform create_transaction(gen_random_uuid(), 'expense', 500, sav, null, groceries, null, null, '{}', '2026-09-15');
  assert (select stale from insight_runs where id = run), 'EC-D4 back-dating into the period marks its cards stale';

  -- EC-P6: capture tokens are stored hashed, limited to 60 an hour, and revoking stops them at once
  insert into api_tokens (name, token_hash) values ('Shortcut', encode(sha256(convert_to('stl_secret', 'utf8')), 'hex'));
  assert not exists (select 1 from api_tokens where token_hash like '%stl_secret%'), 'EC-P6 only a hash is stored';
  reset role;
  assert (select status from api_token_hit(encode(sha256(convert_to('stl_secret', 'utf8')), 'hex'))) = 'ok', 'EC-P6 a live token works';
  for n in 1..59 loop perform api_token_hit(encode(sha256(convert_to('stl_secret', 'utf8')), 'hex')); end loop;
  assert (select status from api_token_hit(encode(sha256(convert_to('stl_secret', 'utf8')), 'hex'))) = 'rate_limited', 'EC-P6 the 61st capture in an hour is refused';
  update api_tokens set window_started_at = now() - interval '2 hours';
  assert (select status from api_token_hit(encode(sha256(convert_to('stl_secret', 'utf8')), 'hex'))) = 'ok', 'EC-P6 the limit resets after the hour';
  update api_tokens set revoked_at = now();
  assert (select status from api_token_hit(encode(sha256(convert_to('stl_secret', 'utf8')), 'hex'))) = 'unauthorised', 'EC-P6 revoking takes effect at once';
  update api_tokens set revoked_at = null, window_started_at = null, window_count = 0;
  assert (select capture_expense(ua, 1250, 'Pret', null, null, 'from a shortcut', now())) is not null, 'CAP-08 the capture creates an expense';
  assert (select count(*) from transactions where amount_pence = 1250 and source = 'shortcut' and needs_review) = 1, 'CAP-08 it is marked as captured and to review';

  -- EC-P8: deleting everything leaves nothing behind, devices and tokens included
  insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (ua, 'https://push.test/x', 'p', 'a');
  insert into trips (user_id, name, currency, start_on, end_on) values (ua, 'Gone', 'EUR', '2026-11-01', '2026-11-03');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform delete_all_my_data();
  reset role;
  assert (select count(*) from push_subscriptions where user_id = ua) = 0 and (select count(*) from api_tokens where user_id = ua) = 0, 'EC-P8 devices and tokens are deleted';
  assert (select count(*) from trips where user_id = ua) = 0 and (select count(*) from insight_runs where user_id = ua) = 0 and (select count(*) from transactions where user_id = ua) = 0, 'EC-P8 trips, AI runs and transactions are deleted';
  assert (select count(*) from categories where user_id = ua) > 0, 'EC-P8 the app returns to first run with the default categories';
end $$;

-- EC-N2: with fewer than three earlier periods there is no "usual"
do $$
declare ua uuid := gen_random_uuid(); acc uuid; groceries uuid;
begin
  insert into auth.users (id, email) values (ua, 'ec3@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groceries from categories where name = 'Groceries' and parent_id is null;
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Monzo', 'current', 100000, '2026-08-01') returning id into acc;
  perform create_transaction(gen_random_uuid(), 'expense', 1000, acc, null, groceries, null, null, '{}', '2026-08-10');
  perform create_transaction(gen_random_uuid(), 'expense', 1000, acc, null, groceries, null, null, '{}', '2026-09-10');
  perform create_transaction(gen_random_uuid(), 'expense', 1000, acc, null, groceries, null, null, '{}', '2026-10-10');
  assert (select norm_pence from spend_by_category('2026-10-01', '2026-10-18') where name = 'Groceries') is null, 'EC-N2 two earlier periods: no usual';
  perform create_transaction(gen_random_uuid(), 'expense', 1000, acc, null, groceries, null, null, '{}', '2026-07-10');
  update accounts set opening_date = '2026-07-01' where id = acc;
  perform create_transaction(gen_random_uuid(), 'expense', 1000, acc, null, groceries, null, null, '{}', '2026-06-10');
  update accounts set opening_date = '2026-06-01' where id = acc;
  assert (select norm_pence from spend_by_category('2026-10-01', '2026-10-18') where name = 'Groceries') is not null, 'EC-N2 with three or more earlier periods the usual appears';
end $$;
