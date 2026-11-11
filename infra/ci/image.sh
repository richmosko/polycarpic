#!/usr/bin/env bash
# POLY-96: the one image build the PR `image` job and build.yml share (ruling §1, §4).
#   image.sh build [name]   build the root Dockerfile and load it locally (GIT_COMMIT from env or HEAD)
#   image.sh scan  [ref]    Trivy: fixable CRITICAL/HIGH and embedded secrets fail (C-82); stage 2 fills this in
set -euo pipefail
cmd="${1:-}"
name="${2:-polycarpic}"
case "$cmd" in
  build)
    commit="${GIT_COMMIT:-$(git rev-parse HEAD)}"
    docker build --pull --build-arg "GIT_COMMIT=${commit}" -t "${name}:ci" .
    ;;
  *) echo "usage: image.sh build [name] | scan [ref]" >&2; exit 2 ;;
esac
