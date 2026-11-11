# POLY-102 — gate 1 ruling (architect)

Re-issued whole on seceng-102's review of `ee9dcf6` (`.claude/worktrees/seceng-102/temp/2026-11-11-seceng-poly102-ruling-review.md`): B1, B2 and A1–A5 accepted. Base: `d2f8c0c`. Inputs: the issue file (criteria and the lead's scope comment), qa-engineer-102's db profile (`.claude/worktrees/qa-engineer-102/temp/2026-11-10-qa-engineer-102-db-profile.md`, one local run), seceng-102's pre-ruling notes (`.claude/worktrees/seceng-102/temp/2026-11-11-seceng-poly102-preruling.md`). Out of scope, decided: CodeQL, A-2, A-3.

## R1. What is generated and committed today (read at d2f8c0c)

| Output | Generator | Reaches the image? | Disposition |
|---|---|---|---|
| `packages/db/migrations/**` (SQL, `meta/_journal.json`, `meta/*_snapshot.json`) | `drizzle-kit generate` from `packages/db/src/schema` | **Yes** (Dockerfile `COPY . .`; not in `.dockerignore`) | Registered, `regenerate` mode, runs in CI |
| `scripts/cairn/dashboard/dist/` | `npm run build` | No (`scripts` ignored) | Built-in pair, `ancestry` mode, `/finish-feature` only |
| `apps/web/src/app.css` token block, `scripts/cairn/board/tokens.css` | copies of `docs/DESIGN/tokens.css` | web: yes | Already content-checked (`apps/web/src/tokens.test.ts`, `test_board_tokens_parity.py`); not registered |
| `docs/*/*.pdf` | headless Chrome | No (`*.pdf` ignored) | Not registered: not byte-reproducible, not in the bundle |
| ESLint layer config | `scripts/layers/generate.mjs` | — | Generated at run time, never committed; nothing to check |

**No ops-bundle manifest exists.** `infra/` holds only `infra/ci/`; there is no compose file or Caddyfile. The ops bundle arrives with POLY-88/POLY-100, and the OpenAPI spec with the first `/api/v1` feature. The rule that covers them: **a feature that commits a generated file registers its pair in `infra/ci/generated.json` in the same PR**; that feature's verdict checks it (ARCH §8, "Generated-output freshness").

**Ancestry is the wrong predicate for migrations (measured).** In an isolated copy of `packages/db`: add a column to `src/schema/tenancy.ts` without generating, then `drizzle-kit generate --custom --name x` writes `meta/0004_snapshot.json` *without* the column; a following plain `generate` still emits `0005_*.sql`. A commit of the custom migration is a later commit touching `migrations/` than the schema edit, so ancestry says fresh while the schema change never ships (T-91). The check is content: regenerate and compare.

## R2. The seam

**Script.** `scripts/cairn/check_dist_freshness.py` stays the one entry point. Extract a pair-generic core; the dashboard becomes the built-in pair `dashboard-dist` (its current constants, unchanged). `check_dist_freshness(repo_root)` and the no-flag CLI keep their exact current contract and exit codes, so `/finish-feature` and the existing PT-58 tests do not change.

**Registry.** `infra/ci/generated.json`, project pairs only (the built-in is never repeated there; a registry name equal to a built-in is an error):

```json
{"pairs": [{"name": "db-migrations", "mode": "regenerate", "root": "packages/db", "output": "migrations",
  "link": ["node_modules"], "skip": [".turbo"], "command": ["./node_modules/.bin/drizzle-kit", "generate"],
  "timeout": 120, "ci": true}]}
```

Keys: `name`, `mode` (`regenerate` | `ancestry`), `root`, `output` (relative to root), `link` (entries symlinked to their real absolute path, not copied: pnpm's per-package `node_modules` holds relative links that dangle in a copy), `skip` (not copied), `command` (argv, run with cwd = the copy), `timeout` (s), `ci` (bool); `ancestry` pairs add `exclude` (noise list, the PT-58 inverse form). Any other key, a missing key, or a bad type is a registry error.

**Modes.**
- `regenerate`: copy `root` (minus `skip`, `link` symlinked) into a tmp dir outside the repo; run `command` there with stdin `/dev/null` and a minimal env (`PATH`, `HOME`, `LANG`, `TMPDIR` only: no token, no `DATABASE_*`), so a drizzle-kit rename prompt exits at once rather than at the timeout; fresh iff the copy's `output` tree is byte-identical to the committed one (files only-in-one count). The tree is never written; the tmp dir is removed. History is not read, so same-second, cross-timezone and shallow clones cannot matter. Measured: `drizzle-kit generate` with the real `drizzle.config.ts` in such a copy, `node_modules` linked, at d2f8c0c: "No schema changes", output identical, 0.39 s; with one added column: new SQL, new snapshot, journal differs.
- What `regenerate` proves for migrations: **the schema matches the latest snapshot**, so no schema change is left ungenerated. It does not prove that committed SQL bytes are what drizzle-kit would emit, since generate never rewrites an existing file; a hand edit to a generated, not-yet-applied migration is left to review and the RLS battery.
- `ancestry`: the existing PT-58 algorithm with its rebuild fallback, generalised over `root`/`output`/`exclude`/`command`.
- Both: uncommitted or untracked changes under `root` are `uncommitted-src-changes` (stale).

**CLI.** `check_dist_freshness.py [--pair NAME]... [--ci] [--all] [repo_root]`. No flag: dashboard only, current behaviour. `--pair` (repeatable), `--ci` (every pair with `ci: true`), `--all`. One line per pair: `<name>: <reason>: <message>`. In flag mode the check **fails closed**:

| Exit | When |
|---|---|
| 0 | every selected pair is fresh |
| 1 | any pair stale: `stale`, `dist-never-built`, `uncommitted-src-changes` |
| 2 | the check could not run: registry missing (with `--ci`) or invalid; unknown pair name; a registered `root` missing; git unavailable; `ancestry` pair on a shallow clone (`git rev-parse --is-shallow-repository` = true); generator absent, non-zero, or past its timeout; tmp copy failure; `--ci` selecting zero pairs |

Exit 2 outranks 1. Flag mode never maps `no-dashboard` or `git-unavailable` to fresh.

## R3. Where it runs

`ci.yml`, `lint` job, new step **"Generated-output freshness"** directly after "ESLint and migration check", `if: node == 'true' || image == 'true' || ci == 'true'`, `run: python3 scripts/cairn/check_dist_freshness.py --ci`. `lint` already installs the workspace (drizzle-kit present), checks out with `fetch-depth: 0`, and feeds `app`. Every input and output of `db-migrations` is under `packages/` (sets `node`); the registry is under `infra/ci/` (sets `ci`). Cost ≈ 0.5 s against `lint`'s 120 s (measured locally, above). No `build.yml` copy: `main` takes no direct push, admins included, and requires `app` in strict mode, so the attested build only sees a tree that passed this step. The dashboard pair stays `ci: false`: it never reaches the image, and its fallback needs the dashboard's own npm tree, which no CI job installs.

## R4. The `db` job headroom

**30 s confirmed.** POLY-62 alone added 14 s (146 → 160 s); 30 s holds about two such features plus the measured ±4 s run-to-run noise on `runner`. **Budget stays 180 s; the cost is cut.** The criterion: the `db` job of a full-battery CI run finishes at **≤ 150 s**, on **two** runs of the build-green head.

The cuts, from qa's profile (local seconds, [CI ≈ × 1.29, projection `(unmeasured)`]):
1. **Required: one migrated template per file.** `ops-status`, `ops-hardening` and the `checks` startup-guard cases build one database per file in `beforeAll` (freshDb + real-chain migrate) and clone it per test with `CREATE DATABASE x TEMPLATE t`. One shared helper replaces the three `migrated()` copies. ~25 s [~32 s].
2. **Required: `freshDb()` 6 execs → 2.** Role passwords set once in global setup; CREATE DATABASE and bootstrap in one psql session. The builder confirms by test that `bootstrap.sql`/`roles.sql` never reset a password. ~8 s [~10 s].
3. **Allowed:** runner's lock test polls `pg_stat_activity` for the apply backend's advisory-lock wait instead of a fixed 3 s sleep (stronger evidence), `pg_sleep(4)` → 1.5 s. Crash preload timer 2500 → 500 ms.
4. **Not allowed:** file parallelism (runner GRANTs and REVOKEs cluster-global roles, and every migrate CLI run preflights those roles); deleting, skipping or merging a case; a fake timer for the ops-hardening hard timeout; runner cases that stop spawning the real `apps/migrate` CLI. `checks` keeps its `pnpm --filter` spawns (cut 5 deferred: it changes what 37 cases exercise).

Guards for cut 1: a template clone does not copy the database owner, database ACLs or per-database settings. The clone is made `OWNER` the same role and re-runs the database-level part of bootstrap, and one test asserts that a clone and a freshly migrated database agree on `pg_database.datdba`, `datacl`, the database's `pg_db_role_setting` rows, the owner of every schema, and the `drizzle.__drizzle_migrations` rows. Cut 3 asserts the apply backend was seen waiting on the lock (`wait_event_type = 'Lock'`, `wait_event = 'advisory'`), not merely present. Case count: the `it` count of `tests/db` at the build-green head is ≥ the count at d2f8c0c (both counts recorded in the build-green commit).

## R5. Filter table (amends POLY-96 ruling §2)

Rule: **every path a job executes or imports, transitively, triggers that job.**

| output | added |
|---|---|
| `image` | `infra/ci/image.sh`, `infra/ci/install-trivy.sh`, `.trivyignore`, `tests/layers/tsc/package.json` (it enters the image context) |
| `db` | `packages/config/**`, `packages/tenancy/**`, `apps/migrate/**`, `apps/web/src/ops/**`, `apps/web/src/main.ts`, `tests/log/**`, `pnpm-lock.yaml` (closes POLY-96 O2) |

`infra/ci/**` keeps setting `ci`. The existing `changes.test.ts` case `pnpm-lock.yaml → [node]` flips to `[node, db]` on purpose. New static test in `tests/ci`: the import closure, followed transitively from `tests/db/**/*.ts` and from each spawned entrypoint (`apps/migrate/src/cli.ts`, `apps/web/src/main.ts`, `apps/web/src/ops/*`), through relative specifiers and `@poly/*` specifiers resolved via each workspace `package.json` `exports`, reaches only files the `db` filter matches. At `d2f8c0c` the closure reaches `@poly/config` (and `/log`) and `@poly/db` (`/migrate`, `/startup`) besides the relative paths. The data files read with `join(ROOT|DB_PKG, …)` (`packages/tenancy/permission-matrix.json`, `packages/db/sql/*`) are explicit `changes.test.ts` cases.

**Registry pin.** One `tests/ci` case asserts `infra/ci/generated.json` holds `db-migrations` with `mode: regenerate`, `ci: true`, `root: packages/db`, `output: migrations`; removing the pair or switching it off goes red.

## R6. `paths:` widening

Add `docs/ARCH/index.html` (the §8 row, architect). Everything else the build touches is already listed.

## R7. Pre-registered verdict checklist (gate 4, against the frozen build-green sha)

| # | Axis | Pass when |
|---|---|---|
| V1 | Stale fails, regenerate passes | Python fixtures (fake generator, both modes) go 1 then 0; one `tests/ci` case on the real drizzle-kit in a tmp repo: schema edit → 1, the R1 `--custom` sequence → 1, after `generate` → 0 |
| V2 | Doc-only never flips | fixture: fresh, then a doc-only commit, still 0 (both modes) |
| V3 | Same-second, cross-timezone | the PT-58 fixtures pass for an `ancestry` pair through the generic core |
| V4 | Fail closed | one test per exit-2 row of R2, a prompting generator among them exits 2 well inside its timeout; the tree's `git status` is unchanged after every run, and the linked `node_modules` is unchanged (file list and mtimes) after a real-generator run |
| V5 | Old contract | the existing `test_dist_freshness.py` passes unchanged |
| V6 | CI wiring | the step exists with the R3 `if:`; `ci-workflow.test.ts` asserts it; a real run log shows `db-migrations: fresh` |
| V7 | `db` headroom | two full-battery CI runs, `db` job ≤ 150 s each; the clone-equivalence test passes; `it` count ≥ base |
| V8 | Filter | every R5 row is a `changes.test.ts` case with its mutation; the closure test fails when a `db` pattern (`packages/config/**` among them) is removed |
| V10 | Registry pin | the pin case fails when `db-migrations` is removed, set `ci: false`, or set `mode: ancestry` |
| V9 | Suites | each touched suite's time delta reported; no new top-level CI job |

## Addendum 1 — stray committed files under an add-only generator (on 53dae72)

R2's "files only-in-one count" is true of the comparator, not of the check: the copy starts from the committed `output`, so for a generator that only adds (drizzle-kit never deletes or rewrites) a committed-only file is in both trees and passes. **The limit is accepted.** It is inside A2's predicate (the schema matches the latest snapshot) and is a statement of what `regenerate` proves, not a gap in it.
- Why it is acceptable: the migrator applies only journal entries (`readMigrationFiles` iterates `meta/_journal.json` and opens `<tag>.sql`), so a stray `.sql` or snapshot outside the journal never runs. `check-migrations` still scans every `.sql` in the folder for the role and `RESET` hazards. A journal entry whose file is missing fails at migrate, and the battery applies the real chain on every `db` run.
- What nothing catches today: a stray file outside the journal, which is inert at runtime but misleading in review. A journal ↔ file bijection in `checkFolder` (every `.sql` and `meta/*_snapshot.json` has its journal entry and the reverse) would close it. That is `packages/db/src/migrations-check.ts`, outside this issue's paths: **routed to the lead as a follow-up, non-gating.**
- Tests: qa's full-rewrite fake generator stands, as it exercises the comparator's only-in-committed branch. Add one fixture pinning the stated limit: an add-only fake generator with a committed-only stray file reports `fresh`, with a comment naming this addendum.
- R2 is read with "for a generator that only adds, files only in the committed output are not seen". ARCH §8 does not overstate this and is unchanged.
