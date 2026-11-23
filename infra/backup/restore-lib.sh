# restore-lib.sh: selection, download, verification, decryption and the throwaway Postgres, shared by restore.sh and drill.sh (POLY-99 R7, R8).
# Sourced, never run. Runs on the laptop: decryption is a local `age -d -i <identity>`; nothing plaintext goes to the box, and nothing is restored
# anywhere but a separate cluster in a container with no network, no capabilities, no bind mount and no secret.
# The caller has set (and `set -euo pipefail; ulimit -c 0; umask 077`): PROG HERE IDENTITY WORK; for the bucket: CRED BUCKET INSTANCE
# [BEFORE (epoch) SETTS]. Functions return a code (3 refused, 4 integrity or replay, 5 the box or bucket refused, 1 failed) and never exit.
# bash 3.2 compatible (macOS): no associative arrays, no mapfile.
# shellcheck disable=SC2034  # the variables below are read by restore.sh and drill.sh, which source this file
set -euo pipefail
umask 077
export LC_ALL=C

LIB=$HERE/backup
b2() { python3 -I "$LIB/b2read.py" "$@"; }
warn() { echo "WARN $*" >&2; }
err() { echo "$PROG: $*" >&2; }
# bytes outside 0x20-0x7E (newline kept) are replaced before anything from the box or the bucket is printed
clean() { tr -c '\040-\176\n' '?'; }
sha256f() { if command -v sha256sum > /dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }

FAIL_ID=""
R2_DUMP='^(base|dump|globals)-[0-9]{2}-[0-9]{1,20}-[0-9]{8}T[0-9]{6}Z\.age$'
R2_PREM='^(dump|globals)-[0-9]{2}-[0-9]{1,20}-[0-9]{8}T[0-9]{6}Z\.age$'
TS_RE='^[0-9]{8}T[0-9]{6}Z$'
SHA_RE='^[0-9a-f]{64}$'

# ---------------------------------------------------------------- versions: a name with a second version or a hide marker is refused
# VERS holds `ver <label> <key> <fileId> <action> <uploadMs> <iso>` lines for every version of every chosen object.
list_versions() { # key
  awk -v k="$1" '$3 == k { printf "version %s %s %s%s\n", $4, $7, $3, ($5 == "hide" ? " hide marker" : "") }' "$VERS" | clean
}
# one_version <key>: sets FID to the newest upload version, or returns 3 after listing every version
one_version() {
  local n act
  n=$(awk -v k="$1" '$3 == k { c++ } END { print c + 0 }' "$VERS")
  if [ "$n" = 0 ]; then err "$(basename "$1") is not in the bucket"; return 4; fi
  FAIL_ID=DR1
  [ "$n" -le 1 ] || { list_versions "$1"; err "$(basename "$1") has more than one version or a hide marker: pick the time with --before"; return 3; } # T10
  act=$(awk -v k="$1" '$3 == k { a = $5 } END { print a }' "$VERS")
  [ "$act" != hide ] || { list_versions "$1"; err "$(basename "$1") is hidden"; return 3; }
  FID=$(awk -v k="$1" '$3 == k && $5 == "upload" { print $6 " " $4 }' "$VERS" | sort -n | tail -1 | cut -d' ' -f2)
  [ -n "$FID" ] || { err "no upload version of $(basename "$1")"; return 3; }
  FAIL_ID=''
}

# ---------------------------------------------------------------- bucket selection
bucket_select() { # nightly set -> SET_TS SET_SYS SET_M; VERS; RECS
  local now out rc=0
  RECS=$WORK/records; VERS=$WORK/versions
  b2 list --credential "$CRED" --bucket "$BUCKET" --instance "$INSTANCE" > "$RECS" || return $?
  now=$(date -u +%s)
  out=$(b2 choose --now "$now" ${BEFORE:+--before "$BEFORE"} ${SETTS:+--set "$SETTS"} < "$RECS") || rc=$?
  if [ "$rc" != 0 ]; then
    printf '%s\n' "$out" | clean
    [ "$rc" != 3 ] || err "selection refused"
    return "$rc"
  fi
  : > "$VERS"
  printf '%s\n' "$out" | grep '^ver ' > "$VERS" || true
  read -r _ SET_TS SET_SYS SET_M _ <<< "$(printf '%s\n' "$out" | grep '^set ')"
  [[ $SET_TS =~ $TS_RE ]] && [[ $SET_SYS =~ ^[0-9]{1,20}$ ]] && [[ $SET_M =~ ^[0-9]{2}$ ]] || { err "bad set from the bucket"; return 5; }
  return 0
}

# fetch_object <dir> <name>: the newest (only) version and its sibling, downloaded by fileId; the sibling must match. -> OBJ_FILE (ciphertext)
fetch_object() {
  local key="$INSTANCE/$SET_M/$1/$2" sfid fid want got
  one_version "$key" || return $?
  fid=$FID
  one_version "$key.sha256" || return $?
  sfid=$FID
  b2 get --credential "$CRED" --bucket "$BUCKET" --file-id "$fid" --out "$WORK/$fid" || return $?
  b2 get --credential "$CRED" --bucket "$BUCKET" --file-id "$sfid" --out "$WORK/$sfid" || return $?
  want=$(head -c 200 "$WORK/$sfid" | awk '{ print $1; exit }')
  got=$(sha256f "$WORK/$fid")
  if [ "$got" != "$want" ]; then FAIL_ID=DR2; err "$2 does not match its sha256 sibling"; return 4; fi
  OBJ_FILE=$WORK/$fid
  OBJ_FID=$fid
}

decrypt() { # in out: a local age process, the identity by path only
  age -d -i "$IDENTITY" -o "$2" "$1" || { FAIL_ID=DR11; err "cannot decrypt $(basename "$1")"; return 4; }
}

# check_time <kind base|dump> <decrypted file> <TS> <seconds after TS the archive may be taken>
check_time() {
  local out
  out=$(b2 check-time --kind "$1" --file "$2" --ts "$3" --before "$4" 2>&1) || { FAIL_ID=DR11; printf '%s\n' "$out" | clean >&2; return 4; }
  CHECKED_WAL=${out##* }
}

# prepare_dump <nightly|premigration>-style inputs from the bucket: DUMP_PLAIN GLOBALS_PLAIN (decrypted), replay-checked
prepare_dump() {
  local d g
  d="dump-$SET_M-$SET_SYS-$SET_TS.age"; g="globals-$SET_M-$SET_SYS-$SET_TS.age"
  fetch_object dump "$d" || return $?
  OBJ_DUMP=$OBJ_FILE; FID_DUMP=$OBJ_FID
  fetch_object dump "$g" || return $?
  OBJ_GLOBALS=$OBJ_FILE
  decrypt "$OBJ_DUMP" "$OBJ_DUMP.dec" || return $?
  decrypt "$OBJ_GLOBALS" "$OBJ_GLOBALS.dec" || return $?
  check_time dump "$OBJ_DUMP.dec" "$SET_TS" 10800 || return 4 # T17
  DUMP_PLAIN=$OBJ_DUMP.dec; GLOBALS_PLAIN=$OBJ_GLOBALS.dec
}

# prepare_base: the base, then every WAL version of the same system id from the base's start on. BASE_PLAIN, WAL_LIST (file of "<segment name> <plain path>")
prepare_base() {
  local b start key name seg fid sibling
  b="base-$SET_M-$SET_SYS-$SET_TS.age"
  fetch_object dump "$b" || return $?
  decrypt "$OBJ_FILE" "$OBJ_FILE.dec" || return $?
  BASE_PLAIN=$OBJ_FILE.dec
  check_time base "$BASE_PLAIN" "$SET_TS" 600 || return 4 # T17
  start=${CHECKED_WAL:-}
  # WAL records of this system id, in the same cutoff as the set
  awk -v p="$INSTANCE/$SET_M/wal/wal-$SET_M-$SET_SYS-" -v cut="${BEFORE:-0}" 'index($5, p) == 1 && (cut == 0 || $3 <= cut * 1000) { print "ver wal " $5 " " $1 " " $2 " " $3 " " $4 }' "$RECS" >> "$VERS"
  WAL_LIST=$WORK/wal-list; : > "$WAL_LIST"
  NEWEST_WAL=''
  awk '$3 ~ /\/wal\// && $3 !~ /\.sha256$/ { print $3 }' "$VERS" | sort -u > "$WORK/wal-keys"
  while read -r key; do
    name=${key##*/}; seg=${name#wal-"$SET_M-$SET_SYS-"}; seg=${seg%.age}
    if [[ ${seg:0:24} < $start ]] && [[ $seg != *.history ]]; then continue; fi
    one_version "$key" || return $?
    fid=$FID
    one_version "$key.sha256" || return $?
    sibling=$FID
    b2 get --credential "$CRED" --bucket "$BUCKET" --file-id "$fid" --out "$WORK/$fid" || return $?
    b2 get --credential "$CRED" --bucket "$BUCKET" --file-id "$sibling" --out "$WORK/$sibling" || return $?
    [ "$(sha256f "$WORK/$fid")" = "$(head -c 200 "$WORK/$sibling" | awk '{ print $1; exit }')" ] || { FAIL_ID=DR2; err "$name does not match its sha256 sibling"; return 4; }
    decrypt "$WORK/$fid" "$WORK/$fid.dec" || return $?
    echo "$seg $WORK/$fid.dec" >> "$WAL_LIST"
  done < "$WORK/wal-keys"
  sort -o "$WAL_LIST" "$WAL_LIST"
  NEWEST_WAL=$(awk '$1 !~ /\./ { print $1 }' "$WAL_LIST" | tail -1)
  return 0
}

# ---------------------------------------------------------------- the throwaway Postgres
scratch_image() {
  IMAGE=$(sed -n 's/^FROM \([^ ]*\).*/\1/p' "$HERE/postgres/Dockerfile" | head -1)
  [[ $IMAGE =~ ^postgres:[0-9A-Za-z.-]+@sha256:[0-9a-f]{64}$ ]] || { err "infra/postgres/Dockerfile has no digest-pinned FROM line"; return 1; }
}
scratch_start() { # -> SC
  SC=polycarpic-restore-$$-$RANDOM
  docker run -d --name "$SC" --label polycarpic.restore=scratch --network none --cap-drop ALL --security-opt no-new-privileges \
    --user 999:999 --pids-limit 512 --memory 2g --entrypoint sleep "$IMAGE" 86400 > /dev/null || { err "cannot start the scratch container"; return 1; }
  SCRATCHES="${SCRATCHES:-} $SC"
}
scratch_wait() { # up to 180 s for a connection that is not in recovery
  local _i
  for _i in $(seq 1 90); do
    if [ "$(docker exec "$SC" psql -U postgres -X -tA -c 'select pg_is_in_recovery()' 2> /dev/null || true)" = f ]; then return 0; fi
    sleep 2
  done
  err "the scratch Postgres did not become ready"; return 1
}
scratch_rm() { local c; for c in $SCRATCHES; do docker rm -f -v "$c" > /dev/null 2>&1 || true; done; }

# restore_dump: globals first, then the whole dump (never --data-only: app.session_handle comes with session). Both enter by stdin.
restore_dump() { # -> SC with the database `polycarpic`
  scratch_start || return 1
  docker exec "$SC" initdb -D /tmp/pgdata -U postgres --auth=trust > /dev/null || { err "initdb failed in the scratch container"; return 1; }
  docker exec -d "$SC" postgres -D /tmp/pgdata -c listen_addresses= || return 1
  scratch_wait || return 1
  docker exec -i "$SC" psql -U postgres -X -q -f - < "$GLOBALS_PLAIN" > /dev/null 2>&1 || true # roles that exist already (postgres) are not an error
  docker exec -i "$SC" pg_restore -U postgres --create -d postgres < "$DUMP_PLAIN" || { err "pg_restore failed"; return 1; }
}

# restore_base: the base tar, the WAL by restore_command, recovery.signal; waits until the cluster has replayed and promoted.
restore_base() { # -> SC
  local seg path
  scratch_start || return 1
  docker exec "$SC" sh -c 'mkdir -m 0700 /tmp/pgdata /tmp/wal' || return 1
  gzip -dc "$BASE_PLAIN" | docker exec -i "$SC" tar -xf - -C /tmp/pgdata || { err "cannot unpack the base"; return 1; }
  while read -r seg path; do
    [[ $seg =~ ^[0-9A-F]{8}(\.history|[0-9A-F]{16}(\.[0-9A-F]{8}\.backup|\.partial)?)$ ]] || { err "bad WAL name"; return 1; }
    gzip -dc "$path" | docker exec -i "$SC" sh -c "cat > /tmp/wal/$seg" || return 1
  done < "$WAL_LIST"
  docker exec "$SC" sh -c "touch /tmp/pgdata/recovery.signal && echo \"restore_command = 'cp /tmp/wal/%f %p'\" >> /tmp/pgdata/postgresql.auto.conf" || return 1
  docker exec -d "$SC" postgres -D /tmp/pgdata -c listen_addresses= || return 1
  scratch_wait || return 1
}

scratch_report() {
  echo "scratch container: $SC"
  echo "connect: docker exec -it $SC psql -U postgres"
}
