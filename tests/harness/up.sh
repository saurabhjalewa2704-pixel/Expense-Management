#!/usr/bin/env bash
# Starts Postgres, PostgREST and the gateway, and writes .stack/env for the app and Playwright.
# Usage: bash tests/harness/up.sh   (idempotent; STERLING_RESET=1 rebuilds the database)
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db.sh"
STACK="$ROOT/.stack"; mkdir -p "$STACK"
SECRET="super-secret-jwt-token-with-at-least-32-characters-long"
PGRST_BIN="${PGRST_BIN:-$STACK/postgrest}"

if [ ! -x "$PGRST_BIN" ]; then
  echo "• downloading PostgREST"
  curl -sSL -o "$STACK/pgrst.tar.xz" "https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz"
  tar -xJf "$STACK/pgrst.tar.xz" -C "$STACK"
fi

pg_start
if [ "${STERLING_RESET:-0}" = "1" ] || ! psql -Atq -d postgres -c "select 1 from pg_database where datname='sterling_dev'" | grep -q 1; then
  echo "• building sterling_dev"; fresh_db sterling_dev
  psql -q -d sterling_dev -c "alter role authenticator set search_path = public, extensions"
fi

stop_pid() {  # stop_pid <name>
  local f="${STACK:?}/$1.pid"
  if [ -f "$f" ]; then kill "$(cat "$f")" 2>/dev/null || true; : > "$f"; fi
}
stop_pid pgrst; stop_pid gateway
PGRST_DB_URI="postgres://authenticator:authenticator@127.0.0.1:$PGPORT/sterling_dev" PGRST_DB_SCHEMAS=public \
PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" PGRST_SERVER_PORT=54323 PGRST_SERVER_HOST=127.0.0.1 \
  nohup "$PGRST_BIN" > "$STACK/pgrst.log" 2>&1 & echo $! > "$STACK/pgrst.pid"
JWT_SECRET="$SECRET" DATABASE_URL="postgres://postgres@127.0.0.1:$PGPORT/sterling_dev" ALLOWED_EMAIL="${ALLOWED_EMAIL:-owner@sterling.local}" \
  nohup node "$HARNESS_DIR/gateway.mjs" > "$STACK/gateway.log" 2>&1 & echo $! > "$STACK/gateway.pid"

for _ in $(seq 1 60); do
  curl -sf http://127.0.0.1:54321/__keys >/dev/null 2>&1 && curl -s -o /dev/null -w '%{http_code}' -H "apikey: x" http://127.0.0.1:54323/ 2>/dev/null | grep -qE '^(200|401)$' && break
  sleep 0.5
done
KEYS=$(curl -sf http://127.0.0.1:54321/__keys)
ANON=$(node -e "console.log(JSON.parse(process.argv[1]).anonKey)" "$KEYS")
SERVICE=$(node -e "console.log(JSON.parse(process.argv[1]).serviceKey)" "$KEYS")
cat > "$STACK/env" <<ENV
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON
SUPABASE_SERVICE_ROLE_KEY=$SERVICE
ALLOWED_EMAIL=${ALLOWED_EMAIL:-owner@sterling.local}
CRON_SECRET=local-cron-secret
ENV
echo "stack up: gateway http://127.0.0.1:54321 (env in .stack/env)"
