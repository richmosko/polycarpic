#!/usr/bin/env bash
# POLY-96: the one image build/scan the PR `image` job and build.yml share (ruling §1, §4).
#   image.sh build [name]   build the root Dockerfile and load it locally (GIT_COMMIT from env or HEAD); never cached
#   image.sh scan  [ref]    Trivy: fixable CRITICAL/HIGH and embedded secrets fail (C-82). ref = local image or registry@digest
#   image.sh check [ref]    assert the built image: no package manager on PATH, no node_modules tree, non-root user (A4),
#                           no esbuild / drizzle-kit / vite / vitest / tsx / SvelteKit / drizzle-adapter in /app (POLY-86 S20)
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
    # bash 3.2 (macOS) treats an empty array as unset under set -u, so branch instead of expanding one
    if [ -f .trivyignore ]; then
      trivy image --scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 --ignorefile .trivyignore "$ref"
    else
      trivy image --scanners vuln,secret --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 "$ref"
    fi
    ;;
  check)
    ref="${2:-polycarpic:ci}"
    # build.yml pushes straight to the registry and keeps no local copy, so fetch the pushed digest (never a tag)
    case "$ref" in *@sha256:*) docker pull -q "$ref" >/dev/null ;; esac
    user="$(docker image inspect --format '{{.Config.User}}' "$ref")"
    if [ "$user" != "node" ]; then echo "image check: Config.User is '${user}', want node" >&2; exit 1; fi
    docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --entrypoint sh "$ref" -c '
      bad=0
      for c in npm npx corepack pnpm yarn; do
        if command -v "$c" >/dev/null 2>&1; then echo "image check: $c resolves on PATH" >&2; bad=1; fi
      done
      if [ -e /usr/local/lib/node_modules ]; then echo "image check: /usr/local/lib/node_modules exists" >&2; bad=1; fi
      # POLY-86 F10 / S20: no build tooling in the app tree. The names are the pnpm store entries and the links to them,
      # plus any file named esbuild (the Go binary). Fails here, before Trivy, so the cause is named.
      found="$(find /app/node_modules/.pnpm -maxdepth 1 \( -name "esbuild@*" -o -name "@esbuild+*" -o -name "@esbuild-kit+*" -o -name "drizzle-kit@*" -o -name "vite@*" -o -name "vitest@*" -o -name "tsx@*" -o -name "@sveltejs+kit@*" -o -name "@better-auth+drizzle-adapter@*" \) 2>/dev/null
        find /app/node_modules /app/packages/*/node_modules /app/apps/*/node_modules -maxdepth 2 -not -path "*/.vite/*" \( -name esbuild -o -name "@esbuild" -o -name "@esbuild-kit" -o -name drizzle-kit -o -name vite -o -name vitest -o -name tsx -o -name drizzle-adapter \) 2>/dev/null
        find /app -type f -name esbuild 2>/dev/null)"
      if [ -n "$found" ]; then echo "image check: build tooling in the image:" >&2; echo "$found" >&2; bad=1; fi
      [ "$(id -un)" = node ] || { echo "image check: process user is $(id -un)" >&2; bad=1; }
      exit $bad'
    # POLY-86 S20: the app's auth still starts with the build tooling gone (a removed package that better-auth imports at load
    # fails here, not in production). No database: the schema probe logs an error and createAuth still resolves.
    smoke="const m = await import('/app/apps/web/node_modules/@poly/auth/src/index.ts');
      const a = await m.createAuth(m.authOptions({ secret: 'smoke-'.repeat(8), baseURL: 'https://smoke.invalid', tlsMode: 'real-domain', requireClientIp: true, sendMagicLink: async () => {} }));
      if (typeof a.handler !== 'function' || Object.keys(m.AUTH_ROUTES).length !== 47) process.exit(1);"
    docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$ref" --input-type=module --eval "$smoke" >/dev/null 2>&1 \
      || { echo "image check: @poly/auth does not start in the built image" >&2; exit 1; }
    ;;
  sbom)
    ref="${2:-polycarpic:ci}"
    trivy image --format cyclonedx --output "${SBOM_OUT:-sbom.cdx.json}" "$ref"
    ;;
  *) echo "usage: image.sh build [name] | check [ref] | scan [ref] | sbom [ref]" >&2; exit 2 ;;
esac
