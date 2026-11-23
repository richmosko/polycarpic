#!/bin/bash
# upload.sh: the uploader (POLY-99 R4). Runs as 10005 on upload-net with the spool mounted read-only. It reads the spool and
# the put-only bucket credential, uploads each object with its .sha256 sibling, and reports `verified <dir> <name> <sha256>` on
# stdout. It deletes nothing, writes nothing under /spool and pings nothing: root acts on the report (polycarpic-ops upload).
# Exit: 0 done; 1 an upload was refused or mismatched, or a file is over 5 GiB; 2 a stray file; 3 config missing or malformed.
set -euo pipefail
ulimit -c 0

spool=/spool
cred=/run/secrets/backup_store_credential
opsconf=/etc/uploader/ops.conf
hostenv=/etc/uploader/host.env
conf=/tmp/rclone.conf
limit=$((5 * 1024 * 1024 * 1024))

die3() { echo "upload.sh: $1" >&2; exit 3; }

# Read one NAME=value line by exact pattern, never by `source`.
getval() { # file name pattern
  local v
  v=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n 1 | cut -d= -f2-) || true
  [[ "$v" =~ $3 ]] && printf '%s' "$v"
}

key_id=$(sed -n 1p "$cred" 2>/dev/null || true)
app_key=$(sed -n 2p "$cred" 2>/dev/null || true)
if [ -z "$key_id" ] || [ -z "$app_key" ]; then die3 "backup_store_credential missing"; fi
bucket=$(getval "$opsconf" B2_BUCKET '^[A-Za-z0-9-]{6,63}$') || true
[ -n "$bucket" ] || die3 "B2_BUCKET missing or malformed"
endpoint=$(getval "$opsconf" B2_S3_ENDPOINT '^https://s3\.[a-z0-9-]+\.backblazeb2\.com$') || true
[ -n "$endpoint" ] || die3 "B2_S3_ENDPOINT missing or malformed"
instance=$(getval "$hostenv" POLY_INSTANCE '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$') || true
[ -n "$instance" ] || die3 "POLY_INSTANCE missing or malformed"

( umask 077
  printf '[b2]\ntype = s3\nprovider = Other\nendpoint = %s\nno_check_bucket = true\naccess_key_id = %s\nsecret_access_key = %s\n' \
    "$endpoint" "$key_id" "$app_key" > "$conf" )
unset key_id app_key

re_dump='^(base|dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age$'
re_prem='^(dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age$'
re_wal='^wal-([0-9]{2})-([0-9]{1,20})-([0-9A-F]{24}(\.[0-9A-F]{8}\.backup|\.partial)?|[0-9A-F]{8}\.history)\.age$'

stray=0
for dir in wal dump premigration; do
  # every entry, sorted by name; .inflight and symlinks are never uploaded
  while IFS= read -r -d '' path; do
    name=${path##*/}
    [ "$name" = .inflight ] && continue
    [ -L "$path" ] && continue
    [ -f "$path" ] || continue
    major=
    case "$dir" in
      wal) [[ "$name" =~ $re_wal ]] && major=${BASH_REMATCH[1]} ;;
      dump) [[ "$name" =~ $re_dump ]] && major=${BASH_REMATCH[2]} ;;
      premigration)
        if [[ "$name" == *.sha256 ]]; then
          # the uploaded marker: admitted when it sits beside a valid premigration file
          base=${name%.sha256}
          [[ "$base" =~ $re_prem ]] && [ -f "$spool/$dir/$base" ] && continue
        fi
        [[ "$name" =~ $re_prem ]] && major=${BASH_REMATCH[2]} ;;
    esac
    if [ -z "$major" ]; then
      echo "upload.sh: stray file $dir/$name" >&2; stray=1; continue
    fi
    if [ "$(head -c 22 "$path" 2>/dev/null | od -An -c | tr -d ' \n')" != 'age-encryption.org/v1\n' ]; then
      echo "upload.sh: stray file $dir/$name" >&2; stray=1; continue
    fi
    size=$(stat -c %s "$path")
    if [ "$size" -gt "$limit" ]; then
      echo "upload.sh: $dir/$name exceeds 5 GiB" >&2; exit 1
    fi
    if [ "$dir" = premigration ] && [ -e "$path.sha256" ]; then continue; fi
    sha=$(sha256sum "$path" | cut -d' ' -f1)
    obj="$instance/$major/$dir/$name"
    printf '%s  %s\n' "$sha" "$name" > /tmp/sibling
    rclone --config /tmp/rclone.conf copyto "$path" "b2:$bucket/$obj" --no-check-dest --s3-no-head --s3-upload-cutoff 5G --retries 1 --low-level-retries 1 >&2 \
      || { echo "upload.sh: upload of $dir/$name failed" >&2; exit 1; }
    rclone --config /tmp/rclone.conf copyto /tmp/sibling "b2:$bucket/$obj.sha256" --no-check-dest --s3-no-head --s3-upload-cutoff 5G --retries 1 --low-level-retries 1 >&2 \
      || { echo "upload.sh: upload of $dir/$name failed" >&2; exit 1; }
    echo "verified $dir $name $sha"
  done < <(find "$spool/$dir" -mindepth 1 -maxdepth 1 -print0 2>/dev/null | sort -z)
done
[ "$stray" = 0 ] || exit 2
