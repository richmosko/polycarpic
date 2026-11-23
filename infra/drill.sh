#!/usr/bin/env bash
# shellcheck disable=SC2034  # variables consumed by the sourced backup/restore-lib.sh
set -euo pipefail
# drill.sh: the INFRA §6.7 restore drill (POLY-99 R8). It runs restore.sh's selection and restore code (backup/restore-lib.sh) for BOTH --base
# and --dump into two throwaway containers and prints `PASS|FAIL|SKIP <id> <text>` per check, then DRILL PASSED, DRILL PASSED WITH SKIPS: <ids>
# or DRILL FAILED: <ids>.
#   drill.sh --identity <file> --read-credential <file> --bucket <name> --box-credential <file> [--instance <i>] [--before <UTC>] [--report <path>]
# Exit: 0 passed; 1 failed; 2 usage; 3 passed with skips. The GA gate (POLY-116) accepts exit 0 only.
ulimit -c 0
umask 077
PROG=drill.sh
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

usage() { echo "usage: drill.sh --identity <file> --read-credential <file> --bucket <name> --box-credential <file> [--instance <i>] [--before <UTC>] [--report <path>]" >&2; exit 2; }
die() { local code=$1; shift; echo "drill.sh: $*" >&2; exit "$code"; }

IDENTITY='' CRED='' BUCKET='' BOXCRED='' INSTANCE='' BEFORE='' BEFORE_ISO='' REPORT='' PLAIN_OK=0 SETTS=''
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY=${2:-}; shift 2 ;;
    --read-credential) CRED=${2:-}; shift 2 ;;
    --bucket) BUCKET=${2:-}; shift 2 ;;
    --box-credential) BOXCRED=${2:-}; shift 2 ;;
    --instance) INSTANCE=${2:-}; shift 2 ;;
    --before) BEFORE_ISO=${2:-}; shift 2 ;;
    --report) REPORT=${2:-}; shift 2 ;;
    --plaintext-disk-is-encrypted) PLAIN_OK=1; shift ;;
    *) usage ;;
  esac
done
[ -n "$IDENTITY" ] && [ -n "$CRED" ] && [ -n "$BUCKET" ] && [ -n "$BOXCRED" ] || usage
[ -f "$IDENTITY" ] || die 2 "identity file not found"
mode=$(stat -c %a "$IDENTITY" 2> /dev/null || stat -f %Lp "$IDENTITY")
[ $((8#$mode & 077)) = 0 ] || die 2 "identity file must be mode 0600 or tighter"
[ -f "$CRED" ] && [ -f "$BOXCRED" ] || die 2 "credential file not found"
[[ $BUCKET =~ ^[A-Za-z0-9-]{6,63}$ ]] || die 2 "bad --bucket"
if [ -n "$INSTANCE" ] && ! [[ $INSTANCE =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]]; then die 2 "bad --instance"; fi
if [ -n "$BEFORE_ISO" ] && ! [[ $BEFORE_ISO =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then die 2 "--before must be YYYY-MM-DDTHH:MM:SSZ"; fi
if [ -n "${POLY_B2_AUTH_URL:-}" ] && ! [[ $POLY_B2_AUTH_URL =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ || $POLY_B2_AUTH_URL = https://api.backblazeb2.com ]]; then
  die 2 "POLY_B2_AUTH_URL must be http://127.0.0.1:<port> or https://api.backblazeb2.com"
fi
if [ "$(uname -s)" = Darwin ]; then
  fdesetup isactive > /dev/null 2>&1 || die 2 "disk encryption is not active (fdesetup isactive)"
elif [ "$PLAIN_OK" = 1 ]; then
  echo "WARN --plaintext-disk-is-encrypted: the decrypted data goes onto a disk this script cannot check" >&2
else
  die 2 "cannot check disk encryption here: pass --plaintext-disk-is-encrypted if the disk is encrypted"
fi
[ -n "$INSTANCE" ] || INSTANCE=polycarpic-prod

# shellcheck source=/dev/null
. "$HERE/backup/restore-lib.sh"
if [ -n "$BEFORE_ISO" ]; then BEFORE=$(b2 epoch "$BEFORE_ISO"); fi
ROLES_SQL=$HERE/../packages/db/sql/roles.sql
[ -f "$ROLES_SQL" ] || die 2 "packages/db/sql/roles.sql not found next to infra/"

WORK=$(mktemp -d "${TMPDIR:-/tmp}/polycarpic-drill.XXXXXX")
SCRATCHES=''
cleanup() { local rc=$?; scratch_rm; rm -rf "$WORK"; return "$rc"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
scratch_image || exit 2
scratch_warn_existing

RESULTS=$WORK/results; : > "$RESULTS"
START=$(date -u +%Y-%m-%dT%H:%M:%SZ)
# res <PASS|FAIL|SKIP> <id> <text>
res() { printf '%s %s %s\n' "$1" "$2" "$3" | tee -a "$RESULTS" | clean; }
skip_rest() { local id; for id in "$@"; do res SKIP "$id" "$SKIPWHY"; done; }
SKIPWHY=''
psql_in() { local c=$1; shift; docker exec -i "$c" psql -U postgres -X -tA -d polycarpic "$@"; }

# ---- selection, download, verification, decryption (DR1, DR2, DR11)
SC_DUMP='' SC_BASE=''
NONFATAL=1 # a fault in one object is a FAIL line, and the drill goes on with the newest upload version so that every check still runs
set +e
bucket_select; rc=$?
FAILED_ID=''
if [ "$rc" = 0 ]; then
  prepare_dump; rc=$?
  [ "$rc" = 0 ] || FAILED_ID=${FAIL_ID:-DR2}
  if [ "$rc" = 0 ]; then prepare_base; rc=$?; [ "$rc" = 0 ] || FAILED_ID=${FAIL_ID:-DR2}; fi
else
  FAILED_ID=DR1
fi
set -e
if [ -n "$FAILED_ID" ]; then
  res FAIL "$FAILED_ID" "selection, download or verification refused (exit $rc); the lines on stderr say which object"
  SKIPWHY="not run: $FAILED_ID failed"
  for id in DR1 DR2 DR11; do
    [ "$id" = "$FAILED_ID" ] || res SKIP "$id" "$SKIPWHY"
  done
  skip_rest DR3 DR4 DR5 DR6 DR7 DR8 DR9
else
  # shellcheck disable=SC2153
  if [ "${STRAY_N:-0}" != 0 ]; then res FAIL DR1 "$STRAY_N stray objects in the bucket (names that are not <instance>/<major>/<dir>/<name>: the put-only key wrote them)"
  elif [ "$DR1_BAD" = 1 ]; then res FAIL DR1 "a chosen object has a second version or a hide marker (the versions are listed on stderr; a hide marker after a checksum mismatch is the usual cause)"; else res PASS DR1 "every chosen object has one version and no hide marker (set $SET_TS, $(awk 'END { print NR }' "$VERS") versions listed)"; fi
  if [ "$DR2_BAD" = 1 ]; then res FAIL DR2 "a download does not match its sha256 sibling"; else res PASS DR2 "every download matches its sha256 sibling"; fi
  if [ "$DR11_BAD" = 1 ]; then res FAIL DR11 "the time inside an archive does not match its name's TS (a replayed file?)"; else res PASS DR11 "the time inside each archive matches its name's TS (replay check)"; fi
  if plain_stream "$GLOBALS_PLAIN" | grep -aqE 'PASSWORD|SCRAM-SHA-256\$'; then res FAIL DR3 "the globals file carries a role password or hash"; else res PASS DR3 "the globals file carries no PASSWORD and no SCRAM-SHA-256\$"; fi

  # ---- two scratch restores (DR4 and the comparisons)
  if restore_dump; then SC_DUMP=$SC; else SC_DUMP=''; fi
  if restore_base; then SC_BASE=$SC; else SC_BASE=''; fi
  if [ -n "$SC_BASE" ]; then
    listed=$(awk '$5 ~ /\/wal\/wal-/ && $5 !~ /\.sha256$/ { n = $5; sub(/.*wal-[0-9][0-9]-[0-9]+-/, "", n); sub(/\.age$/, "", n); if (n !~ /\./) print n }' "$RECS" | sort | tail -1)
    if [ "$NEWEST_WAL" = "$listed" ]; then
      res PASS DR4 "the base recovered through the WAL and promoted; the newest WAL chosen (${NEWEST_WAL:-none}) is the newest listed"
    else
      res FAIL DR4 "the newest WAL chosen (${NEWEST_WAL:-none}) is not the newest listed (${listed:-none})"
    fi
  else
    res FAIL DR4 "the base did not recover through the WAL"
  fi
  if [ -z "$SC_DUMP" ]; then res FAIL DR7 "the dump did not restore"; fi

  # ---- DR5, DR6: roles.sql is re-run on each instance (the restore keeps what a restore loses)
  for which in DUMP BASE; do
    eval "c=\$SC_$which"
    [ -n "$c" ] || continue
    docker exec -i "$c" psql -U postgres -X -q -d polycarpic -v ON_ERROR_STOP=1 -f - < "$ROLES_SQL" > /dev/null 2> "$WORK/roles-$which.err" || res FAIL DR6 "roles.sql did not re-run on the $which instance"
    plp=$(docker exec "$c" psql -U postgres -X -d polycarpic -v VERBOSITY=verbose -c 'SET ROLE poly_app' -c 'DO $$BEGIN END$$' 2>&1 || true)
    xml=$(docker exec "$c" psql -U postgres -X -d polycarpic -v VERBOSITY=verbose -c 'SET ROLE poly_app' -c "SELECT query_to_xml('SELECT 1', true, false, '')" 2>&1 || true)
    if grep -q 'permission denied for language plpgsql' <<< "$plp" && grep -q '42501' <<< "$plp" && grep -q 'permission denied for function' <<< "$xml" && grep -q '42501' <<< "$xml"; then
      res PASS DR5 "$which instance: poly_app is refused plpgsql and query_to_xml (42501)"
    else
      res FAIL DR5 "$which instance: poly_app is not refused plpgsql or query_to_xml"
    fi
    missing=''
    while read -r role; do
      [ "$(docker exec "$c" psql -U postgres -X -tA -c "select count(*) from pg_roles where rolname = '$role'")" = 1 ] || missing="$missing $role"
    done < <(grep -oE 'poly_[a-z_]+' "$ROLES_SQL" | sort -u)
    if [ -z "$missing" ]; then res PASS DR6 "$which instance: every role in roles.sql exists"; else res FAIL DR6 "$which instance: missing roles:$missing"; fi
  done

  # ---- DR7: the row count of every FORCE-RLS table is the same in both restores
  if [ -n "$SC_DUMP" ] && [ -n "$SC_BASE" ]; then
    counts() { # container -> "<table> <count>" lines
      local t
      for t in $(docker exec "$1" psql -U postgres -X -tA -d polycarpic -c "select format('%I.%I', n.nspname, c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind = 'r' and c.relforcerowsecurity order by 1"); do
        echo "$t $(docker exec "$1" psql -U postgres -X -tA -d polycarpic -c "select count(*) from $t")"
      done
    }
    counts "$SC_DUMP" > "$WORK/counts-dump"; counts "$SC_BASE" > "$WORK/counts-base"
    if cmp -s "$WORK/counts-dump" "$WORK/counts-base" && [ -s "$WORK/counts-dump" ]; then
      res PASS DR7 "$(awk 'END { print NR }' "$WORK/counts-dump") FORCE-RLS tables hold the same row counts in the dump and the base restores"
    else
      res FAIL DR7 "FORCE-RLS row counts differ between the dump and the base restores (or there are none)"
    fi
    # ---- DR8: no session without its handle (F4)
    c=$SC_DUMP
    if [ "$(psql_in "$c" -c "select to_regclass('public.session') is null and to_regclass('app.session_handle') is null")" = t ]; then
      res PASS DR8 "no public.session and no app.session_handle in this schema: nothing to check"
    elif [ "$(psql_in "$c" -c "select count(*) from public.session s where not exists (select 1 from app.session_handle h where h.session_id = s.id)")" = 0 ]; then
      res PASS DR8 "every public.session row has its app.session_handle row"
    else
      res FAIL DR8 "a public.session row lacks its app.session_handle row"
    fi
    # ---- DR9: the ledger checks wait for a ledger
    if [ "$(psql_in "$c" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relname in ('journal_entry','journal_entries','ledger_entry') and n.nspname in ('public','app','ledger')")" = 0 ]; then
      res SKIP DR9 "the schema has no ledger yet (trial balance, hash chain, newest entry)"
    else
      res FAIL DR9 "a ledger table exists but the ledger checks are not implemented in this drill"
    fi
  else
    SKIPWHY="not run: a scratch restore failed"
    skip_rest DR8 DR9
    res FAIL DR7 "no two restores to compare"
  fi
fi

# ---- DR10: the box key can add objects and nothing else
set +e
probe=$(b2 s3probe --credential "$CRED" --box-credential "$BOXCRED" --bucket "$BUCKET" --instance "$INSTANCE" 2> "$WORK/probe.err"); prc=$?
set -e
if [ "$prc" != 0 ]; then
  res FAIL DR10 "the bucket probe could not run (exit $prc): $(tr '\n' ' ' < "$WORK/probe.err" | clean | cut -c1-160)"
elif grep -q '^ALLOWED' <<< "$probe"; then
  res FAIL DR10 "the box key was allowed: $(grep '^ALLOWED' <<< "$probe" | tr '\n' ';')"
else
  res PASS DR10 "the box key is refused delete, retention and bucket-default changes, and an overwrite leaves the first version intact"
fi

fails=$(awk '$1 == "FAIL" { print $2 }' "$RESULTS" | sort -u | tr '\n' ' ' | sed 's/ $//; s/ /, /g')
skips=$(awk '$1 == "SKIP" { print $2 }' "$RESULTS" | sort -u | tr '\n' ' ' | sed 's/ $//; s/ /, /g')
if [ -n "$REPORT" ]; then
  # the filed form (the repository is public): the date, per object its kind, TS, upload time and sibling sha256, and every check line. No bucket
  # name, no fileId, no system id and no object key; the fileIds the operator needs stay in the terminal output.
  {
    echo "# Restore drill report"
    echo
    echo "- Date: $START"
    echo "- Set: ${SET_TS:-none}${BEFORE_ISO:+, as of $BEFORE_ISO}"
    echo
    echo "## Objects (kind, TS, upload time, sha256 of the object from its sibling)"
    echo
    sed 's/^/- /' "$WORK/report-objects" 2> /dev/null
    echo
    echo "## Checks"
    echo
    sed 's/^/- /' "$RESULTS"
  } > "$REPORT"
fi
if [ -n "$fails" ]; then echo "DRILL FAILED: $fails"; exit 1; fi
if [ -n "$skips" ]; then echo "DRILL PASSED WITH SKIPS: $skips"; exit 3; fi
echo "DRILL PASSED"
