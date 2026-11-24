#!/bin/sh
# Install polycarpic-ops on a box (POLY-98 R2, A1). Run on the laptop from the verified checkout (INFRA 7.1 step 6):
#   infra/ops/install.sh polyops@<host> [--ssh-key <file>] [--commit <40 hex>]
# Ships committed content only (git archive of HEAD, or of --commit C), never the working tree, over two ssh sessions. Run twice, it changes nothing.
# --commit C (POLY-100 S21) ships C's files and C's install_box.py with no checkout; C must be an ancestor of origin/main (exit 2, before any ssh).
set -eu

usage() { echo "usage: install.sh <user@host> [--ssh-key <file>] [--commit <40 hex>]" >&2; exit 2; }
[ $# -ge 1 ] || usage
host=$1; shift
key=''
commit=''
while [ $# -gt 0 ]; do
  case "$1" in
    --ssh-key) [ $# -ge 2 ] || usage; key=$2; shift 2 ;;
    --commit) [ $# -ge 2 ] || usage; commit=$2; shift 2 ;;
    *) usage ;;
  esac
done
case "$host" in -* | *[!A-Za-z0-9@._-]* | '') echo "install.sh: bad host" >&2; exit 2 ;; esac
case "$key" in -*) echo "install.sh: bad --ssh-key" >&2; exit 2 ;; esac
case "$commit" in *[!0-9a-f]*) echo "install.sh: bad --commit" >&2; exit 2 ;; esac
if [ -n "$commit" ] && [ "${#commit}" -ne 40 ]; then echo "install.sh: bad --commit" >&2; exit 2; fi

PATHS="infra/ops infra/backup infra/postgres/archive-wal.sh infra/postgres/pg_hba.prod.conf infra/postgres/pg_hba.staging.conf infra/provision.sh infra/provision-check.sh infra/postgres/gate-check.sh infra/postgres/gate-check.sql infra/operator/b2-capabilities.json infra/deploy/compose-allow.json infra/deploy/compose-version infra/deploy/systemd infra/compose/prod.yml infra/compose/staging.yml infra/compose/edge.yml packages/db/sql/roles.sql"

if [ -n "$commit" ]; then
  # no checkout: a checkout would run C's tracked git hooks on this machine
  git cat-file -e "$commit^{commit}" 2> /dev/null || { echo "install.sh: $commit is not a commit here; git fetch origin first" >&2; exit 2; }
  git merge-base --is-ancestor "$commit" origin/main || { echo "install.sh: $commit is not an ancestor of origin/main" >&2; exit 2; }
  sha=$commit
else
  # shellcheck disable=SC2086
  dirty=$(git status --porcelain -- $PATHS)
  if [ -n "$dirty" ]; then
    echo "install.sh: uncommitted changes under the bundle paths; commit or discard them first:" >&2
    printf '%s\n' "$dirty" >&2
    exit 2
  fi
  sha=$(git rev-parse HEAD)
fi
id="git-$(printf '%s' "$sha" | cut -c1-12)"

# shellcheck disable=SC2029  # the remote command is a fixed string; only the validated id is substituted
ssh_run() { # remote command (a fixed string)
  if [ -n "$key" ]; then ssh -i "$key" "$host" "$1"; else ssh "$host" "$1"; fi
}

git show "$sha:infra/ops/install_box.py" | ssh_run 'sudo install -d -m 0700 /opt/polycarpic/.incoming && sudo tee /opt/polycarpic/.incoming/install_box.py > /dev/null'
# shellcheck disable=SC2086
git archive --format=tar "$sha" -- $PATHS | ssh_run "sudo /usr/bin/python3 -I /opt/polycarpic/.incoming/install_box.py $id $host"
