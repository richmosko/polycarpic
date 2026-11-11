# POLY-95 — gate 4 verdict (architect)

Build reviewed at d5b6d84 against ruling 9e59e9b + A1 (703fa9b) + A2 (905b929). **Verdict: pass, with two pre-merge conditions (C1, C2).** Merge when both land and CI is green on the result.

| Axis | Result | Evidence |
|---|---|---|
| Criterion 1: lint pass/fail fixtures for every INFRA §2.2 rule | pass | `tests/infra/lint.test.ts` @ d5b6d84; CI 42986024618, 42986534663 green |
| Criterion 2: CI container runs SHOW on each setting | pass | `tests/infra/image/postgres.test.ts`, compose-run `postgres`; container tests 29 s / 33 s on Linux |
| Criterion 3: archive_command encrypts with age, fails closed on exists | pass | `infra/postgres/archive-wal.sh` (exists → exit 1; stale `.inflight` cleared; `sync` file then dir) |
| Criterion 4: tag + digest written once on the FROM line | pass | `infra/postgres/Dockerfile:1`; compose `${POLY_POSTGRES_IMAGE:?}` for postgres + backup; `tests/db/docker/Dockerfile` `FROM ${PG_BASE}`; retyped-tag fixtures |
| Criterion 5: FROM major vs `infra/postgres-major` | pass | `infra/postgres-major` = `17`; drift fixtures both ways |
| R1 Caddy headers (C-07) | pass | `infra/caddy/Caddyfile` snippet with `defer`, imported in `handle_errors` and on the :80 redirect; curl suite 9/9 |
| R1 Caddy config parses in prod | **fail → C1** | `caddy adapt` with the env `edge.yml` renders (no `POLY_TLS`): `parsing caddyfile tokens for 'tls': wrong argument count … Caddyfile:22` |
| R5/R6/R7/R8 + A1 (seceng) | pass | seceng sign-offs 26bb0f3, 0e54cb0; secret-mode tests green on Linux (42985453278) |
| R3 lint guard (≤ +30 s vs 60 s full-run baseline) | pass | lint job 75 s / 79 s (+15 / +19 s). A2's ≤ 15 s step target: 14 s, then 18 s once; the job guard is the binding one |
| R3 db guard (A2: median battery step ≤ 99 s, job ≤ 150 s) | pass | battery steps 98 / 102 / 96 s (42985453278, 42986024618, 42986534663), median 98 s; jobs 116 / 124 / 117 s |
| R3 image guard (+150 s) | **re-ruled: +180 s** | added steps 152 / 140 / 166 s, median 152 s. The overage is the xcaddy rebuild C-82 forces (Caddy 2.11.9 bundles x/net 0.60.0, fixable HIGH; `infra/caddy/Dockerfile` @ 017715a). Temporary; F9 removes it. No layer cache: a temporary cost does not buy a shared-cache trust surface |
| R3 "0 s on node-only PRs" | **fail → C2** | `ci.yml` image job: Set up Node / Install pnpm / Locate store / Cache / Install run without the `image` gate |
| Arch drift (no new top-level job; filter rows) | pass | `ci.yml` adds steps to `lint` and `image` only; `infra/ci/changes.mjs` rows per R3 |
| Docs carry current state only | pass | INFRA/SECURITY diffs: no history or status narration |

## Pre-merge conditions (builder; seceng reviews the result)

- **C1.** `edge.yml` passes `POLY_TLS: ${POLY_TLS:?}` to caddy (the ACME account email on a real host; `internal` only in tests); `policy.json` `allowedVars` gains it; INFRA §2.2 or §7.1 names it as an operator value. Test: `caddy adapt` on the Caddyfile with exactly the environment the lint renders for `edge.yml` exits 0 **and** prints no `"level":"error"` line (adapt can log the error yet still exit 0, so check both).
- **C2.** Gate the image job's Node/pnpm setup steps on `needs.changes.outputs.image == 'true'`, like the steps they serve. `tests/ci` structure test asserts it.

- **SC1–SC5** (seceng build review, `seceng-build-review.md` @ 65b44fd) are pre-merge conditions of this verdict too, as written there: binds keyed by `<project>.<service>`; non-bind/tmpfs service volumes and any top-level `volumes:` fail; the staging allowlist runs before `basic_auth` in a literal `route` (403 for outside clients with or without credentials); backup binds `spool/dump` and `spool/premigration` only; the recipient file is `/etc/polycarpic/age-recipients.txt` everywhere (INFRA's two mentions are the builder's).

## Accepted as built

- `archive-wal.sh` is POSIX `sh` with `set -eu` and no pipeline, so `pipefail` has nothing to guard.
- The staging placeholder baked into the Caddy image is a hash of 32 random bytes nobody holds; compose refuses to start without the real secret.
- `gosu` is removed from the Postgres derivative; every service runs as an explicit uid, so the entrypoint never reaches it.

## Follow-ups (lead files after merge; F1–F8 as in the ruling)

- F9: drop the xcaddy rebuild and its `--replace` when a Caddy release carries golang.org/x/net ≥ 0.62.0; the image guard then returns to +150 s.
- F10: `POLY_APP_IMAGE`, `POLY_TOOLS_IMAGE` and `POLY_CADDY_IMAGE` default to an all-zero digest (`:-…@sha256:000…`), which fails closed at pull, but `${…:?}` like `POLY_POSTGRES_IMAGE` fails at render, earlier and with a named reason. Change with POLY-100, which sets all four.
- F11, F12: as in `seceng-build-review.md` (edge alias rule; uploader access to `.age` files by default POSIX ACL for uid 10005). F12 is a design gap, not a nicety: as provisioned today the uploader cannot read or delete what it must ship, so it gates the first real backup.
