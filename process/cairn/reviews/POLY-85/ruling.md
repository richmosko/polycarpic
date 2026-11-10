# POLY-85 ruling (architect, 2026-11-10)

Gating ruling for runtime config and the ops hooks. Inputs: POLY-85 criteria and its POLY-83 R7 comment, POLY-83 ruling addendum 1, POLY-100, ARCH v1.15.5 §7.4, §7.5, §7.8, §8.1, INFRA v1.3 §2.2, §3.2, §3.4, §6.5, §9.3, D-1, SECURITY v1.7.1 §6.1, §6.2, §9, C-33, C-74, C-76, C-77, TB-13. Every claim here is **read** (from the docs, the tree at 5e27dd5, or documented library and Docker behaviour) or tagged **(unmeasured)**. I ran nothing. ARCH v1.15.6 carries the doc-level parts; this file is the build contract.

## R1. Boundary: `packages/config` vs `packages/secrets`

- **`packages/config` (L0)** holds *operator* configuration: environment variables and the `*_FILE` secret files. They are read once at process start (SECURITY §6.2 "Read once"). It never parses key material and never touches the database.
- **`packages/secrets` (L1)** is the *user-credential* vault (seal/open, keyring by `key_id`). It reads no environment variable and no file. The worker hands it the keyring bytes it got from config. `secrets` keeps `allow: []`, and nothing in POLY-85 changes it.
- **Exports.** `@poly/config` exports `loadConfig(service, env?)`, `checkConfig(service, env?)`, `Secret` and the problem type. A new subpath **`@poly/config/log`** exports the logger (R6). In `layers.json`, config gets `"subpaths": ["./log"]` and keeps `allow: []`. Apps already allow `config`. A package that logs later is granted **`config/log`** only, never `config`, so no L1+ package can reach the secret loader.
- **`packages/db` keeps `connectionFrom(env)`.** It still reads `DATABASE_PASSWORD_FILE` when the pool is built. That is a second read of a file config has already validated, not a second validator (Open 1).
- **`packages/db/src/migrate-config.ts` moves into `packages/config`.** It is deleted from db, and its re-export leaves `@poly/db/migrate`. `apps/migrate` calls `@poly/config`'s `checkConfig('migrate')`. This creates one validator, so nothing is duplicated (POLY-83 R7).

## R2. Environment variables (non-secret)

`host.env` reaches all three services through compose `env_file:`. The app does not parse `host.env` itself (INFRA D-1).

| Variable | Rule |
|---|---|
| `APP_ENV` | Required: `development` \| `staging` \| `production`. No default. `NODE_ENV` is never read for any security decision, because libraries set it. |
| `TLS_MODE` | Required everywhere: `real-domain` \| `private-ca`. Nothing infers it (C-76). Hetzner sets `real-domain`. |
| `PUBLIC_ORIGIN` | Required. Must be an `https:` origin with no path, query or fragment. `http://localhost[:port]` is allowed only when `APP_ENV=development`. |
| `PLAID_ENV` | `sandbox` \| `production`. Staging requires `sandbox` and production requires `production` (C-77, both refusals). Required in staging and production; optional in development, where it must be in the enum if set. |
| `STATUS_PORT` | web only. Integer 1024–65535, default `8081`. The bind host is not configurable (R4). |
| `DATABASE_*` | Exactly as POLY-83 addendum 1, with the expected user per service: `poly_migrator`, `poly_app`, `poly_worker`. |

- **TLS cross-check, offline only, in `checkConfig`.** An origin host ending in `.local`, or with no ICANN public suffix, requires `private-ca`. Any other host requires `real-domain`. A mismatch refuses either way. The suffix list comes from `tldts`, pinned exact (it bundles the PSL; read).
- **The zone/SOA test runs at web start, not in POLY-85** (Open 2). `check-config` still connects nowhere.
- **Secret-looking variables, refused in staging and production** (SECURITY §6.2 says production; staging is held to the same standard so that what passes staging passes prod). Refused: any variable whose name matches `/PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|KEYRING|CREDENTIAL/i` and does not end in `_FILE`.
- `DATABASE_PASSWORD` and `DATABASE_URL` stay refused in every `APP_ENV` (POLY-83). The message names the variable and never its value.

## R3. The `*_FILE` loader contract

- **The registry** is one table, `packages/config/src/registry.ts`. Each row is `{ var, services, required, shape }`, where `shape` ∈ `line` \| `text`. The M1 rows:
  - `DATABASE_PASSWORD_FILE`: web, worker and migrate; required; line.
  - `AUTH_SECRET_FILE`: web and worker; required; line (POLY-86 may change the shape for versioned secrets).
  - `CREDENTIAL_KEYRING_FILE`: worker; optional until `secrets init` lands; text.
  - `OAUTH_GOOGLE_SECRET_FILE` and `OAUTH_GITHUB_SECRET_FILE`: web; optional; line.
  - `RESEND_API_KEY_FILE`: web and worker; optional; line.
  - `PLAID_SECRET_FILE`: web and worker; optional; line.
  - `PRICE_API_KEY_FILE` and `BLS_API_KEY_FILE`: worker; optional; line.
  - Broker secrets get their rows with their adapters. A feature makes a row required in its own PR.
- **Forbidden per service:** a registered `*_FILE` that is set in a service it is not listed for is refused. This enforces TB-4 for the keyring in web, and "the migrator password only" for migrate. An unregistered name ending in `_FILE` is refused in every `APP_ENV`, which catches a typo in an optional secret.
- **Semantics, in order, for each variable:**
  - The variable is unset or `''`: refuse if required (`X_FILE is not set`); otherwise the secret is absent.
  - The path is set but the file is missing: `ENOENT` gives `X_FILE does not exist: <path>`. Any other read error gives `X_FILE cannot be read: <path>`.
  - The value is the file content with **one** trailing `\n` removed and nothing else trimmed. If that is empty or only whitespace: `X_FILE is empty: <path>`.
  - For `line` secrets, an interior newline gives `X_FILE must hold one line: <path>`, and leading or trailing whitespace gives `X_FILE has surrounding whitespace: <path>`.
- **Message texts.** The POLY-83 texts stay byte-identical for the DB variables (`tests/db/checks.test.ts` pins them). A message names the variable and the path, never content.
- **All faults are collected.** `checkConfig` returns every problem, one per fault, as `{ var, fault, path? }`, where `fault` is a fixed enum. `loadConfig` throws `ConfigError` carrying that list.
- **Values are `Secret` objects.** `toString`, `toJSON` and `util.inspect.custom` all return `[secret]`. `.reveal()` returns the string. A test asserts that `JSON.stringify(config)` and `util.inspect(config)` contain no secret content.
- **Every entrypoint takes `check-config`.** `migrate check-config` (unchanged CLI: text lines `check-config: <message>`, exit 0/1), `web check-config` and `worker check-config` run the same `checkConfig(service)`. They exit 0 or 1 and connect nowhere. The migrate container cannot see web's secret files, so the deploy needs all three to check every mount. POLY-100 and INFRA §4.5 are told (bubble-up).
- **Startup.** web and worker call `loadConfig` first. On a fault, they emit one `config.refused` log line per problem (fields `var`, `fault`, never the path) and exit 1, before any pool exists.

## R4. Status listener and public health

- **Code** lives in `apps/web/src/ops/`:
  - `probe.ts`, the one probe. It returns db reachability and schema state through `@poly/db/startup`'s new `schemaStatus(role)` (R7).
  - `status.ts`, a `node:http` server.
  - `health.ts`, `handleHealth(): Promise<Response>` (web-standard). POLY-88 mounts it as `src/routes/api/v1/health/+server.ts` GET. Until then there is no public server, and the handler is tested directly.
- **Listener.** It binds `'127.0.0.1'`, a constant in code, on `STATUS_PORT`. It gets no `ports:` mapping and no Caddy route (TB-13; INFRA §2.2 compose lint).
  - `GET /status` returns 200 with `content-type: application/json` and `cache-control: no-store`. Any other path returns 404 and any other method 405. The query string is ignored.
  - It is read-only. It runs as poly_app (web's pool) and returns no tenant data.
  - It is started by `apps/web/src/main.ts` after `loadConfig` and the schema guard.
  - Host scripts read it with `docker compose exec web polycarpic status`, the R5 dispatcher running a node client. This needs no curl or wget in the image.
- **Payload v1.** It is exactly this shape (`additionalProperties: false`):
  `{ "v": 1, "service": "web", "commit": "<40-hex>|null", "started_at": "<ISO-8601 UTC>", "db": { "ok": bool }, "schema": { "state": "current"|"ahead"|"behind"|"diverged"|"unreachable", "expected": "<journal tag>", "applied": "<tag>|null" }, "jobs": {} }`.
  - `jobs` is keyed by job name, each value `{ "last_ok": "<ISO>" }`. It is `{}` in M1, because no job-run record exists yet (Open 3).
  - Backup age is not in it (INFRA §6.5).
  - `commit` is `POLY_IMAGE_REVISION` (R5), or `null` outside an image.
- **Health.** The body is exactly `{"ok":true}` with 200, or `{"ok":false}` with 503, plus `content-type: application/json` and `cache-control: no-store`. It carries no other header or field.
  - `ok` means `db.ok` and `schema.state ∈ {current, ahead}`. "Ahead" is ok because the previous release must run on the new schema (§8.1).
  - Health memoises the probe for 5 s, so a stranger cannot turn the endpoint into a DB load generator (unmeasured; 5 s is well under the 5-minute ping).
- **Tests assert:**
  - `server.address().address === '127.0.0.1'`.
  - A connect to each non-internal IPv4 of the host is refused. If the host has none, the test fails rather than skips.
  - The health body is byte-equal to one of the two strings.
  - Both the health and status responses contain no R6 canary.

## R5. The image: root `Dockerfile`, label, entrypoint

- **Files:** `Dockerfile` and `.dockerignore` at the repo root. INFRA's postgres derivative and `tests/db/docker/Dockerfile` stay where they are. There is one app image with three entrypoints (§8.1).
- **Stages:**
  - **build:** `node:26.12.0-slim@sha256:<digest the builder measures>`. It runs `npm i -g --allow-scripts=pnpm pnpm@12.18.0` (no corepack on Node 26), `pnpm install --frozen-lockfile`, then `pnpm deploy --prod` per app or an equivalent pruned copy (builder's choice, stated in the Dockerfile).
  - **runtime:** the same base digest and `USER node`. It ships `packages/db/migrations` including `meta/_journal.json` (POLY-100 comment). It contains no secret and no build arg except `GIT_COMMIT`.
- **Label.** In the runtime stage:
  - `ARG GIT_COMMIT` with no default.
  - `RUN echo "$GIT_COMMIT" | grep -Eq '^[0-9a-f]{40}$'`, so the build fails without a full sha.
  - `LABEL org.opencontainers.image.revision=$GIT_COMMIT org.opencontainers.image.source=https://github.com/richmosko/polycarpic`.
  - `ENV POLY_IMAGE_REVISION=$GIT_COMMIT`.
- **The label name POLY-100 reads is `org.opencontainers.image.revision`**, holding the full 40-hex commit. POLY-100 compares it to `git rev-parse <tag>^{commit}`, reading it by digest: `docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' <image>@<digest>`.
  - Why the attestation covers it: labels live in the image config blob, the manifest addresses that blob by digest, and the provenance subject is the manifest digest (read; unmeasured on GHCR).
  - CI passes `--build-arg GIT_COMMIT=${{ github.sha }}` in build.yml, which is devops's file (POLY-96/100).
- **Entrypoint** `ENTRYPOINT ["/app/bin/polycarpic"]` is a POSIX sh dispatcher: `polycarpic web|worker|migrate|status [args…]` `exec`s `node` on the matching app `main.ts`. Compose sets `command: ["web"]` and so on. `bin/polycarpic` **needs `paths:` widened** (lead).
- **`.dockerignore`** excludes at least: `.git`, `**/node_modules`, `temp`, `docs`, `process`, `prototype`, `tests`, `.claude`, `**/*.test.ts`, `.env*`, `**/secrets`.
- **Tests:**
  - A static test always runs. It checks: the ARG has no default, the sha guard is present, the LABEL and ENV are in the *final* stage, there is no `ARG`/`ENV` with a secret-looking name, and `.dockerignore` contains the list above.
  - A real build is opt-in (`POLY_IMAGE_BUILD=1`) and is run by qa at build-green. Building with the sha gives the label equal to it. Building without the arg fails. `docker run <img> migrate check-config` with an empty env exits 1.

## R6. Log schema and redaction

- **Schema:** `packages/config/log.schema.json` (JSON Schema 2020-12), committed, with top-level `additionalProperties: false`.
  - Required fields: `ts` (ISO-8601 UTC, ms), `level` (`debug|info|warn|error|fatal`), `service` (`web|worker|migrate`), `event`.
  - `event` matches `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$` and is a code constant. **There is no free-text `msg` field.**
  - Optional fields, exactly SECURITY §9's "Logged" list plus the R3/R4 needs: `commit`, `req_id`, `user_id`, `entity_id`, `run_id` (uuid each); `route` (the route *id* template, never the raw path or query); `method`; `status` (int); `outcome` (`ok|denied|error|refused`); `latency_ms` (number ≥ 0); `job`; `migration` (journal tag); `var` (`^[A-Z][A-Z0-9_]*$`); `fault` (the R3 enum); `count` (int); `err` (`{ type, code? }` only).
- **Mechanism: an allowlist, with a denylist as backstop** (C-33 names both).
  - The logger is pino behind a typed wrapper, `log.<level>(event, fields)`. A pino `formatters.log` hook keeps only the schema's declared keys and drops everything else. It emits `dropped: <n>` (a count, never the key names) when it drops anything, so the dropping shows up in tests.
  - `pino.redact` covers `*.password`, `*.secret`, `*.token`, `*.authorization`, `*.cookie`, `headers.*` as the backstop.
  - `err` is serialised as `{ type: err.name, code: err.code }` only. It never carries the message or stack (a pg error message can quote a bound value).
  - Pino's default `pid`, `hostname` and `msg` are off, and `level` is the label, not the number.
- **The C-33 canary harness starts here.**
  - `tests/log/canary.ts` exports `CANARIES` (token, URL, account number, memo, a secret-file value) and `assertNoCanary(text)`. Later adapters extend it.
  - It is used by: the logger tests (a canary passed as an undeclared key, nested, in `err.message`, and in a header-shaped object); the check-config tests (the canary as the secret file's content never appears in stdout or stderr); and the R4 response tests.
  - Every line emitted in the logger tests is validated against the schema with `ajv` (a dev dependency of packages/config).

## R7. `packages/db` change, small and additive: needs `paths:` widened

- `packages/db/src/startup.ts` gains `schemaStatus(role)`. It returns `{ state, expected, applied }` and never throws for the four schema states. `unreachable` is returned on a connection error.
- `assertSchemaNotBehind` is re-expressed on top of it, with the same messages and the same `SchemaBehindError`. The POLY-83 guard tests stay green unmodified.
- `migrate-config.ts` is deleted, and its export is removed from `packages/db/src/migrate.ts` (R1).
- Widen POLY-85 `paths:` by: `packages/db/src/startup.ts`, `packages/db/src/migrate.ts`, `packages/db/src/migrate-config.ts`, `packages/db/src/*.test.ts` and `bin/polycarpic`.

## R8. Test layout

| Where | Holds | Needs |
|---|---|---|
| `packages/config/src/*.test.ts` | R2/R3 loader table (tmp files), C-77 both refusals, the C-76 offline matrix, secret-env refusal, forbidden/unknown `_FILE`, `Secret` redaction, R6 logger + schema | nothing |
| `tests/config/check-config.test.ts` | spawns `migrate`, `web` and `worker` `check-config`: exit codes, one line per fault, canary absent | nothing |
| `tests/db/checks.test.ts` (amend) | POLY-83 cases unchanged; `good()` gains `APP_ENV=development`, `TLS_MODE=private-ca`, `PUBLIC_ORIGIN=http://localhost:5173` | — |
| `tests/db/ops-status.test.ts` | R4 against the tests/db harness: current, behind, ahead and unreachable states, 404/405, loopback bind, health bytes | Postgres |
| `tests/image/dockerfile.test.ts` | R5 static checks; the opt-in build | docker, opt-in |
| `tests/log/canary.ts` | the R6 harness (helper, no tests of its own) | — |

## R9. Doc changes

- ARCH v1.15.6 (this commit): §7.4 names the schema file, the allowlist and the status/health payloads. §7.5 names the registry and the `check-config` per entrypoint. §8.1 names the label.
- INFRA §2.2, §4.5 and §3.2 (devops): `env_file: host.env` on all three services, the three `check-config` runs, `STATUS_PORT`, `polycarpic status`.
- SECURITY (seceng to concur): C-33 lives at `@poly/config/log`; §6.2 "secret-looking env var" also applies in staging (R2); C-74 is tested by `packages/config` unit tests.

## Open (not gating)

1. `packages/db` reads the password file a second time when it builds the pool. Passing it the loaded `Secret` is a db API change. Do it when a db feature next touches `connection.ts`.
2. The C-76 zone (SOA) test, with its log-and-retry behaviour on timeout, runs at web start. It needs a home: POLY-88 or POLY-120. Lead to place it.
3. `jobs` in the status payload is filled by the first worker job feature, from its run record.
4. The Vercel target takes secrets from env vars (R-3). The loader has one source, files. POLY-121 adds a Vercel source under its own ruling.
