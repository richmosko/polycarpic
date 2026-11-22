#!/bin/bash
# backup.sh nightly|premigration: the backup container's only job (POLY-99 R1). Runs as 10004 in the Postgres derivative image.
# Every artifact is gzip'd where useful, encrypted with age straight into <spool>/.inflight/, and published all-or-nothing by `ln`.
# Plaintext never touches a disk. Stdout carries one line on success: `published <dir> <TS> <sys> <name>...`.
set -euo pipefail
ulimit -c 0

mode="${1:-}"
case "$mode" in
  nightly) dir=/spool/dump; steps="base dump globals" ;;
  premigration) dir=/spool/premigration; steps="dump globals" ;;
  *) echo "usage: backup.sh nightly|premigration" >&2; exit 2 ;;
esac

rcpt=/etc/backup/age-recipients.txt
pwfile="${DB_PASSWORD_FILE:-/run/secrets/db_password_backup}"
inflight="$dir/.inflight"

fail_pre() { echo "backup.sh: $1" >&2; exit 3; }

# --- preconditions (exit 3, nothing written) ---
nrcpt=$(grep -c . "$rcpt" 2>/dev/null || true)
if [ "$nrcpt" != 1 ] || ! grep -Eq '^age1[0-9a-z]+$' "$rcpt"; then
  fail_pre "recipients file must hold exactly one age1 recipient"
fi
[ -s "$pwfile" ] || fail_pre "db password file is empty"

export PGHOST=postgres PGUSER=poly_backup PGDATABASE=polycarpic
export PGPASSFILE=/tmp/pgpass
pw=$(cat "$pwfile")
pw=${pw//\\/\\\\}
pw=${pw//:/\\:}
( umask 077
  printf 'postgres:5432:polycarpic:poly_backup:%s\npostgres:5432:replication:poly_backup:%s\n' "$pw" "$pw" > "$PGPASSFILE" )
unset pw

vnum=$(psql -X -t -A -c 'SHOW server_version_num' 2>/dev/null) || fail_pre "cannot read server version"
smajor=$((vnum / 10000))
if [ "$smajor" != "${PG_MAJOR:-}" ]; then
  fail_pre "server major $smajor does not match image major ${PG_MAJOR:-unset}"
fi
sys=$(psql -X -t -A "dbname=replication replication=true" -c IDENTIFY_SYSTEM 2>/dev/null | cut -d'|' -f1) \
  || fail_pre "cannot read system identifier"
[[ "$sys" =~ ^[0-9]{1,20}$ ]] || fail_pre "cannot read system identifier"

ts=$(date -u +%Y%m%dT%H%M%SZ)
M=$PG_MAJOR

# --- state: leftovers from a killed run (the runner's lock makes us the only writer) ---
rm -f "$inflight"/* 2>/dev/null || true

published=()
cleanup() {
  rc=$?
  rm -f "$inflight"/*."$$" 2>/dev/null || true
  if [ "$rc" != 0 ]; then
    for f in "${published[@]}"; do rm -f "$f"; done
  fi
}
trap cleanup EXIT

name() { echo "$1-$M-$sys-$ts.age"; }
tmpf() { echo "$inflight/$(name "$1").$$"; }

step_fail() { echo "backup.sh: $1 failed" >&2; exit 1; }

for s in $steps; do
  t=$(tmpf "$s")
  case "$s" in
    base)    { pg_basebackup -Ft -X none -c fast -D - | gzip -1 | age -R "$rcpt" -o "$t"; } || step_fail base ;;
    dump)    { pg_dump -Fc | age -R "$rcpt" -o "$t"; } || step_fail dump ;;
    globals) { pg_dumpall --globals-only --no-role-passwords -l polycarpic | gzip -1 | age -R "$rcpt" -o "$t"; } || step_fail globals ;;
  esac
done

# --- publish: all or nothing ---
for s in $steps; do sync "$(tmpf "$s")"; done
for s in $steps; do
  if ln "$(tmpf "$s")" "$dir/$(name "$s")" 2>/dev/null; then
    published+=("$dir/$(name "$s")")
  else
    echo "backup.sh: publish of $(name "$s") failed" >&2
    exit 1
  fi
done
sync "$dir"
for s in $steps; do rm -f "$(tmpf "$s")"; done

names=()
for s in $steps; do names+=("$(name "$s")"); done
echo "published ${dir#/spool/} $ts $sys ${names[*]}"
