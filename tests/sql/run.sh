#!/usr/bin/env bash
# Runs every tests/sql/*.test.sql against a throw-away database.
# Each file is plain SQL; a failed ASSERT/RAISE aborts with a non-zero exit (psql ON_ERROR_STOP).
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/../harness/db.sh"
pg_start
fresh_db sterling_test
status=0
for f in "$ROOT"/tests/sql/*.test.sql; do
  printf '• %s ... ' "$(basename "$f")"
  if out=$(psql -q -v ON_ERROR_STOP=1 -d sterling_test -f "$f" 2>&1); then echo ok; else echo FAILED; echo "$out"; status=1; fi
done

# the demo seed, applied to its own database, must reproduce the PRD Appendix A figures
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists sterling_seed with (force)" -c "create database sterling_seed" >/dev/null
fresh_db sterling_seed 2>/dev/null
psql -q -v ON_ERROR_STOP=1 -d sterling_seed -f "$ROOT/supabase/seed.sql" >/dev/null 2>&1 || { echo "seed.sql FAILED"; psql -v ON_ERROR_STOP=1 -d sterling_seed -f "$ROOT/supabase/seed.sql" 2>&1 | tail -5; status=1; }
for f in "$ROOT"/tests/sql/seed/*.test.sql; do
  printf '• seed/%s ... ' "$(basename "$f")"
  if out=$(psql -q -v ON_ERROR_STOP=1 -d sterling_seed -f "$f" 2>&1); then echo ok; else echo FAILED; echo "$out"; status=1; fi
done

# the trip demo seed (PRD Appendix A.2) in its own database, with the TRIP acceptance criteria
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists sterling_trip with (force)" -c "create database sterling_trip" >/dev/null
fresh_db sterling_trip 2>/dev/null
psql -q -v ON_ERROR_STOP=1 -d sterling_trip -f "$ROOT/supabase/seed_trip.sql" >/dev/null 2>&1 || { echo "seed_trip.sql FAILED"; psql -v ON_ERROR_STOP=1 -d sterling_trip -f "$ROOT/supabase/seed_trip.sql" 2>&1 | tail -5; status=1; }
for f in "$ROOT"/tests/sql/trip/*.test.sql; do
  [ -e "$f" ] || continue
  printf '• trip/%s ... ' "$(basename "$f")"
  if out=$(psql -q -v ON_ERROR_STOP=1 -d sterling_trip -f "$f" 2>&1); then echo ok; else echo FAILED; echo "$out"; status=1; fi
done
exit $status
