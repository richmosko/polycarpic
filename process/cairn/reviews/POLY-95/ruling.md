# POLY-95 — gate 1 ruling (architect)

Scope: INFRA §2.2, §6.1a; SECURITY C-07 (Caddy half), C-70, C-75, C-79. Status: **issued for seceng review**.

## Measurements

| # | Command | Predicate | Result |
|---|---|---|---|
| M1 | `docker buildx imagetools inspect postgres:17.10` | index digest | `sha256:7958605b474b3d264a969cb3a123d6aa00ad1e1fe9da8a69984dabb704d93317` |
| M2 | `docker run --rm postgres:17.10@<M1> sh -c '. /etc/os-release; apt-cache policy age'` | base release; `age` available from the base's own apt sources | `trixie`; candidate `1.2.1-1+b5` |
| M3 | `docker buildx imagetools inspect caddy:2` | index digest exists | `sha256:ce773ec7…d8bc` (the builder pins a full `2.N.M` tag, not `2`) |
| M4 | `grep -l -i caddy process/cairn/issues/*.md` | an issue other than POLY-95 owns the Caddyfile | none (only POLY-95 and POLY-96's description) |
| M5 | `grep -n 'caddy\|postgres' .github/workflows/build.yml infra/ci/image.sh` | build.yml publishes a Caddy, Postgres or tools image | none |

## R1 — Caddy headers: this loop owns them

Decided: POLY-95 creates `infra/caddy/Caddyfile` and sets, on every site block through one shared snippet: `Strict-Transport-Security "max-age=31536000"`, `X-Content-Type-Options "nosniff"`, `Referrer-Policy "strict-origin-when-cross-origin"` (C-07). No `includeSubDomains`, no `preload` unless seceng conditions otherwise. Caddy sets **no** `Content-Security-Policy` (the CSP is Kit's, `apps/web/vite.config.ts`) and does not strip the app's. Site blocks: `app.{$POLY_DOMAIN}` → prod `web`; `staging.{$POLY_DOMAIN}` → staging `web` behind `basic_auth` (from the `staging_basic_auth` secret file) and a `remote_ip` allowlist. 80 redirects to 443.
Test: a step in the `lint` job runs `caddy adapt` on the Caddyfile (pinned Caddy image, M3) and a Vitest suite asserts the JSON: both sites carry the three headers, none sets CSP, staging has basic auth and the allowlist. Fail fixture: a site block without the snippet. The Playwright header assertion on staging stays with the staging smoke (C-07 "Tested by"), not here.
Image: `infra/caddy/Dockerfile` is a one-line `FROM caddy:2.N.M@sha256:…` derivative (the Hetzner build; no plugins), built and Trivy-scanned in the `image` job. The home-box DNS-plugin build is a follow-up (F3).

## R2 — `infra/postgres-major`: this loop creates it

Decided: POLY-95 creates `infra/postgres-major` with the single line `17`. The lint reads it (criterion 5). POLY-97 starts after POLY-95 merges (STATE "Next") and reads the file from `main`; it does not write it, so the path leaves POLY-97's `paths:` (F1, lead edits POLY-97's frontmatter). (Ownership measured by M4-style grep: only POLY-95 and POLY-97 name the path.)

## R3 — Where things run in CI (no new top-level job)

| What | Job | Gate | Expected delta (unmeasured) |
|---|---|---|---|
| Compose-policy lint (`docker compose config --format json` for edge, prod, staging, rendered with `tests/infra/fixtures/env`) + retyped-tag + major-drift checks + `caddy adapt` + `tests/infra` Vitest suite | `lint` | `image == 'true' \|\| ci == 'true'` | +15–25 s on those PRs; 0 otherwise. Lint stays ≤ its 120 s budget |
| Build the Postgres derivative; start it with the **prod** config fragment, `pg_hba.prod.conf`, a test age key and a tmpfs spool; run `SHOW` on every setting in R5; the archive_command test (R6); build the Caddy derivative; Trivy on both | `image` | `image == 'true'` (not on node-only PRs) | +60–90 s on infra PRs; 0 on node-only PRs |
| Battery Postgres from the same FROM line (R4) | `db` | unchanged, plus `infra/postgres/Dockerfile` joins the db filter | ≈ 0 s (same image size as `postgres:17`) |

`infra/ci/changes.mjs`: add `^tests\/infra\//` to `image`; add `^infra\/postgres\/Dockerfile$` and `^infra\/postgres-major$` to `db` (a minor bump runs the battery, INFRA §6.1a). `infra/postgres-major` already sets `image` through `^infra\/(?!ci\/)`. `tests/ci/changes.test.ts` gains those rows.
Guards: the builder reports the measured lint, image and db wall-clocks from the first green run at gate 3. Over **+30 s on lint, +120 s on image, or +10 s on db** reopens R3 once.
Where INFRA §2.2 and §4.3 say "the DB battery … runs SHOW" / "the C-75 config assertion", the builder rewrites them in present tense to name the `image` job's config container (current state only, no history).

## R4 — One place for the Postgres tag and digest

`infra/postgres/Dockerfile` line 1 is `FROM postgres:17.10@sha256:7958…3317` (M1); then `apt-get update && apt-get upgrade -y && apt-get install -y --no-install-recommends age` from trixie's own sources (M2), lists removed. Nothing else in the repo writes `postgres:<digit>`:
- compose `postgres` (both projects) and `backup` use `${POLY_POSTGRES_IMAGE:?}`; the lint asserts both resolve to the same value and every service image ends `@sha256:<64 hex>`.
- `tests/db/docker/Dockerfile` becomes `ARG PG_BASE` / `FROM ${PG_BASE}`; `tests/db/helpers/pg.ts` reads the FROM line, passes `--build-arg`, and names the cached image after the digest so a bump never reuses a stale local build.
- Lint: any `postgres:<digit>` outside that line (in `infra/compose/**`, `.github/workflows/**`, `tests/db/docker/**`) fails; fixture: compose with `image: postgres:17.10`.
- Lint: the major on the FROM line ≠ the content of `infra/postgres-major` fails; pass and fail fixtures (criterion 5).

## R5 — Postgres settings

Fragment `infra/postgres/postgresql.prod.conf`: C-75 (`log_parameter_max_length = 0`, `log_parameter_max_length_on_error = 0`, `log_statement = 'ddl'`), `archive_mode = on`, `archive_timeout = 300`, `archive_command` (R6), C-79 (`max_replication_slots = 2`, `max_wal_senders = 3`, `max_slot_wal_keep_size = 2GB`, `log_connections = on`), `password_encryption = scram-sha-256`, `shared_buffers = 768MB`. Staging fragment: same minus archiving (`archive_mode = off`; staging is not backed up, INFRA §6.1). The SHOW test asserts each value above on the prod fragment and `archive_mode` on staging.
pg_hba: `pg_hba.prod.conf` exactly as INFRA §2.2 (C-79 four lines first); `pg_hba.staging.conf` = the two reject lines for `poly_backup`/replication, the three app-role lines on the staging subnet, the final reject and the peer line. Staging's default network gets a fixed `10.202.1.0/24`; the builder adds it to INFRA §2.2.

## R6 — archive_command

`infra/postgres/archive-wal.sh %p %f`, mounted read-only: `age -R <mounted public key>` writes `spool/wal/.inflight/<f>.age.<pid>`, then `ln` (no-clobber, atomic) to `spool/wal/<f>.age`, then removes the temp. Exit non-zero, without touching the existing file, if the target exists or any step fails; never writes plaintext. Test (image job): archive one segment → an `.age` file that the test private key decrypts byte-identical; pre-create the target → non-zero exit and the existing file unchanged; `pg_stat_archiver.failed_count` rises. `.inflight/` is the one non-`.age` entry the spool may hold (F2).

## R7 — Compose and lint

Files: `infra/compose/edge.yml`, `prod.yml`, `staging.yml`. Lint: `infra/lint/compose-policy.mjs` (Node, no new dependency beyond what `infra/ci` uses; a YAML parser only if `docker compose config --format json` is insufficient — it is not expected to be). Rules = INFRA §2.2's list, each with a pass and a fail fixture under `tests/infra/fixtures/`: non-root `user`, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, `restart`, `healthcheck`, no docker socket, no secret-looking key in `environment:`, `ports:` only on caddy, no service on both project networks, only postgres+backup on backup-net, backup-net `internal: true` with a fixed subnet equal to the `poly_backup` lines of `pg_hba.prod.conf`, `db_password_backup` only in backup, `backup_store_credential` only in uploader, uploader shares no network with postgres, image by digest, R4's two checks. Secrets are compose `secrets:` with `file: /etc/polycarpic/{secrets,staging-secrets}/<name>`.

## Paths beyond the current `paths:` (lead widens before the build)

`infra/postgres-major`, `process/cairn/reviews/POLY-95/**`. Everything else (`infra/compose/**`, `infra/postgres/**`, `infra/lint/**`, `infra/caddy/**`, `infra/ci/changes.mjs`, `.github/workflows/ci.yml`, `tests/infra/**`, `tests/db/docker/Dockerfile`, `tests/db/helpers/pg.ts`, `tests/ci/changes.test.ts`, `docs/INFRA/index.html`, `docs/SECURITY/index.html`) is already covered.

## Follow-ups (lead files after merge)

- F1: drop `infra/postgres-major` from POLY-97's `paths:`; POLY-97's provision-check reads it from `main`.
- F2: POLY-97 provision-check's "spool holds only `.age`" allows `spool/wal/.inflight/` (empty at rest).
- F3: build.yml publishes and attests the Postgres derivative, the Caddy image and the tools image (INFRA §4.4; M5 shows none today) — attach to POLY-100, which pulls them by digest; the home-box DNS-plugin Caddy build goes with it.
- F4: Renovate rule for the single FROM line (INFRA §6.1a, §5), if no issue owns Renovate config.
- F5: POLY-100's ops bundle must carry `infra/compose/**`, `infra/caddy/Caddyfile` and `infra/postgres/**` config files into the verified image.
