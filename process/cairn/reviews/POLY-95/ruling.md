# POLY-95 — gate 1 ruling (architect)

Scope: INFRA §2.2, §6.1a; SECURITY C-07 (Caddy half), C-70, C-75, C-79. Status: **final** — seceng-95's conditions (their checklist #1–#11) are folded in; each is cited as `[S#n]`.

## Measurements

| # | Command | Predicate | Result |
|---|---|---|---|
| M1 | `docker buildx imagetools inspect postgres:17.10` | index digest | `sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317` |
| M2 | `docker run --rm postgres:17.10@<M1> sh -c '. /etc/os-release; apt-cache policy age'` | base release; `age` available from the base's own signed apt sources | `trixie`; candidate `1.2.1-1+b5` |
| M3 | `docker buildx imagetools inspect caddy:2` | an index digest exists | yes (the builder pins a full `2.N.M` tag and its digest, not `2`) |
| M4 | `grep -l -i caddy process/cairn/issues/*.md` | an issue other than POLY-95 owns the Caddyfile | none |
| M5 | `grep -n 'caddy\|postgres' .github/workflows/build.yml infra/ci/image.sh` | build.yml publishes a Caddy, Postgres or tools image | none |

Everything below marked `(unmeasured)` is measured by the test named beside it; gate 3 carries the result.

## R1 — Caddy headers: this loop owns them

POLY-95 creates `infra/caddy/Caddyfile`. One shared snippet on every site block sets `Strict-Transport-Security "max-age=31536000"`, `X-Content-Type-Options "nosniff"`, `Referrer-Policy "strict-origin-when-cross-origin"` (C-07), applied after the upstream response so the upstream cannot override or drop them [S#9]. No `includeSubDomains`, no `preload`. Caddy sets and strips no `Content-Security-Policy` (the CSP is Kit's, `apps/web/vite.config.ts`). Sites: `app.{$POLY_DOMAIN}` → prod `web`; `staging.{$POLY_DOMAIN}` → staging `web` behind `basic_auth` (from the `staging_basic_auth` secret file) and a `remote_ip` allowlist. Port 80 only redirects to 443.
Test (`image` job, [S#9]): run the Caddy derivative with `tls internal` and a stub upstream that sets its own conflicting `Referrer-Policy` and no HSTS; curl over HTTPS asserts the three headers with the exact values on a proxied 200, an upstream 404, a Caddy 502 (upstream stopped), and a staging 401; and that the stub's CSP passes through unchanged. The :80 redirect is exempt from HSTS (browsers ignore HSTS over http) but carries nosniff. Fail fixture: a site block without the snippet.
Image: `infra/caddy/Dockerfile` is a one-line `FROM caddy:2.N.M@sha256:…` derivative (the Hetzner build, no plugins), built and Trivy-scanned in the `image` job. The home-box DNS-plugin build is F3.

## R2 — `infra/postgres-major`: this loop creates it

POLY-95 creates `infra/postgres-major` with the single line `17`; the lint reads it (criterion 5). POLY-97 starts after POLY-95 merges (STATE "Next") and reads it from `main`; it never writes it, so the path leaves POLY-97's `paths:` (F1). Ownership measured by M4-style grep: only POLY-95 and POLY-97 name the path.

## R3 — Where things run in CI (no new top-level job)

| What | Job | Gate | Expected delta (unmeasured) |
|---|---|---|---|
| Compose-policy lint (R7) over the exact `-f` sets the deploy uses, + retyped-tag and major-drift checks (R4) + `tests/infra` Vitest suite (fixtures) | `lint` | `image == 'true' \|\| ci == 'true'` | +10–20 s on those PRs; 0 otherwise. Lint stays ≤ its 120 s budget |
| Build the Postgres and Caddy derivatives; bring up prod `postgres` via `docker compose -f infra/compose/prod.yml up postgres` with CI fixture secrets and data dirs (R5, R6, R8); SHOW + sourcefile assertions; archive_command test; secret-mode test; Caddy curl test (R1); Trivy on both images | `image` | `image == 'true'` (not on node-only PRs) | +75–110 s on infra PRs; 0 on node-only PRs |
| Battery Postgres from the same FROM line (R4) | `db` | unchanged, plus `infra/postgres/Dockerfile` and `infra/postgres-major` join the db filter | ≈ 0 s |

Both jobs already feed the required `app` aggregate [S#2]. `infra/ci/changes.mjs`: add `^tests\/infra\//` to `image`; add `^infra\/postgres\/Dockerfile$` and `^infra\/postgres-major$` to `db`. `infra/{compose,postgres,caddy,lint}/**` already set `image` through `^infra\/(?!ci\/)` [S#2]. `tests/ci/changes.test.ts` gains those rows.
Guards: the builder reports the measured lint, image and db wall-clocks from the first green run at gate 3. Over **+30 s on lint, +150 s on image, or +10 s on db** reopens R3 once.
INFRA §2.2 and §4.3 are rewritten in present tense to name the `image` job's compose-run Postgres as where SHOW runs (current state only).

## R4 — One place for the Postgres tag and digest

`infra/postgres/Dockerfile` line 1 is `FROM postgres:17.10@sha256:7958…3317` (M1); then one `RUN` of `apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends age=1.2.1-1+b5`, lists removed — from trixie's own signed sources only, no new apt source, no download [S#8]. A pin that Debian drops fails the build loudly; the bump rides the FROM-line bump (F4).
- compose `postgres` (both projects) and `backup` use `${POLY_POSTGRES_IMAGE:?}`; the lint asserts both resolve to the same value and every service image ends `@sha256:<64 hex>`.
- `tests/db/docker/Dockerfile` becomes `ARG PG_BASE` / `FROM ${PG_BASE}`; `tests/db/helpers/pg.ts` reads the FROM line, passes `--build-arg`, and names the cached image after the digest so a bump never reuses a stale build.
- Lint: any `postgres:<digit>` outside that line (`infra/compose/**`, `.github/workflows/**`, `tests/db/docker/**`) fails; fixture: compose with `image: postgres:17.10`.
- Lint: the FROM line's major ≠ `infra/postgres-major` fails; pass and fail fixtures (criterion 5).

## R5 — Postgres settings and runtime

`infra/postgres/postgresql.prod.conf` is the whole `config_file` (passed as `postgres -c config_file=…`; the lint forbids any other `-c` in `command:`) [S#6]: C-75 (`log_parameter_max_length = 0`, `log_parameter_max_length_on_error = 0`, `log_statement = 'ddl'`), `archive_mode = on`, `archive_timeout = 300`, `archive_command` (R6), C-79 (`max_replication_slots = 2`, `max_wal_senders = 3`, `max_slot_wal_keep_size = 2GB`, `log_connections = on`), `password_encryption = scram-sha-256`, `allow_alter_system = off` [S#6], `shared_buffers = 768MB`, `hba_file` pointing at the mounted pg_hba. Staging's fragment is the same with `archive_mode = off` (staging is not backed up, INFRA §6.1).
Test (image job, on the compose-run container — same mounts as compose, never `-c` flags) [S#6]: `SHOW` equals the value for each setting above; `pg_settings.sourcefile` is the mounted fragment for each; `pg_db_role_setting` holds none of them; `ALTER SYSTEM SET log_statement='all'` errors. Staging: `archive_mode` is `off` (render-level assertion in the lint).
Runtime [S#7]: `user: "999:999"` explicit (the image's `postgres` uid), no gosu path; `read_only: true` with tmpfs at `/var/run/postgresql` and `/tmp`; `cap_drop: [ALL]`; the data dir bind is owned by 999 (CI creates it so; POLY-97 provisions it so, F6). The compose-run test proves it boots this way `(unmeasured until the test runs)`.
pg_hba: `pg_hba.prod.conf` exactly as INFRA §2.2 (C-79 four lines first). `pg_hba.staging.conf` [S#10]: `host all poly_backup all reject`, `host replication all all reject`, the three app-role lines on staging's default subnet, the final reject and the peer line — no `poly_backup` allow line. Staging's default network is fixed at `10.202.1.0/24`; staging has no backup-net or upload-net. The builder adds both to INFRA §2.2.
Accepted residual [S#11]: the internal backup-net's gateway (the host) sits inside the `/29` pg_hba admits; host root is already trusted. The builder notes it in INFRA §2.2.

## R6 — archive_command

`infra/postgres/archive-wal.sh %p %f`, mounted read-only, `set -eu -o pipefail` [S#5]:
1. If `spool/wal/<f>.age` exists: return 0 iff `spool/wal/.sums/<f>.sha256` exists and equals `sha256(%p)`; otherwise non-zero and nothing touched. (Liveness after a crash between the link and Postgres recording the segment [S#5]; a differing segment still fails closed — criterion 3.)
2. Else `age -R <mounted public key>` writes `spool/wal/.inflight/<f>.age.$$`; on any failure the temp is removed and the script exits non-zero.
3. Write `.sums/<f>.sha256` (hash of the plaintext segment; no plaintext), then `ln` the temp to `spool/wal/<f>.age` (atomic, no-clobber, same filesystem), remove the temp.
The uploader never reads dot-directories; it removes `.sums/<f>.sha256` when it prunes `<f>.age` (F2).
Test (image job): archive one segment → an `.age` the test private key decrypts byte-identical; pre-create a different target → non-zero, target unchanged, `pg_stat_archiver.failed_count` rises; pre-create the identical target with its sum → 0; an `age` failure (unreadable key) → non-zero and `.inflight/` empty.

## R7 — Compose files and the lint

Files: `infra/compose/edge.yml`, `prod.yml`, `staging.yml`. No `compose.override.yml` may exist under `infra/compose/` (lint fails if one does) [S#2].
Networks [S#1]: each project gets an `edge` network (fixed name `polycarpic-<project>-edge`, declared by the project, `external` in `edge.yml`) holding `caddy` and `web` only. `caddy` joins no `_default` network. `postgres` is never on a network `caddy` is on. INFRA §2.2's "external Caddy attachment (web only)" on `_default` is replaced by this; the builder updates the network table.
Lint: `infra/lint/compose-policy.mjs` (Node, no new dependency) renders each deploy set with `docker compose -f <set> --profile '*' config --format json`, failing closed on a render error or on zero files found [S#2]; the allowlist data lives in `infra/lint/policy.json`. Rules, each with a pass and a fail fixture under `tests/infra/fixtures/`:
- INFRA §2.2's list: explicit non-root `user:` (missing or uid 0 fails), `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `restart`, `healthcheck`, image by digest, no `build:`.
- C-70 bypasses [S#2]: `network_mode` (host/service:/container:), `pid`/`ipc`/`userns_mode: host`, `privileged`, `cap_add`, `devices`, `seccomp`/`apparmor` `unconfined`, any `docker.sock` in a volume source, `env_file`, a secret-looking key in `environment:`, a secret with an `environment:` source, a config with inline `content:`, `${…}` in `ports`/`networks`/`secrets`/`volumes` of the raw files.
- `ports:` only on caddy; no service on both project networks; R7's edge rule.
- C-79: only postgres+backup on backup-net; backup-net `internal: true` with a fixed subnet equal to the `poly_backup` lines of `pg_hba.prod.conf`; uploader shares no network with postgres.
- Secret matrix [S#3]: every secret in INFRA §2.2's table has a secret→service allowlist in `policy.json`; a secret in a service not on its list fails. Prod `file:` paths are under `/etc/polycarpic/secrets/` only, staging's under `/etc/polycarpic/staging-secrets/` only.
- R4's two checks.

## R8 — Secret files under non-root (no swarm) [S#4]

Compose without swarm bind-mounts `file:` secrets and ignores `uid`/`gid`/`mode` `(unmeasured — measured by the test below)`. Rule: each consuming service has a fixed `user: "<uid>:<gid>"`; each host secret file is `root:<that gid>` mode `0440` (one consumer group per file), never world-readable. Test (image job): the compose-run postgres reads `db_superuser_password` from a CI fixture file `root:999 0440`; a container with another uid cannot read it. seceng-95 rewrites the file-mode line in SECURITY §6.2 to this rule on this branch; the builder writes INFRA §2.3/§3.2 to match. Provisioning the ownership is POLY-97 (F6).

## Paths beyond the current `paths:` (lead widens before the build)

`infra/postgres-major`, `process/cairn/reviews/POLY-95/**`. Everything else the build touches (`infra/compose/**`, `infra/postgres/**`, `infra/lint/**`, `infra/caddy/**`, `infra/ci/changes.mjs`, `.github/workflows/ci.yml`, `tests/infra/**`, `tests/db/docker/Dockerfile`, `tests/db/helpers/pg.ts`, `tests/ci/changes.test.ts`, `docs/INFRA/index.html`, `docs/SECURITY/index.html`) is already covered.

## Follow-ups (lead files after merge)

- F1: drop `infra/postgres-major` from POLY-97's `paths:`; provision-check reads it from `main`.
- F2: POLY-97 provision-check's "spool holds only `.age`" allows `spool/wal/.inflight/` (empty at rest) and `spool/wal/.sums/`; the uploader issue removes `.sums/<f>.sha256` with its `.age` and never reads dot-directories.
- F3: build.yml publishes and attests the Postgres derivative, the Caddy image and the tools image (INFRA §4.4; M5 shows none today) — attach to POLY-100, which pulls them by digest; the home-box DNS-plugin Caddy build goes with it.
- F4: Renovate rule for the single FROM line and the pinned `age` version (INFRA §6.1a, §5), if no issue owns Renovate config.
- F5: POLY-100's ops bundle carries `infra/compose/**`, `infra/caddy/Caddyfile` and `infra/postgres/**` config into the verified image.
- F6: POLY-97 provision.sh sets secret files `root:<consumer gid> 0440` (R8) and the Postgres data dirs to uid 999; provision-check asserts both.
- F7: the monitoring issue (INFRA §6.5) alerts on `pg_stat_archiver.failed_count` rising, beside the 2-hour spool alert [S#5].
