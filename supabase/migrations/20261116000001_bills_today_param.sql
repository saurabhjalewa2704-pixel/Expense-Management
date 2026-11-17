-- The database's own clock (london_today()) decided two things the app asks about for a given day: whether a skipped payment can still be
-- undone, and which repeating payments are still "recent". The app and its tests pin "today", so the answer disagreed with what the
-- person was looking at (undoing a skip was refused once the real date passed the payment's date). Both now take the day from the
-- caller and fall back to the database's clock only when none is given.
drop function recurring_unskip(uuid);
create function recurring_unskip(p_occurrence uuid, p_today date default null) returns void language plpgsql as $$
declare o recurring_occurrences;
begin
  select * into o from recurring_occurrences where id = p_occurrence and status = 'skipped' for update;
  if o.id is null then raise exception 'Nothing to undo' using errcode = 'no_data_found'; end if;
  if o.due_on <= coalesce(p_today, london_today()) then raise exception 'That payment is already past its date' using errcode = 'check_violation'; end if;
  delete from recurring_occurrences where id = o.id;
  update recurring_items set next_due_on = o.due_on, ended_at = null where id = o.item_id and next_due_on > o.due_on or (id = o.item_id and ended_at is not null);
end $$;

drop function recurring_suggestions();
create function recurring_suggestions(p_today date default null)
returns table (payee_id uuid, payee_name text, category_id uuid, account_id uuid, amount_pence bigint,
               frequency recur_freq, day_of_month int, weekday int, month_of_year int, seen int, last_on date)
language sql stable as $$
  with t as (
    select x.payee_id, x.category_id, x.account_id, x.amount_pence, x.occurred_on,
           x.occurred_on - lag(x.occurred_on) over (partition by x.payee_id order by x.occurred_on) as gap,
           row_number() over (partition by x.payee_id order by x.occurred_on desc) as rn
      from transactions x
     where x.type = 'expense' and x.deleted_at is null and x.pot_id is null and x.payee_id is not null and x.source <> 'recurring'
       and x.occurred_on >= coalesce(p_today, london_today()) - 800
  ),
  recent as (select * from t where rn <= 6),
  agg as (
    select payee_id, count(*) as seen, max(occurred_on) as last_on,
           percentile_cont(0.5) within group (order by amount_pence) as med,
           min(amount_pence) as lo, max(amount_pence) as hi,
           min(gap) filter (where gap is not null) as gmin, max(gap) as gmax,
           (array_agg(category_id order by occurred_on desc))[1] as cat,
           (array_agg(account_id order by occurred_on desc))[1] as acct,
           (array_agg(amount_pence order by occurred_on desc))[1] as latest,
           (array_agg(occurred_on order by occurred_on desc))[1] as last_date
      from recent group by payee_id
  ),
  shaped as (
    select a.*, case
             when gmin >= 28 and gmax <= 31 then 'monthly'
             when gmin >= 6 and gmax <= 8 and seen >= 4 then 'weekly'
             when gmin >= 89 and gmax <= 92 then 'quarterly'
             when gmin >= 364 and gmax <= 366 then 'yearly' end::recur_freq as freq
      from agg a
     where seen >= 3 and lo >= med * 0.9 and hi <= med * 1.1
  )
  select s.payee_id, p.name, s.cat, s.acct, s.latest::bigint, s.freq,
         extract(day from s.last_date)::int, extract(isodow from s.last_date)::int, extract(month from s.last_date)::int, s.seen::int, s.last_on
    from shaped s
    join payees p on p.id = s.payee_id
   where s.freq is not null and s.cat is not null and s.last_on >= coalesce(p_today, london_today()) - case s.freq when 'weekly' then 21 when 'monthly' then 70 when 'quarterly' then 130 else 400 end
     and not exists (select 1 from recurring_items i where i.payee_id = s.payee_id and i.ended_at is null)
     and not exists (select 1 from recurring_dismissed d where d.payee_id = s.payee_id)
   order by s.latest desc
$$;

revoke execute on function recurring_unskip(uuid, date), recurring_suggestions(date) from anon, public;
grant execute on function recurring_unskip(uuid, date), recurring_suggestions(date) to authenticated, service_role;
