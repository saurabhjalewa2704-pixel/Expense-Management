-- Sterling: "Ask Sterling" (natural-language questions about spending). Each turn keeps the question, the validated answer and the
-- figures it was allowed to quote, so a follow-up can refer back to them and the app can show "Numbers used".

create table ask_turns (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  question      text not null check (char_length(question) between 1 and 500),
  answer        text not null,
  facts         jsonb not null default '[]'::jsonb,       -- [{label, display}] returned by the tools for this turn
  used_fallback boolean not null default false,           -- true: the model's wording failed the grounding check, so the figures were listed instead
  model         text not null,
  input_tokens  int,
  output_tokens int,
  created_at    timestamptz not null default now()
);
create index ask_turns_user on ask_turns (user_id, created_at desc);

alter table ask_turns enable row level security;
create policy ask_turns_select on ask_turns for select using (user_id = auth.uid());
create policy ask_turns_insert on ask_turns for insert with check (user_id = auth.uid());
create policy ask_turns_update on ask_turns for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ask_turns_delete on ask_turns for delete using (user_id = auth.uid());

-- The biggest usual-spending expenses in a period (fixed costs included: the user asked). Pot transactions are not usual spending.
create function largest_transactions(p_from date, p_to date, p_limit int default 5, p_category uuid default null)
returns table (id uuid, payee_name text, category_name text, parent_category_name text, amount_pence bigint, occurred_on date)
language sql stable as $$
  select t.id, p.name, c.name, pc.name, t.amount_pence, t.occurred_on
    from transactions t
    left join payees p on p.id = t.payee_id
    left join categories c on c.id = t.category_id
    left join categories pc on pc.id = c.parent_id
   where t.deleted_at is null and t.type = 'expense' and t.pot_id is null
     and t.occurred_on between p_from and p_to
     and (p_category is null or t.category_id in (select x.id from categories x where x.id = p_category or x.parent_id = p_category))
   order by t.amount_pence desc, t.occurred_on desc
   limit least(greatest(coalesce(p_limit, 5), 1), 20)
$$;

create or replace function delete_all_my_data() returns void language plpgsql as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'Not signed in' using errcode = '28000'; end if;
  delete from ask_turns where user_id = v_uid;
  delete from insight_feedback where user_id = v_uid;
  delete from insight_runs where user_id = v_uid;
  delete from budgets where user_id = v_uid;
  delete from recurring_rules where user_id = v_uid;
  delete from no_spend_days where user_id = v_uid;
  delete from transactions where user_id = v_uid;
  delete from pots where user_id = v_uid;
  delete from payees where user_id = v_uid;
  delete from accounts where user_id = v_uid;
  delete from categories where parent_id is not null and user_id = v_uid;
  delete from categories where user_id = v_uid;
  update profiles set onboarded_at = null, acct_switch_candidate = null, acct_switch_count = 0,
                      last_reminder_on = null, reminder_prompted = false where id = v_uid;
  perform seed_default_categories(v_uid);
end $$;

grant select, insert, update, delete on ask_turns to authenticated, service_role;
revoke all on ask_turns from anon;
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
