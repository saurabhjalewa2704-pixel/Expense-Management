#!/usr/bin/env bash
# Build the app, serve it, run Playwright against it, stop the server. Usage: scripts/e2e-prod.sh [playwright args...]
# Needs the test stack: npm run stack:up
set -uo pipefail
cd "$(dirname "$0")/.."
[ -f .stack/env ] || { echo "run 'npm run stack:up' first"; exit 1; }
set -a; source .stack/env; set +a
# a throwaway public VAPID key (the private half was discarded) and a file standing in for the push service
export NEXT_PUBLIC_VAPID_PUBLIC_KEY="${NEXT_PUBLIC_VAPID_PUBLIC_KEY:-BOhikE_J3XWbyLOkZ_ri-eiUGlk3vd8fvyLUGb53g1NOpppyTRLNduPUM7iaL0CW_ShRvqLkRPc1IBnzOnc_-W4}"
export STERLING_ASK_STUB=1
export STERLING_HOLIDAYS_FILE="$PWD/tests/fixtures/bank-holidays.json"
export STERLING_PUSH_STUB="$PWD/.stack/push.log"
export STERLING_FX_STUB="USD=0.79,EUR=0.86,JPY=0.0052"      # fixed reference rates (GBP per unit), no network
if [ "${E2E_TRIPS:-0}" = "1" ]; then export STERLING_TEST_TODAY="${STERLING_TEST_TODAY:-2027-03-12}"; set -- --project=trips "$@"; fi
export STERLING_TEST_TODAY="${STERLING_TEST_TODAY:-2026-10-18}"
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
