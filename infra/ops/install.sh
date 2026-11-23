#!/bin/sh
# Install polycarpic-ops on a box (POLY-98 R2, A1). Run on the laptop from the verified checkout (INFRA 7.1 step 6):
#   infra/ops/install.sh polyops@<host> [--ssh-key <file>]
# Ships committed content only (git archive of HEAD), never the working tree, over two ssh sessions. Run twice, it changes nothing.
set -eu

usage() { echo "usage: install.sh <user@host> [--ssh-key <file>]" >&2; exit 2; }
[ $# -ge 1 ] || usage
host=$1; shift
key=''
while [ $# -gt 0 ]; do
  case "$1" in
    --ssh-key) [ $# -ge 2 ] || usage; key=$2; shift 2 ;;
    *) usage ;;
  esac
done
case "$host" in -* | *[!A-Za-z0-9@._-]* | '') echo "install.sh: bad host" >&2; exit 2 ;; esac
case "$key" in -*) echo "install.sh: bad --ssh-key" >&2; exit 2 ;; esac

PATHS="infra/ops infra/backup infra/postgres/archive-wal.sh infra/provision.sh infra/provision-check.sh infra/postgres/gate-check.sh infra/postgres/gate-check.sql infra/operator/b2-capabilities.json infra/deploy/compose-allow.json infra/deploy/systemd infra/compose/prod.yml infra/compose/staging.yml infra/compose/edge.yml packages/db/sql/roles.sql"

# shellcheck disable=SC2086
dirty=$(git status --porcelain -- $PATHS)
if [ -n "$dirty" ]; then
  echo "install.sh: uncommitted changes under the bundle paths; commit or discard them first:" >&2
  printf '%s\n' "$dirty" >&2
  exit 2
fi

sha=$(git rev-parse HEAD)
id="git-$(printf '%s' "$sha" | cut -c1-12)"

# shellcheck disable=SC2029  # the remote command is a fixed string; only the validated id is substituted
ssh_run() { # remote command (a fixed string)
  if [ -n "$key" ]; then ssh -i "$key" "$host" "$1"; else ssh "$host" "$1"; fi
}

git show "$sha:infra/ops/install_box.py" | ssh_run 'sudo install -d -m 0700 /opt/polycarpic/.incoming && sudo tee /opt/polycarpic/.incoming/install_box.py > /dev/null'
# shellcheck disable=SC2086
git archive --format=tar "$sha" -- $PATHS | ssh_run "sudo /usr/bin/python3 -I /opt/polycarpic/.incoming/install_box.py $id"
