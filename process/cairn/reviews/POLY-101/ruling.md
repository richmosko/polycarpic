# POLY-101 ruling (architect-101)

Tree read: fb814595. Conditions: `ruling-review.md` @ 53991f7e; Part 2 @ 91c448af. "Read" = code read; "run" = executed here. No container suite was run.
RP = `tests/db/auth-route-policy.test.ts`, POOL = `tests/db/auth-routing-pool.test.ts`, LINT = `packages/auth/src/boundaries.test.ts` plus ESLint over `packages/auth`.

## 1. What runs today

| Change | `db_auth` (RP, POOL) | LINT |
|---|---|---|
| `packages/auth/**`, `packages/tenancy/**` | yes (area paths) | ESLint in `lint`; `boundaries.test.ts` in `lint`, through `tests/layers/structure.test.ts`, which runs the whole packages/auth suite (read) |
| `better-auth` / passkey version: lockfile, root or package manifest, override, catalog | yes (lockfile, root manifests, `pnpm-workspace.yaml` are in DB_SHARED) | same |
| `scripts/layers/**`, `layers.json` | no, not needed | `boundaries.test.ts` by the same path (seceng measured: red with the rule deleted); ESLint itself is off |

`db` and `lint` are in `app`; REQUIRED ties `db`→`db`, `node`→`lint`, `layers`→`lint`, so a skipped job with its key true is red (read).

## 2. The gap

**The row exists in substance; criterion 2 holds for RP and POOL.** What is missing:
- G1: LINT has no path hole, but it runs by accident of another suite's loop; nothing names it or keeps it (condition 1).
- G2: nothing proves RP, POOL or LINT ran; a skip is green (5).
- G3: criterion 1 has no test, and RP's predicate skips `isAction: false` endpoints, which the router does not skip (read: better-call 1.4.5 `router.mjs` skips only a missing `path` or `options`, and `SERVER_ONLY`). Run, no Postgres: an instance from `authOptions` plus a plugin with `/qa-bump` and an `isAction: false` `/qa-noaction` gives `/qa-bump` alone under RP's rule, both under the router's, and no dead entry either way.
  **Does the hook 404 such a path today?** By reading, yes: `routePolicyHook` throws 404 for any path not in the map and never looks at `isAction`, and `refusedByHandle` refuses unlisted paths before it. Over HTTP it is (unmeasured): the probe needs the `poly_auth` pool. B3 measures it. Neither better-auth 1.7.18 nor passkey 1.7.18 uses `isAction` (grep of both dists). So this is a hole in the test, not a known hole in the control.
- G4: a dispatch with a `base` makes a green `app` (10).

## 3. The build: no new job, no new filter key

- **B1 `lint` job, new step "Auth row: drizzleAdapter lint"**, no `if:`, after install: `pnpm exec eslint packages/auth`, then vitest on `packages/auth/src/boundaries.test.ts` by name with a JSON report, then `node infra/ci/auth-row.mjs lint`. No `--affected`. Every trigger of the row sets `node` or `layers`, and both start `lint`.
- **B2 `infra/ci/auth-row.mjs db|lint`** (new, node built-ins only). Reads `VITEST_JSON`. `lint`: LINT's file. `db`: RP and POOL, when `DB_AUTH` is exactly `true`; exactly `false` exits 0; anything else exits 1. Exit 1 unless each file is present exactly once, every assertion is `passed` (none skipped, todo, pending or failed), and the passed count is at least that file's floor. A missing or unreadable report exits 1. It also reads the three source files and exits 1 on `.fails` applied to `it`, `test` or `describe`, or a `fails:` option, because vitest's JSON reports a failing `it.fails` as `passed` (seceng measured); a mistake guard, deliberate edits being condition 11. Files match by exact repo-relative path. It also requires RP's live-route test and the section-3 control (B3) by exact title, the live-route test once in each TLS mode. Floors are the counts measured at tests-red; LINT is 8 today (run), plus B4's case.
- **B2 wiring** (standing in `ci-workflow.test.ts`: no `if:`, no `--affected`, no `continue-on-error` on either step; the `db` step directly follows the battery; `DB_AUTH` from `needs.changes.outputs.db_auth`; the two `VITEST_JSON` paths differ)**:** a `db` step right after the battery, no `if:`, `DB_AUTH` and `VITEST_JSON` through `env:`. `auth-row.mjs` joins the `infra/ci` regex in DB_SHARED.
- **B3 RP (tests, qa):** one predicate function in RP, matching the router: has `path` and `options`, not `SERVER_ONLY`. The live-route test calls it, and so does a control that builds from `authOptions` plus a synthetic plugin with two endpoints, one `isAction: false`. The predicate names both against AUTH_ROUTES, and returns nothing once both are added to a copy of the map. Over `auth.handler`, both answer 404 while unlisted. RP also pins the sorted `METHOD path` list of the instance as a literal in both modes (condition 8), normalising an absent, single and array `method`.
- **B4 `scripts/layers/generate.mjs`** (needs the path, §8; without it condition 9 becomes a stated residue)**:** the auth block also refuses `@better-auth/drizzle-adapter`, in `paths` and `banned`; one case in `boundaries.test.ts`.
- **B5 `changes.mjs`:** `/^\.pnpmfile\./` and `/^patches\//` join `node` and DB_SHARED.
- **B6 aggregate:** `app` passes `DISPATCH_BASE: ${{ inputs.base }}` to the step; `aggregate.mjs` is red when it is non-empty. No documented use of a based dispatch was found in `.github`, WORKFLOW, INFRA, skills or `tests/ci` (grep). A based dispatch still runs its jobs; only its `app` is red. A full dispatch (empty base) is unchanged.

## 4. Conditions

| # | Ruling |
|---|---|
| 1 | Accepted as corrected: B1 names the run. `structure.test.ts` is left as it is and nothing relies on it |
| 2 | Accepted. Pinned as: the database paths set `db_auth`; every path sets `node` or `layers`. One case per path, plus: every workspace manifest that names `better-auth` or `@better-auth/*` sets `db_auth` (found by walking the manifests) |
| 3 | Accepted: B5 |
| 4 | Relied on: the `db-areas.test.ts` TABLE, run by the `db` preflight and on `ci` |
| 5 | Accepted: B2 |
| 6 | Accepted: `lint` and `db` are already in REQUIRED; B2 adds no key. Add aggregate cases: `node` or `layers` true with `lint` skipped, `db` true with `db` skipped |
| 7 | Accepted: B3, with the `isAction: false` endpoint (G3) as a second synthetic route. For seceng: agree under 7 that RP's predicate becomes the router's own rule |
| 8 | Accepted: B3 pins method and path |
| 9 | Accepted: B4. It is not refused today (read). Re-exports through a third package stay out of reach of an import rule |
| 10 | Accepted (lead's decision): B6 |
| 11 | Residue, no build. Mechanism: `pull_request` runs the PR's own workflow, scripts and tests, so one commit can change the code and disarm the gate. Reach: anyone who can push a branch and merge. Stronger: required code-owner review on `.github/`, `infra/ci/`, `tests/ci/`, RP, POOL, LINT. Cost: a second GitHub identity, since an author cannot approve their own PR. The lead files it |
| 12 | Accepted. No npm bot exists; a bump is a human or agent PR through the same filter. `tests/ci` asserts `ci.yml` has no `github.actor` or `triggering_actor` (none today, grep) |

## 5. How criterion 1 is proved

Standing: B3's control, on the pinned better-auth, in the `db` job. One-off, by qa in the one container run: (a) delete one `AUTH_ROUTES` entry, RP is red and names the path; restore, green (a live route with no entry is what the set comparison sees after a bump); (b) `it.skip` RP's live-route test, vitest exits 0 and `auth-row.mjs` is red. The PR's own CI run supplies the green.
**Not proved:** installing a newer better-auth. A real bump also trips the pins in `boundaries.test.ts` and `dist-sites.json`, so it could not isolate this row.

## 6. Verdict checklist

| Axis | Evidence |
|---|---|
| V1 | Deleting the generate.mjs rule alone: the named step red (`tests/layers` is red already today); removing the named step: a `tests/ci` pin red |
| V2 | Each path of conditions 2 and 3 dropped: its case red |
| V3 | `auth-row.mjs` red on: skip, todo, `it.fails`, `fails:`, failed, missing file, duplicate file, below floor, missing title, one TLS mode only, bad `DB_AUTH`, missing report; green on a good report and on `DB_AUTH=false` |
| V4 | Both synthetic routes 404 over the handler; B3 control red when `isAction` filtering returns, and when the predicate returns nothing |
| V5 | One-off (a) and (b) shown, with output paths |
| V6 | Based dispatch red, empty base and `pull_request` green, as aggregate tests |
| V7 | Standing test green, and red when broken: both steps have no `if:` and no `--affected`; `db` step follows the battery; `DB_AUTH` only through `env:` |
| V8 | PR run: `lint`, `db`, `app` green, with the row's lines in both logs |
| V9 | `lint` and `db` time against a same-day control (local LINT run: 1.1 s); diff inside the issue paths |

## 7. Standing tests this trips

`db-areas.test.ts` C25 (a script the `db` job calls must set all areas; OWN list), `changes.test.ts` (new cases), `ci-workflow.test.ts` (db step order, S7, run-body rules; the `app` step's env), `aggregate.test.ts` (new env), `guards.test.ts` and `check-run-expr.mjs` (no `${{ }}` in `run:`), `tests/layers` (generate.mjs output, if it pins the auth block: (unmeasured)).

## 8. Paths to add to the issue

`scripts/layers/generate.mjs` (for B4). `tests/db/auth-route-policy.test.ts` is already added.

## 9. Left out

- INFRA §4.3 names a dependency bot that does not exist for npm (wording; devops-101).
- A plugin `onRequest` can answer before the router (seceng's note).
