# POLY-101 build review (seceng-101)

Build 9eaf595c, gate record dbf156d2, head 9e3ee1b2 (tracker files only after the build).

## Verdict: PASS WITH FOLLOW-UPS, by reading the code and the gate record

**My own mutants were not run.** The worktree guard refused the one command that ran them, and I did not split or reshape it. Every red below is
qa-101's (gate.md, red-run.md), not reproduced by me. The CI run on the head (45661985841, a `workflow_dispatch`) was still in progress when I looked:
this verdict does not rest on it, and V8 needs the pull_request run.

## Conditions

| # | Result | Evidence (read at 9eaf595c) |
|---|---|---|
| 1 | met | named `lint` step, no `if:`; pinned in `ci-workflow.test.ts`; rule deleted -> step red (gate.md) |
| 2, 3 | met | 13 path cases and the manifest walk in `changes.test.ts`; `.pnpmfile.` and `patches/` in `node` and DB_SHARED. Dropped together, each path classified alone in its own case, so each red is its own |
| 4 | met | `db-areas` TABLE unchanged; `auth-row.mjs` in DB_SHARED with its OWN entry |
| 5 | met | `auth-row.mjs`: exactly once, all passed, floors 9 / 43 / 40, titles per TLS mode, `.fails` refused. One-off (b): vitest exit 0, `auth-row.mjs db` exit 1 |
| 6 | met | three aggregate cases, `lint` or `db` skipped with its key true; green at the red run. They feed the real script, but no mutant of REQUIRED is listed in gate.md: follow-up F3 |
| 7, (i) | met | one predicate, `routeDiff`; control with a template-shaped and an `isAction: false` route, through `auth.handler` and `handleAuthRequest`, plus the hookless control |
| 8 | met | `METHOD_PATHS` literal, normalised, asserted in both modes |
| 9 | met | `@better-auth/drizzle-adapter` and its subpaths refused; the bare path has a test, the subpath and dynamic import do not: F1 |
| 10 | met | `DISPATCH_BASE` through `env:`; any non-empty value red; empty and unset green |
| 11 | residue, open | the lead files it |
| 12 | met | no-actor pin; INFRA no longer claims an npm bot |

devops (a) exact relative path, (b) no `${{ }}` in `run:`, (c) no new secret or permission, (d): met.
qa (a) to (i): met; (g) floors corrected from the real run's JSON (26 / 19 were wrong, 43 / 40 are right).

## G3 and SECURITY

Nothing changes. The measurement matches the reading: for an unlisted path with the shape of a listed template, the hook is the only refusal. SECURITY §4.1 (A-34) names
`hooks.before` as the allowlist and claims a second layer for the blocked class only, which is true. No text promises two layers for unlisted paths.
Reach if the hook were lost: any HTTP caller, for a new literal under `/callback/:id` or `/reset-password/:token`'s shape. The standing control turns red on that.

## Follow-ups (none blocks)

- **F1.** `boundaries.test.ts` tests the bare adapter import only. No case covers the `/*` pattern or the `banned` entries (dynamic `import()`), so removing either is not seen by LINT. (read; mutant not run)
- **F2.** `auth-row.mjs` checks the file's own `status`, and every case in `auth-row.test.ts` sends `passed`, so nothing covers that line. vitest exits non-zero on such a file anyway. (read; mutant not run)
- **F3.** Run one mutant per REQUIRED entry of condition 6 and record it, since the red run calls those cases green already and promises mutants in gate.md.
- **F4.** The `.fails` scan is textual: `it['fails']` or a destructured alias passes. A mistake guard; deliberate edits are condition 11.

## Five reds reproduced (single Edit changes, plain vitest, undone by Edit, tree clean after)

| Mutant | Went red |
|---|---|
| the two `better-auth/adapters/drizzle` lines deleted (`generate.mjs`) | `boundaries.test.ts`: 1 of 9, "refuses drizzleAdapter" |
| only `failed` counted as not passed (`auth-row.mjs`) | `auth-row.test.ts`: 13 of 101, the skipped, todo, pending and disabled cases |
| `DISPATCH_BASE` not passed to `evaluate` (`aggregate.mjs`) | `aggregate.test.ts`: both based-dispatch cases |
| `DB_AUTH: 'false'` in the `db` step (`ci.yml`) | `ci-workflow.test.ts`: the db step pin |
| the describe (TLS mode) match dropped (`auth-row.mjs`) | `auth-row.test.ts`: 5 of 101. The two green cases are among them, since the title then counts twice; "one TLS mode only, run twice" itself stays passing |

The first four were planted together, since each goes red in a different test file. Not reproduced: the container reds (RP's predicate and control, one-offs a and b); those stay qa-101's.
