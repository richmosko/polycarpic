# POLY-101 gate: build green (qa-101, 2026-11-25)

**Build sha: 9eaf595c.** The container run was on 1cddc3af; the only later changes are the two floors in `auth-row.mjs` (0624d2aa) and
the matching values in `tests/ci/auth-row.test.ts` (9eaf595c). The final script was run again over the battery's saved report.

## Green

| Command (as `ci.yml` runs it) | Result | On |
|---|---|---|
| `lint`: auth row step (eslint, `boundaries.test.ts` with JSON, `auth-row.mjs lint`) | exit 0, `9 passed (floor 9)` | c24b48b4; the check again at the end |
| `lint`: `check.mjs` + `vitest run tests/layers` | 568 / 568 | 9eaf595c tree |
| `lint`: `eslint packages apps scripts/layers` | exit 0 | 9eaf595c tree |
| `lint`: `check-migrations`, dist freshness, `turbo typecheck --affected`, `pnpm audit --audit-level high` (2 moderate), audit-exemption guard | exit 0 | c24b48b4 |
| `lint`: `check-pins.mjs`, `check-run-expr.mjs` | exit 0 | c24b48b4 |
| `tests/ci` (whole suite) | 874 / 874, 83 s | 9eaf595c |
| `db`: preflight (3 files) | 140 / 140 | 1cddc3af |
| `db`: `svelte-kit sync`, web build, Chromium install, `--db-select` = `all` | exit 0 | 1cddc3af |
| `db`: full battery | 61 files, 1477 passed, 1 skipped (`web-server-limits`, not a row file), 263 s | 1cddc3af |
| `db`: `auth-row.mjs db` on that report | `43 passed (floor 43)`, `40 passed (floor 40)` | 9eaf595c script |

Not run here: `actionlint` (not installed on this machine; the PR run does it). The `app` job and V8 need the PR run.

## Floors, and a correction

LINT 9, RP 43, POOL 40, from real runs' JSON. The red run's RP 26 and POOL 19 were wrong: `vitest list` does not expand `describe.each`
or `it.each`. A floor of 26 would have let most of one TLS mode go missing from RP (only the required titles would have held).
This corrects the "Counts used for floors" section of `red-run.md`.

## G3: the 404 for an unlisted route, now run

**It holds.** Both synthetic routes (`/callback/qa-bump`, shaped like `/callback/:id`; `/qa-noaction`, `isAction: false`) answer 404
`Not found` over `auth.handler` and over `handleAuthRequest`. Without the hook both answer 200 over `auth.handler`; over
`handleAuthRequest`, `/qa-noaction` is still 404 (the handler's refusal) and `/callback/qa-bump` is 200 (only the hook stops it).
Real-domain mode.

## One-offs (ruling §5), in the one container window

The window held separate vitest runs, one at a time, each starting its own harness container. No other container was up.

| One-off | Result |
|---|---|
| (a) `'/ok'` deleted from `AUTH_ROUTES`, RP run | 3 failed / 40 passed: the live-route test in both modes, `live but unclassified: [ '/ok' ]`; also the control's predicate case |
| (a) restored, RP run | 43 / 43; no diff left in `route-policy.ts` |
| (b) `it.skip` on the live-route test, RP + POOL run | **vitest exit 0**, 81 passed, 2 skipped |
| (b) `auth-row.mjs db` on that report | **exit 1**: both modes `skipped`; `41 passed, below the floor of 43`; required test passed 0 times in each mode |

Full outputs (gitignored, this worktree only): `.claude/worktrees/qa-101/temp/` `db-battery.txt`, `oneoff-a-red.txt`,
`oneoff-a-green.txt`, `oneoff-b.txt`, `oneoff-b-row.txt`, `mut-*.txt`.

## Must be shown red

Planted faults (each undone by hand; `git status` clean afterwards):

| Fault | File | Went red |
|---|---|---|
| The two `better-auth/adapters/drizzle` lines deleted | `scripts/layers/generate.mjs` | auth row step by itself: `refuses drizzleAdapter` failed (8 / 9); `auth-row.mjs lint` exit 1. `eslint packages/auth` alone stays 0 |
| Every pattern matching the 13 paths dropped from `node` and `layers` | `infra/ci/changes.mjs` | `changes.test.ts`: all 13 path cases, and the 2 B5 area cases |
| The same dropped from `db` | `infra/ci/changes.mjs` | all 10 database path cases, the 2 B5 cases, the manifest walk; the 3 lint-only cases stay green, as they should |
| `isAction` filtering returns | RP predicate | control, predicate case: `/qa-noaction` missing from `unclassified` |
| The predicate returns nothing | RP predicate | control, predicate case: `unclassified: []`, 53 dead |
| The hook removed from the control's options | RP control | control, 404 case: `auth.handler /callback/qa-bump` answers 200 `{reached:true}` |

Each path is classified alone in its own case, so one pass that drops all their patterns reddens each case for its own path only.

Faults an existing case feeds to the real script as input (the case is the evidence; all in the 874):

| Fault | Case |
|---|---|
| skip, todo, below floor, missing file | `auth-row.test.ts`, "ran is not skipped", per file |
| `it.fails` and the other `.fails` forms, `fails:` | `auth-row.test.ts`, "a failing test reported as passed" |
| one TLS mode only | `auth-row.test.ts`, "one TLS mode only, run twice" |
| `lint` skipped with `node` or `layers` true; `db` skipped with `db` true | `aggregate.test.ts`, "the auth row cannot be skipped" |
| based dispatch | `aggregate.test.ts`, "a based dispatch is red", "any non-empty base" |

V1's second half and V7's "red when broken": on the tree without the steps, the lint-step, db-step and distinct-report pins were red (`red-run.md`).

## One gap found in the build and fixed

The first `.fails` scan missed a call inside the chain: a failing `it.runIf(true).fails` or `it.skipIf(false).fails` is reported `passed`
(run) and the script accepted it. 6 cases red at 9ff95076; fixed at 1cddc3af (any `.fails` property).

## Criterion 1, what is not proved

No newer better-auth was installed (ruling §5). The standing proof is the control on the pinned version; one-off (a) is the same set
comparison failing on an unlisted live route.
