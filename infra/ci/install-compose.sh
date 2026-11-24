#!/usr/bin/env bash
# Installs the one Compose version of infra/deploy/compose-version on a CI runner (POLY-100 G10, S40 d, C-81): the release binary of that version from
# github.com/docker/compose, checked against the sha256 committed in infra/deploy/compose-sha256 (taken from the release's own checksums.txt and from a
# download hashed locally, which agreed), installed as the system CLI plugin that Docker looks at before the runner's own. It fails unless
# `docker compose version --short` then answers exactly the pinned version. The box does not use this: provision.sh installs the same version from Docker's
# apt repository.
set -euo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
want=$(tr -d '[:space:]' < "$here/../deploy/compose-version")
[[ "$want" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "install-compose.sh: infra/deploy/compose-version does not hold one version" >&2; exit 1; }
sums="$here/../deploy/compose-sha256"

run() { echo "+ $*"; "$@"; }

case "$(uname -m)" in
  x86_64) arch=x86_64 ;;
  aarch64 | arm64) arch=aarch64 ;;
  *) echo "install-compose.sh: no Compose release for $(uname -m)" >&2; exit 1 ;;
esac
name="docker-compose-linux-$arch"
url="https://github.com/docker/compose/releases/download/v$want/$name"
expect=$(awk -v n="$name" '$2 == n { print $1 }' "$sums")
[[ "$expect" =~ ^[0-9a-f]{64}$ ]] || { echo "install-compose.sh: $sums holds no sha256 for $name" >&2; exit 1; }

echo "install-compose.sh: running Compose is '$(docker compose version --short 2> /dev/null || echo none)', pinned $want"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
run curl -fsSL --retry 3 -o "$tmp/$name" "$url"
got=$(sha256sum "$tmp/$name" | awk '{ print $1 }')
[ "$got" = "$expect" ] || { echo "install-compose.sh: $name has sha256 $got, expected $expect; nothing installed" >&2; exit 1; }
echo "install-compose.sh: sha256 $got matches $sums"
run sudo install -d -m 0755 /usr/local/lib/docker/cli-plugins
run sudo install -m 0755 "$tmp/$name" /usr/local/lib/docker/cli-plugins/docker-compose
got=$(docker compose version --short)
[ "$got" = "$want" ] || { echo "install-compose.sh: Compose is $got, expected $want" >&2; docker compose version >&2 || true; ls -la "$HOME/.docker/cli-plugins" /usr/local/lib/docker/cli-plugins /usr/libexec/docker/cli-plugins >&2 || true; exit 1; }
echo "install-compose.sh: Compose $got"
