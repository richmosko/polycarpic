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
    # the release bundle needs infra/release/images.env (POLY-100 F1): build.yml writes the real one first; a PR or local build gets all zeros, which V5 refuses
    if [ ! -f infra/release/images.env ]; then
      z="sha256:$(printf '0%.0s' $(seq 64))"
      bash infra/ci/images-env.sh "$z" "$z" "$z"
    fi
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
    # POLY-86 S20: the sign-in service's auth still starts with the build tooling gone (a removed package that better-auth imports at load
    # fails here, not in production). The mailer seam (POLY-137 R1.5) takes `mailer`; the route count is AUTH_ROUTES' (53 with /second-step/cancel-hold). No database: the schema probe logs an error and createAuth still resolves.
    smoke="const m = await import('/app/apps/auth/node_modules/@poly/auth/src/index.ts');
      const a = await m.createAuth(m.authOptions({ secret: 'smoke-'.repeat(8), baseURL: 'https://smoke.invalid', tlsMode: 'real-domain', requireClientIp: true, mailer: { send: async () => {} } }));
      if (typeof a.handler !== 'function' || Object.keys(m.AUTH_ROUTES).length !== 53) process.exit(1);"
    docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$ref" --input-type=module --eval "$smoke" >/dev/null 2>&1 \
      || { echo "image check: @poly/auth does not start in the built image" >&2; exit 1; }
    # POLY-161 R1, S9 (B24, B25, B26): what the web stage left in the FINAL image. Each find has a control that it can see handler.js, so an error or a wrong path is not read as "nothing found".
    docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --entrypoint sh "$ref" -c '
      bad=0; web=/app/apps/web
      [ -n "$(find $web/build -name handler.js 2>/dev/null)" ] || { echo "image check: find cannot see build/handler.js" >&2; exit 1; }
      [ -f $web/build/packages.json ] || { echo "image check: build/packages.json is missing" >&2; bad=1; }
      for f in $web/build/index.js $web/build/server/adapter-index.js; do
        [ ! -e "$f" ] || { echo "image check: $f is in the image" >&2; bad=1; }
      done
      found="$(find $web \( -name "*.map" -o -name .svelte-kit -o -name tests -o -name ".env*" \) 2>/dev/null; find /app -name ".env*" 2>/dev/null)"
      [ -z "$found" ] || { echo "image check: files that must not ship:" >&2; echo "$found" >&2; bad=1; }
      tools="$(find /app -path "*/node_modules/*" \( -name vite -o -name rolldown -o -name "rolldown-*" -o -name svelte-check -o -name playwright -o -name playwright-core -o -name "@sveltejs" -o -name "@playwright" \) -prune -print 2>/dev/null; find /app/node_modules/.pnpm -maxdepth 1 \( -name "@sveltejs+*" -o -name "rolldown@*" -o -name "svelte-check@*" -o -name "playwright*" \) 2>/dev/null)"
      [ -z "$tools" ] || { echo "image check: build tooling in the image:" >&2; echo "$tools" >&2; bad=1; }
      exit $bad' || { echo "image check: web build contents" >&2; exit 1; }
    for uid in 1000 10101; do
      w="$(docker run --rm --network none --cap-drop ALL --user "$uid" --entrypoint sh "$ref" -c 'find /app/apps/web/build -writable 2>/dev/null; test -n "$(find /app/apps/web/build -name handler.js)" || echo CONTROL-FAILED')"
      [ -z "$w" ] || { echo "image check: uid $uid can write under apps/web/build (or the control failed): $w" >&2; exit 1; }
    done
    # R14: the packages the bundle holds are the committed ones; picomatch is refused by name whatever the list says.
    pk="const fs = await import('node:fs'); const have = [...new Set(JSON.parse(fs.readFileSync('/app/apps/web/build/packages.json', 'utf8')).map((p) => p.name))].sort();
      const want = fs.readFileSync('/app/apps/web/bundle-packages.txt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).sort();
      if (have.length === 0 || have.includes('picomatch') || JSON.stringify(have) !== JSON.stringify(want)) { console.error('bundle packages differ from the committed list'); process.exit(1); }"
    docker run --rm --network none --cap-drop ALL --entrypoint node "$ref" --input-type=module --eval "$pk" \
      || { echo "image check: build/packages.json is not the committed list" >&2; exit 1; }
    # B26: the bundle answers in the image, with no network: status and a body marker are compared, so a silent catch cannot pass. packages.json is not served.
    app="const http = await import('node:http'); const { handler } = await import('/app/apps/web/build/handler.js');
      const srv = http.createServer((req, res) => handler(req, res, () => { res.statusCode = 404; res.end(); })).listen(0, '127.0.0.1');
      await new Promise((r) => srv.once('listening', r));
      const get = async (p) => { const r = await fetch('http://127.0.0.1:' + srv.address().port + p, { redirect: 'manual' }); return [r.status, await r.text(), r.headers.get('location')]; };
      const [s1, b1] = await get('/sign-in'); const [s2, , l2] = await get('/dashboard'); const [s3] = await get('/packages.json');
      const ok = s1 === 200 && b1.includes('<html') && s2 === 303 && (l2 ?? '').startsWith('/sign-in') && s3 !== 200;
      if (!ok) console.error('smoke:', s1, s2, l2, s3);
      process.exit(ok ? 0 : 1);"
    docker run --rm --network none --cap-drop ALL --security-opt no-new-privileges --entrypoint node "$ref" --input-type=module --eval "$app" \
      || { echo "image check: the web bundle does not answer /sign-in (200 HTML) and /dashboard (303) in the built image" >&2; exit 1; }
    ;;
  sbom)
    ref="${2:-polycarpic:ci}"
    trivy image --format cyclonedx --output "${SBOM_OUT:-sbom.cdx.json}" "$ref"
    ;;
  *) echo "usage: image.sh build [name] | check [ref] | scan [ref] | sbom [ref]" >&2; exit 2 ;;
esac
