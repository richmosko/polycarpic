# POLY-62 ruling (architect, 2026-11-11)

Gating ruling for the tenancy core. Inputs: POLY-62 criteria and its comments, POLY-84 ruling (R1–R7, Open 1) and its tree (`tests/db/**`, `packages/tenancy/permission-matrix.json`), POLY-85 ruling Open 1 and 3, POLY-90/89/91/86/87 scopes, ARCH 1.15.8 §3.1 and §3.3, SECURITY §4.2.1, C-13–C-20, C-84. Every claim is **read**, **measured** (with its command) or tagged **(unmeasured)**. ARCH 1.15.8 (this commit) carries the doc-level parts; this file is the build contract.

## R1. Seam: who writes what

- **`packages/db/src/schema/tenancy.ts`** declares the tables, columns, constraints and indexes, and `.enableRLS()`. `drizzle-kit generate` writes **`0002_tenancy_tables.sql`**. Policies are **not** declared in Drizzle: they reference functions that need the tables first, so they cannot sit in the generated file.
- **`0003_tenancy_rules.sql`** (`generate --custom`, hand-written, the 0001 pattern) holds functions, triggers, `FORCE ROW LEVEL SECURITY`, policies and grants. Definer owners get `CREATE ON SCHEMA app` for the file only, as in 0001.
- **`packages/db/src/index.ts`** re-exports `sql` from `drizzle-orm` (one line). `packages/tenancy` runs SQL through `tx.execute(sql\`…\`)` and adds no dependency, so `pnpm-lock.yaml` does not change.
- **`@poly/tenancy`** exports `provisionPerson(tx: Tx): Promise<{ personId: string; created: boolean }>`, the `TaxClassification` type, and the value list. It takes no user id: it acts for `app.current_user_id()` of the transaction it is given. A call with no user set rejects (the trigger's 42501).

## R2. Tables (all PKs `uuid DEFAULT gen_random_uuid()`, owned by `poly_owner`)

| Table | Columns (beyond `id`, `created_at timestamptz NOT NULL DEFAULT now()`) |
|---|---|
| `entity_type` | `name text NOT NULL`, `kind text NOT NULL CHECK (kind IN ('base','parent'))`, `system_key text UNIQUE CHECK (system_key IN ('person','trust','business','household','holding'))`, `owner_user_id uuid REFERENCES public."user"(id)`, `CHECK ((system_key IS NULL) = (owner_user_id IS NOT NULL))`. 0003 seeds the five system rows (person, trust, business: base; household, holding: parent). |
| `entity` | `type_id uuid REFERENCES entity_type`, `name text`, `tax_classification text`, `self_user_id uuid UNIQUE REFERENCES public."user"(id)`, `purged_at timestamptz`, `CHECK ((purged_at IS NULL) = (name IS NOT NULL AND type_id IS NOT NULL AND tax_classification IS NOT NULL))`. The three columns are nullable only so the tombstone (ARCH §3.4b) needs no later constraint change. |
| `membership` | `entity_id uuid NOT NULL REFERENCES entity`, `user_id uuid NOT NULL REFERENCES public."user"(id)`, `role text NOT NULL CHECK (role IN ('viewer','manager','owner'))`, `UNIQUE (entity_id, user_id)`, index on `user_id`. `pending_*` columns are POLY-91's. |
| `invitation` | `entity_id uuid REFERENCES entity` (null = operator invite), `email text NOT NULL`, `role text NOT NULL` (same CHECK), `inviter_user_id uuid REFERENCES public."user"(id)`, `token_hash bytea NOT NULL UNIQUE`, `expires_at timestamptz NOT NULL`, `accepted_at`, `revoked_at timestamptz`. `issued_via` is POLY-90's. |
| `notification` | `entity_id uuid REFERENCES entity`, `recipient_user_id uuid NOT NULL REFERENCES public."user"(id)`, `kind text NOT NULL`, `payload jsonb NOT NULL DEFAULT '{}'`, `read_at timestamptz`. |
| `audit_event` | `entity_id uuid REFERENCES entity` (nullable: operator events), `actor_user_id uuid`, `actor text NOT NULL` (`coalesce(app.actor GUC, 'user')`), `kind text NOT NULL` (dotted, e.g. `membership.created`), `subject_user_id uuid`, `payload jsonb NOT NULL DEFAULT '{}'`. No FK has `ON DELETE CASCADE`: entity rows are never deleted, and audit rows sit outside the purge. |

- **Tax classification.** The values and defaults are those in ARCH §3.1. A BEFORE INSERT OR UPDATE trigger `app.check_tax_classification()` (invoker) fills the default when the value is null (Person `individual`, parent kind `parent_pass_through`; a Trust, Business or user-defined base type must supply one, or the insert fails `23514`). It refuses a value outside the entity's kind, and outside the system type's family (`trust_*`, `business_*`), with `23514`. `self_user_id` not null requires `system_key = 'person'`, enforced in the same trigger.

## R3. Functions (`packages/db/sql/definers.json` gains every definer row below)

| Function | Kind | Owner | EXECUTE |
|---|---|---|---|
| `app.has_role(uuid, text) → boolean` | STABLE SECURITY DEFINER, `SET search_path = ''` | `poly_authz` | `poly_app`, `poly_worker` |
| `app.visible_entities() → uuid[]` | same | `poly_authz` | `poly_app`, `poly_worker` |
| `app.owner_count(uuid) → int` | same; **null** when the caller holds no membership on the entity | `poly_authz` | `poly_app`, `poly_worker` |
| `app.seat_creator()` | trigger, AFTER INSERT ON entity, SECURITY DEFINER | `poly_govern` | none |
| `app.audit_membership()` | trigger, AFTER INSERT/UPDATE/DELETE ON membership, SECURITY DEFINER | `poly_govern` | none |
| `app.keep_an_owner()` | trigger, BEFORE UPDATE OR DELETE ON membership, invoker | — | — |
| `app.check_tax_classification()`, `app.refuse_change()`, `app.refuse_truncate()` | triggers, invoker | — | — |

- `has_role` ranks viewer < manager < owner. All three read `membership` through `FOR SELECT TO poly_authz USING (true)`. Trigger functions need no EXECUTE grant at fire time (unmeasured; the builder measures it, and if it is wrong, the grant goes to the firing roles and into the JSON).
- `seat_creator` raises `42501` when `app.current_user_id()` is null; otherwise inserts `(NEW.id, current user, 'owner')` through `FOR INSERT TO poly_govern WITH CHECK (user_id = app.current_user_id() AND role = 'owner')`. This is the one write of a first membership. It is why criterion 1 holds without a poly_app policy that lets a non-member seat themselves (a purged entity with no members would otherwise be claimable).
- `keep_an_owner`: if OLD.role = 'owner' and (DELETE, or NEW.role <> 'owner'), it takes `SELECT … FROM entity WHERE id = OLD.entity_id FOR UPDATE`, then refuses with `23514` when `app.owner_count` is 1 **or null**. The lock serialises two owners demoting each other (unmeasured: the builder's test runs the two demotions on two connections and asserts that one fails). POLY-90's 1 → 2 path takes the same row lock.
- `audit_membership` writes `membership.created | membership.role_changed | membership.removed` through `FOR INSERT TO poly_govern WITH CHECK (true)` on `audit_event`.
- `refuse_change` (BEFORE UPDATE OR DELETE on `audit_event`) and `refuse_truncate` (BEFORE TRUNCATE, statement, on all six tables, POLY-84 R1) raise `42501`.

## R4. Policies and grants (poly_app; per command, never FOR ALL; context only through `app.current_user_id()`)

| Table | Grants | Policies |
|---|---|---|
| `entity` | SELECT, INSERT, UPDATE (name, tax_classification) | SELECT `id = any ((select app.visible_entities()))`; INSERT WITH CHECK `app.current_user_id() IS NOT NULL AND (self_user_id IS NULL OR self_user_id = app.current_user_id())`; UPDATE USING/CHECK `app.has_role(id,'owner')` |
| `membership` | SELECT, INSERT, UPDATE (role), DELETE | SELECT `user_id = app.current_user_id() OR app.has_role(entity_id,'manager')`; INSERT, UPDATE, DELETE `app.has_role(entity_id,'owner')` |
| `invitation` | SELECT, INSERT, UPDATE (revoked_at) | SELECT/UPDATE `app.has_role(entity_id,'owner')`; INSERT CHECK the same `AND inviter_user_id = app.current_user_id()`. `entity_id IS NULL` rows pass no policy (POLY-87 adds the operator path). |
| `notification` | SELECT, UPDATE (read_at) | SELECT/UPDATE `recipient_user_id = app.current_user_id()` |
| `audit_event` | SELECT | SELECT `app.has_role(entity_id,'owner') OR actor_user_id = app.current_user_id()` |
| `entity_type` | SELECT, INSERT | SELECT `owner_user_id IS NULL OR owner_user_id = app.current_user_id() OR id IN (SELECT type_id FROM public.entity)` (entity's own policy filters the subquery); INSERT CHECK `system_key IS NULL AND owner_user_id = app.current_user_id()` |

- poly_worker gets SELECT on all six, with the same SELECT policies `TO poly_app, poly_worker`. No UPDATE or DELETE for the worker. No role gets DELETE on entity, invitation, notification or audit_event.
- The provisioning insert does not use `RETURNING`: the new row's SELECT policy is checked against a snapshot that cannot see the AFTER trigger's membership (unmeasured). `provisionPerson` reads the id back in a second statement. If the builder measures that RETURNING passes, it may use it.

## R5. Criterion 1: the session loader stays out of this loop

`apps/web/src/**` is outside `paths:`, and the SvelteKit scaffold is POLY-128's. The call site belongs to the session loader in `packages/auth`, which POLY-86 builds (its root-layout session projection). Criterion 1 is amended in place: this loop proves `provisionPerson` (idempotent, and the trigger guarantees an owner). POLY-86 owns the loader's call and its test. The lead adds that criterion to POLY-86.

## R6. Permission matrix: the `probe` shape (POLY-84 Open 1) and activation

- **Fixture** `seedTenancy(db)` in `tests/db/helpers/tenancy.ts`. As superuser it inserts users O, M, V and X into `public."user"`; all other writes go through the real `withTenant` as poly_app. O inserts entity E (the trigger seats O). O inserts M as manager and V as viewer, and one invitation on E. X runs `provisionPerson`, giving X its own Person F. Every probed table has at least one E row (notification is seeded as superuser for O, M and V). It returns `{ users: {owner, manager, viewer, outsider}, entity: E, otherEntity: F }`. A seed step that fails is a failing test, never a skip.
- **Shape**: `"probe": [ { "op": "select"|"insert"|"update"|"delete", "table": "schema.table", "sql": "…", "ownSql"?: "…" } ]`. Placeholders `:entity :other_entity :actor :owner :manager :viewer :outsider` are bound positionally by the driver. Each actor runs in `withTenant` inside a transaction that is always rolled back.
- **Outcomes**: for select, allow means every superuser-counted E row of that table (count > 0 is a precondition); own means exactly the actor's own rows; deny means 0. For writes, allow means no error and rowCount ≥ 1; deny means `42501`, `23514` or rowCount 0. `own` needs `ownSql`: `ownSql` must allow and `sql` must deny. **The outsider is a fourth actor on every probe and must be deny**, so every active row is also a cross-tenant check. A row's `tables` must each be named by at least one probe entry (validator).
- **`requires`** (new optional field, a list of `schema.function` names): a row is active only when its tables and its required functions all exist. `founder-transfer` gets `["app.transfer_founder"]` (POLY-90) and `co-owner-remove-demote` gets `["app.apply_change"]` (POLY-112), because their DB answer is the definer path, not today's direct write.
- **Active after this loop**, pinned by id in `matrix.test.ts`: `read-membership-list`, `entity-metadata`, `membership-invite-raise`, `member-remove-demote-self`, `audit-event-read`. Probes are transcribed into the JSON for exactly these five.
- **Rename**: `public.account` in `read-books` and `chart-rules-edit` becomes `public.ledger_account`. BetterAuth owns `public.account`, which is exempt, and ARCH 1.15.8 names the chart table `ledger_account`.

## R7. Reverse coverage and catalog additions

- **Reverse coverage** (`matrix.test.ts`). Every relation in POLY-84 R1's scope must be in at least one of three places: some row's `tables`, the R2 exemption list (read from `02_rls_catalog.sql`'s literal), or a new top-level `"unlisted": [{ "table", "reason" }]` in the JSON. Each `unlisted` and exemption entry must resolve. **A matrix table that is on the exemption list fails.** Initial `unlisted`: `public.notification` (recipient-scoped, not role-scoped) and `public.entity_type` (type metadata, ARCH §3.1). Canaries: an uncovered table is reported, and a stale `unlisted` entry is reported.
- **`battery_gaps` gains three reasons**, each with a canary in 02:
  - `pk_not_uuid`: a primary-key column that is not `uuid` (C-18).
  - `raw_context_read`: `pg_get_expr` of a policy's qual or check contains `current_setting` (criterion 4: the nullif form only through `app.current_user_id()`).
  - `tenancy_column_updatable`: poly_app or poly_worker holds column UPDATE on `id`, `entity_id`, `user_id`, `self_user_id`, `owner_user_id`, `recipient_user_id`, `actor_user_id`, `inviter_user_id`, `created_at` or `type_id` (criterion 3).
- **Definer facts**: R7 of POLY-84 covers owner, grants and search_path from the JSON. Add `provolatile = 's'` for the three authz functions (criterion 4).

## R8. Behaviour tests and their guard

- **`tests/db/tenancy.test.ts`** (new; one `freshDb` and one `seedTenancy` per file; in-process wrappers; no CLI spawn beyond the one `migrateCli`).
  - Cross-tenant: X against E, through `crossTenantRows` (POLY-84 R4), on all six tables. `crossTenantRows` gains an optional `keys: { own, other }` (default `as`/`other`) so it can filter entity-keyed tables. Each assertion needs `otherRows` 0 and `ownRows` > 0.
  - provisionPerson: twice gives one Person and one owner membership; no user set rejects with 42501.
  - Tax: defaults, the refusals, and the owner-only update.
  - Owners: the last-owner refusal (23514); the concurrent mutual demotion; an owner lowering their own role while a second owner exists is allowed.
  - Writes: a manager's membership insert is refused.
  - Append-only: `audit_event` UPDATE as poly_app (42501) and as superuser (the trigger's 42501); a notification UPDATE of anything other than `read_at` (42501); invitation `accepted_at` (42501).
- **`packages/tenancy/src/index.test.ts`**: the value list and the kind map. No DB.
- **Measured (db job, run 42953687382, step and vitest timings via `gh run view --log`)**: the battery step took 130 s of the 146 s job. vitest reported 128.49 s, and its file lines sum to 114.0 s. `runner` (42.9), `ops-status` (34.1), `checks` (17.0) and `ops-hardening` (11.1) together are 105.1 s; `battery`, `matrix`, `pgtap` and `wrappers` are 1.8–2.9 s each. The global setup (image build plus container start) is therefore ≤ 14.5 s. POLY-102 A-1's suspect is not the cost; the CLI-spawning files are.
- **Guard**: this loop's db-file growth is ≤ +15 s of vitest file time on CI, so the job stays ≤ ~165 s. qa reports the per-file lines at tests-red and the implementation lead at build-green. The budget in `infra/ci/budgets.json` warns and never fails (`job-report.mjs` always exits 0), so **no `ci.yml` change in this loop**. Over +15 s is a measured objection that reopens this ruling once.

## R9. POLY-85 carry-overs

- **Open 1 (loaded `Secret` to the pool): deferred.** It changes `packages/db/src/connection.ts`/`pool.ts` and the web and worker startup in `apps/*/src`. Nothing in tenancy depends on it, and `apps/web/src` is contested with POLY-128. It attaches to the next issue that edits `connection.ts`; the lead places it.
- **Open 3 (`jobs` in the status payload): stays with the first worker-job feature.** No job runs here, and `app.job_targets` keeps its empty body.

## Files outside `paths:` today

None. Everything above sits under `packages/db/**`, `packages/tenancy/**`, `tests/**` and `docs/ARCH/**`.

## Open (not gating)

1. SECURITY wording (seceng to concur): C-20's bootstrap exception (`seat_creator` is the one first-membership write); `owner_count` returns null to non-members; the two `unlisted` tables; C-17's `requires` field.
2. The ledger feature extends `provisionPerson` with the seeded accounts named in ARCH §3.1. Nothing seeds them here, because `ledger_account` does not exist yet.
