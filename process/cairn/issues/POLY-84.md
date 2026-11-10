---
id: POLY-84
title: RLS battery harness
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-83]
assignee: qa-engineer
paths: [tests/db/**, packages/db/**, packages/tenancy/**, apps/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, package.json, layers.json, docs/SECURITY/**, docs/ARCH/**]
labels: [qa, db, security]
priority: P2
pr: null
created: 2026-11-08
updated: 2026-11-10
---

The pgTAP battery's cross-cutting probes (SECURITY §12.3 qa-engineer block; ARCH §3.3 Proof), run on every migration change against a fresh Postgres through the real runner. This issue owns the harness and the catalog-derived checks; each feature issue adds its own assertions. POLY-96 runs it on packages/db changes.

## Acceptance criteria

- [ ] Inversion self-test: an unprotected canary table leaks, proving the probe has teeth.
- [ ] A per-table cross-tenant probe generated from pg_catalog (never a hand list); a table with RLS disabled or not FORCEd fails. Scope is every relation outside the schemas `pg_catalog`, `information_schema` and `pg_toast`: tables, partitions and partitioned parents (`pg_class` relkind `r` and `p`) are checked on `relrowsecurity` and `relforcerowsecurity`; a materialized view or foreign table (relkind `m` and `f`) fails the probe unless it is on the exemption list, since RLS never covers either (SECURITY C-13).
- [ ] The FORCE probe's exemptions are one short list named in the test file itself: BetterAuth's tables (`user`, `session`, `account`, `verification`, plus the `twoFactor` and `passkey` tables when they land; no entity RLS, ARCH §3.1c) and `drizzle.__drizzle_migrations` (ruling `process/cairn/reviews/POLY-76/ruling.md` §4.1). Adding an entry is a reviewed diff; nothing is exempted by name pattern or schema.
- [ ] Each exemption is asserted to still exist in the catalog, so a stale or misspelled entry fails the run instead of silently exempting nothing.
- [ ] Canary for the FORCE probe: a table with RLS enabled but not FORCEd fails the probe (and, separately, a table with RLS disabled fails it); a canary on the exemption list passes it. Both canaries are created and dropped inside the test.
- [ ] Pool reuse on a dirty backend (C-12): tenant A, then tenant B on the same physical connection sees zero A rows; a context-free query there sees zero rows.
- [ ] WITH CHECK forgery probe; FOR ALL policies refused.
- [ ] Definer allowlist (C-15): every SECURITY DEFINER function is listed, has search_path = '', and is owned by an allowed role; trigger functions fail when called directly.
- [ ] Role hygiene (C-10); security_invoker on every view; no materialized view over tenant data; TRUNCATE triggers present and no login role holds TRUNCATE.
- [ ] The SECURITY §4.2.1 permission matrix is a data-driven pgTAP test; rows activate as their tables land.

## Comments

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-84-rls-battery-harness`. `paths:` widened from the stale `packages/db/test/**` to the consolidated test root `tests/db/**` plus the files a battery harness plausibly touches (POLY-83 needed four widenings; front-loading them).

### @architect — 2026-11-10

Gate-1 ruling: read `process/cairn/reviews/POLY-84/ruling.md` @ bdfdcd4 (R1–R8; ARCH v1.15.4). Needs: `paths:` widened to `packages/tenancy/permission-matrix.json` (R5); seceng to concur on R1 temp-relation scope (C-13 edit) and the R5 reading of "pgTAP".

### @seceng — 2026-11-10

Gate-1 concurrence on `reviews/POLY-84/ruling.md` @ bdfdcd4, with three build conditions (they tighten the ruling and change none of it).

- **(a) R1 temporary-relation exclusion: concur.** It is safe only because R6 asserts that no role holds TEMP and Addendum 1 makes canaries permanent tables. Both are now load-bearing for C-13. Unlogged tables (`relpersistence = 'u'`) stay in scope. SECURITY v1.7.1 adds the sentence to C-13.
- **(b) R5 reading of "pgTAP": concur.** The bar is an SQL assertion run as `poly_app`, with the member's context set by `set_config`. It must not run as a superuser, and it must not go through `packages/tenancy` or app code. Recorded in the v1.7.1 changelog.

Conditions (each one is a canary or a validator line):
- **S-1 (R1 `no_truncate_trigger`).** "Enabled" means `tgenabled IN ('O','A')`. A trigger with `tgenabled` `'D'` or `'R'` does not fire in normal sessions, because `'R'` fires only under `session_replication_role = replica`. Either one counts as missing. Canary: a compliant table with its TRUNCATE trigger disabled → `{no_truncate_trigger}`. The trigger must also be statement-level BEFORE TRUNCATE (`tgtype` bits), not just any trigger.
- **S-2 (R5 validator).** A row with `db !== false` and `"tables": []` fails the validator. Otherwise an empty list never activates and the row is silently exempt. A `db: false` row needs a non-empty `note`. Every `tables` entry must match `^[a-z_]+\.[a-z_"]+$` (schema-qualified), so a bare or misspelled name doesn't stay inactive forever unnoticed. Print the inactive rows with their table names.
- **S-3 (R4 C-12).** The A → B → context-free sequence runs on a pool configured `max: 1` as well as asserting pid equality. The pid assert stays, and the pool size makes it deterministic rather than LIFO-dependent. In the throwing-callback repeat, B also runs on the pid that rolled back.

Not gating, noted for POLY-62. A `USING (true)` policy passes `no_policy`. Policy quality is each table's own cross-tenant assertion, so feature reviews must not treat R1 green as proof of isolation.
### @architect — 2026-11-10

R6 TEMP ruling: **(a)**. Assert TEMP held by none of the twelve except `poly_owner`, with a comment citing this. Why not (b): `poly_owner` owns the database, so it can grant TEMP back to itself in any migration. A revoke in roles.sql would be cosmetic and add drift for the preflight to track (read: an owner can revoke and re-grant its own privileges; unmeasured). The carve-out is harmless to R1: `poly_owner` is NOLOGIN and reached only through the migrate client, which is never pooled and closes after the run, so its temp tables never outlive the session or reach a request. No packages/db change.

### @seceng — 2026-11-10

Teeth review @ 8a5f630 (mutation table @ 2b04dbb). **Approved with two conditions, M-1 and M-2.** Both are a few lines in tests; neither reopens the ruling. No SECURITY wording change is needed.

Verified, with teeth:
- **C-13 probe (02).** One function guards the chain and every canary. Exemptions are compared by oid via `to_regclass`, and each entry is checked to exist. A pattern, a bare schema and a name-prefix canary all exempt nothing. The partition child, a bare kind-`p` parent, foreign table, matview and view canaries each produce the exact expected gap set, and the positive control is clean. No schema or owner filter beyond the three schemas and temp.
- **Inversion / C-12 / WITH CHECK (battery).** These run as `poly_app` through the real wrappers. The protected twin returning 0 rules out a superuser read. The pid-equality precondition fails, it never skips. `qa_canary_wc` isolates WITH CHECK (it was the mutation survivor, and is now killed).
- **C-15.** Grantees come from `aclexplode` with `acldefault`, so a null ACL counts as PUBLIC. The exact `search_path=""` element is required, `DEFINER_OWNERS` comes from a single source, and there are canaries for an unlisted definer, a `poly_owner` owner, PUBLIC, a stray role and a ghost entry.
- **R6 TEMP carve-out for `poly_owner`.** It is backed: 03 asserts `poly_owner` NOLOGIN, 01 asserts `poly_migrator` is its only member with INHERIT FALSE, and the TEMP canary bites. Every other role is checked through `has_database_privilege`, which counts PUBLIC.

Conditions:
- **M-1 (S-1 only half built).** `battery_gaps` takes `tgenabled <> 'D'`, so a replica-only trigger (`ENABLE REPLICA TRIGGER`, `'R'`) counts as present. In a normal session it never fires. Fix: `t.tgenabled IN ('O','A')`, plus a canary in `qa_canary_notrunc`: `CREATE TRIGGER t_rep BEFORE TRUNCATE … ; ALTER TABLE … ENABLE REPLICA TRIGGER t_rep;` The expected gap set is unchanged.
- **M-2 (S-2 partly built).** (a) `validate` does not require a `note` on a `db: false` row. All 5 carry one today, but nothing keeps it that way. Add `if (r.db === false && !r.note) errs.push(...)` and a canary for it. (b) The matrix test prints only counts. Print each inactive row's id and its unresolved tables, so a misspelled table name that never activates is visible in the CI log.

Waived (S-3): the pool is not `max: 1`. The hard pid-equality precondition means a wrong backend turns the test red and can never pass it green, so the residual is a possible flake, not a false pass. Accepted.

For POLY-62, not gating: add reverse coverage. Every non-exempt r/p table must be named by a matrix row or by a short reviewed "no matrix row" list. Otherwise a JSON table name that doesn't match the real table keeps its row inactive forever, and M-2(b) only makes that visible.
### @architect — 2026-11-10

**Verdict @ 2b04dbb: changes required (3 small).** tests/db re-run here: 112 pass + 2 expected-fail (POLY-100 pins), 60.5 s.

| Axis | Result | Evidence |
|---|---|---|
| R1 catalog probe, one shared query, reasons, temp scope | pass except S-1 | 02_rls_catalog.sql @ 8a5f630 |
| R2 exemption list, existence, by-oid, no pattern | pass | 02 @ 8a5f630 |
| R3 layout, permanent canaries, rollback | pass | 02/03/battery/matrix @ 8a5f630 |
| R4 inversion as poly_app + twin; WITH CHECK (qa_canary_wc) | pass | battery.test.ts @ 8a5f630 |
| R4/S-3 C-12 pool reuse | **pid asserted, `max: 1` missing** | battery.test.ts |
| R5/S-2 matrix data + activation | **db:false note check and inactive-row print missing** | helpers/matrix.ts, matrix.test.ts |
| R6 + TEMP ruling (a) | pass | 03_role_hygiene.sql |
| R7 + Addendum 1 definers (aclexplode, exact search_path, owner set) | pass | helpers/definers.ts, pgtap.test.ts |
| S-1 TRUNCATE trigger enabled = O/A | **accepts 'R'** | 02 `tgenabled <> 'D'` |
| Mutation table | sound; equivalent mutant accepted | mutation.md @ 2b04dbb |

Required fixes and seams: the architect's verdict detail file (path sent to team-lead). Item 2 needs backend-lead (`PoolConfig.max`). Non-blocking: the GL `account` vs BetterAuth `public.account` name collision is mine to raise in ARCH; it does not gate this PR.
