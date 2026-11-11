#!/usr/bin/env bash
# POLY-96: install the pinned Trivy binary, verified by sha256 (C-81/S96-2). Adds it to PATH for later steps.
set -euo pipefail
V=0.76.2
SHA=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf
d="${RUNNER_TEMP:-/tmp}/trivy"
mkdir -p "$d"
curl -fsSL -o "$d/trivy.tgz" "https://github.com/aquasecurity/trivy/releases/download/v${V}/trivy_${V}_Linux-64bit.tar.gz"
echo "${SHA}  $d/trivy.tgz" | sha256sum -c -
tar -xzf "$d/trivy.tgz" -C "$d" trivy
[ -z "${GITHUB_PATH:-}" ] || echo "$d" >> "$GITHUB_PATH"
"$d/trivy" --version
