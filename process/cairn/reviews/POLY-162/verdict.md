# POLY-162e verdict: deploy test passing end to end

Architect. Judged once at gate sha `78888010` (product and tests `a975ba56`; only records after it). Checklist pre-registered at `d0ea5655`.

**Verdict: CHANGES REQUESTED, one item (C1, one test).** Nothing is asked of `infra/**`, `apps/web/src/**` other than that test, or the workflow. The product is as ruled on what I read.

**C1 (qa, `public-health.test.ts`).** The ruled mutant "logging the URL" survives: with `console.log(req.url)` at the top of `answer()`, 16 of 16 passed; reverted, 16 of 16. The test spies `process.stdout.write`, which vitest's console
does not go through. Wanted: that mutant red (spy `console` too, or read a child's real output), and a control that the capture sees a planted line. With it, record the other ruled G15 mutants as run: decoding, `HEAD`, echoed header,
`maxHeaderSize`, `requestTimeout`, `keepAliveTimeout`, `connectionsCheckingInterval`, `maxRequestsPerSocket`, exported handler. Only `startsWith`, `maxConnections`, `headersTimeout` are on record as red (`5ba0105c`). By reading the rest are caught; nobody has shown it.

Read: the diff `main...a1d5da3f`; `a1d5da3f..a975ba56` for product, workflow, T-real, its pins, lint and guard cases, and not its other test files (the sweep's, the aggregate's, the wiring's); rows G13 to G15 and "T-real" of `../POLY-100/ruling.md`.
**Ran:** that one mutant, a unit test. The worktree hook refused a scripted run of the other G15 mutants and I did not rerun it. No container suite.

## Axes

Result and evidence (sha or run id) are filled once, at the gate sha.

| # | Axis | Passes when | Result | Evidence |
|---|---|---|---|---|
| A1 | Criterion 1, G13 | `provision-db-create.test.ts` is green in CI's `image` job; G13's four mutants are red; T-real's `provision --stage database` is exit 0 on a fresh cluster | met | `9233f8f3`: three mutants red; the fourth (helper makes it first) held by the control case, by reading. Run 45507656076: container tests and T-real's provision step green |
| A2 | Criterion 2, G14 | guard, lint and both compose files as ruled; B2 and B5 settled | met, except committed guard cases for prod's backup and uploader and for caddy (follow-up 2) | `2cee4fc4`, `0c487709`; seceng's own guard run covers those three |
| A3 | Criterion 3, G15 and S42 | module as ruled; every ruled mutant red; B7 and D1 settled; seceng's build review has no open S42 item | **NOT MET (C1)**; product met by reading | my mutant run above. Flush mutant survives: accepted, seceng measured both forms alike. D1 and the rest of B7: POLY-161 |
| A4 | Criterion 4, T-real in CI | a CI run at the gate's product sha where the step **ran**: 3 files, 16 or more tests passed, 0 skipped, read in the log and not from the job colour; rollback case included; tests/ci pin green; B1, B3, B4, B6 settled | met | run 45507656076 @ `a975ba56`, log read: 3 files, 17 of 17, no skip; `CI` passed through sudo. `faulted-runs.md`; B6's 120 s bound has no red of its own (follow-up 4) |
| A5 | Criterion 5, time | measured step and `image` job time from CI recorded; worst case ≤ 17 min (1020 s), else T-real is in its own job. See "Time" | met: moved to its own job | run 45500690283: 737 + 295 = 1032 s, over. Run 45507656076: `deploy-real` 419 s of 900, T-real step 290 s; `image` 602 s without T-real. One run each |
| A6 | Criterion 6, faults | each product fault found is fixed or filed, with a test shown red on it | met on the record | beyond G13 to G15 none is recorded as the product's; the rest were the harness's and the undo's (F3). `faulted-runs.md`, `build-review.md` |
| A7 | Trigger list | every row of the ruling is in `changes.mjs` and pinned (`public-health.ts` and the undo script included); import walk green | met | `deploy-key.test.ts` ROWS at `a975ba56`; `gate.md`: tests/ci 715 of 715 |
| A8 | Job placement, S38 a to e | last non-always step of `image`; never in `build.yml`; `contents: read`; no token; undo is `always()`; no later pull; kept log named and swept; B1, B8, B9 settled | met, in its own job (the ruling's own alternative); last non-always step of it | `ci.yml` @ `a975ba56`; run 45507656076: sweep, undo, then `kept.log` alone uploaded; pins read; seceng confirms B9 @ `6f81ea42` |
| A9 | Undo | CI log shows the undo ran; what it removes matches the harness's header | ran; result not shown | run 45507656076; the script always exits 0, so its green says only that it ran. List matches by reading (F3 fixed). Follow-up 3 |
| A10 | Whole CI run | every job green at the gate sha | met at `a975ba56` (the gate sha adds records only); C1's commit needs its own green run | run 45507656076: all ten jobs success |
| A11 | qa `gate.md`; seceng `build-review.md` | signed; no open blocker | met; seceng's pass waits on CI and is void if the product tip moves | `gate.md` @ `78888010`; `build-review.md` @ `6f81ea42`. The ops unit suite (555, 1 skipped) was the lead's run, relayed, with no saved output: it goes into `gate-output/` |
| A12 | Documents | ARCH (mine, below). INFRA §4.4 "Not yet run end to end" and SECURITY's "Not yet shown end to end" no longer say what is now untrue, without history | met | `docs/ARCH` unchanged since `d0ea5655`, re-read; INFRA §4.4 and SECURITY's passage @ `a975ba56` |

## Assertions and steps that would pass a wrong build (by reading, unless marked measured)

| # | Where | What passes wrongly | A fix must achieve | Owner |
|---|---|---|---|---|
| B1 | `ci.yml` step | `sudo --preserve-env=` names two variables, so with sudo's default `env_reset` `CI` does not reach vitest (on the runner: unmeasured). `IN_CI` is then false and a missing tool is `describe.skip`: the step is green with nothing run. `GITHUB_STEP_SUMMARY` is lost too, and 3(e)'s token check sees an environment sudo already emptied | `CI` (and the summary path) reach the suite, pinned in `tests/ci`; a test that the suite refuses to skip under that exact command | devops, qa |
| B2 | `1-first-deploy` | G14 rules `RestartCount` 0 for the worker after the window; nothing reads it. A worker that restarts once and then reports healthy passes | assert it (with the container found) | qa |
| B3 | `1-first-deploy`, `2-rollback` | `byService(svc).every(...)` is true for no container, and the `(healthy)` loops pass over none | exactly one container per service: postgres, web, auth, worker | qa |
| B4 | hostile `.env` | `COMPOSE_PROFILES=migrate,operator` taking effect, or the planted service starting, is ignored by the name filters; nothing asserts the directory is unreadable to uid 10020 | the project's set of long-running services is exact; no `operator`, no `planted`; mode asserted | qa |
| B5 | guard and lint cases | caddy, backup and uploader have no `command` or `entrypoint` case, auth no `entrypoint`; a guard that skips those services passes. G14 says every service of the three files | one generated case per service, per key: missing, other, extended, added | qa |
| B6 | `2-rollback` | no lower bound: a tool that rolls back at once, or a candidate whose web crashes at start, passes. `alert` is only non-empty; the quarantine reason is unread | elapsed ≥ 120 s for the poll; alert and quarantine name their reason (`unhealthy`); the candidate's web was started | qa |
| B7 | `public-health.test.ts` | `/\b3000\b/` is met by the file's own comment; "starts it once" is `>= 2` mentions, so two calls pass; bind failure reads exit 1 without the message (an uncaught error is also 1); health on 8081 is not asked; no test spawns `main.ts`; 404 and 503 have no "nothing else" header check | each ruled clause of G15 asserted as such | qa |
| B8 | `deploy-key.test.ts` | reads step `env` only; a workflow or job level `GH_TOKEN` passes, though the case's title claims it | workflow and job `env` read too | qa |
| B9 | kept log | (measured, macOS `tee`) `tee` without `-a` writes at its own offset into the file the harness appends to, and overwrites harness lines: the kept log is damaged. Separately, `bail: 1` skips part 3 on a red run, so the log is uploaded **unswept**, to a public artifact, exactly when the product printed an error; and the sweep runs before the last reporter output | one append-only writer discipline; the upload happens only after a sweep that also runs on failure, or not at all (S38 d). seceng rules on the second half | devops, qa, seceng |
| B10 | `tests/ci/deploy-key.test.ts` | no case pins `apps/web/src/ops/public-health.ts`: dropping it from `changes.mjs` stays green (`grep public-health tests/ci`: nothing) | a ROWS entry for it | qa |

B1 and B9 bear on whether the step proves anything and on disclosure: open at the gate, each is CHANGES REQUESTED. B2 to B6 and B10 are ruled or criterion clauses: the same, unless
the gate shows another test holds the clause. B7 and B8: follow-ups if open.

## Deltas against the rulings

| # | Delta | Reading |
|---|---|---|
| D1 | `public-health.ts` writes its bind failure as hand-made JSON on stderr, outside the log schema (ARCH §7.4) | the ruled import limit (`node:http`, `health.ts`) forces it: follow-up, goes with the file at POLY-161 |
| D2 | the lint compares web's healthcheck `test` alone, so `disable: true` or another interval passes it; the guard compares the whole object | the ruling says both pin the healthcheck. Guard holds the box: follow-up, or fixed with B5 |
| D3 | `POST` with an unread body: the socket is destroyed with unread input, which can become a reset | as ruled; the test reads the whole 404 |

## Time

Image job without T-real, measured: 626, 644 and 737 s (ruling R13's table, PR #150). T-real locally: 299 s. 737 + 299 = 1036 s, over 1020 before G13's new file is added.
The rule at the gate: worst case = the slowest measured `image` job without T-real (737 s, or a slower one seen) + G13's file + T-real's step, both measured on CI. Over 1020 s, T-real moves to its own job; one fast run does not settle it.

## Follow-ups (POLY-160, or POLY-161 where named)

1. D2: the lint compares only web's `healthcheck.test`; the guard the whole object. With seceng's U1, U2.
2. Committed guard cases for prod's backup and uploader and for caddy.
3. A check of what the undo leaves (U3).
4. B6's lower bound shown red on its own.
5. POLY-161: D1; a test that spawns `main.ts`; health not answered on 8081.

**Not proven here:** real GitHub and attestation, a timer firing on schedule, prod, edge, the tools image (POLY-104 and the first prod deploy).

## ARCH

At this commit §7.4 (the health listener), §8.1 (commands, pinned command and entrypoint, database creation) say what is built. Re-read at the gate sha.
