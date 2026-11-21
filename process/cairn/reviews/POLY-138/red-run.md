# POLY-138 red run

qa-engineer, 2026-11-21, tree `e4ab00fe` plus the tests. Ruling `ruling.md` @ d5ead294a69f1da09ca1d25830e1f48904736182.
Raw output: `temp/` is not kept; each line below names the assertion that failed.

## Red, 76 tests, each for its stated reason

| File | Red | Reason (the failing assertion) |
|---|---|---|
| `tests/infra/lint-edge.test.ts` | 36 fail rows | the lint exits 0 or lacks the rule id: `[edge-alias]`, `[caddy-upstream]`, `[caddy-xff]`, `[caddy-sw]`, `[caddy-log]` absent (rows with `links` show the existing `[links]` rule only; `edge-alias` absent) |
| same | 3 positive cases | `[caddy-headers] ... site block "(upstream)" does not import security_headers`: the lint does not yet exempt the `(upstream)` snippet (R5 last bullet) |
| `lint.test.ts` (2), `lint-sc.test.ts` (1) | 3 | the baseline now carries the ruled Caddyfile; same `(upstream)` message, nothing else |
| `tests/infra/edge-static.test.ts` | 12 | FROM still 17.10 (1); no hold before the upgrade or before the pgtap install (2); no `renovate.json` (2, incl. allowedVersions); `.dockerignore` lacks the four lines (4), still has the two narrower ones (2), order (1) |
| `tests/image/dockerfile.test.ts` | 4 | `.dockerignore` lacks `**/*.test.*`, `**/*.spec.*` and the two `packages/secrets/**` lines |
| `tests/infra/image/caddy-edge.test.ts` | 4 R1 | `X-Real-IP: ["198.51.100.7"]` reached the upstream (and `Forwarded`) |
| same | 8 R2 | status 200 (app, staging with credentials) or 401 (staging without credentials) where 403 is ruled |
| same | 1 R3 | the real global block, on a site without `handle_errors`: the marker appears in `docker logs` (no filter) |
| `caddy-adapt-edge.test.ts` | 3 | no `X-Forwarded-For` set/`delete` on the handlers; `try_duration` undefined; no filter encoder |
| `postgres.test.ts` | 1 | `17.11 (Debian 17.11-1.pgdg13+2)` does not match `^17\.10`. The server runs what apt gave it on that day (17.11 here, 17.12 in the DB harness), not the tag. |
| `tests/db/connection.test.ts` | 1 | `17.12 (Debian 17.12-1.pgdg13+1)` does not match `^17\.10` |

(Counts: 39 + 3 + 12 + 4 + 13 + 3 + 1 + 1 = 76. The edge-static line sums to 12 as run.)

## Already green on today's tree, with the mutation that turned each red

| Test | Why it holds today | Mutation run → result |
|---|---|---|
| `lint-edge` `edge-network` ×2 (staging service named `prod-web`; second service in `edge.yml`) | the rule exists | commented out the two checks in `compose-policy.mjs` → both red; reverted |
| `edge-static` R7 tokens ×8 | the Dockerfile has none | appended `ENV GOFLAGS=-mod=mod` → the GOFLAGS case red; reverted |
| `caddy-build` x/net ≥ 0.62.0 and `go env` checksums | the rebuild is in place; builder is stock | pure parser cases (0.60.0, `=>` line, weakened env) show each assertion able to fail |
| `caddy-edge` R1: one `X-Forwarded-For` line, one entry, equals the unforged request's | Caddy's default overwrites it (M8, the "Unnecessary header_up" warn) | ruled Caddyfile minus the `header_up X-Forwarded-For` line plus `trusted_proxies static 0.0.0.0/0` → 4 red, `got 4` entries; reverted |
| `caddy-adapt-edge` no `trusted_proxies`, `log_credentials`, debug, no site `logs` | none present | not run; the `caddy-log` and `caddy-xff` lint rows cover the same mutations |
| `caddy-edge` R2 "without the header the same paths proxy" | the positive case | n/a (guard passes) |
| `caddy-edge` R3 stopped / closed / healthy upstream: no marker | **no log line is written** (finding below) | ruled Caddyfile minus its `handle_errors` blocks → marker appears, red |

With the ruled Caddyfile (ruling lines 84–160) copied over `infra/caddy/Caddyfile`, the 22 Caddy tests in `caddy-edge` and `caddy-adapt-edge` pass; reverted.

## Finding: M9 does not hold with `handle_errors` (R3)

Caddy writes **no** log line for a dial-failure 502 when the site has a `handle_errors` block, and both ruled sites have one.
Measured three ways: today's Caddyfile, the ruled Caddyfile, and today's minus its `handle_errors` blocks. Only the third logs
`http.log.error` with the full URI, marker included. So on the ruled stack no token reaches the log, filter or not, and the
filter is defence in depth for a future `handle_errors`-free site, an access log, or a Caddy that changes this.
Consequence for tests: the stack-level R3 tests (stopped, closed, healthy) pass today and cannot gate; the one R3 test that
is red is the isolated one, which runs the real Caddyfile's global block on a site without `handle_errors`. The ruling's
"stopped case shows the M10 paths" cannot be asserted on the real stack; it is asserted in the isolated test.
Decision for the lead and architect: R3 stays as ruled (the filter and its lint rule are still worth having), and the ruling's
M9 and R3 wording should say why.

## Known macOS failures, untouched tests

`postgres.test.ts` fails three more cases on this Mac, none touched by this loop: "web is refused a file in postgres's directory…",
"a 0440 file in a service directory is refused to an unrelated uid", "an age failure (unreadable recipients file)…" (POLY-143's class).
Control: the file as it stands at `e4ab00fe` (before any test change), run alone against the same tree, fails the same three and passes 27.
I did not run `main` itself; the Dockerfile, compose and stack code those tests read are unchanged on this branch.

## Renovate validator (once, not in CI)

The ruled JSON (copied from the ruling, `renovate.json` does not exist yet) in `renovate/renovate@sha256:d6b65ff3…aa75`:
`renovate-config-validator --strict` → "Config validated successfully against 1 file(s)", exit 0.
Re-run it against the built file at the green gate.

## Static suites

`tests/ci` 542 pass; `tests/layers` 545 pass; `tests/infra` 198 of 252 pass, the 54 reds listed above (lint-edge 39, lint 2, lint-sc 1, edge-static 12); `wiring.test.ts` green.
`tests/db/connection.test.ts`: 9 pass, 1 red. Not run: lint and typecheck (no source changed), the full image job.

## Held for the Principal

R10 test row and `caddy-cache` fixture (D3); the D1(b) workflow structure test. D2 proceeded as ruled (`caddy-log` refuses a site `log`).

## D1(b) workflow test (added 2026-11-21)

`tests/infra/renovate-workflow.test.ts`: 8 tests, all red on today's tree (`.github/workflows/renovate-check.yml` does not exist).
Run against a compliant sample workflow (not committed) all 8 pass, and each of eight mutations turns exactly one test red:
`pull_request_target` trigger, `contents: write`, `secrets.X` in checkout, image by tag, exit code swallowed, daily cron,
`--dry-run=full`, no permissions block. Total red is now 84.

## D1(b) behavioural test (`renovate-report.test.ts`, against `check-report.sh` @ 96dbb7d9)

16 tests, 14 pass, **2 red, both fail-open**: a report whose repository has no `packageFiles` (`{"repositories":{"r":{}}}`), and
one whose package files hold no dependencies, both exit 0 "No update is due." A lookup that extracted nothing (a broken
`includePaths` or config) reads as clean, so the weekly run would stay green while checking nothing. Wanted: exit 2. Total red: 86.

## Addendum 2 (ruling @ 04edd0f3)

No test pinned the Caddy FROM lines. Added two to `edge-static.test.ts`: builder `f9beaa5d…`, runtime `4851e54a…`. Both red (still `1b828679…` and `0c2243ef…`). Total red: 88. The R7 tests re-measure x/net and the checksum env at build-green, as the addendum says.

## R10 (decision D3 taken)

Lint: 10 `caddy-cache` rows red (rule absent; the snippet-missing row exits 0). The baseline now carries `(no_store)` and both imports, so the 3 baseline-based positive cases stay red for the `(upstream)`/`(no_store)` `caddy-headers` exemption until the lint is built.
Container (`caddy-edge.test.ts` -t R10, today's Caddyfile): 7 red, 3 green. Red: the six page/auth cases (`expected ['max-age=31536000, immutable'] to deeply equal ['no-store']`) and the lookalike-path case (`/_app/version.json` keeps the upstream value). Green today: `/_app/immutable/x.js` keeps the upstream value (both sites) and the Service-Worker 403 case.
Controls: today's Caddyfile plus the ruling's snippet and two imports (temporary, reverted) makes all 32 tests in `caddy-edge` and `caddy-adapt-edge` pass.
Net new red: 17 (10 lint + 7 container), so 105 at the red gate.
