#!/bin/sh
# The deploy gate behind INFRA §7.1 step 16: runs gate-check.sql through the psql command given as arguments, prints what
# it prints, and exits 0 only when psql succeeded, no line starts with FAIL and the output ends with `gate: pass`.
# Anything else (an error, no output, a FAIL line) exits 1.
#   infra/postgres/gate-check.sh docker compose exec -T postgres psql -U postgres -d polycarpic
set -u
[ $# -ge 1 ] || { echo "usage: gate-check.sh <psql command...>" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
out=$("$@" -X -tA -v ON_ERROR_STOP=1 -f - < "$here/gate-check.sql") || { printf '%s\n' "$out"; echo "gate: error (psql failed)"; exit 1; }
printf '%s\n' "$out"
case "$out" in *FAIL*) exit 1 ;; esac
[ "$out" = "gate: pass" ] || { echo "gate: error (no pass line)"; exit 1; }
