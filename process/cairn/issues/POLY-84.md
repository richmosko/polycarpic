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
