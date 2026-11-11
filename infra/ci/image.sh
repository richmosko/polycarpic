#!/usr/bin/env bash
# POLY-96: the one image build/scan the PR `image` job and build.yml share (ruling §1, §4).
#   image.sh build [name]   build the root Dockerfile and load it locally (GIT_COMMIT from env or HEAD); never cached
#   image.sh scan  [ref]    Trivy: fixable CRITICAL/HIGH and embedded secrets fail (C-82). ref = local image or registry@digest
#   image.sh sbom  [ref]    CycloneDX SBOM of ref to $SBOM_OUT (default sbom.cdx.json)
# A .trivyignore entry is one id per line followed by "# expires=YYYY-MM-DD issue=POLY-NN"; a line without both, or one
# past its date, fails the scan before Trivy runs (S96-10).
set -euo pipefail
cmd="${1:-}"
name="${2:-polycarpic}"

check_ignorefile() {
  local f=.trivyignore today n=0
  [ -f "$f" ] || return 0
  today="$(date -u +%Y-%m-%d)"
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    case "$line" in ''|'#'*) continue ;; esac
    if ! [[ "$line" =~ ^[A-Za-z0-9._-]+[[:space:]]+#[[:space:]]*expires=([0-9]{4}-[0-9]{2}-[0-9]{2})[[:space:]]+issue=POLY-[0-9]+ ]]; then
      echo "$f:$n: entry needs '# expires=YYYY-MM-DD issue=POLY-NN'" >&2; return 1
    fi
    if [[ "${BASH_REMATCH[1]}" < "$today" ]]; then
      echo "$f:$n: entry expired ${BASH_REMATCH[1]}" >&2; return 1
    fi
  done < "$f"
}

case "$cmd" in
  build)
    commit="${GIT_COMMIT:-$(git rev-parse HEAD)}"
    docker build --no-cache --pull --build-arg "GIT_COMMIT=${commit}" -t "${name}:ci" .
    ;;
  scan)
    ref="${2:-polycarpic:ci}"
    check_ignorefile
    ignore=()
    [ -f .trivyignore ] && ignore=(--ignorefile .trivyignore)
    trivy image --scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 "${ignore[@]}" "$ref"
    ;;
  sbom)
    ref="${2:-polycarpic:ci}"
    trivy image --format cyclonedx --output "${SBOM_OUT:-sbom.cdx.json}" "$ref"
    ;;
  *) echo "usage: image.sh build [name] | scan [ref] | sbom [ref]" >&2; exit 2 ;;
esac
