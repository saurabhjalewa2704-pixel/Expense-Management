#!/usr/bin/env bash
# Build the app, serve it, run Playwright against it, stop the server. Usage: scripts/e2e-prod.sh [playwright args...]
# Needs the test stack: npm run stack:up
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .stack/env ] || { echo "run 'npm run stack:up' first"; exit 1; }
set -a; source .stack/env; set +a
PORT="${E2E_PORT:-3200}"
pkill -f "[n]ext-server" 2>/dev/null || true
if [ "${SKIP_BUILD:-0}" != "1" ]; then npx next build || exit 1; fi
nohup npx next start -p "$PORT" > .stack/next.log 2>&1 &
SERVER=$!
for _ in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$PORT/sign-in" && break; sleep 1; done
E2E_PORT="$PORT" npx playwright test "$@"
STATUS=$?
kill "$SERVER" 2>/dev/null; pkill -f "[n]ext-server" 2>/dev/null
exit $STATUS
