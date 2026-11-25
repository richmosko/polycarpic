# POLY-101 red run (qa-101, 2026-11-25)

Tests commit: 00d73ebd. Red tree: a916c56c plus those test files (no build); run before ee0eeda0 was pulled.

## tests/ci

`pnpm exec vitest run -c tests/ci/vitest.config.ts` on `auth-row`, `aggregate`, `changes`, `ci-workflow`, `db-areas`: **106 failed, 366 passed**.

| Failing tests | Reason shown |
|---|---|
| `auth-row.test.ts` (V3, `.fails`, fails-closed, `ROWS`) | `infra/ci/auth-row.mjs does not exist` (the two table cases: module not found, ENOENT) |
| `changes`: `.pnpmfile.cjs`, `.pnpmfile.mjs`, `patches/…` path cases; the two B5 area cases | `node=false layers=false`; every db area false |
| `db-areas` C25: `infra/ci/auth-row.mjs` | does not set `db` |
| `aggregate`: based dispatch; any non-empty base | exit 0, expected non-zero |
| `ci-workflow`: lint step, db step, distinct reports | "exactly one `auth-row.mjs lint/db` step": 0 found |
| `ci-workflow`: `DISPATCH_BASE` | `undefined` |

## LINT

`pnpm exec vitest run packages/auth/src/boundaries.test.ts`: 1 failed, 8 passed. The new `@better-auth/drizzle-adapter` case: the rule returned no message.

## Green already at the red run, so each is shown red by a mutant (gate.md)

The three aggregate "job skipped with its key true" cases, the empty-base control, the path cases for the paths the filter already covered,
the manifest walk, the root-anchor case, the `lint` job's `if:`, and the no-actor pin.

RP's changes (shared predicate, `METHOD path` literal, control) test behaviour that exists today, so they cannot be red without a fault.
They need Postgres; their reds are the mutants in the container run (gate.md).

## First slice

On ee0eeda0 + 00d73ebd the same five files gave 466 passed, 6 failed: only the pending RP and POOL floors and the two control titles in `ROWS`.

## Counts used for floors

`vitest list -c tests/db/vitest.config.ts` (collection only, no container): RP 26, POOL 19. LINT 9 (8 before B4's case). The container run confirms them.
