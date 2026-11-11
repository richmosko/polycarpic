#!/bin/sh
# archive_command: archive-wal.sh %p %f. Encrypts the segment with age straight into spool/wal/ (plaintext never
# touches disk) and fails closed when the target already exists (INFRA §6.1, POLY-95 R6).
set -eu
p="$1" f="$2"
wal=/spool/wal
rcpt=/etc/postgresql/age-recipients.txt
tgt="$wal/$f.age"
if [ -e "$tgt" ]; then echo "archive-wal: $tgt exists" >&2; exit 1; fi
mkdir -p "$wal/.inflight"
rm -f "$wal/.inflight/$f.age".*
tmp="$wal/.inflight/$f.age.$$"
trap 'rm -f "$tmp"' EXIT
age -R "$rcpt" -o "$tmp" "$p"
sync "$tmp"
ln "$tmp" "$tgt"
sync "$wal"
rm -f "$tmp"
