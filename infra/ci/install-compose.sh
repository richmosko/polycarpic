#!/usr/bin/env bash
# Installs the one Compose version of infra/deploy/compose-version on a CI runner (POLY-100 G10, S40 d), from Docker's apt repository with the same
# key-fingerprint check as provision.sh, and fails unless `docker compose version --short` then answers exactly that version. Never the runner's own.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
want=$(tr -d '[:space:]' < "$here/../deploy/compose-version")
[[ "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "install-compose.sh: infra/deploy/compose-version does not hold one version" >&2; exit 1; }
FPR=9DC858229FC7DD38854AE2D88D81803C0EBFCD88

if [ "$(docker compose version --short 2> /dev/null || true)" = "$want" ]; then
  echo "install-compose.sh: Compose $want already installed"
  exit 0
fi

keyring=/etc/apt/keyrings/docker.gpg
list=/etc/apt/sources.list.d/docker.list
if [ ! -f "$keyring" ] || ! grep -q download.docker.com "$list" /etc/apt/sources.list.d/*.list 2> /dev/null; then
  tmp=$(mktemp)
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o "$tmp"
  got=$(gpg --show-keys --with-colons "$tmp" | awk -F: '$1 == "fpr" { print $10; exit }')
  [ "$got" = "$FPR" ] || { echo "install-compose.sh: Docker's apt key fingerprint is $got, expected $FPR" >&2; exit 1; }
  sudo install -d -m 0755 /etc/apt/keyrings
  gpg --dearmor < "$tmp" | sudo tee "$keyring" > /dev/null
  sudo chmod 0644 "$keyring"
  codename=$(. /etc/os-release && echo "$VERSION_CODENAME")
  echo "deb [arch=$(dpkg --print-architecture) signed-by=$keyring] https://download.docker.com/linux/ubuntu $codename stable" | sudo tee "$list" > /dev/null
fi
sudo apt-get update -y > /dev/null
cand=$(apt-cache madison docker-compose-plugin | awk -F'|' -v w="$want" '{ gsub(/ /, "", $2); if (index($2, w "-") == 1) { print $2; exit } }')
[ -n "$cand" ] || { echo "install-compose.sh: Docker's repository does not list docker-compose-plugin $want" >&2; exit 1; }
sudo apt-get install -y --no-install-recommends --allow-downgrades "docker-compose-plugin=$cand" > /dev/null
got=$(docker compose version --short)
[ "$got" = "$want" ] || { echo "install-compose.sh: Compose is $got, expected $want" >&2; exit 1; }
echo "install-compose.sh: Compose $got"
