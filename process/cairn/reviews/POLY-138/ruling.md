# POLY-138 ruling: Caddy and edge follow-ups

Architect, 2026-11-21. Tree read at `a82fad62d98e16f85e39217e7ea79073b8e7c764`. Scope: the six items and five comments on
`POLY-138.md`, plus one drift found while measuring (R4). A claim is measured unless tagged `(unmeasured)`; the
measurements are in §M and were taken on this Mac (Docker 29.9.3, arm64) on the date above. Where the lead's or the
Principal's call is needed it is in §D, and the ruling proceeds on the recommendation unless the issue file says otherwise.

## M — Measurements

| # | Question | Command (abridged) | Result |
|---|---|---|---|
| M1 | Does a released Caddy carry x/net ≥ 0.62.0? | `gh api repos/caddyserver/caddy/releases`; `contents/go.mod?ref=<tag>` for the four newest | Newest release **v2.11.9** (2026-11-05). go.mod: v2.11.9 and v2.11.8 pin x/net **v0.60.0**, v2.11.7/v2.11.6 v0.59.0. `master` pins v0.62.0, but no tag carries it. |
| M2 | Same, from the published binary | `docker cp` `/usr/bin/caddy` out of `caddy:latest`; `go version -m` in the pinned builder | `caddy version` v2.11.9; `dep golang.org/x/net v0.60.0`. |
| M3 | Does our derivative carry the fix? | `docker build infra/caddy`; `go version -m` on its binary | `dep golang.org/x/net v0.60.0` then `=> golang.org/x/net v0.62.0 h1:18EL…`. The effective version is the `=>` line. |
| M4 | Does the pinned builder weaken Go checksum checks? | `go env GOSUMDB GONOSUMDB GOPRIVATE GOINSECURE GOFLAGS GOPROXY` in `caddy:2.11.9-builder@sha256:1b82…` | `sum.golang.org`, four empty, `https://proxy.golang.org,direct`. Image env sets none of them. |
| M5 | Does `apt-get upgrade` move the Postgres minor? | `postgres:17.10@sha256:7958…`: `apt-get -s upgrade` | `postgresql-17` and `postgresql-client-17` 17.10 → **17.12**; `libpq5` 18.4 → 19.0. Verified: the image says 17.10 and runs 17.12. |
| M6 | The pgtap test image too? | same base: `apt-get install -s postgresql-17-pgtap` | Installing pgtap also moves `postgresql-17` to 17.12. With the server packages held on 17.10 the install **fails** (pgtap needs the newer server). |
| M7 | Hold on the current minor | `postgres:17.12@sha256:b60e9004…` (Docker Hub index digest): `apt-mark hold postgresql-$PG_MAJOR postgresql-client-$PG_MAJOR`, `apt-get upgrade -y`, `apt-get install age=1.2.1-1+b5`; second run with `postgresql-17-pgtap` | `postgres --version` 17.12 before and after; the upgrade still applies the libc6, libssl3t64, openssl, zlib1g and postgresql-common updates; age installs; pgtap installs and `pgtap.control` exists. `PG_MAJOR=17` is set by the base image. |
| M8 | Client address, Service-Worker match, logs | `caddy:2.11.9@sha256:0c22…` and a Node echo upstream on a scratch network | With `header_up X-Forwarded-For {remote_host}`, a request with `X-Forwarded-For: 1.2.3.4, 5.6.7.8` **and** a second `X-Forwarded-For: 9.9.9.9` line reaches the upstream as one line, one entry, the peer (`172.20.0.1`). `X-Real-IP` and `Forwarded` pass through unless deleted. `@sw header Service-Worker *` answers 403 for `script`, `Script`, `x` and an empty value. |
| M9 | Does Caddy log the query with **no** `log` directive? | same, upstream absent, `GET /down/sign-up?invitation=SECRET` | **Yes.** `http.log.error` writes `"uri":"/down/sign-up?invitation=SECRET…"` on the 502. No access log is needed for the leak. |
| M10 | The R3 filter | same, with R3's global `log` block | `/sign-up?invitation=…` → `/sign-up`; `/api/auth/reset-password/<tok>?callbackURL=…` → `/api/auth/reset-password`; `/api/auth/magic-link/verify?token=…` → `/api/auth/magic-link`; `/api/auth/callback/google?code=…&state=…` → `/api/auth/callback`. Zero log lines contain a token. `Authorization` and `Cookie` print `REDACTED` (Caddy default); `Referer` is gone. |
| M11 | The whole target Caddyfile (§R-text) | `caddy adapt` in the `infra/caddy` derivative, env as `edge.yml` renders | Exit 0, no `"level":"error"`. Four `warn` lines "Unnecessary header_up X-Forwarded-For" (expected; see R1). Every `reverse_proxy` handler has `headers.request.set["X-Forwarded-For"] = ["{http.request.remote.host}"]`, `delete = ["X-Real-IP","Forwarded"]`, `load_balancing.try_duration = 10000000000`; no `trusted_proxies` in the JSON. |
| M12 | Does any Renovate config exist, or any issue own one? | `ls renovate.json .github/renovate.json .renovaterc*`; `grep -il renovate process/cairn/issues/*`; `gh pr list --search author:app/renovate` | No config file, no issue other than POLY-138's own, and no Renovate or Dependabot PR ever. SECURITY C-80 and INFRA §5/§6.1a describe Renovate as if it runs. |
| M13 | The R8 config | `renovate/renovate@sha256:d6b65ff3…` (44.257.9): `renovate-config-validator --strict`; `--platform=local --dry-run=lookup` on a copy of the two Dockerfiles | Valid. Proposes `postgres` 17.10 → 17.12 (branch `renovate/postgres-17.x`, digest `b60e9004…`) and groups the two Caddy digest bumps on `renovate/caddy`; offers no 18.x/19.x; finds `age` (current, no update) and the `xcaddy build v2.11.9` literal. Without `timestamp-optional` the Postgres minors sit **pending forever**: Docker Hub gives them no release timestamp. |

## R1 — Client address (item 1; gates POLY-104)

- One snippet, `(upstream)`, imported inside **every** `reverse_proxy` block on both sites (four today):
  `header_up X-Forwarded-For {remote_host}`, `header_up -X-Real-IP`, `header_up -Forwarded`, and R4's `lb_try_duration 10s`.
- `{remote_host}` is the TCP peer. The header is set, never appended to (M8). No `trusted_proxies` anywhere, because
  nothing sits in front of Caddy (POLY-86 S19 point 2). A CDN or tunnel in front needs a new seceng ruling.
- Deleting `X-Real-IP` and `Forwarded` is new: the app reads neither today (S19 point 1), and removing them stops a
  later change from trusting a client-sent value. Cost: two lines in one snippet.
- `caddy adapt` warns "Unnecessary header_up X-Forwarded-For" (M11): Caddy's default does the same thing. The line
  stays, so the result does not rest on that default (S19). The adapt test keeps failing on `error` only, never `warn`.

## R2 — `Service-Worker` refusal (item 6)

- Both HTTPS site blocks: `@sw header Service-Worker *` and `respond @sw 403`, inside the site's `route`.
- Match on presence (`*`), not the value `script`: M8 shows it catches every value, and a browser sends the header
  only when fetching a worker script. The app registers no worker, so nothing legitimate is refused.
- `app.` gains a `route` so the order is literal, as `staging.` already has. On `staging.` the refusal sits after the
  allowlist and before `basic_auth` (SC3 stands: an outside client still learns nothing).
- The 403 carries the security headers (site-level `header … defer`, as for the allowlist 403).
- The `http://` redirect block is unchanged: it serves nothing a worker could be registered from.

## R3 — No query string or path token in any Caddy log (comment 2)

- Caddy writes **no access log** (no site-level `log` directive). A site `log` creates its own logger that the filter
  below does not reach, so the lint refuses one (R5). Adding an access log later needs its own filter and a ruling (§D2).
- The **default** logger, in the global options, filters every entry that carries a request (M9 shows `http.log.error`
  does): `request>uri regexp "^(/api/auth/[^/?#]*)[^?#]*|[?#].*" "${1}"` and `request>headers>Referer delete`.
  The regex drops the query and fragment everywhere, and under `/api/auth/` everything after the first segment,
  because `/reset-password/:token` carries its token in the path (`packages/auth/src/route-policy.ts`). M10.
- `log_credentials` appears nowhere (it would print `Cookie` and `Authorization`, which Caddy redacts by default).
- Rule that follows: outside `/api/auth/`, no route carries a secret in a path segment. Recorded for ARCH at the
  verdict; nothing violates it today (the invitation token is in the `/sign-up` query).

## R4 — `lb_try_duration 10s` (drift, added)

ARCH §8.1 and INFRA §4.6 say Caddy retries an upstream for 10 seconds during a deploy; the Caddyfile has no such line.
It goes in `(upstream)` (M11: `try_duration` 10 s on all four). It keeps the docs true and costs one line.

## The target Caddyfile

`infra/caddy/Caddyfile` becomes exactly this text (comments may be reworded; directives, order and values may not).
Measured as M11.

```caddyfile
{
	admin off
	http_port 8080
	https_port 8443
	log {
		output stderr
		format filter {
			request>uri regexp "^(/api/auth/[^/?#]*)[^?#]*|[?#].*" "${1}"
			request>headers>Referer delete
		}
	}
}

(security_headers) {
	header {
		defer
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
}

(upstream) {
	header_up X-Forwarded-For {remote_host}
	header_up -X-Real-IP
	header_up -Forwarded
	lb_try_duration 10s
}

http://app.{$POLY_DOMAIN}, http://staging.{$POLY_DOMAIN} {
	import security_headers
	redir https://{host}{uri} permanent
}

app.{$POLY_DOMAIN} {
	tls {$POLY_TLS}
	import security_headers
	handle_errors {
		import security_headers
	}
	route {
		@sw header Service-Worker *
		respond @sw 403
		@auth path /api/auth /api/auth/*
		reverse_proxy @auth prod-auth:3000 {
			import upstream
		}
		reverse_proxy prod-web:3000 {
			import upstream
		}
	}
}

staging.{$POLY_DOMAIN} {
	tls {$POLY_TLS}
	import security_headers
	handle_errors {
		import security_headers
	}
	route {
		@denied not remote_ip {$POLY_STAGING_ALLOW}
		respond @denied 403
		@sw header Service-Worker *
		respond @sw 403
		basic_auth {
			import /run/secrets/staging_basic_auth
		}
		@auth path /api/auth /api/auth/*
		reverse_proxy @auth staging-auth:3000 {
			import upstream
		}
		reverse_proxy staging-web:3000 {
			import upstream
		}
	}
}
```

## R5 — Lint rules in `infra/lint/compose-policy.mjs` (item 3, and the Caddyfile guards)

New rule ids, each with a fail fixture in `tests/infra/lint.test.ts` or `lint-sc.test.ts`:

- `edge-alias` (F11). In `prod.yml` and `staging.yml`, a service on `polycarpic-edge-<p>` has `aliases` on that network
  equal to exactly `["<kind>-<service>"]` (`prod-web`, `prod-auth`, `staging-web`, `staging-auth`), and sets no
  `container_name` and no `links`/`external_links` (each also registers a name on the network). Read from the
  rendered config. The existing `cross-project` rule already stops staging from joining `edge-prod`; this one stops a
  staging container from answering to `prod-web` on Caddy's side, since Caddy sits on both edge networks.
- `caddy-upstream`. In the `app.` site every `reverse_proxy` upstream is `prod-web:3000` or `prod-auth:3000`; in
  `staging.` it is `staging-web:3000` or `staging-auth:3000`; the `http://` block has none.
- `caddy-xff`. The `(upstream)` snippet holds exactly R1's four lines. Every `reverse_proxy` line in a site block ends
  in `{` and the next line is `import upstream`. `trusted_proxies` stays refused (existing check).
- `caddy-sw`. Each HTTPS site's `route` holds `@sw header Service-Worker *` then `respond @sw 403`, before its first
  `basic_auth` and first `reverse_proxy`.
- `caddy-log`. The global block holds the R3 `log` block with its two filter lines; no site block holds a `log`
  directive; `log_credentials` appears nowhere.
- The existing `caddy-headers` loop exempts the `(upstream)` snippet (it imports no headers, by design).

## R6 — The Postgres image runs the minor its tag names (item 5)

- `infra/postgres/Dockerfile` `FROM postgres:17.12@sha256:b60e90042aa6b8dbecd58e224b3e36114dbf8ad754465264c2476ad58a86e45c`
  (the index digest Docker Hub serves for 17.12, M7; the same digest Renovate proposes, M13). No behaviour change: the
  image already ran 17.12 (M5), and every DB test so far ran on 17.12 (POLY-147 R11 read 17.12).
- The `RUN` holds the server packages before the upgrade:
  `apt-mark hold "postgresql-$PG_MAJOR" "postgresql-client-$PG_MAJOR" && apt-get update && apt-get upgrade -y && …`.
  The upgrade stays, so OS fixes still land on the weekly rebuild (M7). Not "drop the upgrade": that would leave the
  fixable libssl/libc CVEs to Trivy until the next base digest. `libpq5` is not held; it moves to 19.0 (M7), which is
  the library major the client tools use and is ABI-stable across server majors `(unmeasured: no replication test)`.
- `tests/db/docker/Dockerfile` takes the same hold before installing pgtap, so the DB battery runs the tagged minor too.
- **Consequence, accepted:** when pgdg ships 17.13, the held pgtap install fails (M6) and the DB job goes red until the
  FROM line is bumped. That is the drift made loud instead of silent; Renovate's `postgres-17.x` PR is the fix.
- Tests: `SHOW server_version` matches `^<M.m>( |$)`, where `<M.m>` is read from the FROM line, on the compose-run
  prod container (`tests/infra/image/postgres.test.ts`) and in the DB harness (an existing `tests/db` file, so no
  new `DB_AREAS` entry). A static test: the hold precedes `apt-get upgrade` in the same `RUN`, in both Dockerfiles.

## R7 — The xcaddy rebuild stays (item 2)

- M1–M2: no Caddy release carries x/net ≥ 0.62.0. The rebuild and its `--replace` stay; the image guard stays at the
  re-ruled +180 s (POLY-95 verdict). Removal moves to a follow-up (F1); Renovate's `renovate/caddy` PR (R8) is the
  signal that a new release exists.
- Two tests pin the property rather than the mechanism, so they survive the removal unchanged:
  - The built Caddy binary's **effective** x/net (the `=>` line when present, M3) is ≥ 0.62.0, by `go version -m` run
    in the pinned builder stage against the built image's `/usr/bin/caddy`.
  - Nothing disables Go checksum verification: `infra/caddy/Dockerfile` contains none of `GOSUMDB`, `GONOSUMDB`,
    `GONOSUMCHECK`, `GONOVERIFY`, `GOPRIVATE`, `GOINSECURE`, `GOFLAGS`, `-insecure`; and `go env GOSUMDB` in the pinned
    builder is `sum.golang.org` with `GONOSUMDB`, `GOPRIVATE`, `GOINSECURE` empty (M4).

## R8 — Renovate (item 4)

No issue owns Renovate config and none exists (M12), so this issue adds the smallest one that covers the two pins plus
the Caddy lines R7 needs watched. `renovate.json` at the root, exactly (M13):

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "enabledManagers": ["dockerfile", "custom.regex"],
  "includePaths": ["infra/postgres/Dockerfile", "infra/caddy/Dockerfile"],
  "minimumReleaseAge": "3 days",
  "automerge": false,
  "customManagers": [
    {
      "customType": "regex",
      "managerFilePatterns": ["/^infra/postgres/Dockerfile$/"],
      "matchStrings": ["\\bage=(?<currentValue>\\S+)"],
      "depNameTemplate": "age",
      "datasourceTemplate": "deb",
      "versioningTemplate": "deb",
      "registryUrlTemplate": "https://deb.debian.org/debian?suite=trixie&components=main&binaryArch=amd64"
    },
    {
      "customType": "regex",
      "managerFilePatterns": ["/^infra/caddy/Dockerfile$/"],
      "matchStrings": ["xcaddy build v(?<currentValue>\\d+\\.\\d+\\.\\d+)"],
      "depNameTemplate": "caddy",
      "datasourceTemplate": "docker"
    }
  ],
  "packageRules": [
    {
      "matchDatasources": ["docker"],
      "matchDepNames": ["postgres"],
      "allowedVersions": "<18",
      "minimumReleaseAgeBehaviour": "timestamp-optional"
    },
    { "matchDepNames": ["caddy"], "groupName": "caddy" }
  ]
}
```

- `allowedVersions "<18"`: a major needs the upgrade path and restore drill (INFRA §6.1a), never a bot PR. When the
  major moves, this line moves with `infra/postgres-major`; a test asserts the two agree.
- `timestamp-optional` for Postgres only: without it the 3-day age rule blocks every Postgres minor forever (M13). The
  cost is that a Postgres tag is proposed without a 3-day wait; a human still reviews, and CI runs the DB battery first.
- `includePaths` keeps it off the app's Node image, pnpm and Actions, which nobody has ruled on (F3).
- Tests (static, in `tests/infra`): the file parses and equals the ruled keys above; and the validator run
  (`renovate-config-validator --strict` in the digest-pinned image) is recorded once by qa at tests-red, not in CI.
- The config does nothing until something runs Renovate. §D1.

## R9 — `.dockerignore` test-file names (comment 1)

The lint counts as a test any file matching `\.(test|spec)\.[cm]?[jt]sx?$` (`scripts/layers/plugin.mjs` `TEST_FILE`).
`.dockerignore` replaces `**/*.test.ts` with `**/*.test.*` and `**/*.spec.*`, and `packages/secrets/**/*.test.ts`
(after the `!packages/secrets` negation, where order matters) with `packages/secrets/**/*.test.*` and
`packages/secrets/**/*.spec.*`. `tests/image/dockerfile.test.ts`'s list takes the new lines, and a test asserts both
`packages/secrets/**` lines come after `!packages/secrets`.

## Tests qa pins, and what makes each red

| Criterion | Test (file) | Red when |
|---|---|---|
| R1 forged header | container (`tests/infra/image/caddy.test.ts`): upstream echoes raw headers; send `X-Forwarded-For: 198.51.100.1, 203.0.113.5` plus a second `X-Forwarded-For` line, `X-Real-IP`, `Forwarded` to both sites (staging with credentials, allowlisted), to the web and the `/api/auth` upstream | upstream sees ≠ one line, one entry, equal to the peer; or sees `X-Real-IP`/`Forwarded` |
| R1, R4 adapted | `caddy-adapt.test.ts`: every `reverse_proxy` handler's `headers.request` and `load_balancing.try_duration` as in M11; no `trusted_proxies` | any handler differs |
| R2 | container: `Service-Worker: script` → 403 with the three security headers, on `app.` and on allowlisted `staging.` with and without credentials; without the header the same path proxies | any 200/401, or a missing header |
| R3 | container: upstream stopped, GET each M10 URI with a unique marker; `docker logs` holds zero markers and the M10 paths; adapt JSON has the filter and no site `log` | a marker appears |
| R5 | lint fixtures, one per rule id | the fixture passes the lint |
| R6 | `SHOW server_version` (prod container and DB harness); static hold-before-upgrade in both Dockerfiles; FROM line is 17.12 at the ruled digest | version ≠ tag, hold missing or after the upgrade |
| R7 | effective x/net ≥ 0.62.0; checksum-env checks | below 0.62.0, or a forbidden token/setting |
| R8 | `renovate.json` shape; `allowedVersions` major agrees with `infra/postgres-major` | key drift |
| R9 | `.dockerignore` lines and order | a line missing or before the negation |

## Guards

- Image job: ≤ +30 s over a same-day control on `main` for this loop's additions (two container tests, adapt walk,
  `go version -m`) `(unmeasured: estimate; measured at build-green)`. The +180 s xcaddy allowance is unchanged.
- Lint job: ≤ +5 s `(unmeasured)`. DB job: no change beyond noise; the pgtap image tag changes with the digest, so the
  first run rebuilds it once.

## Docs (owners, this loop)

- seceng (138b): C-04's client-address sentence and §1560's "rests on Caddy's default until POLY-138"; R-25's Caddy
  mitigation ("not built yet" goes); C-80's Renovate sentences match §D1's outcome.
- devops (138d): INFRA §5 and §6.1a on the hold, the 17.12 pin and who runs Renovate; the log filter and "no access log".
- architect (138e): ARCH's client-address paragraph and R3's path-segment rule.

## D — Decisions for the lead

- **D1. What runs Renovate.** The config is inert until something runs it, and the docs already say it runs.
  - (a) The Mend Renovate GitHub App: it gets write access to contents, PRs and workflows on this repo, a new party on
    trust boundary TB-12. PRs appear by themselves.
  - (b) **Recommended:** a weekly scheduled workflow with `permissions: contents: read`, no secrets, running the
    digest-pinned Renovate image in `--platform=local --dry-run=lookup`. It fails when an update is due, and the red
    scheduled run is the email. A human makes the 1–3 line bump. No new write access, no third party; cost one small
    workflow plus a structure test, built in this loop if chosen before tests-red.
  - (c) Nothing runs it; devops runs the same lookup by hand monthly (runbook line). Cheapest, easiest to forget.
- **D2. No Caddy access log.** Recommended, for now: the edge keeps no per-request record. The app's own logs and the
  filtered error log remain. If an access log is wanted, it is one site `log` per site with R3's filter, plus a lint
  change; the cost is one more place a token could leak if the filter drifts.

## Follow-ups (the lead files after merge)

- F1. Drop the xcaddy rebuild and `--replace` when a Caddy release's go.mod carries x/net ≥ 0.62.0 (`master` already
  does); R7's x/net test then passes on the stock binary and the image guard returns to +150 s.
- F2. The Caddy `2.11.9` and `2.11.9-builder` tags have been re-pushed upstream (M13 proposes new digests for both).
  Take them on the next Caddy bump; not needed for this loop.
- F3. Renovate (or §D1's runner) for the app's Node base image, pnpm and GitHub Actions: SECURITY C-80 assumes it.
- F4. The prod maintenance page INFRA §7.1 steps 14–17 and lockdown describe is not in the Caddyfile (POLY-100 or the
  deploy issue that owns first-deploy).
