#!/usr/bin/env bash
# POLY-100 R11: write infra/release/images.env from the three sibling digests build.yml just pushed. The file is a build artifact, never committed.
# usage: images-env.sh <postgres digest> <tools digest> <caddy digest>
set -euo pipefail
[ $# -eq 3 ] || { echo "usage: images-env.sh <postgres> <tools> <caddy>" >&2; exit 2; }
for d in "$@"; do
  [[ "$d" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "images-env: not a sha256 digest" >&2; exit 1; }
done
mkdir -p infra/release
{
  echo "POLY_POSTGRES_IMAGE=ghcr.io/richmosko/polycarpic-postgres@$1"
  echo "POLY_TOOLS_IMAGE=ghcr.io/richmosko/polycarpic-tools@$2"
  echo "POLY_CADDY_IMAGE=ghcr.io/richmosko/polycarpic-caddy@$3"
} > infra/release/images.env
