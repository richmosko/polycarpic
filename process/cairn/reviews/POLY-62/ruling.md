# POLY-62 ruling (architect, 2026-11-11)

Gating ruling for the tenancy core, re-issued whole on seceng-62's objection batch (O1–O4 accepted, N1–N4 folded in). Inputs: POLY-62 criteria and its comments, POLY-84 ruling (R1–R7, Open 1) and its tree (`tests/db/**`, `packages/tenancy/permission-matrix.json`), POLY-85 ruling Open 1 and 3, POLY-90/89/91/86/87 scopes, ARCH 1.15.8 §3.1 and §3.3, SECURITY §4.2.1, C-13–C-20, C-84. Every claim is **read**, **measured** (with its command) or tagged **(unmeasured)**. ARCH 1.15.8 (this commit) carries the doc-level parts; this file is the build contract.

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
| `audit_event` | `entity_id uuid REFERENCES entity` (nullable: operator events), `actor_user_id uuid`, `actor text NOT NULL` (`coalesce(app.actor GUC, 'user')`), `kind text NOT NULL` (dotted, e.g. `membership.created`), `subject_user_id uuid`, `payload jsonb NOT NULL DEFAULT '{}'`. `actor` is `coalesce(nullif(app.actor GUC, ''), CASE WHEN app.current_user_id() IS NULL THEN 'none' ELSE 'user' END)`. No FK has `ON DELETE CASCADE`: entity rows are never deleted, and audit rows sit outside the purge. |

- **`app.check_entity()`**: a BEFORE INSERT OR UPDATE trigger on `entity`, SECURITY DEFINER owned by `poly_authz`. It reads `entity_type` through `FOR SELECT TO poly_authz USING (true)`, and `poly_authz` gets SELECT on `entity_type`. On INSERT:
  - It refuses a `type_id` that is neither a system type nor one the caller owns (`42501`, O3 secondary). Types are not shareable by use.
  - It refuses `self_user_id` not null unless `system_key = 'person'` (`23514`).
  - Tax classification (values and defaults per ARCH §3.1): it fills the default when the value is null (Person `individual`, parent kind `parent_pass_through`). A Trust, a Business or a user-defined base type must supply one, or the insert fails `23514`. It refuses a value outside the entity's kind, or outside the system type's family (`trust_*`, `business_*`), with `23514`. The value check runs on UPDATE too.

## R3. Functions (`packages/db/sql/definers.json` gains every definer row below)

| Function | Kind | Owner | EXECUTE |
|---|---|---|---|
| `app.has_role(uuid, text) → boolean` | STABLE SECURITY DEFINER, `SET search_path = ''` | `poly_authz` | `poly_app`, `poly_worker` |
| `app.visible_entities() → uuid[]` | same | `poly_authz` | `poly_app`, `poly_worker` |
| `app.owner_count(uuid) → int` | same; **null** when the caller holds no membership on the entity | `poly_authz` | `poly_app`, `poly_worker` |
| `app.seat_creator()` | trigger, AFTER INSERT ON entity, SECURITY DEFINER | `poly_govern` | none |
| `app.audit_membership()` | trigger, AFTER INSERT/UPDATE/DELETE ON membership, SECURITY DEFINER | `poly_govern` | none |
| `app.check_entity()` | trigger, BEFORE INSERT OR UPDATE ON entity, SECURITY DEFINER | `poly_authz` | none |
| `app.gate_owner_changes()` | trigger, BEFORE UPDATE OR DELETE ON membership and BEFORE INSERT ON invitation, invoker | — | — |
| `app.keep_an_owner()` | trigger, BEFORE UPDATE OR DELETE ON membership, invoker | — | — |
| `app.refuse_change()`, `app.refuse_truncate()` | triggers, invoker | — | — |

- `has_role` ranks viewer < manager < owner. All three read `membership` through `FOR SELECT TO poly_authz USING (true)`. Trigger functions need no EXECUTE grant at fire time (unmeasured; the builder measures it, and if it is wrong, the grant goes to the firing roles and into the JSON).
- `seat_creator` raises `42501` when `app.current_user_id()` is null; otherwise inserts `(NEW.id, current user, 'owner')` through `FOR INSERT TO poly_govern WITH CHECK (user_id = app.current_user_id() AND role = 'owner')`. This is the one write of a first membership. It is why criterion 1 holds without a poly_app policy that lets a non-member seat themselves (a purged entity with no members would otherwise be claimable).
- **The entity lock.** Both membership guards take `SELECT … FROM entity WHERE id = <entity_id> FOR UPDATE` first, so the count they read is serialised. **No row returned means `42501`; they never continue unlocked** (N3). Each guard is VOLATILE and reads `app.owner_count` in a statement after the lock (N3). POLY-90's 1 → 2 path takes the same lock.
- **`gate_owner_changes`** (§4.2.2 direct writes, C-28; O1) acts only when `current_user = 'poly_app'`. After the lock, when `app.owner_count` is not 1 (**null included**), it refuses with `42501`:
  - any invitation INSERT;
  - a membership UPDATE that raises the role (rank NEW > rank OLD);
  - a membership UPDATE or DELETE of another owner's row (OLD.role = 'owner' AND OLD.user_id <> current user).

  It still allows removing or demoting a viewer or manager, lowering or giving up one's own role, and revoking an invitation. Until POLY-90 and POLY-112 land, a multi-owner entity cannot change its owners, which is the intended fail-closed state. This is POLY-90's first criterion, landing here.
- **`keep_an_owner`**: if OLD.role = 'owner' and (DELETE, or NEW.role <> 'owner'), after the lock it refuses with `23514` when `app.owner_count` is 1 **or null** (unmeasured: the test runs two mutual demotions on two connections and asserts that one fails). Trigger order is alphabetical, so the gate fires first.
- `audit_membership` writes `membership.created | membership.role_changed | membership.removed` through `FOR INSERT TO poly_govern WITH CHECK (true)` on `audit_event`.
- `refuse_change` (BEFORE UPDATE OR DELETE on `audit_event`) and `refuse_truncate` (BEFORE TRUNCATE, statement, on all six tables, POLY-84 R1) raise `42501`.

## R4. Policies and grants (poly_app; per command, never FOR ALL; context only through `app.current_user_id()`)

| Table | Grants | Policies |
|---|---|---|
| `entity` | SELECT; INSERT (type_id, name, tax_classification, self_user_id); UPDATE (name, tax_classification) | SELECT `id = any ((select app.visible_entities()))`; INSERT WITH CHECK `app.current_user_id() IS NOT NULL AND (self_user_id IS NULL OR self_user_id = app.current_user_id())`; UPDATE USING/CHECK `app.has_role(id,'owner')` |
| `membership` | SELECT; UPDATE (role); DELETE; **no INSERT** (O2) | SELECT `user_id = app.current_user_id() OR app.has_role(entity_id,'manager')`; UPDATE, DELETE `app.has_role(entity_id,'owner')` |
| `invitation` | SELECT (every column except token_hash); INSERT (entity_id, email, role, inviter_user_id, token_hash, expires_at); UPDATE (revoked_at) | SELECT/UPDATE `app.has_role(entity_id,'owner')`; INSERT CHECK the same `AND inviter_user_id = app.current_user_id()`. `entity_id IS NULL` rows pass no policy (POLY-87 adds the operator path). |
| `notification` | SELECT, UPDATE (read_at) | SELECT/UPDATE `recipient_user_id = app.current_user_id()` |
| `audit_event` | SELECT | SELECT `app.has_role(entity_id,'owner') OR actor_user_id = app.current_user_id()` |
| `entity_type` | SELECT (id, name, kind, system_key, created_at; **never owner_user_id**, O3, R-9); INSERT (name, kind, owner_user_id) | SELECT `owner_user_id IS NULL OR owner_user_id = app.current_user_id() OR id IN (SELECT type_id FROM public.entity)` (entity's own policy filters the subquery; a policy predicate needs no column privilege, unmeasured, and the test confirms it); INSERT CHECK `system_key IS NULL AND owner_user_id = app.current_user_id()` |

- **Membership is written only by definers.** `seat_creator` writes the creator's row. Later, the invitation-accept definer (POLY-87 with POLY-90) seats `app.current_user_id()` against a live invitation, after the second step for manager or owner. A direct insert would bypass the invitee's consent and the second-step gate.
- poly_worker gets SELECT on all six, with the same SELECT policies `TO poly_app, poly_worker` and the same column limits. No UPDATE or DELETE for the worker. No role gets DELETE on entity, invitation, notification or audit_event.
- The provisioning insert does not use `RETURNING`: the new row's SELECT policy is checked against a snapshot that cannot see the AFTER trigger's membership (unmeasured). `provisionPerson` reads the id back in a second statement. If the builder measures that RETURNING passes, it may use it.

## R5. Criterion 1: the session loader stays out of this loop

`apps/web/src/**` is outside `paths:`, and the SvelteKit scaffold is POLY-128's. The call site belongs to the session loader in `packages/auth`, which POLY-86 builds (its root-layout session projection). Criterion 1 is amended in place: this loop proves `provisionPerson` (idempotent, and the trigger guarantees an owner). POLY-86 owns the loader's call and its test. The lead adds that criterion to POLY-86.

## R6. Permission matrix: the `probe` shape (POLY-84 Open 1) and activation

- **Fixture `seedTenancy(db)`** in `tests/db/helpers/tenancy.ts`:
  - As superuser, it inserts users O, M, V and X into `public."user"`.
  - O inserts entity E through the real `withTenant` as poly_app; the trigger seats O.
  - M (manager) and V (viewer) are seated **as superuser**, since poly_app has no membership INSERT. Their audit rows carry actor `none`, and the fixture asserts them.
  - O inserts one invitation on E as poly_app.
  - X runs `provisionPerson`, giving X its own Person F.
  - Every probed table has at least one E row. Notification rows are seeded as superuser for O, M and V.
  - It returns `{ users: {owner, manager, viewer, outsider}, entity: E, otherEntity: F }`.
  - A failed seed step is a failing test, never a skip.
- **Shape**: `"probe": [ { "op": "select"|"insert"|"update"|"delete", "table": "schema.table", "sql": "…", "ownSql"?: "…", "actors"?: [...], "requires"?: [...] } ]`.
  - The driver binds the placeholders `:entity :other_entity :actor :owner :manager :viewer :outsider` positionally.
  - Each actor runs in `withTenant`, inside a transaction that is always rolled back.
  - `actors` limits an entry to a subset of `viewer|manager|owner|outsider` (default: all four).
- **Outcomes**:
  - **Select**: allow means the actor sees every E row of that table that the superuser counts (count > 0 is a precondition); own means exactly the actor's own rows; deny means 0.
  - **Writes**: allow means no error and rowCount ≥ 1; deny means `42501`, `23514` or rowCount 0.
  - **own** needs `ownSql`: `ownSql` must allow and `sql` must deny.
  - **The outsider is an actor on every probe and must be deny**, so every active row is also a cross-tenant check.
  - Validator: each table in a row's `tables` is named by at least one probe entry.
- **`requires`**, at two levels (N2):
  - **Row level**: the row is active only when its tables and its required functions exist. `founder-transfer` gets `["app.transfer_founder"]` (POLY-90): its column does not exist yet, so no probe can be written.
  - **Entry level**: the entry runs only when its functions exist, and the row's other entries still run.
  - **An active row with no runnable entry fails** ("active and empty").
- **`co-owner-remove-demote` is active now** (O1).
  - Its viewer, manager and outsider entries run: DELETE and demote of O's row → deny.
  - Its owner entry has `requires: ["app.apply_change"]` (POLY-112).
- **`membership-invite-raise`** (O2):
  - Invitation INSERT for all four actors.
  - Membership raise of V with `actors: [viewer, manager, outsider]` → deny.
  - The owner raise entry has `requires: ["app.hold_unenrolled_role"]` (POLY-91), because a held raise changes its answer.
- **Active after this loop** (pinned by equality in `matrix.test.ts`, so a row cannot quietly go inactive):
  - `read-membership-list`, `entity-metadata`, `membership-invite-raise`
  - `member-remove-demote-self`, `co-owner-remove-demote`, `audit-event-read`
- **Harness canary** (N1): in a rolled-back transaction, as superuser, `CREATE POLICY canary ON membership FOR SELECT TO poly_app USING (true)`. Then the `read-membership-list` outsider probe must report allow, so the driver fails. This proves the matrix can fail.
- **Rename**: `public.account` in `read-books` and `chart-rules-edit` becomes `public.ledger_account`. BetterAuth owns `public.account`, which is exempt, and ARCH 1.15.8 names the chart table `ledger_account`.

## R7. Reverse coverage and catalog additions

- **Reverse coverage** (`matrix.test.ts`). Every relation in POLY-84 R1's scope must be in at least one of three places: some row's `tables`, the R2 exemption list (read from `02_rls_catalog.sql`'s literal), or a new top-level `"unlisted": [{ "table", "reason" }]` in the JSON. Each `unlisted` and exemption entry must resolve. **A matrix table that is on the exemption list fails.** Initial `unlisted`: `public.notification` (recipient-scoped, not role-scoped) and `public.entity_type` (type metadata, ARCH §3.1). Canaries: an uncovered table is reported, and a stale `unlisted` entry is reported.
- **The reverse-coverage check names `tenancy.test.ts`'s per-table cross-tenant test as the cover for the `unlisted` tables** (N4).
- **`battery_gaps` gains five reasons**, each with a canary in 02:
  - `pk_not_uuid`: a primary-key column that is not `uuid` (C-18).
  - `raw_context_read`: `pg_get_expr` of a policy's qual or check contains `current_setting`. This is criterion 4: the nullif form is reached only through `app.current_user_id()`.
  - `column_grant_not_allowlisted` (O4; replaces a denylist): any column INSERT or UPDATE privilege that poly_app or poly_worker holds on an in-scope table must be in a literal allowlist in 02. A table-level grant counts as every column. The allowlist:
    - UPDATE: `entity.name`, `entity.tax_classification`, `membership.role`, `invitation.revoked_at`, `notification.read_at`.
    - INSERT: R4's column lists.

    This covers criterion 3, and catches the next table's tenancy column with no list to remember.
  - `policy_public` (N1): a policy whose `polroles` contains 0 (PUBLIC).
  - `policy_trivial_for_app` (N1): a policy that applies to poly_app or poly_worker whose qual or with_check is the constant `true`.
- **Definer facts**: R7 of POLY-84 covers owner, grants and search_path from the JSON. Add `provolatile = 's'` for the three authz functions (criterion 4).

## R8. Behaviour tests and their guard

- **`tests/db/tenancy.test.ts`** (new; one `freshDb` and one `seedTenancy` per file; in-process wrappers; no CLI spawn beyond the one `migrateCli`).
  - Cross-tenant: X against E, through `crossTenantRows` (POLY-84 R4), on all six tables. `crossTenantRows` gains an optional `keys: { own, other }` (default `as`/`other`) so it can filter entity-keyed tables. Each assertion needs `otherRows` 0 and `ownRows` > 0.
  - provisionPerson: twice gives one Person and one owner membership; no user set rejects with 42501.
  - Tax: defaults, the refusals, and the owner-only update.
  - Owners: the last-owner refusal (23514); the concurrent mutual demotion on a two-owner entity (one fails).
  - The multi-owner gate (O1). This uses a two-owner fixture: O2 is seated as superuser.
    - Refused with 42501: O deletes O2; O demotes O2; O raises V; O inserts an invitation.
    - Allowed: O removes V; O lowers its own role.
  - Writes: poly_app membership INSERT is refused with 42501, for an owner too (O2). An entity of another user's custom type is refused (42501). A viewer selecting `entity_type.owner_user_id` is refused with 42501 (O3). poly_app selecting `invitation.token_hash` is refused with 42501.
  - Append-only: `audit_event` UPDATE as poly_app (42501) and as superuser (the trigger's 42501); a notification UPDATE of anything other than `read_at` (42501); invitation `accepted_at` (42501); entity INSERT supplying `purged_at` or `created_at` (42501).
  - entity_type's cross-tenant assertion keys on `id`, not `owner_user_id`, which poly_app cannot read.
- **`packages/tenancy/src/index.test.ts`**: the value list and the kind map. No DB.
- **Measured (db job, run 42953687382, step and vitest timings via `gh run view --log`)**: the battery step took 130 s of the 146 s job. vitest reported 128.49 s, and its file lines sum to 114.0 s. `runner` (42.9), `ops-status` (34.1), `checks` (17.0) and `ops-hardening` (11.1) together are 105.1 s; `battery`, `matrix`, `pgtap` and `wrappers` are 1.8–2.9 s each. The global setup (image build plus container start) is therefore ≤ 14.5 s. POLY-102 A-1's suspect is not the cost; the CLI-spawning files are.
- **Guard**: this loop's db-file growth is ≤ +15 s of vitest file time on CI, so the job stays ≤ ~165 s. qa reports the per-file lines at tests-red and the implementation lead at build-green. The budget in `infra/ci/budgets.json` warns and never fails (`job-report.mjs` always exits 0), so **no `ci.yml` change in this loop**. Over +15 s is a measured objection that reopens this ruling once.

## R9. POLY-85 carry-overs

- **Open 1 (loaded `Secret` to the pool): deferred.** It changes `packages/db/src/connection.ts`/`pool.ts` and the web and worker startup in `apps/*/src`. Nothing in tenancy depends on it, and `apps/web/src` is contested with POLY-128. It attaches to the next issue that edits `connection.ts`; the lead places it.
- **Open 3 (`jobs` in the status payload): stays with the first worker-job feature.** No job runs here, and `app.job_targets` keeps its empty body.

## Files outside `paths:` today

None. Everything above sits under `packages/db/**`, `packages/tenancy/**`, `tests/**` and `docs/ARCH/**`.

## Open (not gating)

1. SECURITY wording (seceng, N1–N4): C-20's bootstrap exception; `owner_count` null to non-members, refused by every consumer; the `unlisted` tables; the two-level `requires`; the audit actor read; R-9 label-only type read; poly_app holds no membership INSERT.
2. The ledger feature extends `provisionPerson` with the seeded accounts named in ARCH §3.1. Nothing seeds them here, because `ledger_account` does not exist yet.

## Addendum 1 (2026-11-11): gate scope and trigger order (seceng-62, non-gating, accepted)

- **The gate is default-deny.** `gate_owner_changes` applies to every `current_user` except two: the named definer roles (`poly_govern`, `poly_purge`) and a superuser (`rolsuper`, so the test fixture can seat members). It no longer applies only to `current_user = 'poly_app'`, so a future login role that inherits poly_app cannot skip it. Where ARCH and SECURITY say "for poly_app", they describe the effect today.
- **Trigger order is set by trigger names**, not function names:
  - on `membership`: `membership_10_gate_owner_changes`, `membership_20_keep_an_owner`, and `membership_90_audit` (AFTER);
  - on `invitation`: `invitation_10_gate_owner_changes`.

  Add one assertion on `pg_trigger` for the BEFORE triggers' `tgname` order. The tests-red commit 3caa90d predates this addendum, so qa adds the assertion.
