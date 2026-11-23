#!/bin/bash
# archive_command: archive-wal.sh %p %f. Compresses the segment, encrypts it with age straight into spool/wal/ (plaintext never
# touches disk) and fails closed when the target already exists (INFRA §6.1, POLY-99 R3). Target name:
# wal-<major>-<system id>-<%f>.age. The system id keeps a re-initialised cluster's segments apart from the old one's.
set -euo pipefail
p="$1" f="$2"
wal=/spool/wal
rcpt=/etc/postgresql/age-recipients.txt
if [ "$(grep -c . "$rcpt")" != 1 ] || ! grep -Eq '^age1[0-9a-z]+$' "$rcpt"; then
  echo "archive-wal: recipients file must hold exactly one age1 recipient" >&2; exit 1
fi
sys=$(pg_controldata . | sed -n 's/^Database system identifier: *//p')
[[ "$sys" =~ ^[0-9]{1,20}$ ]] || { echo "archive-wal: cannot read system identifier" >&2; exit 1; }
n="wal-${PG_MAJOR:?}-$sys-$f.age"
tgt="$wal/$n"
if [ -e "$tgt" ]; then echo "archive-wal: $tgt exists" >&2; exit 1; fi
mkdir -p "$wal/.inflight"
rm -f "$wal/.inflight/$n".*
tmp="$wal/.inflight/$n.$$"
trap 'rm -f "$tmp"' EXIT
gzip -1 -c "$p" | age -R "$rcpt" -o "$tmp"
sync "$tmp"
ln "$tmp" "$tgt"
sync "$wal"
rm -f "$tmp"
