-- Sterling demo data (development only). Reproduces PRD Appendix A (Sun 18 Oct 2026) to the penny:
--   opening cash 1 Oct £7,862.40 · income £140.00 · spend £3,236.85 · available cash £4,765.55
--   Monzo £3,214.08 · HSBC £2,486.20 · Cash £250.00 · Amex −£1,184.73 · Marcus (savings) £12,400.00
--   September to day 18: £3,604.10 (so October is £367.25 lower) · September in full: £5,316.20
--   October by category: Home 1,812.40 · Groceries 386.25 · Eating out 312.60 (+38% on its ~£226 norm) · Transport 214.80
--   · Shopping 178.90 · Bills 118.43 · Health 96.00 · Entertainment 74.97 · Family & giving 42.50
-- It seeds the first user in auth.users (creating demo@sterling.local when there is none) and is safe to re-run.
do $seed$
declare
  u uuid;
  monzo uuid; hsbc uuid; cash uuid; amex uuid; marcus uuid;
  months date[] := array['2026-04-01','2026-05-01','2026-06-01','2026-07-01','2026-08-01','2026-09-01']::date[];
  m int; mdate date; mend date;
  c record;
  half int;                         -- 1: days 1-18, 2: day 19 to month end
  total bigint; cnt int; first_day int; span int;
  nsubs int; k int; sub_total bigint; rem_total bigint; per int; idx int;
  left_amt bigint; each_amt bigint; day_n int; alt uuid; hh int; mi int;
begin
  select id into u from auth.users order by created_at limit 1;
  if u is null then
    insert into auth.users (email, raw_user_meta_data) values ('demo@sterling.local', '{"display_name":"Saurabh"}') returning id into u;
  end if;

  -- start clean (re-runnable)
  delete from insight_feedback where user_id = u;
  delete from insight_runs where user_id = u;
  delete from transactions where user_id = u;
  delete from payees where user_id = u;
  delete from accounts where user_id = u;
  update profiles set display_name = 'Saurabh', onboarded_at = now(), acct_switch_candidate = null, acct_switch_count = 0, reminder_prompted = true where id = u;

  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order, is_default)
    values (u, 'Monzo', 'Monzo', 'current', 0, '2026-04-01', true, 1, true) returning id into monzo;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'HSBC Premier', 'HSBC', 'current', 0, '2026-04-01', true, 2) returning id into hsbc;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'Cash', null, 'cash', 0, '2026-04-01', true, 3) returning id into cash;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'Amex Gold', 'American Express', 'credit_card', 0, '2026-04-01', true, 4) returning id into amex;
  insert into accounts (user_id, name, institution, type, opening_balance_pence, opening_date, counts_as_cash, sort_order)
    values (u, 'Marcus', 'Goldman Sachs', 'savings', 0, '2026-04-01', false, 5) returning id into marcus;

  create temp table seed_txn (
    type txn_type, amount bigint, acct uuid, counter uuid, cat text, payee text, note text, on_date date, at_ts timestamptz
  ) on commit drop;
  create temp table plan (cat text, t18 bigint[], a18 bigint[], n_t int, n_a int, acct uuid, subs text[], shares numeric[], payees text[]) on commit drop;

  -- ---------- October 2026, 1 to 18: every transaction listed (52 = 50 expenses + 2 income) ----------
  -- Sub-category totals are PRD Appendix A: Home 1,812.40 (Rent 1,600 · Council tax 142 · Energy 48.40 · Broadband 22) · Groceries 386.25
  -- (Supermarket 314.70 · Specialist 48.90 · Household 22.65) · Eating out 312.60 in 21 visits (Restaurants 142.50 ×3 · Coffee 76.80 ×12 ·
  -- Takeaway 58.30 ×3 · Work lunches 28.60 ×2 · Drinks 6.40) · Transport 214.80 · Shopping 178.90 · Bills 118.43 · Health 96.00 · Entertainment 74.97 · Gifts 42.50
  insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts)
  select t.type::txn_type, t.amount, case t.acct when 'M' then monzo when 'H' then hsbc when 'A' then amex when 'C' then cash end, t.cat, t.payee,
         make_date(2026, 10, t.d), (make_date(2026, 10, t.d)::text || ' ' || t.tm || ' Europe/London')::timestamptz
    from (values
      -- Home (fixed)
      (1,'09:00','expense',160000,'M','Rent & mortgage','Foxtons Lettings'), (3,'07:30','expense',4840,'M','Energy','Octopus Energy'),
      (5,'07:30','expense',2200,'M','Broadband & TV','Hyperoptic'), (7,'07:30','expense',14200,'M','Council tax','Camden Council'),
      -- Groceries
      (2,'18:05','expense',9240,'H','Supermarket','Tesco'), (8,'18:20','expense',8430,'M','Supermarket','Sainsbury''s'),
      (12,'18:10','expense',8928,'H','Supermarket','Tesco'), (17,'17:30','expense',4872,'M','Supermarket','Waitrose'),
      (14,'12:15','expense',2000,'M','Specialist shops','Borough Market'), (15,'11:40','expense',2890,'M','Specialist shops','Neal''s Yard Dairy'),
      (6,'11:10','expense',2265,'A','Household supplies','Robert Dyas'),
      -- Eating out: Restaurants ×3
      (3,'19:30','expense',3100,'A','Restaurants','Franco Manca'), (9,'19:45','expense',2500,'A','Restaurants','Honest Burgers'),
      (17,'20:40','expense',8650,'A','Restaurants','Dishoom Kensington'),
      -- Coffee & snacks ×12 (Gail's Bakery six times at £6.40)
      (2,'08:55','expense',640,'A','Coffee & snacks','Gail''s Bakery'), (3,'08:20','expense',680,'A','Coffee & snacks','Starbucks'),
      (5,'08:50','expense',640,'A','Coffee & snacks','Gail''s Bakery'), (6,'08:35','expense',725,'A','Coffee & snacks','Black Sheep Coffee'),
      (8,'08:52','expense',640,'A','Coffee & snacks','Gail''s Bakery'), (10,'09:05','expense',830,'A','Coffee & snacks','Costa Coffee'),
      (11,'08:48','expense',640,'A','Coffee & snacks','Gail''s Bakery'), (13,'08:40','expense',550,'A','Coffee & snacks','Pret A Manger'),
      (14,'08:51','expense',640,'A','Coffee & snacks','Gail''s Bakery'), (15,'08:30','expense',640,'A','Coffee & snacks','Costa Coffee'),
      (16,'08:50','expense',415,'A','Coffee & snacks','Costa Coffee'), (18,'09:12','expense',640,'A','Coffee & snacks','Gail''s Bakery'),
      -- Takeaway & delivery ×3
      (4,'20:30','expense',1940,'A','Takeaway & delivery','Deliveroo'), (11,'20:10','expense',1890,'A','Takeaway & delivery','Deliveroo'),
      (15,'19:50','expense',2000,'A','Takeaway & delivery','Deliveroo'),
      -- Work lunches ×2, Drinks ×1
      (1,'12:40','expense',1660,'A','Work lunches','Pret A Manger'), (16,'13:05','expense',1200,'A','Work lunches','Itsu'),
      (15,'21:30','expense',640,'A','Drinks','The Crown Tavern'),
      -- Transport
      (2,'08:10','expense',14260,'A','TfL & rail','TfL'), (12,'22:10','expense',4300,'A','Taxis','Uber'), (17,'23:05','expense',1420,'A','Taxis','Uber'),
      (13,'10:30','expense',1500,'A','Parking & tolls','NCP Parking'),
      -- Shopping
      (6,'13:20','expense',6550,'A','Clothing & shoes','Uniqlo'), (11,'14:00','expense',1500,'A','Homeware','Dunelm'),
      (13,'21:15','expense',5331,'A','Online & general','Amazon'), (16,'21:40','expense',4509,'A','Online & general','Amazon'),
      -- Bills
      (4,'09:00','expense',3600,'H','Mobile','Three Mobile'), (8,'09:00','expense',6243,'H','Insurance','Admiral Insurance'),
      (12,'09:00','expense',2000,'H','Bank fees & interest','HSBC Account Fee'),
      -- Health
      (3,'07:00','expense',7500,'M','Gym & fitness','PureGym'), (10,'16:30','expense',450,'M','Pharmacy','Boots'), (17,'12:10','expense',1650,'M','Pharmacy','Boots'),
      -- Entertainment
      (2,'06:00','expense',1299,'A','Streaming & apps','Netflix'), (5,'06:00','expense',2898,'A','Streaming & apps','Apple One'),
      (9,'21:00','expense',3300,'A','Events & culture','Curzon Cinema'),
      -- Family & giving
      (8,'11:00','expense',4250,'M','Gifts','Interflora'),
      -- Income
      (15,'06:00','income',1840,'H','Interest & dividends','HSBC Interest'), (16,'10:00','income',12160,'M','Refunds','ASOS')
    ) as t(d, tm, type, amount, acct, cat, payee);

  -- ---------- April to September ----------
  -- Home and Travel are planned by parent. t18 = spend on days 1-18 · a18 = spend from the 19th. September lands on £3,604.10 by day 18 and
  -- £5,316.20 in full; Travel's September absorbs whatever the planned sub-categories leave, so those two totals never move.
  insert into plan values
   ('Home',          '{180520,181140,179880,180360,181420,180800}', '{0,0,0,0,0,0}',                                 4, 0, monzo, '{Energy,Broadband & TV,Water}', '{50,25,25}', '{Octopus Energy,Hyperoptic,Thames Water}'),
   ('Travel',        '{0,0,31200,0,118000,36787}',                  '{0,0,0,0,40000,11940}',                         2, 1, amex,  '{Flights,Hotels}', '{50,50}', '{British Airways,Booking.com,Trainline}');

  -- Every other category is planned by sub-category: per month, what was spent on days 1-18 (t18) and from the 19th (a18). Each sub's six
  -- t18 values have the "usual by day 18" of PRD Appendix A as their median (Supermarket £298, Restaurants £105, ...), and Eating out's
  -- month totals are May £218.40 · Jun £243.10 · Jul £331.20 · Aug £287.60 · Sep £264.10, as in the Category detail mock-up.
  create temp table plan_sub (cat text, sub text, t18 bigint[], a18 bigint[], n_t int, n_a int, acct uuid, payees text[]) on commit drop;
  insert into plan_sub values
   ('Groceries', 'Supermarket', '{31886,27714,29800,29800,26820,30992}', '{12080,11360,12720,11840,12880,13464}', 4, 3, monzo, '{Tesco,Sainsbury''s,Waitrose,M&S Food}'),
   ('Groceries', 'Specialist shops', '{4601,3999,4300,4300,3870,4472}', '{1812,1704,1908,1776,1932,2020}', 2, 1, monzo, '{Borough Market,Neal''s Yard Dairy}'),
   ('Groceries', 'Household supplies', '{2140,1860,2000,2000,1800,2080}', '{1208,1136,1272,1184,1288,1346}', 1, 1, monzo, '{Robert Dyas,Dunelm}'),
   ('Transport', 'TfL & rail', '{19046,16554,17800,17800,16020,18512}', '{5520,6840,5280,7260,6180,5892}', 2, 2, amex, '{TfL,Trainline}'),
   ('Transport', 'Taxis', '{6206,5394,5800,5800,5220,6032}', '{2300,2850,2200,3025,2575,2455}', 2, 1, amex, '{Uber}'),
   ('Transport', 'Parking & tolls', '{1605,1395,1500,1500,1350,1560}', '{1380,1710,1320,1815,1545,1473}', 1, 1, amex, '{NCP Parking}'),
   ('Shopping', 'Online & general', '{9630,8370,9000,9000,8100,9360}', '{4920,7560,3800,8840,5920,40016}', 2, 2, amex, '{Amazon,Apple}'),
   ('Shopping', 'Clothing & shoes', '{10058,8742,9400,9400,8460,9776}', '{4920,7560,3800,8840,5920,40016}', 1, 1, amex, '{Uniqlo,Zara}'),
   ('Shopping', 'Homeware', '{2140,1860,2000,2000,1800,2080}', '{2460,3780,1900,4420,2960,20008}', 1, 1, amex, '{John Lewis,Dunelm}'),
   ('Health', 'Gym & fitness', '{7500,7500,7500,7500,7500,7500}', '{2250,2550,1500,3000,2250,6000}', 1, 1, monzo, '{PureGym}'),
   ('Health', 'Pharmacy', '{1391,1209,1300,1300,1170,1352}', '{2250,2550,1500,3000,2250,6000}', 2, 1, monzo, '{Boots}'),
   ('Entertainment', 'Streaming & apps', '{4170,3624,3897,3897,3507,4053}', '{1650,1210,3575,1430,4455,2128}', 3, 1, amex, '{Netflix,Spotify,Apple TV+}'),
   ('Entertainment', 'Events & culture', '{3427,2979,3203,3203,2883,3331}', '{1350,990,2925,1170,3645,1742}', 1, 1, amex, '{Curzon Cinema}'),
   ('Family & giving', 'Gifts', '{5885,5115,5500,5500,4950,5720}', '{4000,6000,2500,3500,5000,12000}', 2, 1, hsbc, '{Interflora}'),
   ('Eating out', 'Restaurants', '{11710,9850,11150,4920,2950,11205}', '{7700,0,0,12397,12397,1271}', 3, 2, amex, '{Dishoom,Franco Manca,Pizza Express,Wagamama,Honest Burgers}'),
   ('Eating out', 'Coffee & snacks', '{5905,5065,5745,2575,1435,5735}', '{1400,640,290,2254,2254,231}', 9, 2, amex, '{Gail''s Bakery,Costa Coffee,Starbucks,Pret A Manger}'),
   ('Eating out', 'Takeaway & delivery', '{4750,4035,4575,1925,1230,4565}', '{2800,0,0,4508,4508,462}', 3, 2, amex, '{Deliveroo}'),
   ('Eating out', 'Work lunches', '{2020,1780,2020,850,465,2025}', '{2100,0,0,3381,3381,346}', 2, 1, amex, '{Pret A Manger,Itsu}'),
   ('Eating out', 'Drinks', '{615,470,530,310,140,570}', '{0,0,0,0,0,0}', 1, 1, amex, '{The Crown Tavern}'),
   ('Bills', 'Mobile', '{3600,3600,3600,3600,3600,3600}', '{0,0,0,0,0,0}', 1, 0, hsbc, '{Three Mobile}'),
   ('Bills', 'Insurance', '{6243,6243,6243,6243,6243,6243}', '{0,0,0,0,0,0}', 1, 0, hsbc, '{Admiral Insurance}'),
   ('Bills', 'Bank fees & interest', '{2100,1850,1957,1957,1800,2060}', '{2400,2400,2400,2400,2400,2400}', 1, 1, hsbc, '{HSBC Account Fee}');

  for m in 1..6 loop
    mdate := months[m];
    mend := (date_trunc('month', mdate) + interval '1 month - 1 day')::date;
    for c in select * from plan loop
      for half in 1..2 loop
        total := case when half = 1 then c.t18[m] else c.a18[m] end;
        cnt := case when half = 1 then c.n_t else c.n_a end;
        continue when total <= 0 or cnt <= 0;
        first_day := case when half = 1 then 1 else 19 end;
        span := case when half = 1 then 18 else extract(day from mend)::int - 18 end;

        if c.cat = 'Home' then
          -- the rent is fixed; the rest of the household bills split by share (Energy / Broadband / Water)
          insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts) values
            ('expense', 165000, c.acct, 'Rent & mortgage', 'Foxtons Lettings', mdate, (mdate::text || ' 09:00 Europe/London')::timestamptz);
          rem_total := total - 165000;
          for k in 1..3 loop
            sub_total := case when k < 3 then round(rem_total * c.shares[k] / 100) else rem_total end;
            rem_total := rem_total - sub_total;
            insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts) values
              ('expense', sub_total, c.acct, c.subs[k], c.payees[k], mdate + (2 * k), ((mdate + (2 * k))::text || ' 07:30 Europe/London')::timestamptz);
          end loop;
          continue;
        end if;

        -- split the parent total across its sub-categories by share, then each part into a few transactions
        nsubs := array_length(c.subs, 1);
        rem_total := total;
        for k in 1..nsubs loop
          sub_total := case when k < nsubs then round(total * c.shares[k] / 100) else rem_total end;
          rem_total := rem_total - sub_total;
          per := greatest(1, round(cnt * c.shares[k] / 100.0)::int);
          left_amt := sub_total;
          for idx in 1..per loop
            if idx < per then
              each_amt := least(left_amt, round(left_amt::numeric / (per - idx + 1) * (0.7 + (abs(hashtext(c.cat || k || '-' || idx || '-' || m || half)) % 60) / 100.0)));
            else
              each_amt := left_amt;
            end if;
            left_amt := left_amt - each_amt;
            continue when each_amt <= 0;
            day_n := first_day + (abs(hashtext(c.cat || k || '-' || idx || '-' || m || half || 'd')) % span);
            hh := 8 + (abs(hashtext(c.cat || k || '-' || idx || '-' || m || half || 't')) % 13);
            mi := abs(hashtext(c.cat || k || '-' || idx || '-' || m || half || 'm')) % 60;
            alt := case c.acct when amex then monzo when monzo then hsbc else c.acct end;
            insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts) values
              ('expense', each_amt, case when (idx + k + m) % 3 = 0 then alt else c.acct end, c.subs[k],
               c.payees[1 + (abs(hashtext(c.cat || k || '-' || idx || '-' || m || half || 'p')) % array_length(c.payees, 1))],
               mdate + (day_n - 1),
               ((mdate + (day_n - 1))::text || ' ' || lpad(hh::text, 2, '0') || ':' || lpad(mi::text, 2, '0') || ' Europe/London')::timestamptz);
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;

  for m in 1..6 loop
    mdate := months[m];
    for c in select * from plan_sub loop
      for half in 1..2 loop
        total := case when half = 1 then c.t18[m] else c.a18[m] end;
        cnt := case when half = 1 then c.n_t else c.n_a end;
        continue when total <= 0 or cnt <= 0;
        first_day := case when half = 1 then 1 else 19 end;
        span := case when half = 1 then 18 else extract(day from (date_trunc('month', mdate) + interval '1 month - 1 day'))::int - 18 end;
        per := least(cnt, greatest(1, (total / 400)::int));          -- a few small purchases, never a £4 purchase split in three
        left_amt := total;
        for idx in 1..per loop
          if idx < per then
            each_amt := least(left_amt, round(left_amt::numeric / (per - idx + 1) * (0.7 + (abs(hashtext(c.sub || '-' || idx || '-' || m || half)) % 60) / 100.0)));
          else
            each_amt := left_amt;
          end if;
          left_amt := left_amt - each_amt;
          continue when each_amt <= 0;
          day_n := first_day + (abs(hashtext(c.sub || '-' || idx || '-' || m || half || 'd')) % span);
          hh := 8 + (abs(hashtext(c.sub || '-' || idx || '-' || m || half || 't')) % 13);
          mi := abs(hashtext(c.sub || '-' || idx || '-' || m || half || 'm')) % 60;
          alt := case c.acct when amex then monzo when monzo then hsbc else c.acct end;
          insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts) values
            ('expense', each_amt, case when (idx + m) % 3 = 0 then alt else c.acct end, c.sub,
             c.payees[1 + (abs(hashtext(c.sub || '-' || idx || '-' || m || half || 'p')) % array_length(c.payees, 1))],
             mdate + (day_n - 1),
             ((mdate + (day_n - 1))::text || ' ' || lpad(hh::text, 2, '0') || ':' || lpad(mi::text, 2, '0') || ' Europe/London')::timestamptz);
        end loop;
      end loop;
    end loop;
  end loop;

  -- Top up days 19-30 of April-August so each month's late spending matches the pattern in the mock-up
  -- (projected October £5,062 = £3,236.85 + the median late-month spend of £1,825.15).
  for m in 1..5 loop
    mdate := months[m];
    total := (array[182530, 179000, 196000, 182500, 190000])[m]
             - coalesce((select sum(amount) from seed_txn where type = 'expense' and on_date >= mdate + 18 and on_date < (mdate + interval '1 month')::date), 0);
    if total > 0 then
      insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts) values
        ('expense', round(total * 0.4), amex, 'Online & general', 'Amazon', mdate + 20, ((mdate + 20)::text || ' 20:15 Europe/London')::timestamptz),
        ('expense', round(total * 0.3), amex, 'Homeware', 'John Lewis', mdate + 23, ((mdate + 23)::text || ' 13:05 Europe/London')::timestamptz),
        ('expense', total - round(total * 0.4) - round(total * 0.3), amex, 'Clothing & shoes', 'Uniqlo', mdate + 26, ((mdate + 26)::text || ' 15:40 Europe/London')::timestamptz);
    end if;
  end loop;

  -- income, savings, card payments, a cash top-up and one reconciliation
  insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts)
  select 'income', 515000, monzo, 'Salary', 'Northwind Ltd', make_date(2026, mm, 25), (make_date(2026, mm, 25)::text || ' 06:00 Europe/London')::timestamptz from generate_series(4, 9) mm;
  insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts)
  select 'income', 1840, hsbc, 'Interest & dividends', 'HSBC Interest', make_date(2026, mm, 15), (make_date(2026, mm, 15)::text || ' 06:00 Europe/London')::timestamptz from generate_series(4, 9) mm;
  insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts) values
    ('income', 60000, monzo, 'Freelance & consulting', 'Brightside Studio', '2026-06-12', '2026-06-12 10:00 Europe/London');
  insert into seed_txn (type, amount, acct, counter, on_date, at_ts, note)
  select 'transfer', 50000, monzo, marcus, make_date(2026, mm, 26), (make_date(2026, mm, 26)::text || ' 07:00 Europe/London')::timestamptz, 'Monthly savings' from generate_series(4, 9) mm;
  insert into seed_txn (type, amount, acct, counter, on_date, at_ts, note)
  select 'transfer', 118000 + (mm * 3700), monzo, amex, make_date(2026, mm, 4), (make_date(2026, mm, 4)::text || ' 08:00 Europe/London')::timestamptz, 'Amex bill' from generate_series(5, 9) mm;
  insert into seed_txn (type, amount, acct, counter, on_date, at_ts, note) values
    ('transfer', 10000, hsbc, cash, '2026-06-10', '2026-06-10 12:00 Europe/London', 'Cash withdrawal'),
    ('transfer', 10000, hsbc, cash, '2026-09-10', '2026-09-10 12:00 Europe/London', 'Cash withdrawal');
  insert into seed_txn (type, amount, acct, on_date, at_ts, note) values
    ('adjustment', 1200, cash, '2026-07-14', '2026-07-14 12:00 Europe/London', 'Balance adjustment');

  -- payee memory: the last category and account used with each payee
  insert into payees (user_id, name, default_category_id, default_account_id, use_count, last_used_at)
  select u, s.payee,
         (array_agg(cat.id order by s.on_date desc, s.at_ts desc))[1],
         (array_agg(s.acct order by s.on_date desc, s.at_ts desc))[1],
         count(*), max(s.at_ts)
    from seed_txn s join categories cat on cat.user_id = u and cat.name = s.cat
   where s.payee is not null and s.type in ('expense', 'income')
   group by s.payee;

  insert into transactions (user_id, client_id, type, amount_pence, account_id, counter_account_id, category_id, payee_id, note, occurred_on, occurred_at, source, created_at)
  select u, gen_random_uuid(), s.type, s.amount, s.acct, s.counter, cat.id, p.id, s.note, s.on_date, s.at_ts, 'app', s.at_ts
    from seed_txn s
    left join categories cat on cat.user_id = u and cat.name = s.cat
    left join payees p on p.user_id = u and p.name = s.payee
   order by s.on_date, s.at_ts;

  -- Bills (PRD §6.9): the regular payments in this data become recurring items whose past occurrences are the transactions
  -- already there, plus four still to come this month (£34.97 of expenses and a £500 transfer to Marcus on the 26th).
  create temp table seed_bill (payee text, cat text, acct uuid, amt bigint, varies boolean, dom int, nextdue date) on commit drop;
  insert into seed_bill values
    ('Foxtons Lettings',  'Rent & mortgage', monzo, 160000, false, 1, '2026-11-01'),
    ('Camden Council',    'Council tax',     monzo,  14200, false, 7, '2026-11-07'),
    ('PureGym',           'Gym & fitness',   monzo,   7500, false, 3, '2026-11-03'),
    ('Octopus Energy',    'Energy',          monzo,   4840, true,  3, '2026-11-03'),
    ('Three Mobile',      'Mobile',          hsbc,    3600, false, 4, '2026-11-04'),
    ('Hyperoptic',        'Broadband & TV',  monzo,   2200, false, 5, '2026-11-05'),
    ('Admiral Insurance', 'Insurance',       hsbc,    6243, false, 8, '2026-11-08'),
    ('Netflix',           'Streaming & apps', amex,   1299, false, 2, '2026-11-02'),
    ('Apple One',         'Streaming & apps', amex,   2898, false, 5, '2026-11-05'),
    ('Spotify',           'Streaming & apps', amex,   1299, false, 22, '2026-10-22'),
    ('Disney+',           'Streaming & apps', amex,    899, false, 24, '2026-10-24'),
    ('YouTube Premium',   'Streaming & apps', amex,   1299, false, 27, '2026-10-27');

  insert into payees (user_id, name, default_category_id)
  select u, b.payee, (select id from categories where user_id = u and name = b.cat)
    from seed_bill b where not exists (select 1 from payees p where p.user_id = u and p.name = b.payee);

  insert into recurring_items (user_id, type, amount_pence, amount_varies, account_id, category_id, payee_id, frequency, day_of_month, starts_on, next_due_on)
  select u, 'expense', b.amt, b.varies, b.acct, cat.id, p.id, 'monthly', b.dom,
         coalesce((select min(t.occurred_on) from transactions t where t.payee_id = p.id), b.nextdue), b.nextdue
    from seed_bill b
    join categories cat on cat.user_id = u and cat.name = b.cat
    join payees p on p.user_id = u and p.name = b.payee;

  insert into recurring_items (user_id, type, amount_pence, account_id, counter_account_id, frequency, day_of_month, starts_on, next_due_on)
  values (u, 'transfer', 50000, monzo, marcus, 'monthly', 26, '2026-10-26', '2026-10-26');

  -- the earlier payments are the transactions already in the ledger
  update transactions t set recurring_id = i.id, source = 'recurring'
    from recurring_items i
   where t.user_id = u and i.user_id = u and t.payee_id = i.payee_id and t.type = 'expense' and t.category_id = i.category_id and t.occurred_on < '2026-10-19'
     and extract(day from t.occurred_on) = i.day_of_month;
  insert into recurring_occurrences (user_id, item_id, due_on, scheduled_on, status, transaction_id, amount_pence)
  select u, t.recurring_id, t.occurred_on, t.occurred_on, case when i.amount_varies then 'confirmed' else 'logged' end::occur_status, t.id, t.amount_pence
    from transactions t join recurring_items i on i.id = t.recurring_id
   where t.user_id = u and t.recurring_id is not null;

  -- opening balances are set so today's balances are exactly the mock-up figures
  update accounts a set opening_balance_pence = v.target - coalesce((select b.balance_pence from account_balances('2026-10-18') b where b.account_id = a.id), 0)
    from (values (monzo, 321408::bigint), (hsbc, 248620::bigint), (cash, 25000::bigint), (amex, -118473::bigint), (marcus, 1240000::bigint)) as v(id, target)
   where a.id = v.id;
end
$seed$;
