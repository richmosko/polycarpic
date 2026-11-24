#!/usr/bin/env bash
# Installs the one Compose version of infra/deploy/compose-version on a CI runner (POLY-100 G10, S40 d), from Docker's apt repository, and fails
# unless `docker compose version --short` then answers exactly that version. Never the runner's own. Every command is printed before it runs, and
# nothing's output is hidden: the step's log is the diagnosis.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
want=$(tr -d '[:space:]' < "$here/../deploy/compose-version")
[[ "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "install-compose.sh: infra/deploy/compose-version does not hold one version" >&2; exit 1; }
FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88
APT=(-o DPkg::Lock::Timeout=300 -o Acquire::Retries=3)

run() { echo "+ $*"; "$@"; }

if [ "$(docker compose version --short 2> /dev/null || true)" = "$want" ]; then
  echo "install-compose.sh: Compose $want already installed"
  exit 0
fi
echo "install-compose.sh: running Compose is '$(docker compose version --short 2> /dev/null || echo none)', pinned $want"

# Docker's repository: the runner image may already carry it (then it is used as it is: a second entry with another Signed-By makes `apt-get update` fail);
# else it is added, the key checked against provision.sh's fingerprint first.
if grep -rqs 'download.docker.com' /etc/apt/sources.list /etc/apt/sources.list.d/; then
  echo "install-compose.sh: Docker's apt repository is already configured:"
  grep -rs 'download.docker.com' /etc/apt/sources.list /etc/apt/sources.list.d/ || true
else
  keyring=/etc/apt/keyrings/docker.gpg
  tmp=$(mktemp)
  run curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$tmp"
  got=$(gpg --show-keys --with-colons "$tmp" | awk -F: '$1 == "fpr" { print $10; exit }')
  [ "$got" = "$FPR" ] || { echo "install-compose.sh: Docker's apt key fingerprint is $got, expected $FPR" >&2; exit 1; }
  run sudo install -d -m 0755 /etc/apt/keyrings
  gpg --dearmor < "$tmp" | sudo tee "$keyring" > /dev/null
  run sudo chmod 0644 "$keyring"
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=$keyring] https://download.docker.com/linux/ubuntu $codename stable" | sudo tee /etc/apt/sources.list.d/docker.list
fi
run sudo apt-get "${APT[@]}" update
cand=$(apt-cache madison docker-compose-plugin | awk -F'|' -v w="$want" '{ gsub(/ /, "", $2); if (index($2, w "-") == 1) { print $2; exit } }')
if [ -z "$cand" ]; then
  echo "install-compose.sh: Docker's repository does not list docker-compose-plugin $want; it lists:" >&2
  apt-cache madison docker-compose-plugin >&2 || true
  exit 1
fi
run sudo apt-get "${APT[@]}" install -y --no-install-recommends --allow-downgrades "docker-compose-plugin=$cand"
got=$(docker compose version --short)
[ "$got" = "$want" ] || { echo "install-compose.sh: Compose is $got, expected $want" >&2; exit 1; }
echo "install-compose.sh: Compose $got"
