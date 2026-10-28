-- Trip insights, wrap-up and notifications (PRD v1.6 §6.12 TRIP-08).
-- A trip's insight run is an ordinary insight_runs row with scope 'trip' and the trip's id, so the same storage, feedback,
-- token cap and grounding validator apply. The Insights screen and Home read only runs with no trip_id.

alter table insight_runs add column trip_id uuid references trips on delete cascade;
alter table insight_runs drop constraint insight_runs_scope_check;
alter table insight_runs add constraint insight_runs_scope_check check (scope in ('weekly','monthly','adhoc','trip'));
create index insight_runs_trip on insight_runs (trip_id, created_at desc) where trip_id is not null;

-- When a trip was last edited, so its insights regenerate after an edit (debounced by the caller).
alter table trips add column updated_at timestamptz not null default now();
create function trips_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger trips_touch before update on trips for each row execute function trips_touch();

-- The newest change to a trip or to anything on it (security invoker, so RLS applies).
create function trip_changed_at(p_trip uuid)
returns timestamptz language sql stable as $$
  select greatest(t.updated_at, coalesce((select max(x.updated_at) from transactions x where x.trip_id = t.id), t.updated_at))
    from trips t where t.id = p_trip
$$;

-- The wrap-up push ("USA wrap-up ready") is sent once per trip; the evening-reminder permission is reused.
alter table trips add column wrapup_sent_at timestamptz;
alter table profiles add column trip_notify boolean not null default true;

revoke execute on function trip_changed_at(uuid) from public, anon;
grant execute on function trip_changed_at(uuid) to authenticated, service_role;
