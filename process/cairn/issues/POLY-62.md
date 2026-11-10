---
id: POLY-62
title: Entity + membership schema
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-83]
assignee: null
labels: [tenancy, db]
priority: null
pr: null
created: 2026-09-27
updated: 2026-11-10
---

PRD §4 Story 1 (foundational); ARCH §3.1. The tenancy core: entity, entity_type (base and parent kinds, user-defined types), membership (role in force), invitation (row shape), the poly_authz functions app.has_role, app.visible_entities and app.owner_count, the permission matrix as data (SECURITY §4.2.1), and the notification and audit_event tables, which move here from POLY-64 because the M1 triggers write them. Every user owns a default Person from sign-up through provisionPerson. Each entity carries a settable tax classification. Split out (2026-11-08 decomposition): roll-up link POLY-94, multi-owner gate and founder POLY-90, second step POLY-89, held raise POLY-91, cap table POLY-93, BetterAuth POLY-86.

## Acceptance criteria

- [ ] A new user has a Person with an owner membership; no signed-in user is ever without one (provisionPerson is idempotent and the session loader re-runs it until POLY-76 (f) settles OQ-16).
- [ ] A tax classification can be set per entity: individual; trust grantor / non-grantor; business pass-through / C-corp; for a parent, joint filers or pass-through to members (default for a new Household and Holding).
- [ ] entity.self_user_id (unique, nullable) marks the own Person; entity.purged_at exists for the tombstone; tenancy and actor columns are not updatable; keys are UUIDs.
- [ ] app.has_role / app.visible_entities / app.owner_count are STABLE SECURITY DEFINER owned by poly_authz, reading membership through a role-targeted policy; policies use the nullif context form.
- [ ] notification (insert-only except read_at) and audit_event (append-only, outside the purge cascade, owners-only read) exist under RLS.
- [ ] The SECURITY §4.2.1 matrix rows for these tables pass in the POLY-84 battery.

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
