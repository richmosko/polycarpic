# POLY-95 — seceng check of the final ruling @ 2669725

Result: **no veto**. The final ruling folds in checklist #1–#11. Four points from S1–S9 (@ 519d815) are still open, and three of them would break or weaken the build. Requested as **addendum A1** (≤ 15 lines):

1. **R6 crash safety (new hole, caused by the step-1 liveness fix).** Step 1 returns 0 when the plaintext sum matches, and that trusts the `.age` file to be complete. After a power loss, a linked but unflushed `.age` can be truncated, and the retry would then accept it: a silent WAL gap that only the restore drill finds. Rule: `sync` the temp file and the `.sums` file before `ln`, then `sync` the `spool/wal/` directory. Before step 2, remove any stale `.inflight/<f>.age.*`.
2. **Caddy vs `cap_drop: [ALL]` + no `cap_add` (S2).** A non-root Caddy can't bind 80/443 without a capability. Rule: Caddy listens on `:8080`/`:8443` in the container and `ports:` maps 80→8080 and 443→8443.
   - R7 bans `${…}` in raw `ports`. The local box still needs its LAN bind, so allow exactly one variable, `${POLY_BIND_ADDR:?}` (no default), as the host IP of caddy's ports. Any other interpolation in `ports` fails.
3. **R8 with more than one consumer.** `auth_secret`, `resend_api_key` and `plaid_secret` each have two consumers (web and worker), which "one consumer group per file" can't express.
   - Rule: per-service directories `/etc/polycarpic/{secrets,staging-secrets}/<service>/<name>`, dir `root:<service gid> 0750`, file `0440`.
   - A secret with two consumers is two files. A service's `file:` sources lie under its own directory only (lint), which replaces R7's path rule.
   - Every service has a distinct gid. None uses `group_add`.
4. **Small adds (S3, S5, S7).**
   - Lint fails on `sysctls`, `extra_hosts`, `links`/`external_links`, and a volume source of `/`, `/run` or `/var/run` (a socket by its directory).
   - Image job: `pg_hba_file_rules` has no `error` and its first four rows are the C-79 lines.
   - Caddy adapt test: no `trusted_proxies`; `admin` absent or loopback-only.

Once A1 lands, seceng writes SECURITY §6.2 to item 3's rule. Until then §6.2 stays as it is.

## Re-issued ruling @ 9e59e9b

**Approved. The build may start.** S1–S9 and A1 items 2–4 are met. Item 1 applies in its fail-on-exists form, with one line to add:

- **R6 step 4:** after `ln`, `sync` the `spool/wal/` directory before exiting 0. Without it, a power loss after Postgres records success can lose the link itself: the segment is marked archived but is missing from the spool, a silent WAL gap. The builder applies this; it is not a re-issue.

## Trivy finding on gosu (CI run 42984439494 @ 22f192b)

**Ruling: remove gosu from the image. No accepted risk, no ignore entry.**
- Postgres runs as `999:999` (R5), so the entrypoint never calls gosu. Its one gosu call (`docker-entrypoint.sh` line 343, measured in the base image) runs only when the uid is 0. The backup container is also non-root. The binary is dead weight carrying 26 fixable CVEs.
- `infra/postgres/Dockerfile`: add `rm -f /usr/local/bin/gosu` to the existing `RUN`. Trivy applies layer whiteouts, so it does not report a file a later layer deletes (unmeasured; the next scan shows it).
- Removing it also fails closed: a container started as root dies at `exec gosu`, so it cannot run Postgres as root.
- The image job adds `test ! -e /usr/local/bin/gosu` next to the `age --version` check.
- A `.trivyignore` entry, or a severity or `--ignore-unfixed` change, for this path is refused.

## Sign-off on 017715a (Trivy-clean derivatives)

**Both accepted. No ignore entries.**
- **Postgres:** gosu is removed as ruled above.
  - Still missing at this sha: the image job's `test ! -e /usr/local/bin/gosu` and the S8 `age --version` check (grep finds neither in `infra/ci`, `tests/infra` or `.github`). Both are required before build-green.
- **Caddy, xcaddy rebuild with `golang.org/x/net` v0.62.0:** accepted. The builder and runtime images are pinned by digest, and the module versions are pinned and checked against `sum.golang.org`.
  - Condition: no `GOFLAGS=-insecure`, `GONOSUMDB`, `GONOSUMCHECK`, `GOSUMDB=off` or `GOPROXY=direct` override anywhere in the build.
  - Condition: drop the `--replace` once a Caddy release ships a fixed x/net (F4's Renovate rule covers the tag).
- **Placeholder `staging_basic_auth` in the image:** accepted. It is a bcrypt hash of a random password nobody holds, so with the mount missing the staging route denies everyone: it fails closed and grants nothing. The real hash is never in the image or the repo.
