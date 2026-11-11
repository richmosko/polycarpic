# POLY-95 — seceng conditions on the gate-1 ruling @ fe88a89

Verdict: **approve with conditions S1–S9**. No veto. Each condition names its rule and its test. R2 and R3 are approved unchanged. Where a condition and R1–R7 differ, the condition applies.

## S1 — Caddy never shares a network with Postgres (C-70, TB-1, T-60)
R7's "no service on both project networks" leaves out that Caddy is on both, and INFRA §2.2 puts Caddy on `polycarpic-prod_default`. That is postgres's network, and pg_hba admits the app roles from the whole /24.
- Networks `edge-prod` (caddy plus prod `web`) and `edge-staging` (caddy plus staging `web`) are defined in `edge.yml` and are `external` in the project files. Each gets a fixed subnet, outside every pg_hba allow CIDR and outside the 10.200.0.0/16 pool.
- Lint: caddy is the one service allowed on networks of two projects, and only on `edge-*`. No service other than `web` shares a network with caddy. The edge subnets overlap no pg_hba allow line in either `pg_hba.*.conf`. Fail fixtures: caddy on `polycarpic-prod_default`; postgres on `edge-prod`.
- The builder updates INFRA §2.2's network table to match.

## S2 — No capability added anywhere (C-70)
`cap_drop: [ALL]` plus `no-new-privileges` removes the bind capability that the caddy binary gets from its file capabilities, so binding 80/443 as non-root fails. The fix is for Caddy to listen on unprivileged ports inside the container (`8080`/`8443`, with `ports:` mapping 80→8080 and 443→8443). It is not `cap_add`.
- Lint: `cap_add` present on any service fails.
- The host IP of each port comes from one variable, `${POLY_BIND_ADDR:?}`, with no default, so a missing value fails instead of binding 0.0.0.0. The local box sets the LAN address.

## S3 — Lint bypasses (C-70, C-79). Each item is one rule with a fail fixture
- Fails on: `privileged`; `network_mode` (any value: `host`, `service:`, `container:`); `pid`, `ipc` or `userns_mode` = `host`; `devices`; `security_opt` containing `unconfined`; `sysctls`; `env_file`; a top-level secret with an `environment:` source (only `file:` allowed); a config with inline `content:`; `build:`; `extra_hosts`; `links` or `external_links`.
- Docker socket: any volume whose source resolves to `/var/run/docker.sock`, `/run/docker.sock`, `/var/run`, `/run` or `/` fails. Bind mounts follow an allowlist (service → source → target, `:ro` unless listed), default deny.
- `user:` must be set explicitly, numeric `uid:gid`, uid ≠ 0, on every service. The image default is not trusted: `postgres:17.10` defaults to root.
- Interpolation: `${…}` is allowed only in image references, the variables named in `infra/lint/policy.json`, and S2's bind address. Any `${` in networks, secrets, volumes, user, cap_*, security_opt or healthcheck fails. The check runs on the raw files (`docker compose config --no-interpolate`) as well as the rendered output.
- Render set: for each project, `docker compose -f <exactly the deploy's files>` with every profile from `docker compose config --profiles` enabled. A file named `*compose.override.y*ml` under `infra/compose/` fails.
- Fail closed: exit non-zero when `docker compose` is missing, a render errors, a project renders zero services, or `policy.json` is missing or invalid.

## S4 — Secrets are default-deny, by matrix (C-74, C-77, C-79)
- `infra/lint/policy.json` carries the INFRA §2.2 secret → service matrix for prod and staging. A secret absent from the matrix fails. A service mounting a secret not listed for it fails. This covers more than the two C-79 secrets: for example `credential_keyring` is worker-only and `db_superuser_password` is postgres-only.
- Staging `file:` sources lie under `/etc/polycarpic/staging-secrets/` only, and prod sources under `/etc/polycarpic/secrets/` only. Cross-directory fixtures fail.
- `environment:` rule: a key matching `(SECRET|PASSWORD|PASSWD|TOKEN|KEY|CREDENTIAL|DSN|DATABASE_URL)` fails unless it ends `_FILE` and its value starts `/run/secrets/`.

## S5 — Postgres config cannot be overridden or skipped (C-75, C-79)
- The fragment sets `allow_alter_system = off` (PG 17), `hba_file` pointing at the mounted pg_hba, and `listen_addresses`. The official image's initdb appends `host all all all scram-sha-256` to `$PGDATA/pg_hba.conf`, so an unset `hba_file` silently admits poly_backup from anywhere.
- SHOW test additions:
  - `SHOW hba_file` returns the mounted path.
  - `pg_hba_file_rules` has no `error` and its first four rows are the C-79 lines.
  - For every R5 setting, `pg_settings.sourcefile` is the mounted fragment.
  - `pg_db_role_setting` is empty.
  - `allow_alter_system` is `off`.
- The image job's config container takes its `command`, `user` and mount targets from the rendered `prod.yml` postgres service, not a second copy. Alternatively the lint asserts the two are equal. Postgres runs as the explicit numeric postgres uid (S3), with tmpfs at `/var/run/postgresql` and `/tmp`.

## S6 — archive_command (R6 approved with these additions)
- `set -eu`. Before writing, remove stale `.inflight/<f>.age.*` left by an earlier failed attempt on the same segment. `sync` the temp file before `ln`, so a crash can never leave a truncated `.age` under the final name.
- Fail-on-exists is accepted. Its liveness case (a crash after `ln`, before Postgres records success) clears itself once the uploader ships the file and deletes it from the spool. The uploader never reads `.inflight/` (add to F2).
- Additional test: a failing `age` (key file unreadable) leaves no file under `spool/wal/` except in `.inflight/`, and leaves none at all after the next attempt.

## S7 — Caddy headers (R1 approved with these additions)
- HSTS `max-age=31536000`, no `includeSubDomains` or `preload`: accepted. HSTS on `app.` cannot cover sibling subdomains anyway. The subdomain cookie-injection threat (T-04) is the cookie prefix's job (POLY-86), not HSTS's.
- The headers are set with `defer`, so an upstream cannot replace them. They must appear on a proxied 200, on a Caddy 404 or error, and on the staging 401.
- Runtime test (image job, about 5 s): start the Caddy derivative against a stub upstream that returns a conflicting `Referrer-Policy`. Assert the three headers with curl on each of those four responses, and assert that no `Content-Security-Policy` is added when the upstream sends none. The `caddy adapt` JSON test stays, plus: no `trusted_proxies` (Caddy is the edge and must not trust a client's `X-Forwarded-For`), and `admin` is absent or loopback-only.
- No basic-auth hash in the repo. Fixtures use a throwaway hash.

## S8 — age in the derivative (C-80, C-82)
The apt line in M2 is accepted as the ruling C-80 requires for a new package. `tests/image`'s static apt check runs on `infra/postgres/Dockerfile` too: no added source or key, no unauthenticated flags. The image job asserts that `age --version` runs and that the image's configured user is overridden to non-root in compose (S3). Trivy scanning is as R3. Attestation follows F3.

## S9 — Secret-file ownership under non-root (C-74; unmeasured)
Plain `docker compose` (not swarm) bind-mounts `file:` secrets, and its support for long-syntax `uid`, `gid` and `mode` is unmeasured. A `root:root 0400` host file may then be unreadable by a non-root container. The tempting fixes are 0444, or running as root, and both are refused.
- Each service runs as its own distinct numeric uid (web, worker, migrate, backup, uploader and caddy all differ), so the host can own each secret file per uid at mode 0400.
- At gate 3 the builder measures, on the runner, whether a `user: <uid>` service reads a 0400 secret owned by that uid, and whether it is refused a 0400 file owned by root. Report the result. SecEng then updates SECURITY §6.2's ownership line from that measurement.

## Follow-ups (lead files after merge)
- **F2+:** the uploader ignores `spool/wal/.inflight/` (POLY-97 / uploader owner).
- **F6:** POLY-100's deploy uses explicit `-f` files from the verified bundle only, never a working-directory compose file. It runs the compose-policy lint, or checks the bundle's digest, before `up`.
- **F7:** POLY-97 provision-check: each secret file is owned by its consuming uid, mode 0400, directory 0700. No file is world-readable.
