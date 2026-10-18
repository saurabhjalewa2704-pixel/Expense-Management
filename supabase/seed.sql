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
  update profiles set display_name = 'Saurabh', onboarded_at = now(), acct_switch_candidate = null, acct_switch_count = 0 where id = u;

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
  insert into seed_txn (type, amount, acct, cat, payee, on_date, at_ts)
  select t.type::txn_type, t.amount, case t.acct when 'M' then monzo when 'H' then hsbc when 'A' then amex when 'C' then cash end, t.cat, t.payee,
         make_date(2026, 10, t.d), (make_date(2026, 10, t.d)::text || ' ' || t.tm || ' Europe/London')::timestamptz
    from (values
      -- Home
      (1,'09:00','expense',165000,'M','Rent & mortgage','Foxtons Lettings'), (3,'07:30','expense',9240,'M','Energy','Octopus Energy'),
      (5,'07:30','expense',3500,'M','Broadband & TV','Hyperoptic'), (7,'07:30','expense',3500,'M','Water','Thames Water'),
      -- Groceries
      (2,'18:05','expense',6218,'H','Supermarket','Tesco'), (5,'17:40','expense',5430,'M','Supermarket','Sainsbury''s'),
      (8,'18:20','expense',7145,'M','Supermarket','Waitrose'), (10,'17:55','expense',3890,'A','Supermarket','M&S Food'),
      (12,'18:10','expense',6675,'H','Supermarket','Tesco'), (14,'12:15','expense',2000,'M','Specialist shops','Borough Market'),
      (15,'11:40','expense',2395,'M','Specialist shops','Neal''s Yard Dairy'), (17,'17:30','expense',4872,'M','Supermarket','Waitrose'),
      -- Eating out
      (1,'12:40','expense',845,'A','Work lunches','Pret A Manger'), (3,'19:30','expense',3420,'A','Restaurants','Franco Manca'),
      (4,'20:00','expense',4180,'A','Restaurants','Pizza Express'), (16,'13:05','expense',1200,'A','Work lunches','Itsu'),
      (9,'19:45','expense',3050,'A','Restaurants','Honest Burgers'), (11,'20:15','expense',3860,'A','Restaurants','Wagamama'),
      (16,'08:50','expense',415,'A','Coffee & snacks','Costa Coffee'), (14,'19:10','expense',1200,'A','Restaurants','Nando''s'),
      (15,'19:20','expense',1200,'A','Restaurants','Nando''s'), (15,'21:30','expense',2600,'A','Drinks','The Crown Tavern'),
      (17,'20:40','expense',8650,'A','Restaurants','Dishoom Kensington'), (18,'09:12','expense',640,'A','Coffee & snacks','Gail''s Bakery'),
      -- Transport
      (2,'08:10','expense',4500,'A','TfL & rail','TfL'), (9,'08:05','expense',4500,'A','TfL & rail','TfL'), (15,'08:12','expense',4500,'A','TfL & rail','TfL'),
      (6,'17:50','expense',3860,'A','TfL & rail','Trainline'), (12,'22:10','expense',1200,'A','Taxis','Uber'), (17,'23:05','expense',1420,'A','Taxis','Uber'),
      (13,'10:30','expense',1500,'A','Parking & tolls','NCP Parking'),
      -- Shopping
      (6,'13:20','expense',5990,'A','Clothing & shoes','Uniqlo'), (11,'14:00','expense',4995,'A','Homeware','John Lewis'),
      (13,'21:15','expense',2396,'A','Online & general','Amazon'), (16,'21:40','expense',4509,'A','Online & general','Amazon'),
      -- Bills
      (4,'09:00','expense',2800,'H','Mobile','Three Mobile'), (8,'09:00','expense',6243,'H','Insurance','Admiral Insurance'),
      (12,'09:00','expense',300,'H','Bank fees & interest','HSBC Account Fee'), (15,'10:00','expense',2500,'H','Professional fees','Bright Accountants'),
      -- Health
      (3,'07:00','expense',4950,'M','Gym & fitness','PureGym'), (10,'16:30','expense',3000,'M','Medical & dental','Smile Dental'), (17,'12:10','expense',1650,'M','Pharmacy','Boots'),
      -- Entertainment
      (2,'06:00','expense',1299,'A','Streaming & apps','Netflix'), (2,'06:00','expense',1199,'A','Streaming & apps','Spotify'),
      (5,'06:00','expense',899,'A','Streaming & apps','Apple TV+'), (9,'21:00','expense',2200,'A','Events & culture','Curzon Cinema'),
      (12,'13:30','expense',950,'M','Books & media','Waterstones'), (14,'13:10','expense',950,'M','Books & media','Foyles'),
      -- Family & giving
      (8,'11:00','expense',3000,'M','Gifts','Interflora'), (15,'11:30','expense',1250,'H','Charity','British Heart Foundation'),
      -- Income
      (15,'06:00','income',1840,'H','Interest & dividends','HSBC Interest'), (16,'10:00','income',12160,'M','Refunds','ASOS')
    ) as t(d, tm, type, amount, acct, cat, payee);

  -- ---------- April to September: monthly plan by parent category ----------
  -- t18 = spend on days 1-18 · a18 = spend from the 19th. Chosen so each category's six-month median by day 18 matches the mock-ups
  -- (Groceries £361.20, Eating out £226.10, Transport £251.10) and September lands on £3,604.10 / £5,316.20.
  insert into plan values
   ('Home',          '{180520,181140,179880,180360,181420,180800}', '{0,0,0,0,0,0}',                                 4, 0, monzo, '{Energy,Broadband & TV,Water}', '{50,25,25}', '{Octopus Energy,Hyperoptic,Thames Water}'),
   ('Groceries',     '{36400,35210,35840,36845,35530,37240}',       '{15100,14200,15900,14800,16100,16830}',        7, 6, monzo, '{Supermarket,Specialist shops}', '{85,15}', '{Tesco,Sainsbury''s,Waitrose,M&S Food,Borough Market}'),
   ('Eating out',    '{20975,19840,24130,22600,25510,22620}',       '{12900,14300,16800,15200,17900,14250}',        9, 7, amex,  '{Restaurants,Coffee & snacks,Takeaway & delivery,Work lunches}', '{60,15,10,15}', '{Dishoom,Franco Manca,Pizza Express,Pret A Manger,Gail''s Bakery,Wagamama,Deliveroo,Itsu,Honest Burgers}'),
   ('Transport',     '{25490,24010,26800,23160,24730,26215}',       '{9200,11400,8800,12100,10300,9820}',           6, 4, amex,  '{TfL & rail,Taxis,Parking & tolls}', '{60,25,15}', '{TfL,Uber,Trainline,NCP Parking}'),
   ('Shopping',      '{16000,24560,19840,18999,30120,21430}',       '{12300,18900,9500,22100,14800,100040}',        3, 3, amex,  '{Clothing & shoes,Online & general,Homeware}', '{40,40,20}', '{Uniqlo,Amazon,John Lewis,Zara,Apple}'),
   ('Bills',         '{11955,11955,12140,11955,11955,11955}',       '{2400,2400,2400,2400,2400,2400}',              4, 1, hsbc,  '{Mobile,Insurance,Bank fees & interest,Professional fees}', '{25,50,5,20}', '{Three Mobile,Admiral Insurance,HSBC Account Fee,Bright Accountants}'),
   ('Health',        '{9600,6600,12600,9600,6600,5490}',            '{4500,5100,3000,6000,4500,12000}',             3, 2, monzo, '{Gym & fitness,Pharmacy,Medical & dental}', '{50,20,30}', '{PureGym,Boots,Smile Dental}'),
   ('Entertainment', '{7497,7497,9846,7497,12000,7297}',            '{3000,2200,6500,2600,8100,3870}',              4, 2, amex,  '{Streaming & apps,Events & culture,Books & media}', '{45,35,20}', '{Netflix,Spotify,Curzon Cinema,Waterstones,Foyles}'),
   ('Family & giving','{2500,5500,4250,3000,4250,3800}',           '{4000,6000,2500,3500,5000,12000}',             2, 2, hsbc,  '{Gifts,Charity}', '{60,40}', '{Interflora,British Heart Foundation,Oxfam}'),
   ('Travel',        '{0,0,31200,0,118000,43563}',                  '{0,0,0,0,40000,0}',                            2, 1, amex,  '{Flights,Hotels}', '{50,50}', '{British Airways,Booking.com,Trainline}');

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

  -- opening balances are set so today's balances are exactly the mock-up figures
  update accounts a set opening_balance_pence = v.target - coalesce((select b.balance_pence from account_balances('2026-10-18') b where b.account_id = a.id), 0)
    from (values (monzo, 321408::bigint), (hsbc, 248620::bigint), (cash, 25000::bigint), (amex, -118473::bigint), (marcus, 1240000::bigint)) as v(id, target)
   where a.id = v.id;
end
$seed$;
