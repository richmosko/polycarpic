#!/usr/bin/env bash
# shellcheck disable=SC2034  # variables consumed by the sourced backup/restore-lib.sh
set -euo pipefail
# restore.sh: decrypt a backup on THIS machine and restore it into a throwaway Postgres (POLY-99 R7; INFRA §6.4, §8.10).
#   restore.sh --identity <age key file> --premigration --from-box <user@host> [--set <TS>] [--read-credential <file> --bucket <name>] [--keep]
#   restore.sh --identity <age key file> --read-credential <file> --bucket <name> (--base | --dump) [--instance <i>] [--before <UTC>] [--set <TS>] [--keep]
# The age identity is read by `age -d -i <path>` here and goes nowhere else. The restore always starts its own separate cluster in a container
# (no network, no capabilities, no bind mount, no secret); it never touches a running database.
# Exit: 0 restored; 1 restore failed; 2 usage; 3 selection refused; 4 integrity or replay; 5 the box or bucket refused, or a line failed validation.
ulimit -c 0
umask 077
PROG=restore.sh
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

usage() { echo "usage: restore.sh --identity <file> (--premigration --from-box <user@host> [--set <TS>] | --base | --dump) [--read-credential <file> --bucket <name>] [--instance <i>] [--before <UTC>] [--keep]" >&2; exit 2; }
die() { local code=$1; shift; echo "restore.sh: $*" >&2; exit "$code"; }

[ $# -gt 0 ] || usage
IDENTITY='' CRED='' BUCKET='' INSTANCE='' BEFORE='' SETTS='' BOX='' KEEP=0 MODE='' NMODES=0 PLAIN_OK=0 BEFORE_ISO=''
while [ $# -gt 0 ]; do
  case "$1" in
    --identity) IDENTITY=${2:-}; shift 2 ;;
    --read-credential) CRED=${2:-}; shift 2 ;;
    --bucket) BUCKET=${2:-}; shift 2 ;;
    --instance) INSTANCE=${2:-}; shift 2 ;;
    --before) BEFORE_ISO=${2:-}; shift 2 ;;
    --set) SETTS=${2:-}; shift 2 ;;
    --from-box) BOX=${2:-}; shift 2 ;;
    --premigration) MODE=premigration; NMODES=$((NMODES + 1)); shift ;;
    --base) MODE=base; NMODES=$((NMODES + 1)); shift ;;
    --dump) MODE=dump; NMODES=$((NMODES + 1)); shift ;;
    --keep) KEEP=1; shift ;;
    --plaintext-disk-is-encrypted) PLAIN_OK=1; shift ;;
    *) die 2 "unknown option $1" ;;
  esac
done
[ "$NMODES" = 1 ] || die 2 "choose one of --premigration, --base, --dump"
if [ -n "$BEFORE_ISO" ] && ! [[ $BEFORE_ISO =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]; then die 2 "--before must be YYYY-MM-DDTHH:MM:SSZ"; fi
if [ -n "$INSTANCE" ] && ! [[ $INSTANCE =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$ ]]; then die 2 "bad --instance"; fi
if [ -n "$SETTS" ] && ! [[ $SETTS =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then die 2 "bad --set"; fi
if [ "$MODE" = premigration ]; then
  [ -n "$BOX" ] || die 2 "--premigration needs --from-box <user@host>"
  [[ $BOX =~ ^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z0-9][A-Za-z0-9.-]*$ ]] || die 2 "bad --from-box"
else
  [ -z "$BOX" ] || die 2 "--from-box is for --premigration"
  [ -n "$CRED" ] && [ -n "$BUCKET" ] || die 2 "--read-credential and --bucket are required"
fi
[ -n "$IDENTITY" ] || usage
[ -f "$IDENTITY" ] || die 2 "identity file not found"
mode=$(stat -c %a "$IDENTITY" 2> /dev/null || stat -f %Lp "$IDENTITY")
[ $((8#$mode & 077)) = 0 ] || die 2 "identity file must be mode 0600 or tighter"
if [ -n "$CRED" ]; then
  [ -f "$CRED" ] || die 2 "read credential file not found"
  [[ ${BUCKET} =~ ^[A-Za-z0-9-]{6,63}$ ]] || die 2 "bad --bucket"
fi
if [ -n "${POLY_B2_AUTH_URL:-}" ] && ! [[ $POLY_B2_AUTH_URL =~ ^http://127\.0\.0\.1:[0-9]{1,5}$ || $POLY_B2_AUTH_URL = https://api.backblazeb2.com ]]; then
  die 2 "POLY_B2_AUTH_URL must be http://127.0.0.1:<port> or https://api.backblazeb2.com"
fi
# C12: decrypted data goes only onto an encrypted disk
if [ "$(uname -s)" = Darwin ]; then
  fdesetup isactive > /dev/null 2>&1 || die 2 "disk encryption is not active (fdesetup isactive)"
elif [ "$PLAIN_OK" = 1 ]; then
  echo "WARN --plaintext-disk-is-encrypted: the decrypted data goes onto a disk this script cannot check" >&2
else
  die 2 "cannot check disk encryption here: pass --plaintext-disk-is-encrypted if the disk is encrypted"
fi
[ -z "$INSTANCE" ] && INSTANCE=polycarpic-prod

# shellcheck source=/dev/null
. "$HERE/backup/restore-lib.sh"
if [ -n "$BEFORE_ISO" ]; then BEFORE=$(b2 epoch "$BEFORE_ISO"); fi

WORK=$(mktemp -d "${TMPDIR:-/tmp}/polycarpic-restore.XXXXXX")
SCRATCHES=''
OK=0
cleanup() {
  local rc=$?
  if [ "$KEEP" = 1 ]; then echo "keeping $WORK" >&2; else rm -rf "$WORK"; fi
  if [ "$OK" != 1 ]; then scratch_rm; fi
  return "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP
scratch_image || exit 2

# The remote command is built in ONE place, for the two fixed forms only; the name is single-quoted (the grammar check below is the first guard,
# this quoting the second). Nothing is forwarded: stdin is empty, no agent, no forwarded ports; `--` ends the options before the destination.
box_cmd() { # <name or empty> <list-premigration|fetch-premigration>
  local q
  q="'$(printf '%s' "$1" | sed "s/'/'\\\\''/g")'" # T16q
  case "$2" in
    list-premigration) echo "sudo polycarpic-ops backup list-premigration" ;;
    fetch-premigration) echo "sudo polycarpic-ops backup fetch-premigration $q" ;;
    *) return 1 ;;
  esac
}
box_ssh() { # <name or empty> <verb>
  < /dev/null ssh -a -x -o ForwardAgent=no -o ClearAllForwardings=yes -o BatchMode=yes -- "$BOX" "$(box_cmd "$@")" # T9
}

# from_box: the newest premigration set (or --set) from `list-premigration`, each file checked against root's record on the box
from_box() {
  local list line n ts d dsha g gsha state f1 f2 f3 f4 f5 f6 extra pick=''

  list=$(box_ssh "" list-premigration) || die 5 "the box refused list-premigration"
  while IFS= read -r line; do
    if [[ $line =~ ^stray\ [0-9]{1,4}$ ]]; then echo "$line"; continue; fi
    IFS=' ' read -r f1 f2 f3 f4 f5 f6 extra <<< "$line"
    # T16: every name, time and hash that comes back from the box is checked before any command uses it
    [ -z "${extra:-}" ] && [ -n "${f6:-}" ] && [[ $f1 =~ $TS_RE ]] && [[ $f2 =~ $R2_PREM ]] && [[ $f3 =~ $SHA_RE ]] && [[ $f4 =~ $R2_PREM ]] && [[ $f5 =~ $SHA_RE ]] && [[ $f6 =~ ^(uploaded|pending)$ ]] || { echo "restore.sh: a line from the box failed validation: $(printf '%s' "$line" | clean | cut -c1-120)" >&2; exit 5; } # T16
    if [ -z "$SETTS" ] || [ "$f1" = "$SETTS" ]; then pick=$line; fi
  done < <(printf '%s\n' "$list")
  [ -n "$pick" ] || die 3 "no premigration set on the box${SETTS:+ for $SETTS}"
  read -r ts d dsha g gsha state <<< "$pick"
  SET_TS=$ts
  for n in "$d:$dsha" "$g:$gsha"; do
    box_ssh "${n%%:*}" fetch-premigration > "$WORK/${n%%:*}" || die 5 "the box refused fetch-premigration"
    [ "$(sha256f "$WORK/${n%%:*}")" = "${n##*:}" ] || die 4 "${n%%:*} does not match the spool record"
  done
  decrypt "$WORK/$d" "$WORK/dump.dec" || exit 4
  decrypt "$WORK/$g" "$WORK/globals.dec" || exit 4
  check_time dump "$WORK/dump.dec" "$ts" 1800 || exit 4 # T17
  DUMP_PLAIN=$WORK/dump.dec; GLOBALS_PLAIN=$WORK/globals.dec
  if [ -n "$CRED" ]; then
    cross_check "$d" "$dsha" "$g" "$gsha" "$ts" || exit $?
  else
    warn "not cross-checked against the bucket"
  fi
  if [ "$state" = pending ]; then warn "the set has not reached the bucket yet"; fi
}

# the bucket's first-uploaded version of each premigration object must carry the same sha256, and be the only version
cross_check() {
  local d=$1 dsha=$2 g=$3 gsha=$4 ts=$5 f
  RECS=$WORK/records; VERS=$WORK/versions
  b2 list --credential "$CRED" --bucket "$BUCKET" --instance "$INSTANCE" > "$RECS" || return $?
  awk '{ print "ver x " $5 " " $1 " " $2 " " $3 " " $4 }' "$RECS" > "$VERS"
  SET_M=${d#*-}; SET_M=${SET_M%%-*}
  for f in "$d:$dsha" "$g:$gsha"; do
    one_version "$INSTANCE/$SET_M/premigration/${f%%:*}" || return $?
    b2 get --credential "$CRED" --bucket "$BUCKET" --file-id "$FID" --out "$WORK/x-$FID" || return $?
    [ "$(sha256f "$WORK/x-$FID")" = "${f##*:}" ] || { err "${f%%:*} differs from the bucket's copy"; return 4; }
  done
}

case "$MODE" in
  premigration)
    from_box
    restore_dump || exit 1
    ;;
  dump)
    bucket_select || exit $?
    prepare_dump || exit $?
    restore_dump || exit 1
    ;;
  base)
    bucket_select || exit $?
    prepare_base || exit $?
    restore_base || exit 1
    ;;
esac
OK=1
scratch_report
