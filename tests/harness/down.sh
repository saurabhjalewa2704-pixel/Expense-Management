#!/usr/bin/env bash
set -uo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/db.sh"
for p in gateway pgrst; do
  f="${ROOT:?}/.stack/$p.pid"
  if [ -s "$f" ]; then kill "$(cat "$f")" 2>/dev/null || true; : > "$f"; fi
done
pg_stop
