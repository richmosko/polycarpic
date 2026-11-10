# POLY-84 ruling (architect, 2026-11-10)

Gating ruling for the RLS battery. Inputs: POLY-84 criteria, POLY-83 ruling + build (`tests/db/**`, `packages/db/sql/definers.json`, migrations 0000–0001), ARCH v1.15.3 §3.3, SECURITY v1.7 §4.2.1, §12.3, C-10, C-12–C-17, C-21. Every claim is **read** or **(unmeasured)**; nothing here was run. ARCH v1.15.4 carries the doc-level parts.

M1 fact that shapes everything: the chain has **no tenant table**. Its relations are the four BetterAuth tables and `drizzle.__drizzle_migrations`, all exempt. So every catalog check passes vacuously on the real chain, and **each check gets a canary that makes it fail**. A check without a canary is not done.

## R1. Per-table probe: catalog only in M1; behaviour is proven on canaries

- The generated per-table probe is a **catalog** probe. It does not attempt a cross-tenant SELECT per table: that needs a seeding convention (tenant column, NOT NULL columns, FKs) that lands with POLY-62 (entity + membership), not here.
- The behavioural property — a policy built on `app.current_user_id()` hides another tenant's rows — is proven once, on canary tables (R4). Each tenant table's own cross-tenant assertion is added by the feature that creates it (the issue body already says so). POLY-62 decides the seeding helper; Open item 1.
- One query defines the probe: `pg_temp.battery_gaps(exempt text[]) RETURNS TABLE (rel regclass, reason text)`, created at the top of the pgTAP file inside its transaction. The real-catalog assertion and every canary call the **same** function, so the canaries prove the query that guards the chain.
- Scope: `pg_class` outside `pg_catalog`, `information_schema`, `pg_toast`, **and `relpersistence <> 't'`**. Temporary relations are session-private, never shared across tenants, and no poly_* role holds TEMP (R6 asserts it). Without this, pgTAP's own `__tcache__` temp tables fail the probe (read: pgTAP creates them at `plan()`/`no_plan()`; unmeasured here). Nothing else is excluded — no extension-member exclusion for tables.
- Reasons, one row per gap: relkind `r`/`p` not exempt → `rls_disabled`, `not_forced`, `no_policy` (C-13 "at least one policy"), `for_all_policy` (any `pg_policy.polcmd = '*'`, C-14), `no_truncate_trigger` (no enabled statement-level BEFORE TRUNCATE trigger; ARCH §6.1: "POLY-84 checks TRUNCATE triggers on every table"); relkind `m` → `matview`, `f` → `foreign_table` unless exempt; relkind `v` → `view_not_security_invoker` (reloptions lacks `security_invoker=true`/`on`), excluding extension members by `pg_depend deptype = 'e'` — the same precedent `01_roles.sql` uses for functions (pgTAP ships views; read, unmeasured). Assertion on the real chain: zero rows.
- "No matview over tenant data" (C-16) is the `matview` reason: in M1 no matview is legal at all. Nothing extra.

## R2. The exemption list

- One `text[]` literal at the top of `tests/db/pgtap/02_rls_catalog.sql`, a comment above it citing C-13 and "adding an entry needs SecEng review of the diff". Exact M1 contents, in quoted-identifier form so `to_regclass` resolves them:
  `public."user"`, `public.session`, `public.account`, `public.verification`, `drizzle.__drizzle_migrations`.
- `twoFactor` and `passkey` are **not** listed until their migrations land (POLY-86): a listed-but-absent entry fails R2's existence check by design.
- Existence check: one assertion per entry, `ok(to_regclass(e) IS NOT NULL, 'exemption exists: ' || e)`. Comparison in the probe is by oid (`c.oid = ANY (SELECT to_regclass(e) …)`), never by name match.

## R3. File layout and canaries

| File | Holds |
|---|---|
| `tests/db/pgtap/02_rls_catalog.sql` (new) | `battery_gaps`, R2 list + existence, real-chain zero-gaps, catalog canaries |
| `tests/db/pgtap/03_role_hygiene.sql` (new) | R6 |
| `tests/db/battery.test.ts` (new, vitest) | R4 inversion, C-12 pool reuse, WITH CHECK forgery — anything that must run *as a login role* |
| `tests/db/matrix.test.ts` (new, vitest) | R5 |
| `tests/db/pgtap.test.ts` (extend) | R7 definer allowlist |

- **Why behaviour is in vitest:** pgTAP writes its results to superuser-owned temp tables, so its assertion functions cannot run after `SET LOCAL ROLE poly_app`, and poly_app has no TEMP (unmeasured; follows from R1 of POLY-83). Behavioural probes connect as the real login role (`psql(..., { role })` or the `packages/db` wrappers) and assert in vitest. pgTAP files stay superuser-only catalog reads.
- **Catalog canaries** (02): created inside the file's `BEGIN … ROLLBACK`, which is what drops them; no file sees another's canaries. Required canaries and their exact expected gap set: RLS on, not forced → `{not_forced}`; RLS off → `{rls_disabled, …}` contains `rls_disabled`; a canary passed in an extended exempt array → no rows; a fully compliant canary (ENABLE + FORCE + one SELECT policy + BEFORE TRUNCATE trigger) → no rows (the positive control); a FOR ALL policy → `for_all_policy`; a matview → `matview`; a view without `security_invoker` → `view_not_security_invoker`. Foreign table: skip (needs an FDW; not worth an extension in M1).
- **Behavioural canaries** (battery.test.ts): one fresh db, real migrations, then as superuser `public.qa_canary_open` (no RLS) and `public.qa_canary_rls` (ENABLE + FORCE, owner `poly_owner`, per-command policies on `owner_user_id = app.current_user_id()`: SELECT USING, INSERT WITH CHECK, UPDATE USING + WITH CHECK), granted SELECT/INSERT/UPDATE to `poly_app`, seeded with one row for A and one for B. The db is disposable, so no explicit DROP.

## R4. Behavioural probes (battery.test.ts)

- **Inversion:** as poly_app with A's context, `qa_canary_open` returns B's row (the leak is asserted, `> 0`), and `qa_canary_rls` returns zero B rows. One helper, `crossTenantRows(db, table, as, other)`, does both — features reuse it.
- **C-12 pool reuse:** through the real `withTenant` / `withContextFreeTx` on one `configure`d pool. Read `pg_backend_pid()` in each transaction and **assert it equal** — a precondition that fails, never skips (pg-pool reuses the idle client LIFO; read, unmeasured). Sequence: A sees its 1 row; B on the same pid sees zero A rows; `withContextFreeTx` on the same pid sees zero rows and raises nothing. Repeat once with A's callback throwing, so the dirty backend is one that rolled back.
- **WITH CHECK forgery:** as poly_app with A's context, INSERT a row owned by B → SQLSTATE `42501`; UPDATE A's row to owner B → `42501`. FOR ALL refusal is catalog (R1), not behaviour.

## R5. Permission matrix as data

- Data file: `packages/tenancy/permission-matrix.json` (C-17 says the matrix lives in `packages/tenancy`; the endpoint matrix will read the same file). **Needs `paths:` widened** — lead.
- Shape, one object per §4.2.1 row, all rows transcribed now: `{ "id": "kebab-id", "action": "<row text>", "tables": ["schema.table", …], "cells": { "viewer": c, "manager": c, "owner": c }, "probe": null, "note": "…" }`; `c` ∈ `allow | deny | own`. Step-up, co-owner approval and rate limits are not DB facts: they go in `note`, and the cell records the DB answer. Rows with no DB enforcement (e.g. last-4) carry `"tables": []` and `"db": false`.
- **Activation:** a row is active when `db !== false` and every table in `tables` resolves by `to_regclass`. Active with `probe: null` → **fail** ("table landed without its matrix probe"). Inactive rows are counted and printed, not failed. In M1 every row is inactive.
- `probe` shape is fixed by POLY-62 with its fixture (entity + three members). M1 builds: the shape validator (ids unique, cells complete, values legal), `activeRows`, and a canary: a row whose table is `public.qa_canary_rls` with `probe: null` fails activation.
- "pgTAP" in the criterion reads as SECURITY §4.2.1 means it: an SQL assertion run as `poly_app` that bypasses the app layer. A vitest driver over psql satisfies that; the `definers.json` test is the precedent. seceng to concur.

## R6. Role hygiene additions (03_role_hygiene.sql)

Only what `01_roles.sql` lacks: the seven C-10 roles own no `pg_class` row (poly_owner owns tables by design); login roles `poly_app`, `poly_worker`, `poly_migrator`, `poly_backup` hold no TRUNCATE, REFERENCES or TRIGGER on any relation outside `pg_catalog`/`information_schema`; none of the twelve holds TEMP on the database; the installed extensions are exactly `{plpgsql, pgtap}` (pgtap is harness-only), so the extension-member exclusion in R1 cannot hide anything else.

## R7. Definer allowlist (C-15): extend POLY-83's test, don't duplicate it

- Stays in `pgtap.test.ts`. Factor its catalog query into a helper `definerGaps(db, allow, setupSql = '')` that runs `BEGIN; <setupSql>; <query>; ROLLBACK` and returns problems.
- Add: owner ∈ `DEFINER_OWNERS`, imported from `packages/db/src/migrations-check.ts` (one source; a JSON entry naming `poly_owner` fails); PUBLIC holds no EXECUTE (already asserted for all functions in 01 — do not re-assert).
- Canaries through `setupSql`: an unlisted SECURITY DEFINER function → reported; a definer owned by `poly_owner` → reported.
- Trigger functions: in 02, every user function with `prorettype = 'trigger'::regtype` (not an extension member) gets `throws_ok(format('SELECT %s()', oid::regproc), '0A000')`; plus a canary trigger function. M1 has none on the chain.

## R8. Doc changes

- ARCH v1.15.4 (this commit): §3.3 Proof states R1's scope (temporary relations out, the gap reasons), that the probe is catalog-only and per-table behaviour belongs to each table's feature.
- SECURITY (seceng): C-13 gains the temporary-relation exclusion (R1) — it narrows "every relation outside …"; seceng to concur and edit. No change to C-17's location.
- No packages/db change is expected (unmeasured). If the builder needs one, backend-lead-84 makes it.

## Open (not gating)

1. Tenant seeding helper and the matrix `probe` shape: POLY-62.
2. Drift between §4.2.1 and the JSON is caught by review only; a row-count tie to the SECURITY HTML is brittle and not built.
