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
# every digit and letter written out: in some locales a range like [a-f] also holds upper-case letters
case "$commit" in *[!0123456789abcdef]*) echo "install.sh: bad --commit" >&2; exit 2 ;; esac
if [ -n "$commit" ] && [ "${#commit}" -ne 40 ]; then echo "install.sh: bad --commit" >&2; exit 2; fi

# The repository that counts is the one this script lives in, wherever the operator stands (POLY-104 F2). Each git call runs from its root, in a
# subshell: the script stays where the operator is, so a relative --ssh-key keeps its meaning.
unset CDPATH
repo=$(cd -- "$(dirname -- "$0")/../.." && pwd -P)
repo_git() { (cd -- "$repo" && git "$@"); }

PATHS="infra/ops infra/backup infra/postgres/archive-wal.sh infra/postgres/pg_hba.prod.conf infra/postgres/pg_hba.staging.conf infra/provision.sh infra/provision-check.sh infra/postgres/gate-check.sh infra/postgres/gate-check.sql infra/operator/b2-capabilities.json infra/deploy/compose-allow.json infra/deploy/compose-version infra/deploy/gh-version infra/deploy/gh-sha256 infra/deploy/systemd infra/compose/prod.yml infra/compose/staging.yml infra/compose/edge.yml packages/db/sql/roles.sql"

if [ -n "$commit" ]; then
  # no checkout: a checkout would run C's tracked git hooks on this machine
  repo_git cat-file -e "$commit^{commit}" 2> /dev/null || { echo "install.sh: $commit is not a commit here; git fetch origin first" >&2; exit 2; }
  repo_git merge-base --is-ancestor "$commit" origin/main || { echo "install.sh: $commit is not an ancestor of origin/main" >&2; exit 2; }
  sha=$commit
else
  # shellcheck disable=SC2086
  dirty=$(repo_git status --porcelain -- $PATHS)
  if [ -n "$dirty" ]; then
    echo "install.sh: uncommitted changes under the bundle paths; commit or discard them first:" >&2
    printf '%s\n' "$dirty" >&2
    exit 2
  fi
  sha=$(repo_git rev-parse HEAD)
fi
id="git-$(printf '%s' "$sha" | cut -c1-12)"

# shellcheck disable=SC2029  # the remote command is a fixed string; only the validated id is substituted
ssh_run() { # remote command (a fixed string)
  if [ -n "$key" ]; then ssh -i "$key" "$host" "$1"; else ssh "$host" "$1"; fi
}

# sh gives a pipe its last command's status, so `git | ssh` would hide a failed git: both outputs are written out and git's status checked before
# the first ssh. The box cannot tell a tar cut between two members from a whole one. (Committed files only, no secrets.)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git_to() { # file, git arguments
  out=$1; shift
  rc=0
  repo_git "$@" > "$out" || rc=$?
  [ "$rc" = 0 ] || { echo "install.sh: git $1 failed (exit $rc); nothing was sent to the box" >&2; exit "$rc"; }
}
git_to "$tmp/install_box.py" show "$sha:infra/ops/install_box.py"
# shellcheck disable=SC2086
git_to "$tmp/bundle.tar" archive --format=tar "$sha" -- $PATHS

ssh_run 'sudo install -d -m 0700 /opt/polycarpic/.incoming && sudo tee /opt/polycarpic/.incoming/install_box.py > /dev/null' < "$tmp/install_box.py"
ssh_run "sudo /usr/bin/python3 -I /opt/polycarpic/.incoming/install_box.py $id $host" < "$tmp/bundle.tar"
