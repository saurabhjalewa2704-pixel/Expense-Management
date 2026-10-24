-- The demo seed reproduces PRD Appendix A to the penny, so visual tests can compare with the mock-ups.
do $$
declare u uuid; r record; n int;
begin
  select id into u from auth.users order by created_at limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- accounts (pool sums to available cash; savings kept apart)
  assert (select balance_pence from account_balances('2026-10-18') where name = 'Monzo') = 321408;
  assert (select balance_pence from account_balances('2026-10-18') where name = 'HSBC Premier') = 248620;
  assert (select balance_pence from account_balances('2026-10-18') where name = 'Cash') = 25000;
  assert (select balance_pence from account_balances('2026-10-18') where name = 'Amex Gold') = -118473;
  assert (select balance_pence from account_balances('2026-10-18') where name = 'Marcus') = 1240000;
  assert available_cash('2026-10-18') = 476555, 'available cash £4,765.55';

  -- the equation: £7,862.40 + £140.00 − £3,236.85 = £4,765.55
  select * into r from cash_flow('2026-10-01', '2026-10-18');
  assert (r.opening_pence, r.income_pence, r.spend_pence, r.set_aside_pence, r.adjust_pence, r.closing_pence) = (786240, 14000, 323685, 0, 0, 476555), r::text;

  -- pace: £3,604.10 by day 18 of September, £367.25 more than October; September in full £5,316.20
  select * into r from month_pace('2026-10-18');
  assert r.spend_pence = 323685 and r.prev_spend_pence = 360410 and r.prev_total_pence = 531620 and r.day_of_month = 18 and r.days_in_month = 31, r::text;
  assert 360410 - 323685 = 36725;
  assert round(323685 * 1000.0 / 531620) = 609 and round(360410 * 1000.0 / 531620) = 678, 'pace bar: 60.9% fill, tick at 67.8%';

  -- categories month to date
  assert (select array_agg(name || ':' || total_pence order by name) from spend_by_category('2026-10-01', '2026-10-18')) = array[
    'Bills:11843','Eating out:31260','Entertainment:7497','Family & giving:4250','Groceries:38625','Health:9600','Home:181240','Shopping:17890','Transport:21480'];
  -- Eating out is 38% above its norm of about £226
  select * into r from spend_by_category('2026-10-01', '2026-10-18') where name = 'Eating out';
  assert round((r.total_pence - r.norm_pence) * 100.0 / r.norm_pence) = 38 and round(r.norm_pence / 100.0) = 226, r::text;

  -- sub-categories (PRD §6.7.1): the leaf view reproduces the appendix and sums to the parent view (invariant 6)
  assert (select name from spend_by_category('2026-10-01', '2026-10-18', p_level => 'leaf') where not is_fixed order by total_pence desc limit 1) = 'Supermarket';
  assert (select total_pence from spend_by_category('2026-10-01', '2026-10-18', p_level => 'leaf') where name = 'Supermarket') = 31470;
  select * into r from spend_by_category('2026-10-01', '2026-10-18', p_level => 'leaf') where name = 'Restaurants';
  assert r.total_pence = 14250 and r.norm_pence = 10500 and r.parent_name = 'Eating out' and r.visits = 3, r::text;
  assert round((r.total_pence - r.norm_pence) * 100.0 / r.norm_pence) = 36, 'Restaurants ↑ 36%';
  assert (select sum(total_pence) from spend_by_category('2026-10-01', '2026-10-18', p_level => 'leaf') where is_fixed) = 191083, 'Fixed costs £1,910.83';
  assert (select count(*) from spend_by_category('2026-10-01', '2026-10-18', p_level => 'leaf') where is_fixed) = 6, 'Fixed costs · 6';
  select * into r from spend_by_category('2026-10-01', '2026-10-18') where name = 'Eating out';
  assert r.total_pence = 31260 and r.txn_count = 21 and r.total_pence / r.txn_count = 1488, r::text;  -- £14.88 (truncated)
  assert (select array_agg(month::text || ':' || total_pence order by month) from category_monthly((select id from categories where name = 'Eating out'), 6))
       = array['2026-05-01:21840','2026-06-01:24310','2026-07-01:33120','2026-08-01:28760','2026-09-01:26410','2026-10-01:31260'];
  assert 31260 + category_remaining((select id from categories where name = 'Eating out'), '2026-10-18') = 53800, 'projection ≈ £538';
  assert (select name from top_places('2026-10-01', '2026-10-18', 3, (select id from categories where name = 'Eating out')) limit 1) = 'Dishoom Kensington';
  -- invariant 6 over several ranges
  for n in 0..5 loop
    assert not exists (
      select 1 from spend_by_category('2026-04-01'::date + n * 20, '2026-04-01'::date + n * 20 + 25) p
       where p.total_pence <> (select coalesce(sum(l.total_pence), 0) from spend_by_category('2026-04-01'::date + n * 20, '2026-04-01'::date + n * 20 + 25, p_level => 'leaf') l
                                where l.category_id = p.category_id or l.parent_id = p.category_id)), 'leaf sums equal parent rows, range ' || n;
    assert (select coalesce(sum(total_pence), 0) from spend_by_category('2026-04-01'::date + n * 20, '2026-04-01'::date + n * 20 + 25))
         = (select coalesce(sum(total_pence), 0) from spend_by_category('2026-04-01'::date + n * 20, '2026-04-01'::date + n * 20 + 25, p_level => 'leaf')), 'grand totals match';
  end loop;

  -- counts and day totals shown on the Activity mock-up
  assert (select txn_count from transaction_totals(p_from => '2026-10-01', p_to => '2026-10-18')) = 52;
  assert (select count(*) from transactions where type = 'income' and occurred_on between '2026-10-01' and '2026-10-18') = 2;
  assert (select sum(amount_pence) from transactions where type = 'expense' and occurred_on = '2026-10-17') = 16592, 'yesterday −£165.92';
  assert (select sum(case type when 'income' then amount_pence else -amount_pence end) from transactions where type in ('income','expense') and occurred_on = '2026-10-16') = 6036, 'Fri +£60.36';
  assert (select sum(amount_pence) from transactions where type = 'expense' and occurred_on = '2026-10-18') = 640, 'today −£6.40';
  assert (select payee_name from list_transactions(p_limit => 1)) = 'Gail''s Bakery';

  -- the mock-up rows exist with the right labels
  assert exists (select 1 from list_transactions(p_q => 'Dishoom') where amount_pence = 8650 and category_name = 'Restaurants' and account_name = 'Amex Gold');
  assert exists (select 1 from list_transactions(p_q => 'ASOS') where type = 'income' and amount_pence = 12160 and category_name = 'Refunds');
  assert (select count(*) from account_balances('2026-10-18') where counts_as_cash) = 4;

  -- the late-month spending of the six previous months has a median of £1,825.15, so October is heading for £5,062
  assert (select round(percentile_cont(0.5) within group (order by late))
            from (select (select coalesce(sum(amount_pence), 0) from transactions t where t.type = 'expense' and t.deleted_at is null
                           and t.occurred_on > m::date + 17 and t.occurred_on < (m + interval '1 month')::date) as late
                    from generate_series('2026-04-01'::date, '2026-09-01', interval '1 month') m) x) = 182515, 'median late-month spend';

  -- six months of history, and the invariant holds on it
  assert (select count(*) from monthly_totals(7) where spend_pence > 0) = 7;
  for n in 1..30 loop
    select * into r from cash_flow('2026-04-01'::date + (n * 5), '2026-04-01'::date + (n * 5) + 20);
    assert r.opening_pence + r.income_pence - r.spend_pence + r.set_aside_pence + r.adjust_pence = r.closing_pence, 'identity on seed range ' || n;
  end loop;
  reset role;
end $$;
