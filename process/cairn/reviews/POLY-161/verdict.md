# POLY-161f verdict: web server in the release image

Architect. Checklist pre-registered with the ruling, before any test was written. Judged once, at gate `e4451ac9` (product tip `35908f5b`).

**Verdict: CHANGES REQUESTED, four items, all small and none in the product.** Re-judged for these alone: A1, A3, A5, A9, A10, S9 in A14.

| # | Owner | Open | Closes when |
|---|---|---|---|
| C1 | qa | `web-server-start.test.ts:88` (B9) is red in CI (run 45533753986, `db`: 1 failed, 1467 passed, 1 skipped): a connect to 3000 succeeded while the test thought it held. By reading, the test can sample after the real listen and before it sees `web.started` (it polls at 50 ms, and samples at 300 ms). The log does not say when the connect succeeded, so the product is **not cleared by this run** | every successful connect is later than the log's own `zone.unverified` time; red on a listen moved before the zone check (no record of that mutant in `gate.md`); green in CI |
| C2 | qa | `tests/image/dockerfile.test.ts:96` still asks for `.env*`; F2 made it `**/.env*` (run's `unit` job: 1 failed, 99 passed, 15 skipped). The gate did not run CI's `tests/config` step, which holds `tests/image` | the list says `**/.env*`; that step is run and recorded |
| C3 | lead | Criterion 5: POLY-88 still holds both criteria | R11 done in `POLY-88.md` |
| C4 | devops | `image.sh check`: R1 and B24 to B26 want each new assertion shown red; no tracked record shows one | a table in the gate record: plant, message, red. If the reds exist already, only the record is missing |

Then one CI run, every job green, at the final sha, with the `image` and `deploy-real` seconds.

**qa's two gaps, mine to judge: both accepted.** B38: the assertion is a plain 200 with the page's own heading on the running image, and a missing import is a 500, so it can go red by construction. `gate.md` says `image.sh check` would show the missing dependency: by reading it would not, since its smoke never opens that page; T-real is the only check. B35: the committed list is exact and the client-only plant is red, so a per-side floor adds nothing (seceng the same).

**Read:** product diff, T-real 1b, `web-server*.test.ts` (start: to line 130), the audit, layers and trigger diffs, `image.sh`, the two failed jobs' logs and T-real's. Not read: `zone.test.ts`, `console.test.ts`, the Dockerfile tests, and most of `server.test.ts`. **Run by me:** nothing at this sha.

**Follow-ups.** POLY-163, the gate before prod is opened (R4's residual, S6). POLY-160: the pool's missing `error` listener before the first staging deploy; unpinned environment keys; the re-scan reading `packages.json`; `bits-ui`. Watch: `second-step-locked.spec.ts:53`, one unexplained failure in one local run; e2e was 84 of 84 in CI.

**Not proven here:** Caddy in front of web (Host pass-through, its idle time, `nosniff`, `no-store`): POLY-104. The 512 cap in a cgroup.

## Axes

| # | Axis | Passes when | Result | Evidence |
|---|---|---|---|---|
| A1 | Criterion 1: built and mounted | R1 and R3 as ruled; `image.sh check`'s new assertions green on the CI image and each shown red; T-real 1 and 2 | **open: C4** | built, mounted and served as ruled (read; run 45533753986 T-real). No record of `image.sh check` turned red: `gate.md` has Dockerfile mutants only |
| A2 | Criterion 2: health, one listener | health through the real server; `public-health.ts` and its test gone, no reference left in product, tests/ci or `changes.mjs`; the socket-list check red on a planted second listener | met | `public-health` gone (grep of apps, packages, infra, tests, docs: none); exact sockets in the container; red on a planted 3001 (`gate.md`) |
| A3 | Criterion 3: zone before listen | R7's table, each row driven; a spawned `main.ts` refuses with exit 1 and `zone.refused` and 3000 never opened; a silent resolver starts within 5 s plus margin | **open: C1** | product order read: `verifyZone` is awaited before the import and the listen. The test of it is red in CI |
| A4 | Criterion 4: T-real | a CI run at the gate's product sha, counts read in the log, no skip; trigger rows pinned | met | run 45533753986 @ `35908f5b`, log read: 4 files, 24 of 24, no skip; `ROWS` pinned |
| A5 | Criterion 5: POLY-88 | the two criteria and the comments of R11 removed or pointed here | **open: C3** | both criteria are still in `POLY-88.md` at `e4451ac9` |
| A6 | R6: what is served | crawl over the manifest red on an unguarded new route and on a prefix `isPublic`; seceng's review has no open item | met | crawl read; prefix and planted route 8 findings red; `build-review.md` @ `aaf80fbd` |
| A12 | R13: `safeNext` | every row of addendum 1 red on today's module or on its mutant; the two Chromium cases green | met | 44 refused and 9 kept rows; 4 Chromium cases red on the old module; e2e 84 of 84 in the same CI run |
| A13 | R14, B2: the bundle's packages | list exact in the stage and the final image, red on both plants and on picomatch | met | three plants red; list exact in the stage (T-real image) and in `image.sh check` (qa, local). B35: accepted, below |
| A14 | seceng S1 to S10, R15 | each shown as its row says; S6 and S7 with their measured values | met, but S9 needs C4 | S7 at most 153 of 384 MiB, host reading; S6 not bounded (160 s): POLY-163. S1, S4, S10 not shown red, accepted by seceng; I agree |
| A7 | R4: limits and Host | each limit driven, not read; 421 and 400 asserted with bodies; positive case through the public host | met | 10, 30, 60 s driven; 512 counted by the server; Host and probe read. The check interval and the 125 s are not driven |
| A8 | R5: logging | a real 500 (database down) and a planted `console.error(object)` leave no request or error text; red without `handleError` and without the guard, separately | met | `handleError` away: red; guard away with a planted call: red (`gate.md`) |
| A9 | Whole CI run; times | every job green; `image` and `deploy-real` seconds recorded, each under 840 | **not met** | run 45533753986: `db` and `unit` failed; `image` still running when read; `deploy-real` 456 s; no `image` time yet |
| A10 | qa gate, seceng build review | signed, no open blocker | signed; seceng's CI condition open | `gate.md` @ `e4451ac9`; `build-review.md` @ `aaf80fbd` |
| A11 | Documents | ARCH §7.4 and §7.8 (mine), INFRA, SECURITY C-76 say what is, with no history | ARCH met; INFRA diff read in part; SECURITY by seceng | `docs/` at `e4451ac9` |

## Assertions that would pass a wrong build

Each is settled in the first tests or the first build. Open at the gate: CHANGES REQUESTED, unless another test is shown to hold the clause.

| # | Where | What passes wrongly | A fix must achieve | Owner |
|---|---|---|---|---|
| B1 | guard tests | calling `handle` with a fake `resolve`: the router, `__data.json`, static files and Kit's 308 are not exercised | the crawl runs on the built server over sockets | qa |
| B2 | crawl | a hand-written route list: a new route is never asked | ids read from `manifest.js`; a floor on their number; a planted unguarded route is red | qa |
| B3 | crawl | `__data.json` answers 200 for a refusal, so a status check passes both ways | the body is asserted: a redirect, and no data node | qa |
| B4 | guard | every case is a refusal; a guard that refuses everyone passes | T-real 3 and the db test: a real handle gets 200 and the name | qa |
| B5 | one listener | asking "does 3000 answer" passes with a second listener on another port or address; a source grep passes when a library listens | the socket list of the real container is exact; red on a planted listener | qa |
| B6 | one listener | `/proc/net/tcp` read in the host's namespace lists the host | read in web's own namespace; control: 8081 is seen | qa |
| B7 | spawned `main.ts` | exit 1 alone: a missing build, a busy port and a refused zone all exit 1 | the event is asserted, and that no other fatal event is there | qa |
| B8 | zone | a test that stubs `verifyZone` or its result | a real resolver over UDP to a fake server, and the preload for `main.ts` | qa |
| B9 | zone order | `web.started` after `zone.*` in the log passes when the listen came first | while the resolver is held silent, a connect to 3000 is refused; then it opens | qa |
| B10 | zone | NXDOMAIN tested on one resolver only; "refused when any says so" passes | all four pairs: nx+nx refuses; nx+silent and nx+servfail start; nx+SOA is verified | qa |
| B11 | zone | "no query in private-ca" is never asserted | the fake resolver counts zero queries | qa |
| B12 | zone retry | the retry is asserted by a timer having been set | a second query arrives; a later nx+nx leaves the process up and logs `zone.missing` | qa |
| B13 | log capture | spying `process.stdout.write` misses vitest's console (POLY-162 C1); strings only misses a logged object | a child's real stdout and stderr; a planted object; a control line is seen | qa |
| B14 | console guard | asserting the canary's absence passes when nothing was logged | `console.suppressed` is there, and the un-guarded run shows the canary | qa |
| B15 | `handleError` | a thrown test error in a fake event; Kit's own path never ran | a real 500 on the built server with the database down | qa |
| B16 | limits | reading `server.headersTimeout` (POLY-162) | slow headers, slow body, hung handler, oversize headers and connection 513 driven over sockets; where a test shortens a timeout, the configured value is asserted too | qa |
| B17 | rejection | a handler that throws synchronously only | one that rejects before headers, one after headers are out; the same pid answers the next request | qa |
| B18 | client abort | none of the above: a client that resets mid-body or mid-answer | a battery of aborts on the built server; same pid, no `process.crash` | qa |
| B19 | Host | `fetch` cannot set `Host`, so the test sends the right one by accident | `node:http` or raw sockets; a wrong Host, a wrong port, a path inside Host (M5), and health on a wrong Host all refused | qa |
| B20 | health exception | loopback Host admitted for every path | `/dashboard` and `/api/v1/health?x` with `Host: 127.0.0.1:3000` are 421 | qa |
| B21 | health | `status === 200` alone, met by any page | byte-equal bodies, 503 with the database down, 405, not on 8081 | qa |
| B22 | T-real page | 200 alone, met by another page | HTML with the page's own marker, its CSP header, and an asset it names fetched | qa |
| B23 | T-real logs | the sweep's result, which covers known secrets only | the assertion reads web's `docker logs` | qa |
| B24 | image check | a path tested in the build stage; a `find` whose error is empty output | run on the final image; control that the `find` sees `handler.js` | devops |
| B25 | image check | writability tested as root | as uid 10101 and 1000 | devops |
| B26 | image smoke | the exit code of a script whose `catch` is silent | status and a body marker compared; red when `build` is emptied | devops |
| B27 | Dockerfile tests | a grep for `vite build` met by a comment or the wrong stage | the final stage's `COPY --from=web` is the only one from it; `--network=none` is on that RUN | qa |
| B28 | adapter variables | setting `HOST_HEADER` unprefixed proves nothing when Host is pinned anyway | `POLY_ADAPTER_HOST_HEADER` refuses at start; `PORT`, `HOST`, `SOCKET_PATH` set leave the bind alone | qa |
| B29 | trigger | a row whose regex another row already matches | the existing "every row is needed" case covers each new row | qa, devops |
| B30 | ops-hardening crash | exits 1 because the build is missing | `23505` is the one crash, with the build present | qa |
| B31 | db job | the build step missing: a suite that skips without `build/handler.js` is green | it fails, never skips, in CI | qa, devops |
| B32 | `safeNext` | Node's parser stands in for the browser | the two Chromium cases end on our origin after a real sign-in | qa |
| B33 | `safeNext` | only tab tested, or only in second position; the origin check hides a missing control check | every control, two positions; each rule dropped in turn is red | qa |
| B34 | remotes | an empty `remotes` object asserted on a name that does not exist (undefined) | the key exists and has no entry; the header request is made | qa |
| B35 | bundle list | server only, or an empty list equal to an empty list | floors per side; a client-only plant is red; `svelte` and `pg` are in it | qa, devops |
| B36 | CSP | "has a CSP header" passes a widened one; the 500 page is never reached | by value, on 200, 404 and a real 500 | qa |
| B37 | S7 | 512 sockets that never reach web (the client's own limit) | the server counts 512; peak memory read under the 384m limit | qa |
| B38 | T-real page | `/dashboard` renders with `qrcode-generator` missing from the install; the second-step page would be a 500 | signed in, `/settings/second-step` is 200 on the running image, with its own marker | qa |
| B39 | typecheck | `apps/web/src/ops/server.test.ts:99` (`connectionsCheckingInterval`): `pnpm --filter @poly/web typecheck` is red at `cdc57276`, with and without `build/`; vitest does not typecheck | typecheck green in both states | qa |

## Deltas against the ruling

| # | Delta | Reading |
|---|---|---|
| D1 | R2 step 8: a literal `await import(...)` of `../build/handler.js`, not a computed URL | Objection from frontend, upheld: `poly/no-computed-import` is part of the layer and confinement enforcement and gets **no exemption**. The purpose stands: typecheck green both with and without `build/`, unit suites need no build (they do not import `main.ts`). Form: a wildcard ambient declaration (`*/build/handler.js`) in a `.d.ts` beside `main.ts`, exporting `handler` as `WebHandler` `(unmeasured)`. Both lint and typecheck are run in both states. If it fails, the measured error comes back here before any exemption |
| D1a | `#web-build` in `apps/web/package.json` `imports` stays (seceng's B1) | D1's form fails, measured at `cdc57276` with `build/` present: TypeScript follows the relative path into the generated files and reports errors by the hundred, through a committed JS wrapper too (which also fails without `build/`). So **one exact exemption** (qa, `tests/layers/relative-structure.test.ts`, red at this tip: 2 of 83 failed): `imports` is accepted only in `apps/web/package.json` and only deep-equal to today's entry, its two conditions in their order. Red on: a second key, a changed target, an added or changed condition, the same entry in another package, `imports` of another shape. And `#web-build` is named in `main.ts` only, counted over every source file of `apps/` and `packages/`; red on a second. The lint rules are untouched |
| D3 | R14's last clause (a server file with no map and no plugin record fails) is dropped (F3) | Measured on a fresh build at `cdc57276`: the maps add **no** package to the plugin's record; `pg` (17 ids) and the adapter's own runtime (5) are in the record, so the adapter's files go through the plugin's build. The union stays as it is |
| D4 | M1 and R1 say nothing outside `node:*` is imported: wrong | `chunks/SecondStepSetup.js` imports `qrcode-generator`, resolved from the image's production install (Trivy does see that one). Nothing on the image asks for a page that loads it: B38 |
| D5 | R5, R12 and B14 read `web.console_suppressed` for `console.suppressed` | seceng F6: the name collides with the S-7(c) source guard, which stays whole. Same level and fields; product and tests follow |
| D2 | addendum 2 names POLY-156 as the prod gate | it is POLY-163 (the lead) |
