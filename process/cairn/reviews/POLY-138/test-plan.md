# POLY-138 test plan

qa-engineer, 2026-11-21. Ruling `process/cairn/reviews/POLY-138/ruling.md` @ d5ead294a69f1da09ca1d25830e1f48904736182.
Static and lint tests run in the `lint` job (`tests/infra/vitest.config.ts`); container tests in the `image` job
(`tests/infra/vitest.image.config.ts`); the DB check in the db battery. "Red when" is the mutation that turns the test red.

| Criterion | Test (file > case) | Red when |
|---|---|---|
| R1 forged header, both sites, web and auth | `tests/infra/image/caddy-edge.test.ts` > R1, 4 cases: `X-Forwarded-For` two entries plus a second line, `X-Real-IP`, `Forwarded` against a node echo upstream (web, auth) | upstream sees ≠ 1 `X-Forwarded-For` line, ≠ 1 entry, a value ≠ the unforged request's, a forged address, or any `X-Real-IP`/`Forwarded` line. Mutation run for the XFF part: a global `trusted_proxies static 0.0.0.0/0` |
| R1, R4 adapted | `caddy-adapt-edge.test.ts` > four handlers set XFF `{http.request.remote.host}` and delete `X-Real-IP`,`Forwarded`; `try_duration` 10 s on all four; no `trusted_proxies`/`log_credentials`/debug | any handler differs; fewer or more than four proxies |
| R2 `Service-Worker` | `caddy-edge.test.ts` > R2: 403 + three security headers, on a web and an `/api/auth` path, `app.`, `staging.` with and without credentials; values `x`, `Script`, empty; lowercase name; unforged paths still proxy (staging without credentials still 401) | any 200/401, a missing header, or an upstream body in the 403 |
| R3 no token in logs | `caddy-edge.test.ts` > R3: four M10 URIs plus `Referer`, `Authorization`, `Cookie` markers against a stopped upstream, an accept-and-close upstream, and a healthy one; `docker logs` holds no marker (green today: with `handle_errors` Caddy logs no 502, see `red-run.md`); plus an isolated case running the real global log block on a site without `handle_errors`, where `"uri":"/sign-up"`, `/api/auth/reset-password`, `/magic-link`, `/callback` must be logged and no marker | a marker in the logs; no filtered path logged (a silent log cannot pass). Only the isolated case is red today |
| R3 adapted | `caddy-adapt-edge.test.ts` > filter encoder, regexp and Referer delete on the default logger; no site `logs` | no global `log`; a site `log`; a different regexp |
| R4 | `caddy-adapt-edge.test.ts` (above); `lint-edge.test.ts` > `caddy-xff` snippet rows | `lb_try_duration` missing |
| R5 `edge-network` | `lint-edge.test.ts`: staging service named `prod-web` on `edge-staging`; second service in `edge.yml` | already green (rule exists); red if the web/auth-only check or the "unexpected service" check is removed (run) |
| R5 `edge-alias` | `lint-edge.test.ts`, 8 rows: foreign-project alias, wrong service alias, extra alias, no alias, `container_name`, `links`, `external_links` | rule absent |
| R5 `caddy-upstream` | `lint-edge.test.ts`, 6 rows: cross-kind names, wrong port, name outside the four, a proxy in the `http://` block | rule absent |
| R5 `caddy-xff` | `lint-edge.test.ts`, 8 rows: snippet missing a line, appended value, extra line, missing import, import not the next line, snippet absent | rule absent |
| R5 `caddy-sw` | `lint-edge.test.ts`, 7 rows: no matcher, value match, no `respond`, wrong status, after `basic_auth`, after a `reverse_proxy`, outside `route` | rule absent |
| R5 `caddy-log` | `lint-edge.test.ts`, 7 rows: no global log, a missing filter line, a different regexp, `debug`, `log_credentials`, two site-level `log` forms | rule absent |
| R5 positive cases | `lint-edge.test.ts` > baseline (the ruled Caddyfile and aliases) plus two comment-only mutations | clean now only once the `(upstream)` snippet is exempt from `caddy-headers` (R5 last bullet); red today for that reason alone |
| R5 `caddy-headers` exemption | the baseline in `lint.test.ts`, `lint-sc.test.ts` and `lint-edge.test.ts` use the ruled Caddyfile | the lint says `site block "(upstream)" does not import security_headers` |
| R6 | `tests/infra/image/postgres.test.ts` > `SHOW server_version` vs the FROM minor; `tests/db/connection.test.ts` > the same in the DB harness; `tests/infra/edge-static.test.ts` > FROM is 17.12 at the ruled digest, hold before `apt-get upgrade` in the same RUN (image), hold before the pgtap install, upgrade still present, `age` still pinned | version ≠ tag, hold absent or after, FROM still 17.10 |
| R7 | `caddy-build.test.ts` > effective x/net ≥ 0.62.0 from `go version -m` in the pinned builder; `go env` checksum settings; `edge-static.test.ts` > eight forbidden tokens absent from the Dockerfile; the parsers have pure red/green cases | below 0.62.0 or any token/setting. Already green; token mutation run (`ENV GOFLAGS=-mod=mod`) |
| R8 | `edge-static.test.ts` > `renovate.json` equals the ruled object; one config only; `allowedVersions` is `<(postgres-major + 1)` | no file, key drift, major moved in one file |
| R9 | `edge-static.test.ts` > the four lines present, the two narrower lines gone, both `packages/secrets/**` lines after the negation; `tests/image/dockerfile.test.ts` list takes the four lines | a line missing or before the negation |
| R10 (D3) | not written: waits for the Principal's decision | |
| D1(b) workflow structure test | not written: waits for the Principal's decision | |

## Edits to existing tests

- `tests/infra/baseline.ts`: `CADDYFILE` becomes the ruled target text; `web` gets the `<kind>-web` edge alias (`auth` had one).
- `tests/infra/lint.test.ts`: three rows that pushed onto `web`'s `networks` list now assign object keys; the `caddy-headers`
  "site block without the snippet" row removes the import from the `app.` block.
- `tests/image/dockerfile.test.ts`: the `.dockerignore` list takes R9's four lines in place of `**/*.test.ts`.
- `tests/infra/image/postgres.test.ts`, `tests/db/connection.test.ts`: one `SHOW server_version` case each. No `DB_AREAS` entry (existing file).

## Not covered, on purpose

- That Caddy sees the real client address behind Docker's userland proxy (seceng finding 1): the container test's peer is the bridge gateway. F5.
- The `renovate-config-validator` run is recorded once in `red-run.md`, not in CI.
- The `libpq5` 19.0 ABI claim stays `(unmeasured)`.

## Follow-ups (for the lead to file)

- F-QA1: R1's container test cannot tell a trusted forged header from the peer by value alone, because Caddy's default already overwrites `X-Forwarded-For` (M8). It passes on today's tree; the `X-Real-IP` and `Forwarded` assertions are what turn it red. Pinned by the adapt test and `caddy-xff`, not by the container.
- F-QA2: a lint row for `edge-alias` on `links` also trips the existing `[links]` rule; both fire once built.
