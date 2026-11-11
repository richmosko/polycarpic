---
id: POLY-62
title: Entity + membership schema
status: done
milestone: POLY-M1
parent: null
blocked_by: [POLY-83]
assignee: backend-lead
paths: [packages/tenancy/**, packages/db/**, tests/**, layers.json, eslint.config.js, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, package.json, docs/ARCH/**, docs/SECURITY/**, process/cairn/issues/POLY-62.md, process/cairn/reviews/POLY-62/**]
labels: [tenancy, db]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/109
created: 2026-09-27
updated: 2026-11-10
---

PRD §4 Story 1 (foundational); ARCH §3.1. The tenancy core: entity, entity_type (base and parent kinds, user-defined types), membership (role in force), invitation (row shape), the poly_authz functions app.has_role, app.visible_entities and app.owner_count, the permission matrix as data (SECURITY §4.2.1), and the notification and audit_event tables, which move here from POLY-64 because the M1 triggers write them. Every user owns a default Person from sign-up through provisionPerson. Each entity carries a settable tax classification. Split out (2026-11-08 decomposition): roll-up link POLY-94, multi-owner gate and founder POLY-90, second step POLY-89, held raise POLY-91, cap table POLY-93, BetterAuth POLY-86.

## Acceptance criteria

- [x] A new user has a Person with an owner membership: provisionPerson is idempotent, and an entity never commits without an owner. The session loader that re-runs it, so that no signed-in user is ever without one, is wired and tested by POLY-86. — tests/db/tenancy.test.ts: "provisionPerson twice gives one Person with self_user_id set and one owner membership", "with no user set it rejects with 42501", and "the last owner can neither be demoted nor removed"
- [x] A tax classification can be set per entity: individual; trust grantor / non-grantor; business pass-through / C-corp; for a parent, joint filers or pass-through to members (default for a new Household and Holding). — tests/db/tenancy.test.ts: "a Household and a Holding default to parent_pass_through...", "a value outside the type's family is refused (23514) and one inside it is accepted", "only an owner may change the classification"
- [x] entity.self_user_id (unique, nullable) marks the own Person; entity.purged_at exists for the tombstone; tenancy and actor columns are not updatable; keys are UUIDs. — tests/db/tenancy.test.ts: "purged_at is all-or-nothing", "tenancy and actor columns are not updatable by poly_app"; tests/db/pgtap/04_tenancy.sql: "entity.self_user_id is unique", "six uuid primary keys", "entity.purged_at exists"; 02_rls_catalog.sql: pk_not_uuid, column_grant_not_allowlisted
- [x] app.has_role / app.visible_entities / app.owner_count are STABLE SECURITY DEFINER owned by poly_authz, reading membership through a role-targeted policy; policies use the nullif context form. — tests/db/pgtap/04_tenancy.sql: "STABLE, SECURITY DEFINER, poly_authz, search_path pinned", "membership has a SELECT policy TO poly_authz alone"; tests/db/tenancy.test.ts: "has_role ranks viewer < manager < owner", "owner_count answers members and is null to a non-member"; 02_rls_catalog.sql: raw_context_read
- [x] notification (insert-only except read_at) and audit_event (append-only, outside the purge cascade, owners-only read) exist under RLS. — tests/db/tenancy.test.ts: "a notification is insert-only except read_at", "audit_event cannot be updated or deleted", "no foreign key from the six tables cascades a delete", "audit_event is readable by an owner, not by a manager, a viewer or an outsider"; tests/db/pgtap/04_tenancy.sql: six tables ENABLE + FORCE RLS
- [x] The SECURITY §4.2.1 matrix rows for these tables pass in the POLY-84 battery. — tests/db/tenancy.test.ts: "every active row's runnable probes give viewer, manager, owner their cell and the outsider a denial", "harness canary"; tests/db/matrix.test.ts: "exactly the six POLY-62 rows are active", "reverse coverage"

## Comments

### @seceng — 2026-11-08

BetterAuth measurement spike (2026-11-08). better-auth 1.7.18 + @better-auth/passkey 1.7.18 on scratch PostgreSQL 14. Throwaway code outside the repo. SECURITY v1.2.3 holds the record (§4.1 "BetterAuth, measured"; R-12; A-29 amended; A-31 to A-33).
1. Session token: stored in the clear in session.token, matching the cookie token. The cookie is HMAC-signed with the auth secret. R-12 is confirmed, with narrower impact; Principal to re-approve it.
2. encryptOAuthTokens: exists, default false. When on, access and refresh tokens are XChaCha20-Poly1305 ciphertext. The idToken stays plain, and a databaseHooks.account before-hook drops it.
3. Two-factor: /enable needs the password and writes twoFactor verified=false, with secret and backup codes encrypted. skipVerificationOnEnable defaults to false. method otp is refused when unconfigured. The first /verify-totp sets twoFactorEnabled, replaces the session, then sets verified. Backup codes are encrypted, not hashed. One redeems while TOTP is unverified, but nothing becomes enabled.
4. Passkey: there is no /passkey/add-passkey. Registration is generate-register-options + verify-registration. It needs a session younger than freshAge (24h default; SESSION_NOT_FRESH otherwise) and no password.
5. Connection: on its own pool, the trigger saw app.session_id = null, on a different backend and transaction. databaseHooks never fire for twoFactor or passkey. hooks.before sees the session id and refuses with nothing written, but runs outside the transaction. A routing pool (BetterAuth gets our withTenant client; BEGIN/COMMIT become savepoints) let the trigger see the GUC in our transaction, and rollback removed BetterAuth's row (A-31). The TOTP guard moves to the user twoFactorEnabled flip (A-32).
6. Email-anchored enrolment: no native step. emailOTP types are fixed, keyed on the email address, and need no session. The app's email_challenge + grant is the only path.
7. Other (code-read): deleteUser is off by default (404). bearer plugin token = session token; unsigned is accepted unless requireSignature. allowPasswordless is needed for OAuth-only TOTP. freshAge is session age, not re-auth, so recent_auth_at stays ours.

### @architect — 2026-11-08

Re-scoped at the 2026-11-08 decomposition (architect + PM drafts; lead rulings). The description now lists what stays and the split-out issues. The seceng BetterAuth measurement comment above stays as the record; POLY-86 and POLY-89 build on it. The founding-owner and parent-cycle criteria the PM drafted live in POLY-90 and POLY-94.

### @team-lead — 2026-11-10

From POLY-84 (seceng, 2026-11-10): the catalog probe's `no_policy` check is satisfied by any policy, including a permissive `USING (true)`. Passing the battery is therefore not proof of tenant isolation. When the first tenant tables land here, each gets its own cross-tenant assertion using POLY-84's `crossTenantRows(db, table, as, other)` helper (ruling R4), and this issue decides the seeding helper and the permission-matrix `probe` shape (ruling R5, Open item 1).

### @team-lead — 2026-11-10

Also from POLY-84 (seceng, non-gating): add reverse coverage — every real table must be named by a permission-matrix row or by a short reviewed list, so a misspelled table name in `packages/tenancy/permission-matrix.json` cannot leave its row untested forever (M-2 only makes the gap visible).

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-62-entity-membership-schema`. Runs in parallel with POLY-128 (app shell); the two share only config files (`eslint.config.js`, `package.json`, `pnpm-lock.yaml`), so the second PR to merge takes main first.

### @architect — 2026-11-10

Gating ruling (gate 1): process/cairn/reviews/POLY-62/ruling.md, with ARCH 1.15.8 §3.1. Summary of what it settles:
- Seam: Drizzle tables in 0002 (generated), and functions, policies, FORCE and grants in 0003 (custom). `@poly/db` re-exports `sql`. `provisionPerson(tx)` acts for the transaction's user.
- The first owner membership is written only by the `app.seat_creator()` trigger (poly_govern). `app.keep_an_owner()` locks the entity row and refuses removing the last owner (C-20).
- Matrix probe shape and the `seedTenancy` fixture (POLY-84 Open 1). The outsider is a fourth actor on every probe. A new `requires` field holds founder-transfer and co-owner-remove-demote inactive. Five rows activate.
- Reverse coverage through an `unlisted` list. `battery_gaps` gains pk_not_uuid, raw_context_read and tenancy_column_updatable.
- Criterion 1 is amended: the session-loader call moves to POLY-86.
- db job measured: the CLI-spawning files take 105 of the 114 s of file time, and setup is at most 14.5 s. Guard: this loop adds at most 15 s. No ci.yml change.
- POLY-85 Open 1 is deferred to the next issue that edits connection.ts. Open 3 stays with the first worker-job feature.

### @architect — 2026-11-10

Ruling re-issued whole on seceng-62's objection batch: process/cairn/reviews/POLY-62/ruling.md. ARCH 1.15.8 §3.1 is updated to match. O1–O4 are accepted:
- `app.gate_owner_changes()` refuses direct multi-owner changes. POLY-90's first criterion lands here.
- poly_app gets no membership INSERT.
- The entity_type read is label-only, and an entity may use only a system type or one its creator owns (`app.check_entity()`, a poly_authz definer).
- INSERT grants are column-level, and invitation.token_hash is unreadable.
- The battery reason is an allowlist, `column_grant_not_allowlisted`.
N1–N4 are folded in:
- policy_public and policy_trivial_for_app, plus a harness canary that proves the matrix can fail.
- `requires` works at row and entry level; an active row with no runnable entry fails.
- co-owner-remove-demote activates (six rows active).
- The lock guards refuse when the lock returns no row.

### @architect — 2026-11-10

Verdict (gate 4): **pass**. Build 8779392 against the ruling (40f61ca + addendum 1 at 81f0010).

| Axis | Result | Evidence |
|---|---|---|
| Seam R1 | conforms. Tables are generated in 0002; rules are custom in 0003; `@poly/db` re-exports `sql`; pnpm-lock is untouched. | 8779392 |
| Tables and tombstone R2 | conforms. UUID PKs; the tombstone CHECK; the tax CHECK plus `app.check_entity()`; no FK cascades. | 0002, 0003 @ 8779392 |
| Definers R3 | conforms. Seven definers.json rows; `search_path=`; file-scoped CREATE and EXECUTE revoked by their grantors. | definers.json @ 8779392 |
| Gate and lock (O1, N3, addendum 1) | conforms. The gate is default-deny (definer roles and superuser exempt). Both guards lock the entity FOR UPDATE and refuse when no row is returned. Trigger names order the guards. | 0003; 04_tenancy.sql tgname assertion |
| Policies and grants R4 (O2–O4) | conforms. No membership INSERT. The entity_type read is label-only. token_hash is unreadable. INSERT grants are column-level. | 0003 @ 8779392 |
| Matrix R6 | conforms. Six rows are active, pinned by equality. Entry-level requires. The harness canary. No `public.account` left. | matrix.test.ts, permission-matrix.json |
| Catalog R7 | conforms. Five new battery_gaps reasons, each with a canary. `unlisted` reverse coverage. | 02_rls_catalog.sql |
| Behaviour | pass. Measured: `vitest run -c tests/db/vitest.config.ts` on tenancy, matrix, pgtap and battery gave 66/66 in 18.05 s locally (architect). backend-lead reports the full tests/db at 192 passed. | 8779392 |
| CI time R8 | Pending: the guard (≤ +15 s file time) is read from the PR's db job at finish. | lead at finish |

Measured deviations, both accepted:
- provisionPerson does a find, then an INSERT without ON CONFLICT, because the arbiter applies the SELECT policy. ARCH §3.1 is corrected to match in this commit.
  - **Criterion 1 is met as written.** Repeated calls return the same Person and create nothing new. Two concurrent first calls never leave a second Person or an ownerless entity: the unique self_user_id refuses the loser with 23505, and its transaction rolls back whole. Idempotent here means no duplicate state, not that a racing call never fails.
  - **The POLY-86 criterion:** the session loader calls provisionPerson inside withTenant. On 23505 it retries the whole transaction once, and that retry returns `created: false` with the winner's Person. A second 23505, or any other error, fails the request and is never swallowed. Test: two concurrent first loads for one new user end with exactly one Person, one owner membership, and both requests succeeding.
- The gate's branches are split so that OLD is never read on an invitation INSERT.

Carried forward:
- A null-entity (operator) invitation is refused by the gate's lock (42501). POLY-87 needs its definer path.
- The poly_govern `audit_event` INSERT policy is `WITH CHECK (true)`. That is acceptable only while every poly_govern definer is allowlisted (C-15).

### @team-lead — 2026-11-10

PR opened: https://github.com/richmosko/polycarpic/pull/109. Awaiting Validate. Verified build `8779392` (qa gate 3, architect verdict `ff53ec9`, seceng `reviewed @ 8779392`); `cairn gate --head 8779392` PASS. Open: the CI-time guard (at most +15 s on the `db` job), read from the PR's run.

### @team-lead — 2026-11-10

Validate passed; merging via PR #109. Closing. qa-engineer: gate 3 green at `8779392`, CI-time axis PASS on run 42967381790 (file time +3.4 s against the +15 s cap; `db` job 160 s of 180 s). Principal approved the merge 2026-11-11.
