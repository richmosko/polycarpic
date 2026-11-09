# POLY-76 ruling (architect, POLY-76c, 2026-11-09)

**CONFIRM: Drizzle Kit is the migration tool.** No flip condition failed. ARCH v1.13 §6.2 is now a decision.

Evidence base: `spike.md` (backend-lead, 50af326), qa-engineer's verdict on POLY-76a (e81f0b3, full `checks/run.mjs` exit 0), and my own read of `spikes/poly-76/` and of drizzle-orm 0.45.4's `pg-core/dialect.js` `migrate()` (read, not run). Each point says whether it is **measured** (the record), **read** (code inspection) or **proposed** (my inference, unmeasured).

## 1. Confirm or flip, per item

| item | result | evidence | ruling |
|---|---|---|---|
| (a) | PASS | spike.md Results; verdict: generate/apply/generate byte-identical, policy in `pg_policies`, sentinel emitted `CREATE POLICY` | measured |
| (b) | PASS | 4 tables created by poly_migrator (DDL log), owned poly_owner, second generate clean | measured |
| (b′) | PASS with the `fields` map | unmodified CLI schema + Kysely path: "Database schema mismatch" at startup (spike.md); with the map: sign-up/in/getSession as poly_app, 3.1c grants hold, DELETE / UPDATE id / TRUNCATE → 42501 | measured; read as **meets** the condition (below) |
| (c) | PASS | custom SQL trigger + definer applied by the real runner, all DDL `session_user = poly_migrator`, 2 tracking rows = 2 journal entries | measured |
| (d) | not run | deferred to POLY-121 (Principal) | not a flip condition |
| (e) | PASS with FORCE in custom SQL | `relforcerowsecurity` true, poly_app 2 / definer 3 / poly_owner 0, second generate clean | measured; read as **meets** the condition (below) |
| (f) | measured | hook not in the insert's transaction (user row survives a throw); our context-free tx: 1/1, 0/0, 0/0 | does not flip; see §3 |

**(b′) meets the condition.** §6.2 asked that BetterAuth's Kysely path and the Drizzle-declared tables agree on column names. They agree once configured, and BetterAuth refuses to start when they do not (measured), so drift fails closed at boot, not at the first query. The finding does not discriminate between tools: under dbmate + Kysely the same CLI-generated names meet the same Kysely lookup. A flip would buy nothing here.

**(e) meets the condition.** §6.2's (e) asked that FORCE RLS, `to:` policies and a non-owner definer "round-trip through generate and apply". All three apply as poly_migrator and the second generate is clean. FORCE has no schema representation (backend-lead: no occurrence in drizzle-kit 0.31.11), so it lives in custom SQL, exactly as it would under dbmate. What Drizzle does not give is detection of a missing FORCE; nothing in dbmate gives it either. The guard is the catalog battery (§4.1).

**Discrepancy, moot.** The lead's brief says a failed (b) or (b′) flips; ARCH v1.12.1 §6.2 says (b)/(b′)/(d) go back to the architect and Principal and only (a)/(c)/(e) flip outright. Nothing failed, so it does not matter; v1.13 drops the flip clause with the provisional status.

## 2. BetterAuth column naming: snake_case columns + a derived `fields` map

Ruling: BetterAuth's tables keep snake_case columns (as the CLI emits them). `packages/db` exports the `fields` map **derived from the Drizzle table objects** (property key → `column.name`), never hand-written; `packages/auth` passes it to BetterAuth, plugins included.

Why: every hand-written SQL object that touches these tables (the §3.1c enrolment guards, `app.sync_second_step()`, the grants, the pgTAP battery) is in snake_case with the rest of the schema. camelCase columns force quoted identifiers into that SQL, and a missing quote is a runtime 42703. That failure was observed in this very spike: qa's `check-b-prime.mjs` assumed `"providerId"` and hit `42703` (verdict, check defect 1). A derived map cannot drift from the schema, and BetterAuth's startup check catches the case where it does (proposed: a test that drops one entry and asserts refusal).

Unmeasured, carried to POLY-86: the `twoFactor` and `passkey` plugins take their renames through the plugin `schema` option; the spike covered only the four core tables.

## 3. OQ-16 / (f)

Measured: `user.create.after` runs outside the user insert's transaction on 1.7.18; wrapping sign-up in a context-free transaction of ours (routing pool, BEGIN/COMMIT → savepoints) makes sign-up plus provisioning atomic in all three cases.

What it means (read + proposed):
- On BetterAuth alone, the session-loader re-run is the guarantee, as §3.1 already says. Nothing breaks today.
- The spike's probe table had no RLS. The real `provisionPerson` writes `entity` and `membership` under FORCE RLS, and in a context-free transaction `app.user_id` is unset, so default-deny refuses those inserts. The hook must set `app.user_id` to the new user's id with `is_local = true` on the current transaction (through `packages/db`, never a session `SET`) before it calls `provisionPerson`. This is **unmeasured**; it belongs to the sign-up story (POLY-87).
- Every route that can insert a `user` row needs the wrapper, not only invitation sign-up: OAuth first sign-in and magic link may create users. Which ones do is a POLY-86 / POLY-87 fact.

**Question for the Principal (one):** run every user-creating auth route inside a context-free transaction of ours, so the Person, owner membership and seeded accounts commit with the user row, and keep the session-loader re-run as a backstop only? **Recommendation: yes.** The cost is one more connection shape (§4.6) and the `app.user_id` step above; the gain is that no user row ever exists without its Person, and the re-run stops being load-bearing. Until the Principal answers, ARCH §3.1 keeps the re-run as the guarantee.

## 4. What the real build carries

1. **FORCE RLS guard.** POLY-84's catalog-derived probe ("a table with RLS disabled or not FORCEd fails") is enough, **provided its scope is every table outside `pg_catalog` / `information_schema`** and its exemptions are a short list named in the test: BetterAuth's tables (no entity RLS, §3.1c) and `drizzle.__drizzle_migrations`. Adding an exemption is a reviewed diff. FORCE is written in the same custom migration that creates the table's policies, never batched later. (Lead/qa: POLY-84 is not mine to amend.)
2. **Ownership by `SET ROLE`.** Copy as measured. The migrate client is the one place a session-level `SET` is allowed: it is a dedicated connection closed after the run, never pooled, so the hazard the ban exists for (identity carried across pooled requests) cannot arise. `layers.json` names exactly that module as the exemption (ARCH §2.1). A custom migration that switches to `poly_authz` / `poly_purge` / another definer owner ends on `SET ROLE poly_owner` (a file check enforces it). Spike definers used `search_path = pg_catalog, public`; the real ones use `search_path = ''` (C-15).
3. **Tracking schema and grants.** The `drizzle` schema and table are created by `poly_owner` (the active role), so `poly_owner` needs CREATE on the database (it owns it) and `poly_migrator` needs none of its own. That last point is **proposed**: the harness granted both, so it is unmeasured; POLY-83 measures it. `poly_app` and `poly_worker` get USAGE on `drizzle` and SELECT on the table, nothing more, for the "schema behind image" start check.
4. **One transaction, no lock, timestamp ordering** (read from drizzle-orm 0.45.4 `migrate()`): all pending migrations run in one transaction (good: a failing file leaves the schema unchanged, which POLY-100 relies on). But the runner (i) takes no advisory lock; (ii) treats a migration as pending only if its journal `when` is later than the last applied row's `created_at`, and never compares hashes. So a migration merged with an older timestamp than one already applied is **silently skipped**, and an edited applied file goes unnoticed. With parallel feature loops this will happen. The real runner therefore: takes `pg_advisory_lock` on the migrate client before `migrate()`; refuses to run, and `migrate --plan` reports, when the tracking rows are not a hash-for-hash prefix of the journal; and CI refuses a journal whose `when` values are not strictly increasing. No `CREATE INDEX CONCURRENTLY` in migrations (one transaction).
5. **Timestamps.** Every BetterAuth timestamp column is declared `withTimezone: true` (`timestamptz`), like the rest of the schema; the CLI output is a starting point, not a frozen file. BetterAuth on `timestamptz` is **unmeasured**; POLY-86 re-runs the (b′) behaviour on it.
6. **Where the pools live** (§2.1 layer map). The migration runner is in `packages/db`. BetterAuth's plain `poly_app` pool and `withContextFreeTx` are a connection path that is neither `withTenant` nor `withSystem`, so they move into `packages/db` on a restricted subpath `db/auth`, importable only by `packages/auth` (the same pattern as `db/session`). The routing-pool shim stays in `packages/auth` and takes its pool and Kysely dialect from `db/auth`, so `auth` imports no driver. The spike's `routing-pool.mjs` nesting guard is a counter only; the real one serialises concurrent `connect()` (already on POLY-86).
7. **Copy list, agreed:** custom migrations via `generate --custom`; triggers, functions, grants (column-level included) as custom SQL. **Do-not-copy list, agreed**, plus: the spike grants `UPDATE (… created_at …)` on `"user"`; the real grant follows §3.1c's column list exactly.

## 5. Versions

- **Pin in ARCH (measured):** drizzle-orm 0.45.4, drizzle-kit 0.31.11, exact, stable line. The 1.0 release candidate is not adopted; moving to 1.0 is its own issue gated on POLY-84's battery and a clean second `generate` (its migration folder format may differ; unmeasured). better-auth stays at 1.7.18 (already pinned).
- **Postgres:** ARCH names the **major, 17** (measured here; POLY-62 ran on 14). The image tag and minor are INFRA's.
- **INFRA gap (devops, do not edit here):** INFRA names no Postgres version anywhere (searched). It should name the Postgres 17 image and minor for prod, CI and the backup container, and say who bumps it.

## 6. Consequences (amended on the issue files)

- **POLY-83:** + runner takes an advisory lock and refuses when tracking rows are not a hash prefix of the journal; + CI refuses a non-monotonic journal; + `drizzle` schema owned by poly_owner, poly_migrator holds no database CREATE, poly_app/poly_worker USAGE + SELECT only; + session `SET ROLE` only in the migrate module, custom files end on `SET ROLE poly_owner`; + `db/auth` exports the plain pool and `withContextFreeTx`, and the derived `fields` map.
- **POLY-86:** + BetterAuth (plugins included) takes the derived map and starts with no schema mismatch as poly_app; a dropped map entry makes it refuse; + `timestamptz` columns pass sign-up, sign-in, getSession; + routing pool takes pool and dialect from `db/auth`.
- **POLY-100:** + a failing migration file leaves the tracking table and schema unchanged (one transaction); + two concurrent migrate runs: the second waits on the lock and applies nothing.
- **Not mine to edit:** POLY-84 (battery scope + exemption list, §4.1); POLY-87 (`app.user_id` step inside the context-free sign-up, §3, pending the Principal); POLY-82 / `layers.json` (`db/auth` subpath, migrate-module SET exemption).

## 7. SECURITY / INFRA passages to change (not edited)

- SECURITY §4.1 / A-31 (the routing pool "outside, it falls back to a plain pool"): the plain pool and the context-free transaction now come from `db/auth`; SecEng to concur, as it is a connection path with no user context.
- SECURITY §12.3 (qa battery list): the FORCE probe's scope and named exemptions (§4.1 above).
- SECURITY's ban on session-level `SET`, wherever it is stated with the lint rule: the one migrate-module exemption (§4.2).
- INFRA: the Postgres version gap (§5); provisioning (`provision.sh`) gives poly_owner the database and does not grant poly_migrator database CREATE (§4.3, once POLY-83 measures it).
