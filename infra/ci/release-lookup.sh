#!/usr/bin/env bash
# POLY-96 stage 3 (ruling §5, S96-15, S96-21): find the digest build.yml already built for a commit and prove it.
#   release-lookup.sh <40-hex commit>
# Never builds. Checks, in order: a successful build.yml run on main for the commit; its recorded digest; the image's
# revision label equals the commit; the provenance attestation verifies against the build.yml signer on refs/heads/main.
# Success prints `digest: sha256:...` as the LAST stdout line; every failure exits non-zero before printing it.
set -euo pipefail
commit="${1:-}"
if ! [[ "$commit" =~ ^[0-9a-f]{40}$ ]]; then echo "release-lookup: commit must be 40 lowercase hex" >&2; exit 2; fi
repo="${GITHUB_REPOSITORY:-richmosko/polycarpic}"
image="ghcr.io/${repo}"
out="${RELEASE_OUT:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/release}"
mkdir -p "$out"

run="$(gh run list --workflow build.yml --branch main --status success --commit "$commit" --limit 1 --json databaseId --jq '.[0].databaseId // empty')"
if [ -z "$run" ]; then echo "release-lookup: no successful build.yml run on main for ${commit}; nothing is published" >&2; exit 1; fi

gh run download "$run" -n "image-${commit}" -D "$out"
digest="$(tr -d '[:space:]' < "$out/digest.txt")"
if ! [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then echo "release-lookup: recorded digest is malformed" >&2; exit 1; fi

docker pull -q "${image}@${digest}" >/dev/null
label="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${image}@${digest}")"
if [ "$label" != "$commit" ]; then echo "release-lookup: image revision label ${label} != ${commit}" >&2; exit 1; fi

gh attestation verify "oci://${image}@${digest}" --repo "$repo" \
  --signer-workflow richmosko/polycarpic/.github/workflows/build.yml \
  --source-ref refs/heads/main --deny-self-hosted-runners >&2

echo "digest: ${digest}"
