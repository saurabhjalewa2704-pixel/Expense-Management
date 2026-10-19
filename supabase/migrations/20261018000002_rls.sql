-- Sterling: row-level security (PRD §10.3). Every table, the same four policies.
do $$
declare t text;
begin
  foreach t in array array['accounts','categories','payees','transactions','recurring_rules','budgets',
                           'insight_runs','insight_feedback','api_tokens','push_subscriptions','no_spend_days']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid())', t || '_select', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid())', t || '_insert', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid())', t || '_delete', t);
  end loop;
end $$;

alter table profiles enable row level security;
create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_delete on profiles for delete using (id = auth.uid());

-- The data API is for signed-in users only. anon gets nothing.
revoke all on all tables in schema public from anon;
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, service_role;
