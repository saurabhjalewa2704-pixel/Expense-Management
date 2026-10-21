-- A one-off pot transaction needs no category: the pot is what classifies it, and it never reaches the category analytics.
-- Every other expense or income still needs one; transfers and adjustments still must not have one.

do $$
declare c text;
begin
  for c in select conname from pg_constraint
            where conrelid = 'transactions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%category_id IS NOT NULL%'
  loop
    execute format('alter table transactions drop constraint %I', c);
  end loop;
end $$;

alter table transactions add constraint txn_category_rule check (
  (type in ('expense', 'income') and (category_id is not null or pot_id is not null))
  or (type not in ('expense', 'income') and category_id is null)
);

-- A pot's expenses by category, now with a "No category" row for the ones that have none.
create or replace function pot_by_category(p_pot uuid)
returns table (category_id uuid, name text, icon text, color text, total_pence bigint, txn_count int)
language sql stable as $$
  select c.id, coalesce(c.name, 'No category'), coalesce(c.icon, 'circle'), coalesce(c.color, 'stone'),
         sum(t.amount_pence)::bigint, count(*)::int
    from transactions t
    left join categories x on x.id = t.category_id
    left join categories c on c.id = coalesce(x.parent_id, x.id)
   where t.pot_id = p_pot and t.deleted_at is null and t.type = 'expense'
   group by c.id, c.name, c.icon, c.color
   order by (c.id is null), sum(t.amount_pence) desc, c.name
$$;

grant execute on all functions in schema public to authenticated, service_role;
revoke execute on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated, service_role;
