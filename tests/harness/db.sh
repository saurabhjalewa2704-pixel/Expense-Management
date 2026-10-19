#!/usr/bin/env bash
# Shared helpers for the local Postgres used by the SQL tests and the E2E stack.
# Postgres refuses to run as root, so the server runs as the `postgres` OS user.
set -euo pipefail
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HARNESS_DIR/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}"
PGDATA="${STERLING_PGDATA:-/tmp/sterling-pg/data}"
PGPORT="${STERLING_PGPORT:-54322}"
PGSOCK=/tmp/sterling-pg/sock
export PGHOST=127.0.0.1 PGPORT PGUSER=postgres

as_pg() { if [ "$(id -u)" = "0" ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

pg_start() {
  if [ ! -d "$PGDATA" ]; then
    mkdir -p /tmp/sterling-pg "$PGSOCK"; chown -R postgres /tmp/sterling-pg 2>/dev/null || true
    as_pg "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
  fi
  mkdir -p "$PGSOCK"; chown -R postgres /tmp/sterling-pg 2>/dev/null || true
  if ! "$PGBIN/pg_isready" -q -h 127.0.0.1 -p "$PGPORT"; then
    as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -o "-p $PGPORT -k $PGSOCK -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
      -l /tmp/sterling-pg/pg.log -w start >/dev/null
  fi
}
pg_stop() { as_pg "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true; }

# fresh_db <name>: drop and recreate a database with the stub + all migrations applied.
fresh_db() {
  local db="$1"
  psql -q -d postgres -c "drop database if exists $db with (force)" -c "create database $db"
  psql -q -v ON_ERROR_STOP=1 -d "$db" -c "alter database $db set search_path = public, extensions" \
       -f "$HARNESS_DIR/auth_stub.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f"
  done
  psql -q -v ON_ERROR_STOP=1 -d "$db" -c "grant usage on schema extensions to authenticated, service_role"
}
