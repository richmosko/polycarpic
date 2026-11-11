# POLY-95 — gate 1 ruling (architect)

Scope: INFRA §2.2, §6.1a; SECURITY C-07 (Caddy half), C-70, C-75, C-79. Status: **final**. seceng-95's pre-ruling checklist (cited `[S#n]`) and their conditions S1–S9 (`seceng-ruling-review.md`, cited `[Sn]`) are folded in; where the two differed, S1–S9 apply.

## Measurements

| # | Command | Predicate | Result |
|---|---|---|---|
| M1 | `docker buildx imagetools inspect postgres:17.10` | index digest | `sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317` |
| M2 | `docker run --rm postgres:17.10@<M1> sh -c '. /etc/os-release; apt-cache policy age'` | base release; `age` available from the base's own signed apt sources | `trixie`; candidate `1.2.1-1+b5` |
| M3 | `docker buildx imagetools inspect caddy:2` | an index digest exists | yes (the builder pins a full `2.N.M` tag and its digest, not `2`) |
| M4 | `grep -l -i caddy process/cairn/issues/*.md` | an issue other than POLY-95 owns the Caddyfile | none |
| M5 | `grep -n 'caddy\|postgres' .github/workflows/build.yml infra/ci/image.sh` | build.yml publishes a Caddy, Postgres or tools image | none |

Everything marked `(unmeasured)` is measured by the test named beside it; gate 3 carries the result.

## R1 — Caddy headers: this loop owns them

POLY-95 creates `infra/caddy/Caddyfile`. One shared snippet on every site block sets `Strict-Transport-Security "max-age=31536000"`, `X-Content-Type-Options "nosniff"`, `Referrer-Policy "strict-origin-when-cross-origin"` (C-07), with `defer` so the upstream cannot override or drop them [S#9][S7]. No `includeSubDomains`, no `preload` [S7]. Caddy sets and strips no `Content-Security-Policy` (the CSP is Kit's, `apps/web/vite.config.ts`). Sites: `app.{$POLY_DOMAIN}` → prod `web`; `staging.{$POLY_DOMAIN}` → staging `web` behind `basic_auth` (from the `staging_basic_auth` secret file) and a `remote_ip` allowlist. Port 80 only redirects to 443. No `trusted_proxies` (Caddy is the edge); `admin` off or loopback-only [S7]. No basic-auth hash in the repo; fixtures use a throwaway hash [S7].
Ports [S2]: Caddy listens on 8080/8443 inside the container; `ports:` maps `${POLY_BIND_ADDR:?}:80:8080` and `${POLY_BIND_ADDR:?}:443:8443`, no default, so a missing value fails instead of binding 0.0.0.0. The local box sets its LAN address. No `cap_add`.
Test (`image` job) [S#9][S7]: run the Caddy derivative with `tls internal` and a stub upstream that sends a conflicting `Referrer-Policy` and no HSTS; curl asserts the three headers with exact values on a proxied 200, an upstream 404, a Caddy-generated 404/502, and a staging 401; no CSP is added when the upstream sends none, and the upstream's passes through unchanged. A `caddy adapt` JSON assertion in the same suite: no `trusted_proxies`, `admin` off or loopback. The :80 redirect is exempt from HSTS (ignored over http) but carries nosniff. Fail fixture: a site block without the snippet.
Image: `infra/caddy/Dockerfile` is a one-line `FROM caddy:2.N.M@sha256:…` derivative (Hetzner build, no plugins), built and Trivy-scanned in the `image` job. The home-box DNS-plugin build is F3.

## R2 — `infra/postgres-major`: this loop creates it

POLY-95 creates `infra/postgres-major` with the single line `17`; the lint reads it (criterion 5). POLY-97 starts after POLY-95 merges (STATE "Next") and reads it from `main`; it never writes it, so the path leaves POLY-97's `paths:` (F1). Ownership measured by M4-style grep: only POLY-95 and POLY-97 name the path.

## R3 — Where things run in CI (no new top-level job)

| What | Job | Gate | Expected delta (unmeasured) |
|---|---|---|---|
| Compose-policy lint (R7) + R4's retyped-tag and major-drift checks + `tests/infra` Vitest fixtures | `lint` | `image == 'true' \|\| ci == 'true'` | +10–20 s on those PRs; 0 otherwise. Lint stays ≤ its 120 s budget |
| Build the Postgres and Caddy derivatives; bring up prod `postgres` with `docker compose -f infra/compose/prod.yml up postgres`, CI fixture secrets and data dirs (R5, R6, R8); the Caddy curl test (R1); Trivy on both images | `image` | `image == 'true'` (not on node-only PRs) | +75–110 s on infra PRs; 0 on node-only PRs |
| Battery Postgres from the same FROM line (R4) | `db` | unchanged, plus `infra/postgres/Dockerfile` and `infra/postgres-major` join the db filter | ≈ 0 s |

Both jobs already feed the required `app` aggregate [S#2]. `infra/ci/changes.mjs`: add `^tests\/infra\//` to `image`; add `^infra\/postgres\/Dockerfile$` and `^infra\/postgres-major$` to `db`. `infra/{compose,postgres,caddy,lint}/**` already set `image` through `^infra\/(?!ci\/)`. `tests/ci/changes.test.ts` gains those rows.
Guards: the builder reports the measured lint, image and db wall-clocks from the first green run at gate 3. Over **+30 s on lint, +150 s on image, or +10 s on db** reopens R3 once.
INFRA §2.2 and §4.3 are rewritten in present tense to name the `image` job's compose-run Postgres as where SHOW runs.

## R4 — One place for the Postgres tag and digest

`infra/postgres/Dockerfile` line 1 is `FROM postgres:17.10@sha256:7958…3317` (M1); then one `RUN` of `apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends age=1.2.1-1+b5`, lists removed, from trixie's own signed sources only: no new source or key, no download, no unauthenticated flag [S#8][S8]. A pin Debian drops fails the build loudly; the bump rides the FROM-line bump (F4). `tests/image`'s static apt check also runs on this Dockerfile, and the image job asserts `age --version` runs [S8].
- compose `postgres` (both projects) and `backup` use `${POLY_POSTGRES_IMAGE:?}`; the lint asserts both resolve to the same value and every service image ends `@sha256:<64 hex>`.
- `tests/db/docker/Dockerfile` becomes `ARG PG_BASE` / `FROM ${PG_BASE}`; `tests/db/helpers/pg.ts` reads the FROM line, passes `--build-arg`, and names the cached image after the digest so a bump never reuses a stale build.
- Lint: any `postgres:<digit>` outside that line (`infra/compose/**`, `.github/workflows/**`, `tests/db/docker/**`) fails; fixture: compose with `image: postgres:17.10`.
- Lint: the FROM line's major ≠ `infra/postgres-major` fails; pass and fail fixtures (criterion 5).

## R5 — Postgres settings and runtime

`infra/postgres/postgresql.prod.conf` is the whole `config_file` (`postgres -c config_file=…`; the lint forbids any other `-c` in `command:`) [S#6]: C-75 (`log_parameter_max_length = 0`, `log_parameter_max_length_on_error = 0`, `log_statement = 'ddl'`), `archive_mode = on`, `archive_timeout = 300`, `archive_command` (R6), C-79 (`max_replication_slots = 2`, `max_wal_senders = 3`, `max_slot_wal_keep_size = 2GB`, `log_connections = on`), `password_encryption = scram-sha-256`, `allow_alter_system = off`, `hba_file` at the mounted pg_hba (otherwise the image's initdb leaves `host all all all scram-sha-256` in `$PGDATA/pg_hba.conf`), `listen_addresses` [S5], `shared_buffers = 768MB`. Staging's fragment is the same with `archive_mode = off` (staging is not backed up, INFRA §6.1).
Test (image job, the compose-run container: `command`, `user` and mounts from the rendered `prod.yml` service, never a second copy, never `-c` flags) [S#6][S5]: `SHOW` equals the value for each setting above; `pg_settings.sourcefile` is the mounted fragment for each; `pg_db_role_setting` is empty; `SHOW hba_file` is the mounted path; `pg_hba_file_rules` has no `error` and its first four rows are the C-79 lines; `allow_alter_system` is `off` and `ALTER SYSTEM SET log_statement='all'` errors. Staging's `archive_mode = off` is a render-level lint assertion.
Runtime [S#7][S3]: explicit numeric `user: "999:999"` (the image defaults to root), no gosu path; `read_only: true` with tmpfs at `/var/run/postgresql` and `/tmp`; `cap_drop: [ALL]`; the data-dir bind owned by 999 (CI creates it so; POLY-97 provisions it so, F6). The compose-run test proves it boots this way `(unmeasured until it runs)`.
pg_hba: `pg_hba.prod.conf` exactly as INFRA §2.2 (C-79 four lines first). `pg_hba.staging.conf` [S#10]: `host all poly_backup all reject`, `host replication all all reject`, the three app-role lines on staging's default subnet, the final reject and the peer line; no `poly_backup` allow line. Staging's default network is fixed at `10.202.1.0/24`; staging has no backup-net or upload-net. The builder adds both to INFRA §2.2.
Accepted residual [S#11]: backup-net's gateway (the host) sits inside the `/29` pg_hba admits; host root is already trusted. The builder notes it in INFRA §2.2.

## R6 — archive_command

`infra/postgres/archive-wal.sh %p %f`, mounted read-only, `set -eu -o pipefail` [S#5][S6]:
1. If `spool/wal/<f>.age` exists: exit non-zero, touch nothing (criterion 3). The liveness case (a crash after the link, before Postgres records success) clears itself: the uploader ships and deletes the file within a minute and the next retry succeeds [S6].
2. Remove stale `spool/wal/.inflight/<f>.age.*` from an earlier failed attempt on the same segment.
3. `age -R <mounted public key>` writes `spool/wal/.inflight/<f>.age.$$`; on any failure the temp is removed and the script exits non-zero.
4. `sync` the temp, `ln` it to `spool/wal/<f>.age` (atomic, no-clobber, same filesystem), remove the temp. No plaintext is ever written.
The uploader never reads `.inflight/` (F2).
Test (image job): archive one segment → an `.age` the test private key decrypts byte-identical; pre-create the target → non-zero, target unchanged, `pg_stat_archiver.failed_count` rises; an `age` failure (key unreadable) → non-zero, nothing under `spool/wal/` outside `.inflight/`, and nothing at all after the next attempt [S6].

## R7 — Compose files and the lint

Files: `infra/compose/edge.yml`, `prod.yml`, `staging.yml`. A file named `*compose.override.y*ml` under `infra/compose/` fails the lint [S#2][S3].
Networks [S#1][S1]: `edge.yml` defines `edge-prod` (fixed `10.201.30.0/28`: caddy + prod `web`) and `edge-staging` (fixed `10.202.30.0/28`: caddy + staging `web`); the project files declare them `external`. Both lie outside every pg_hba allow CIDR and the `10.200.0.0/16` pool. `caddy` joins no `_default` network. This replaces INFRA §2.2's Caddy attachment on `_default`; the builder updates the network table.
Lint: `infra/lint/compose-policy.mjs` (Node, no new dependency); allowlist data in `infra/lint/policy.json`. It renders each project with `docker compose -f <exactly the deploy's files>` and every profile from `config --profiles` enabled, both raw (`--no-interpolate`) and interpolated, and fails closed when `docker compose` is missing, a render errors, a project renders zero services, or `policy.json` is missing or invalid [S#2][S3]. Rules, each with a pass and a fail fixture under `tests/infra/fixtures/`:
- INFRA §2.2's list: explicit numeric `uid:gid` `user:` on every service (missing or uid 0 fails; image defaults are not trusted), `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `restart`, `healthcheck`, image by digest, no `build:` [S3].
- Bypasses [S#2][S2][S3]: `privileged`; `network_mode` (any value); `pid`/`ipc`/`userns_mode: host`; `cap_add` (any); `devices`; `security_opt` containing `unconfined`; `sysctls`; `env_file`; `extra_hosts`; `links`/`external_links`; a top-level secret with an `environment:` source; a config with inline `content:`.
- Mounts [S3]: a volume source resolving to `/var/run/docker.sock`, `/run/docker.sock`, `/var/run`, `/run` or `/` fails; bind mounts follow a service → source → target allowlist in `policy.json`, `:ro` unless listed, default deny.
- Interpolation [S3]: `${…}` only in image references, `POLY_BIND_ADDR`, and the variables listed in `policy.json`; any `${` in networks, secrets, volumes, user, cap_*, security_opt or healthcheck fails.
- `environment:` [S4]: a key matching `(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|DSN|DATABASE_URL)` fails unless it ends `_FILE` and its value starts `/run/secrets/`.
- Edge [S1]: `ports:` only on caddy; caddy is the one service on networks of two projects, and only on `edge-*`; no service but `web` shares a network with caddy; the edge subnets overlap no pg_hba allow line in either `pg_hba.*.conf`. Fail fixtures: caddy on `polycarpic-prod_default`; postgres on `edge-prod`.
- C-79: only postgres + backup on backup-net; backup-net `internal: true` with a fixed subnet equal to the `poly_backup` lines of `pg_hba.prod.conf`; uploader shares no network with postgres.
- Secret matrix [S#3][S4]: `policy.json` carries INFRA §2.2's secret → service matrix for prod and staging (e.g. `credential_keyring` worker-only, `db_superuser_password` postgres-only); a secret absent from the matrix, or mounted by a service not listed for it, fails. Prod `file:` sources lie under `/etc/polycarpic/secrets/` only, staging's under `/etc/polycarpic/staging-secrets/` only; cross-directory fixtures fail.
- R4's two checks.

## R8 — Secret files under non-root (no swarm) [S#4][S9]

Plain `docker compose` bind-mounts `file:` secrets; its handling of long-syntax `uid`/`gid`/`mode` is `(unmeasured)`. 0444 and running as root are both refused. Rule: web, worker, migrate, backup, uploader, caddy and postgres each run as a distinct numeric uid; every host secret file is `0400`, owned by its one consuming uid, in a `0700` directory. A secret two services consume (`auth_secret`, `resend_api_key`, …) is one host file per consumer (`<name>_<service>`, mounted under the same target name), so no file has two readers; the matrix lists them that way.
Test (image job, the measurement S9 asks for): a `user: <uid>` service reads a `0400` file owned by that uid, and is refused a `0400` file owned by root and one owned by another uid. The builder reports the result at gate 3; seceng-95 then writes SECURITY §6.2's ownership line from it, and the builder writes INFRA §2.3/§3.2 to match. Provisioning the ownership is POLY-97 (F6).

## Paths beyond the original `paths:`

`infra/postgres-major`, `process/cairn/reviews/POLY-95/**` (widened at 28771ff). Everything else the build touches (`infra/compose/**`, `infra/postgres/**`, `infra/lint/**`, `infra/caddy/**`, `infra/ci/changes.mjs`, `.github/workflows/ci.yml`, `tests/infra/**`, `tests/image/**`, `tests/db/docker/Dockerfile`, `tests/db/helpers/pg.ts`, `tests/ci/changes.test.ts`, `docs/INFRA/index.html`, `docs/SECURITY/index.html`) is already covered.

## Follow-ups (lead files after merge)

- F1: drop `infra/postgres-major` from POLY-97's `paths:`; provision-check reads it from `main`.
- F2: POLY-97 provision-check's "spool holds only `.age`" allows `spool/wal/.inflight/` (empty at rest); the uploader never reads `.inflight/`.
- F3: build.yml publishes and attests the Postgres derivative, the Caddy image and the tools image (INFRA §4.4; M5 shows none today); attach to POLY-100, which pulls them by digest. The home-box DNS-plugin Caddy build goes with it.
- F4: Renovate rule for the single FROM line and the pinned `age` version (INFRA §6.1a, §5), if no issue owns Renovate config.
- F5: POLY-100's ops bundle carries `infra/compose/**`, `infra/caddy/Caddyfile` and `infra/postgres/**` config into the verified image.
- F6: POLY-97 provision.sh sets each secret file `0400` owned by its consuming uid, directories `0700`, and the Postgres data dirs to uid 999; provision-check asserts them and that no file is world-readable.
- F7: the monitoring issue (INFRA §6.5) alerts on `pg_stat_archiver.failed_count` rising, beside the 2-hour spool alert.
- F8: POLY-100's deploy uses explicit `-f` files from the verified bundle only, never a working-directory compose file, and runs the compose-policy lint (or checks the bundle digest) before `up`.

## Addendum A1 — seceng final check (`seceng-ruling-final-check.md`)

Seceng's points 2 and 4 are already in R1, R5 and R7 above; point 1's sum-match path no longer exists (R6 has no `.sums/`). Two changes:
- **R6 step 4:** after `ln`, `sync` the `spool/wal/` directory as well, so a power loss leaves either no `<f>.age` or a complete one.
- **R8 and R7's secret-path rule are replaced:** secrets live in per-service directories `/etc/polycarpic/{secrets,staging-secrets}/<service>/<name>`; each directory is `root:<service gid>` `0750`, each file `0440`. Every service has a distinct uid **and** gid; none uses `group_add`. A secret with two consumers (`auth_secret`, `resend_api_key`, `plaid_secret`, …) is two files, one per service directory. Lint: a service's `file:` sources lie under its own directory only (prod under `secrets/`, staging under `staging-secrets/`). R8's test becomes: a service reads `0440` files in its own directory, and is refused a file in another service's directory. F6 reads the same way (POLY-97 provisions directories `root:<gid> 0750`, files `0440`). seceng-95 writes SECURITY §6.2 to this rule.

## Addendum A2 — R3 guards against measured CI time

Measured (`gh run view <id> --json jobs`, per step): full `workflow_dispatch` baselines on main's tree (42976214364, 42975920810) give lint 60 s / 59 s and a DB battery step of 76 s / 89 s; the POLY-102 PR run 42978057616 has a 99 s battery step. POLY-95 full run 42984439494: lint 102 s, of which `Infra lint fixtures` takes 37 s and `Compose-policy lint` 0 s; DB battery step 109 s. Comparing full run with full run, lint is **+42 s**; the +51–60 s figure compared a full run with path-filtered PR runs.
- **Lint: the +30 s guard stands. The suite gets faster; the guard does not widen.** The fixture suite runs its cases concurrently: async `spawn` (not `spawnSync`), `describe.concurrent` with `maxConcurrency: 4` (the runner's vCPUs), one temp root per case. Every case still runs end to end through the CLI and `docker compose config`, with no in-process shortcut, because compose's normalisation is where a bypass hides. Gate: on a full CI run, the `Infra lint fixtures` step ≤ 15 s and the lint job ≤ 90 s `(unmeasured until that run)`. If concurrency cannot reach that, the measurement is the one objection that reopens R3.
- **db: one run inside a 23 s spread is not a measurement.** The guard compares medians: over three full runs of this branch, the median DB battery step is ≤ the baseline median + 10 s, i.e. ≤ 99 s (baseline 76/89/99, median 89), and the job is ≤ 150 s in every run. If it is over, the builder times the pgTAP image build separately in the step summary, and the overage reopens R3.
