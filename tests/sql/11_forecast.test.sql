-- Forecasting engine (FORECASTING-ENGINE-PRD §6.14): the daily facts, the one-off flag, planned extras, and isolation of the engine's memory.
do $$
declare
  ua uuid := gen_random_uuid(); ub uuid := gen_random_uuid(); acc uuid; groc uuid; eat uuid; refunds uuid; sup uuid; sup2 uuid; tx uuid; n int; ex uuid; denied boolean;
begin
  insert into auth.users (id, email) values (ua, 'fa@test.local'), (ub, 'fb@test.local');
  perform set_config('request.jwt.claims', json_build_object('sub', ua, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select id into groc from categories where name = 'Groceries' and parent_id is null;
  select id into eat from categories where name = 'Eating out' and parent_id is null;
  select id into refunds from categories where name = 'Refunds' and kind = 'income';
  insert into accounts (name, type, opening_balance_pence, opening_date) values ('Current', 'current', 500000, '2026-06-01') returning id into acc;
  update profiles set tracking_started_on = '2026-06-01' where id = ua;

  -- EC-F27: facts are keyed by occurred_on, the date where the spend happened
  perform create_transaction(gen_random_uuid(), 'expense', 2500, acc, null, groc, null, null, '{}', '2026-10-03', '2026-10-03 23:50 America/New_York');
  assert (select discretionary from forecast_daily_facts('2026-10-03', '2026-10-03')) = 2500, 'EC-F27 a day is its occurred_on';

  -- EC-F21 a linked refund reduces that day's discretionary (and can make it negative); an unlinked one is ignored
  perform create_transaction(gen_random_uuid(), 'income', 4000, acc, null, refunds, null, null, '{}', '2026-10-04');
  assert (select discretionary from forecast_daily_facts('2026-10-04', '2026-10-04')) = 0, 'EC-F21 an unlinked refund is ignored';
  update transactions set refund_category_id = groc where category_id = refunds;
  assert (select discretionary from forecast_daily_facts('2026-10-04', '2026-10-04')) = -4000, 'EC-F21 a linked refund makes the day negative';
  assert (select (by_cat->>groc::text)::bigint from forecast_daily_facts('2026-10-04', '2026-10-04')) = -4000, 'EC-F21 and the category''s day';

  -- EC-F31 a large deposit that isn't spending never affects the facts' spend
  perform create_transaction(gen_random_uuid(), 'income', 300000, acc, null, (select id from categories where name = 'Salary' and kind = 'income'), null, null, '{}', '2026-10-05');
  assert (select discretionary + recurring + trip + oneoff from forecast_daily_facts('2026-10-05', '2026-10-05')) = 0 and (select has_activity from forecast_daily_facts('2026-10-05', '2026-10-05')), 'EC-F31 a salary is activity, not spending';

  -- EC-F7 / EC-F8: activity and the "Nothing to log" marker are what separate a logging gap from a genuine £0 day
  assert not (select has_activity from forecast_daily_facts('2026-10-06', '2026-10-06')), 'EC-F7 a day with nothing is not activity';
  insert into no_spend_days (day) values ('2026-10-06');
  assert (select confirmed_zero from forecast_daily_facts('2026-10-06', '2026-10-06')), 'EC-F8 confirmed: a genuine £0 day';

  -- EC-F12 point in time: with a cutoff, only what had been logged by then
  perform create_transaction(gen_random_uuid(), 'expense', 9000, acc, null, eat, null, null, '{}', '2026-10-07');
  assert (select discretionary from forecast_daily_facts('2026-10-07', '2026-10-07', now() - interval '1 hour')) = 0, 'EC-F12 a late entry is not in an earlier point in time';
  assert (select discretionary from forecast_daily_facts('2026-10-07', '2026-10-07')) = 9000, 'EC-F12 ...but is in the next calculation';

  -- EC-F9: one-offs, flagged automatically with the threshold; the user's choice is final
  perform create_transaction(gen_random_uuid(), 'expense', 89900, acc, null, groc, null, null, '{}', '2026-10-08');
  select id into tx from transactions where amount_pence = 89900;
  assert (select is_one_off and one_off_source = 'auto' from transactions where id = tx), 'EC-F9 the sofa is flagged';
  assert (select oneoff from forecast_daily_facts('2026-10-08', '2026-10-08')) = 89900 and (select discretionary from forecast_daily_facts('2026-10-08', '2026-10-08')) = 0, 'EC-F9 counted in spent, not in the pace';
  assert (select is_one_off from transactions where amount_pence = 2500) = false, 'a £25 shop is not a one-off';
  assert (select is_one_off from transactions where amount_pence = 9000) = false, 'EC-F9 £90 on eating out is below £150';

  -- EC-F23: merging a category rebuilds the facts under the target
  perform merge_category(eat, groc);
  assert (select discretionary from forecast_daily_facts('2026-10-07', '2026-10-07')) = 9000 and (select by_cat ? groc::text from forecast_daily_facts('2026-10-07', '2026-10-07')), 'EC-F23 the history continues under the target';

  -- EC-F30: a planned extra, and the once-only question
  insert into planned_extras (month, label, amount_pence, category_id) values ('2026-11-01', 'Christmas presents', 30000, groc) returning id into ex;
  assert (forecast_input('2026-11-01', '2026-11-03')->'planned_extras'->0->>'label') = 'Christmas presents', 'planned extras are in the engine''s feed';
  assert jsonb_array_length(forecast_input('2026-12-01', '2026-12-03')->'planned_extras') = 0, 'an extra counts in its own month only';
  perform create_transaction(gen_random_uuid(), 'expense', 12000, acc, null, groc, 'Hamleys', null, '{}', '2026-11-03');
  select id into tx from transactions where amount_pence = 12000;
  insert into planned_extra_answers (transaction_id, extra_id, answer) values (tx, ex, 'no');
  denied := false;
  begin insert into planned_extra_answers (transaction_id, extra_id, answer) values (tx, ex, 'all_of_it'); exception when unique_violation then denied := true; end;
  assert denied, 'EC-F30 each expense is asked about at most once';

  -- EC-F29: a tuning change is logged with before and after
  insert into forecast_params (k, half_life, version) values (5, 30, 'k5-h30');
  insert into forecast_param_log (changed_on, k_before, k_after, half_life_before, half_life_after, mape_before, mape_after) values ('2026-11-09', 7, 5, 60, 30, 0.09, 0.07);
  assert (forecast_input('2026-11-12', '2026-11-12')->'params_changed'->>'half_life')::int = 30 and (forecast_input('2026-11-12', '2026-11-12')->'params'->>'k_base')::numeric = 5, 'EC-F29 the feed carries the tuned parameters and when they changed';

  insert into forecast_backtest (month, day, point_pence, low_pence, high_pence, actual_pence) values ('2026-10-01', 15, 480000, 450000, 510000, 500000);
  insert into forecast_snapshots (day, point_pence) values ('2026-10-31', 500000);
  reset role;

  -- isolation: B sees none of A's engine memory, and the functions see only B's rows
  perform set_config('request.jwt.claims', json_build_object('sub', ub, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach ex in array array[]::uuid[] loop end loop;
  assert (select count(*) from planned_extras) = 0 and (select count(*) from planned_extra_answers) = 0 and (select count(*) from forecast_params) = 0
     and (select count(*) from forecast_param_log) = 0 and (select count(*) from forecast_backtest) = 0 and (select count(*) from forecast_snapshots) = 0, 'B cannot read A''s forecast tables';
  assert (select count(*) from forecast_daily_facts('2026-10-01', '2026-10-10') where discretionary <> 0 or has_activity) = 0, 'the facts ignore other users';
  assert jsonb_array_length(forecast_input('2026-11-01', '2026-11-03')->'planned_extras') = 0, 'the feed ignores other users';
  denied := false;
  begin insert into planned_extras (user_id, month, label, amount_pence) values (ua, '2026-11-01', 'planted', 100); exception when others then denied := true; end;
  assert denied, 'B cannot insert as A';
  update planned_extras set amount_pence = 1; get diagnostics n = row_count; assert n = 0, 'B cannot change A''s extras';
  reset role;
end $$;
