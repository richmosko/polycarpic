# POLY-161c: qa gate record

qa-161. Gate run at `4971dc28` (feature branch tip), on a machine the lead declared quiet. Every command is the one in `.github/workflows/ci.yml`. Output of each step, timestamped, is in the author's worktree `temp/gate-out/` (gitignored); this file holds the results.

## Gate run

| Step (CI's command) | Result | Time |
|---|---|---|
| `pnpm install --frozen-lockfile`, `svelte-kit sync`, `pnpm --filter @poly/web build` | ok | 3 s build |
| `node scripts/layers/check.mjs`; `vitest run tests/layers` | ok; 568 passed | 21 s |
| `eslint packages apps scripts/layers`; `check-migrations` | ok | 2 s |
| `turbo run typecheck` (with `build/` present; B39) | 20 of 20 tasks ok | 4 s |
| `tests/ci` (`-c tests/ci/vitest.config.ts`) | 743 passed | 83 s |
| `tests/infra` (`-c tests/infra/vitest.config.ts`) | 657 passed, 3 skipped (existing container-gated cases) | 24 s |
| web unit (`pnpm --filter @poly/web test`) | 335 passed | 11 s |
| `tests/db` (`-c tests/db/vitest.config.ts`, all four areas) | 1468 passed, 1 skipped (the S6 measurement, runs with `POLY_MEASURE_S6=1`) | 250 s |
| web e2e (`pnpm --filter @poly/web test:e2e`) | 84 passed | 300 s |
| T-real, in the privileged container, image built from the tip | 24 passed (first-deploy 9, `1-web-served` 7, rollback 4, sweep 4) | 300 s |

Typecheck is green in both states (B39): with `apps/web/build/` present (the row above) and with it moved aside (`turbo run typecheck --force`, 20 of 20, svelte-check 0 errors, 0 warnings).

**One red seen and not explained by this loop.** In the first full e2e pass (`44e93416`), `second-step-locked.spec.ts:53` ("EXPIRED hold") failed after 1.2 minutes waiting for a limiter slot (`getByText(/codes are paused…/)` not found). Alone it passed (5 of 5, 22 s), and the full e2e pass at `4971dc28` was 84 of 84. I did not re-run until green: it is one failure in one run, timing-shaped (a hold that expires while the spec waits for the shared limiter), in a spec this loop does not touch. Watch it in CI; file it if it recurs.

## Defects and gaps the tests found (all fixed or placed)

- Dead handle's 303 lost the clearing `Set-Cookie` (R9.3). Fixed by `a89e6337`; `web-server.test.ts` green on it.
- `typecheck` red at `cdc57276` on `server.test.ts` (`connectionsCheckingInterval` not in Node's types): fixed in the test (B39).
- The 60 s timer test in `server.test.ts` pushed the web package's unit run over the layer suite's 60 s allowance ("web: its vitest tests run alone"): moved to `tests/db/web-server-limits.test.ts`.
- `relative-structure.test.ts` was red (2 of 83) on `imports` in `apps/web/package.json`: D1a's one exact exemption written, with ten mutants and the count of `#web-build` (one file).
- `db-filter-imports.test.ts`: the closure followed `join(ROOT, 'apps/web/build/...')` into generated chunks; generated build output is skipped; no file edge to `temp/`.
- **Pool crash, placed in POLY-160 by the lead (no test left red).** Reproduction: spawn `main.ts` against Postgres through a TCP forwarder (`tests/db/helpers/web-server.ts`: `startWeb({ proxy: true })`), request `/api/v1/health` once (opens a pooled connection), then `proxy.kill()` (destroys the forwarder's sockets). Result measured: web exits 1 within seconds, one fatal line `process.crash` with `err: {type: 'Error'}`. Cause read: `packages/db/src/pool.ts` has no `pool.on('error')`, so an idle client's socket error is an uncaught `error` event; `main.ts`'s crash handler exits.
- B38 not shown red in the container: the web container's root filesystem is read-only, so the dependency could not be moved aside, and the test needs the sign-in state of the preceding tests, so it cannot run alone. It is green on the image (200, heading, and its `__data.json`). `image.sh check` does not exercise the second-step page (its smoke asks only for `/sign-in` and `/dashboard`), so a missing `qrcode-generator` would show only in this T-real case, which has not been shown red on that fault.

## Seceng conditions and verdict rows (the test that shows each)

| Row | Test | Shown red on |
|---|---|---|
| S1, B34 remotes empty | `web-server.test.ts` (manifest `remotes: {}` present and empty; `/_app/remote/x/y` with the header is no data) | read only; no remote function was planted |
| S2, B1 to B3 crawl | `web-server.test.ts` crawl: ids from `build/server/manifest.js` (floor 18), 7 methods and `__data.json` per id, body asserted (redirect, no data node); static file list exact | prefix `isPublic` + planted `/sign-in/planted` route: 8 findings; planted `static/planted.txt`: red |
| S3, B36 CSP | `web-server.test.ts` (200, 404, 500 by value, one header, nonce or hash only on Kit pages; 500 directive by directive); `web-server-start.test.ts` (Chromium: page script runs, no violation) and `1-web-served` (container) | `kit.csp` removed from `vite.config.ts`: Chromium case red (`script-src-elem inline`) |
| S4 form origin | `web-server.test.ts`: foreign, none, `null`, http scheme, multipart, text/plain: Kit's 403 message; our origin is not 403; forged Host is 421 | not mutated (Kit's own check) |
| S5, B13, B14 console | `console.test.ts`: 18 methods in a child process, un-guarded controls print the canary, warnings silent | `dirxml` left unreplaced: red; guard removed from `main.ts` with a planted `console.error(headers)`: `web-server.test.ts` A8 red |
| S6 slow reader | `web-server-limits.test.ts` (`POLY_MEASURE_S6=1`) | measurement, below |
| S7, B37 512 sockets | `web-server-limits.test.ts`: the 513th gets nothing; RSS recorded | `maxConnections` 64: red |
| S8 zone | `zone.test.ts` (fake resolver over UDP: query name is the zone only; late answers; refused logs once, name never logged) and `web-server-start.test.ts` (preload; 3000 closed while held silent; private-ca makes no query) | 4 mutants red (one NXDOMAIN refuses; verified only if both SOA; query prefixed `app.`; bound 60 s) |
| S9 image | `image.sh check` (devops) and `tests/infra/web-stage.test.ts` (17 cases, 15 mutants) | Dockerfile mutants |
| S10 | `1-web-served`: signed-in `/dashboard` 200, no `Set-Cookie`, `no-store`; invitation canary in no web log line | read only |
| R13, A12, B32, B33 | `safe-next.test.ts` (44 refused rows, 9 unchanged, one row per rule; checked in a scratch reference) and `safe-next.spec.ts` (Chromium, 4 cases) | pre-R13 module: Chromium cases red (`net::ERR_FAILED` on the navigation to `evil.example`, which the spec's route refused); module at the tip: green 4 of 4 |
| R14, A13, B35 | `audit-exemption.test.ts`: builds a copy of `apps/web`, checks the list | plants in a server file, a client-only file (`hooks.client.ts`) and `picomatch` (list naming it): all red |
| B5, B6 one listener | `1-web-served` reads `/proc/net/tcp{,6}` inside the web container: exactly `0.0.0.0:3000`, `127.0.0.1:8081`; also `web-server*.test.ts` by `/proc` or `lsof`; `tests/ci/one-listener.test.ts` | a listener on 3001 planted in the running container: red |
| B7, B28 | `web-server-start.test.ts`: `web.build_missing`, `web.bind_failed`, `zone.refused`, `config.refused` each the only fatal event; adapter variables inert | read only |
| B8 to B12 | `zone.test.ts` and `web-server-start.test.ts` | as S8 |
| B15, A8 | `web-server.test.ts`: renamed `app.enter_session` gives Kit's 500 and `web.error` with type and no text; a failing migration table gives health 503 | `handleError` renamed away: red |
| B16 to B21 | `server.test.ts` (Host pin, loopback exception, 400/421/500 bodies, keep-alive, 431) and `web-server-limits.test.ts` (10, 30, 60 s driven) | `keepAliveTimeout` 1 s, Host pin off, probe exception widened: red |
| B22, B23 | `1-web-served` | read only |
| B27 | `web-stage.test.ts` | its mutants |
| B30 | `ops-hardening.test.ts`: build present, `process.crash` the only fatal | read only |
| B31 | `web-server*.test.ts` fail (never skip) without `apps/web/build/handler.js` | read only |

## Measured values (S6, S7; one machine, host RSS of `main.ts` with the real bundle, not a cgroup reading)

- **S7.** Idle 98 to 99 MiB. 512 held slow bodies: 143 to 145 MiB. 512 sockets with 14 KiB of headers and no end: 149 to 153 MiB (six runs). Limit 384m. The 513th connection receives nothing; health answers after the sockets close.
- **S6: a slow reader is not bounded by the timers.** A client reading 1 byte every 20 s from 3000 pipelined requests of an 81 KB file kept the connection open for 160 s (2.7 times `server.timeout` 60 s) and was still open when the test ended. The bound is the 512-connection cap and Caddy (seceng's S6 wording).

## Reproduced from architect's single runs

M3 (guard on traversal, case, `//`, absolute form, `__data.json`): crawl and near-miss rows. M4 (prefix `isPublic`; `/healthz`): mutation run and `/healthz` 303. M5 (Host decides the URL): 421 on a path inside Host. M6 (raw pg error with stack): the 500 case reads logs and body for the error text. M7 (rejections): sync, before-headers and after-headers rows, same pid. M8: Node's own 400, 431 and CONNECT; `Expect: foo` (417) and Upgrade were not driven. M9: `server.timeout` driven at 60 s. M10: SOA, NXDOMAIN, NODATA, SERVFAIL, REFUSED and silence over UDP; the resolver's own 2001 ms for a silent server was not measured (our timer is the bound and is tested). M11: 56 MB was the bundle alone; with `main.ts` idle is 99 MiB. R13's list has 20 rows I wrote from addendum 1; the "19 values" are not listed anywhere I can read, so the 19 are not claimed individually.

## Local runs and the container

- T-real needed Compose 5.7.1 (the recipe says 5.7.0); the lead fixes the recipe at close.
- The db harness left six `poly83-qa-*` containers up after the gate and e2e runs (no vitest process was running); I removed them by exact name.
- Containers now: none of mine running; `poly-treal` is stopped, not removed (image `polycarpic-qa161:ci` and the base stay local).

## Suite time (web unit tier, the layer suite's 60 s cap is not raised)

`pnpm --filter @poly/web test`, same machine, two runs each: `main` 180 tests, 6.9 s (vitest duration; 7.7 to 9.9 s wall). This branch 343 tests, 10.6 s (11.5 s wall). The layer suite's "web: its vitest tests run alone" case was 65.9 s at `44e93416` (it timed out at 60 s) and passes at `4971dc28` (the whole layers run took 21 s). What moved it: the real-time cases (10, 30 and 60 s limits, driven over sockets) are in `tests/db/web-server-limits.test.ts`, the db tier. What stays in the unit tier by file (parallel, longest first): `ops/zone.test.ts` 10.4 s (real UDP waits, late answers, retries), `ops/console.test.ts` 5.7 s (child processes), `ops/server.test.ts` 5.2 s (3 s idle case, 512 cap). The db tier gained about 70 s of wall time in `web-server-limits` (60 s of it the hung-handler timer), run serially after the parallel files.

## F1 (build review): the one cookie

On a dead handle `getSetCookie()` equals exactly the clearing line, all attributes, in the unit test, the db test and T-real. Every signed-out answer in the crawl (every method, every `__data.json`, public pages included) carries no `Set-Cookie`; unit rows say the same for six signed-out paths and a signed-in page, and that `event.cookies.set` is never called. The source test counts `set-cookie` occurrences (one), header appends (one) and refuses `cookies.set(`. Shown red on a build with `event.cookies.set` in the public branch (unit 5 red, db crawl 1 red) and, in unit, on a second `set-cookie` append; control: db `web-server.test.ts` 31 of 31 green.

## F2 (build review): `**/.env*`

`tests/infra/web-stage.test.ts` pins `.dockerignore` as patterns: `**/.env*`, `**/.svelte-kit`, `apps/web/build`, `apps/web/tests` present, the root-only `.env*` absent, no `.env` re-include; five mutants. It is red at `176f89b1` because devops-161's fix (`15a0832a`) is not on the branch yet.

## Delta gate at `35908f5b` (F1, F2, F6, D1a, B38, B39, Chromium in the db job on top of `4971dc28`)

| Step | Result | Time |
|---|---|---|
| build; `eslint packages apps scripts/layers` | ok | 4 s; 2 s |
| `vitest run tests/layers` | 568 passed | 21 s |
| `turbo run typecheck` | 20 of 20 | 5 s |
| `tests/ci` | 743 passed | 90 s |
| `tests/infra` (includes the F2 pin: 6 more cases, green on `aca1ddc5`) | 663 passed, 3 skipped (existing) | 26 s |
| web unit | 343 passed | 12 s |
| `tests/db/web-server.test.ts` | 31 of 31 (F1 exact-one-cookie included) | 12 s |
| image build; `image.sh check` | ok, exit 0 | |
| T-real in the container, image built at this sha | 24 of 24 (`1-web-served` 7, including B38 and F1) | 301 s |

Not re-run at this sha (nothing they cover changed since `4971dc28`): the full `tests/db` battery, e2e, `web-server-start.test.ts` (its Chromium case needs the browser the db job now installs: it passed locally at `4971dc28`; CI at the tip is its first run with the install).

## C1, C2 (verdict @ 994ba84a)

- C1: the B9 case sampled 3000 every 300 ms and failed any success before `startWeb` saw `web.started`, but the listen legitimately comes right after the zone check's own log line, so a sample in that gap read as a violation. Each sample is now stamped when its answer arrives and compared with the `ts` of `zone.unverified`: samples before it (more than 3 required) all refused, and every successful connect is at or after it. Red on a build with the zone check moved after the listen (`main.ts` mutated; B9 case red, restored); green 3 of 3 for the file locally.
- C2: `tests/image/dockerfile.test.ts` wants `**/.env*`. The step the first gate missed, CI's `tests/config` (`vitest run -c tests/config/vitest.config.ts`, holds `tests/image`), is now run: 100 passed, 15 skipped (existing), 5 files.

## Not covered

- B38 shown red (above). B35's "floors per side": the plugin writes one union, so a per-side floor needs a change in `bundle-packages.mjs` (devops); the test holds a total floor and the three plants.
- Limits are shown on one OS (macOS); CI is Linux (the listeners helper reads `/proc` first, the container run is Linux).
