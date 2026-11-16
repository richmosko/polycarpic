# POLY-89 — Second sign-in step: ruling (architect)

Against: branch `feature/poly-89-second-sign-in-step` @ fb595a13; better-auth and @better-auth/passkey 1.7.18 (pins unchanged); the POLY-147 marker (`app.tx_identity`, migration 0011). Criteria are numbered C1–C15 in the order of POLY-89's list. "(code-read)" marks a fact read from the 1.7.18 tarball, not run; "(unmeasured)" marks a claim no test has run yet, which qa's red test measures first.

## R1. Rules every guard follows

1. **Identity.** Every POLY-89 definer and trigger takes the acting user from `app.current_user_id()` and refuses (`42501`) when it is NULL. The one exception is the operator reset (R6), which refuses when it is *not* NULL, as `app.issue_operator_invitation` does. No function reads `current_setting('app.*')`; `app.promote_held_roles` (POLY-91) takes no parameter and reads `app.current_user_id()`.
2. **The session id narrows, it never proves (C13).** `app.current_session_id()` is web's word until POLY-149. It is used only as an extra equality that can make a check refuse. In every guard the proof is a row only a definer writes: an `enrolment_grant` minted by a correct emailed code, a grant's `consumed_xid`, or `session.recent_auth_at`, which no login role can write (R3). A step-up check reads `session.recent_auth_at` from the row `id = app.current_session_id() AND user_id = app.current_user_id()`. The forge tests: with the marker naming (a) another real session of the same user that holds no grant, (b) a uuid with no session row, (c) another user's session that holds a fresh `recent_auth_at` or a live grant, each guard still refuses.
3. **Role-indifferent.** No guard names poly_app or poly_auth. A guard passes only on its own check; the only roles it lets through unchecked are `poly_govern` (NOLOGIN, reached only inside its definers) and a superuser (fixtures, restores), as `app.gate_owner_changes` does. So stage 2 changes no guard body, only the test fixtures' role. qa's role tests (POLY-89c): every refusal path runs as poly_app and as a fixture login role `poly_auth` holding poly_app's grants on BetterAuth's tables (the test harness creates it, as `roles.sql` does not until POLY-149). Positive paths run as poly_app, because `tx_identity_own` does not cover poly_auth until stage 2. A catalog test fails if any POLY-89 function body names `poly_app` or `poly_auth`.
4. **No new poly_app grant on BetterAuth's tables, and none is needed.** `user.two_factor_enabled` is written by a definer (R3), and `session.recent_auth_at` is stripped (R3). The new grants are to `poly_govern` (`UPDATE (two_factor_enabled, second_step_at)` on `user`; `SELECT (id, user_id, recent_auth_at)`, `UPDATE (recent_auth_at)`, `DELETE` on `session`; `SELECT`, `DELETE` on `two_factor`, `passkey`; `DELETE` on `verification`) and to `poly_authz` (column SELECTs on `entity` and `invitation`, with role-targeted policies, as for `membership`).
5. **Exact call.** Every definer a login role may EXECUTE refuses unless `current_query()` is exactly its own parameter-bound call, by the `enter_*` check (0011). An injected fragment therefore cannot draw an emailed code, confirm one or flip the factor flag.

## R2. Tables and the emailed code (C3, C8)

- **`app.email_challenge`**: `id`, `user_id` (FK user, CASCADE), `session_id` (FK session, **ON DELETE CASCADE**, NOT NULL), `purpose` (`first_enrolment` | `account_deletion`), `code_hash` bytea, `created_at`, `expires_at` (created + 10 minutes), `attempts` int, `used_at`. Code only: the link form (`link_hash`) is dropped, so there is no cross-device path to explain. RLS `user_id = app.current_user_id()`; poly_app SELECTs only `id, purpose, created_at, expires_at, attempts, used_at`, and has no INSERT, UPDATE or DELETE.
- **`app.enrolment_grant`**: `id`, `user_id`, `session_id` (FK session, **ON DELETE SET NULL**), `created_at`, `expires_at` (10 minutes), `consumed_at`, `consumed_xid` xid8, `revoked_at`. A unique partial index on `user_id WHERE consumed_at IS NULL AND revoked_at IS NULL AND session_id IS NOT NULL` allows one open grant per user. *Live* means open and `expires_at > now()`. poly_app holds no privilege on the table.
- **`app.issue_email_challenge(p_purpose text) RETURNS text`** (poly_govern; EXECUTE poly_app). It needs a marker with a session. It counts the user's challenges created in the last 15 minutes and returns NULL at 3 or more (suppressed). Otherwise it voids the open challenge of that user and purpose, then makes six digits from `uuid_send(gen_random_uuid())` (its first 32 bits, mod 10^6; `pg_strong_random` underneath, no pgcrypto). It stores `sha256(code ‖ ':' ‖ id)` and returns the code once.
- **`app.confirm_email_challenge(p_code text) RETURNS boolean`** (poly_govern; EXECUTE poly_app). It takes the open, unexpired `first_enrolment` challenge with `user_id = app.current_user_id()` **and** `session_id = app.current_session_id()`, and hashes in Postgres. A wrong code increments `attempts` and voids the challenge at 5. A right code sets `used_at`, revokes any open grant of the user and inserts one grant for (user, marker session). False for every refusal.
- **Routes: a packages/auth plugin, `secondStepAnchor`**, so the routes move to the sign-in service with BetterAuth in stage 2. `POST /second-step/send-code` takes the password, checked by BetterAuth's `validatePassword`. A user with no credential account instead needs a session created in the last 5 minutes (the fresh IdP round trip). The route calls the issuer inside the request's `withTenant` and sends through a new `AuthInput.sendSecondStepCode`, before commit, so a failed send rolls the challenge back. The response is identical whether sent or suppressed. `POST /second-step/confirm-code` calls the confirmer. Both are a fifth class in `AUTH_ROUTES`, **anchor**: a session is required, a user who already has `second_step_at` is refused with 403, and both paths are rate-limited (`LIMITED`). Web's `sendSecondStepCode` throws "mailer not configured", as `sendMagicLink` does, until POLY-137.

## R3. Triggers and definers, in BetterAuth's write order (C7, C9, C14, C15)

The order, code-read from `plugins/two-factor/totp/index.mjs` and `index.mjs`; the first-verify order is also measured (ARCH §3.1c):
- **First TOTP verify:** `updateUser({twoFactorEnabled: true})` → `createSession(…, activeSession)` → `deleteSession(old)` → `UPDATE two_factor SET verified = true`.
- **Disable:** `updateUser(false)` → `DELETE two_factor` → `createSession` → `deleteSession(old)`.
- **Passkey:** `INSERT passkey`.

| # | Where | Name (owner) | Rule |
|---|---|---|---|
| 1 | `userUpdateBefore` (packages/auth) | calls `app.set_two_factor_enabled(p_on boolean)` (poly_govern; EXECUTE poly_app) on `currentTx()` | The hook strips `twoFactorEnabled` from the data, adds `updatedAt`, and calls the definer in the request's transaction, refusing outside one. **On**, first factor (`second_step_at` NULL): it consumes the live grant for (user, marker session), setting `consumed_at` and `consumed_xid = pg_current_xact_id()`. Any later factor needs a fresh step-up (R1.2). Either way an unverified `two_factor` row of the user must exist. **Off**: a fresh step-up and the last-method rule (#6). BetterAuth's following `UPDATE … RETURNING` then returns the flipped value (unmeasured: that the before-hook's returned data replaces the update; qa measures it). |
| 2 | `user_30_two_factor_flag` BEFORE INSERT OR UPDATE OF two_factor_enabled ON user | `app.guard_two_factor_flag()` (poly_govern) | INSERT: the flag must be false. UPDATE: refused unless R1.3's exemption applies. Only #1 and R6 write it. |
| 3 | `session_10_recent_auth` BEFORE INSERT ON session | `app.stamp_recent_auth()` (poly_govern) | It sets `NEW.recent_auth_at := now()` if a grant of `NEW.user_id = app.current_user_id()` has `consumed_xid = pg_current_xact_id()`, else NULL. A value BetterAuth copied is therefore discarded whatever the role's grants. C15: databaseHooks `session.create.before` also strips `recentAuthAt`, because poly_app has no INSERT on the column, so the rotation inserts. The cost is that a rotated session after disable or a later factor is asked to step up again (seceng §7.4). |
| 4 | FK actions | none | Deleting the old session sets `enrolment_grant.session_id` NULL and cascades the session's challenges. |
| 5 | `two_factor_10_guard` BEFORE INSERT OR UPDATE ON two_factor; `passkey_10_guard` BEFORE INSERT OR UPDATE ON passkey | `app.guard_two_factor()`, `app.guard_passkey()` (poly_govern) | The row's `user_id` must equal `app.current_user_id()` and never changes. two_factor INSERT: `verified` must be false. `verified` false → true: for a first factor, a grant with `consumed_xid = pg_current_xact_id()`; for a later one, a fresh step-up. `verified` true → false and a change of `secret` on a verified row are refused; a change of `backup_codes` on a verified row needs a fresh step-up. passkey INSERT: for a first factor it consumes the live grant for (user, marker session) and stamps that session's `recent_auth_at` (`WHERE id = marker session AND user_id = me`); for a later one, a fresh step-up. passkey UPDATE: only `name` and `counter` may change. |
| 6 | `two_factor_20_last_method`, `passkey_20_last_method` BEFORE DELETE; also inside #1 *off* | `app.refuse_last_method()` (poly_govern) | It needs a fresh step-up, and refuses when the user would have no method left while they hold manager or owner on any entity where `app.own_person_exempt(entity)` is false. |
| 7 | `two_factor_80_sync` AFTER INSERT OR UPDATE OF verified OR DELETE; `passkey_80_sync` AFTER INSERT OR DELETE | **`app.sync_second_step()`** (poly_govern) | **The single writer of `second_step_at` (C7).** It recomputes the column from the tables: set (keeping an existing value) when a verified two_factor row or any passkey exists, else NULL. NULL → set calls `app.seat_claimed_invitations()` (#8). |
| 8 | called by #7 | `app.seat_claimed_invitations()` (poly_govern; no EXECUTE grant) | For `app.current_user_id()`: each unrevoked invitation with `claimed_user_id = me`, `accepted_at` NULL and role manager or owner becomes a membership row and gets `accepted_at` (POLY-87 R1, R2). POLY-91 adds its `promote_held_roles()` call here. |
| 9 | `user_91_two_factor_consistent`, `two_factor_91_consistent` CONSTRAINT AFTER …, DEFERRABLE INITIALLY DEFERRED | `app.two_factor_consistent()` | At commit: `two_factor_enabled` = a verified two_factor row exists for the user. So the flag turns on only in the transaction that verifies the factor and off only in the one that deletes it (C14). |
| 10 | `membership_05_second_step` BEFORE INSERT OR UPDATE OF role ON membership | `app.require_second_step_for_role()` (poly_govern) | Refuses manager or owner for a member with NULL `second_step_at` (`second_step_required`), unless `NEW.user_id = app.current_user_id()` and `app.own_person_exempt(NEW.entity_id)`. It fires for `seat_creator` (entity creation), `accept_invitations` and the UPDATE raise alike. The UPDATE refusal is interim: POLY-91 replaces that branch with the hold. Until then a sole owner cannot raise an unenrolled member at all, which closes the POLY-106 release gap early. |
| 11 | `invitation_05_second_step` BEFORE INSERT ON invitation | `app.require_enrolled_inviter()` (poly_govern) | With `entity_id` not NULL: `inviter_user_id = app.current_user_id()` and that user has `second_step_at`. Operator rows (`entity_id` NULL) pass. |

`two_factor.verified` becomes `NOT NULL DEFAULT false` (POLY-86 follow-up 2).

## R4. The one exemption predicate (C1, C2, C10)

**`app.own_person_exempt(p_entity uuid) RETURNS boolean`** (poly_authz; no EXECUTE grant to login roles) holds when all three are true:
- the entity's `self_user_id = app.current_user_id()`;
- no membership row of another user is on it;
- no invitation on it is unrevoked and unaccepted and either claimed or unexpired.

Counting live invitations closes the case where a user enrols, invites a manager to their Person, then drops their last method before the invitee seats. The `entity_rollup` clause (A-28) is added by the migration that creates `entity_rollup`, which does not exist yet. That migration replaces this function and adds the `check_rollup_edge` refusal. **`app.second_step_required() RETURNS boolean`** (poly_authz; EXECUTE poly_app) is true when the user has NULL `second_step_at` and holds manager or owner on an entity where `own_person_exempt` is false. It is both the sign-in gate and `SecondStep.required`; #6 and #10 call `own_person_exempt` directly, so all four agree. Viewing a shared entity touches none of them.

## R5. The app guard and the sign-in gate (C3, C4, C5)

- `routePolicyHook`'s enrolment class with NULL `second_step_at` replaces today's flat 403. It calls `app.enrolment_grant_live()` (poly_govern; EXECUTE poly_app; boolean, for the marker's user and session) and answers 403 `email_confirmation_required` without a live grant. With `second_step_at` set, `requireRecentAuth` is unchanged.
- The sign-in gate lives in web's session loader. When `app.second_step_required()` is true, any page except `/settings/second-step` and `/api/auth/*` redirects there. This loop ships that page as a bare placeholder that names the state and has no form.
- Google and GitHub sign-in are held like any `SIGN_IN_PATHS` sign-in and never stamp `recent_auth_at`, so they satisfy neither the second step nor a step-up.

## R6. `polycarpic user reset-mfa` lives here (C6), not in POLY-98

`apps/cli` does not exist, and needs not: the operator CLI already exists as `polycarpic cli user invite` (`apps/worker/src/cli/`, run by the one-shot `operator` service as poly_operator). POLY-98 is the `polycarpic-ops` host wrapper, which passes `cli …` through unchanged.

- **Command:** `apps/worker/src/cli/user-reset-mfa.ts`, dispatched from `cli/main.ts` beside `user invite`.
- **Wrapper:** `packages/tenancy/src/operator-reset.ts`, the one file that names the definer. It uses `withOperatorTx`, and both `layers.json` confinements gain this caller.
- **Definer:** `app.reset_second_step(p_email text) RETURNS boolean` (poly_govern; EXECUTE **poly_operator only**). It refuses any user marker and checks the exact call. It deletes the user's `two_factor` and `passkey` rows, sets `two_factor_enabled` false, and deletes every session, open challenge and grant of the user. It also deletes the user's trust-device `verification` rows (`value = user id::text`, code-read `verify-two-factor.mjs:53`). It writes `audit_event` kind `second_step.reset`, actor `operator`, `subject_user_id`. #7 clears `second_step_at`; memberships stay. The exit codes are those of `user invite`.
- **Effect:** the user's next sign-in meets the gate (R5) if they hold manager or owner.
- **Paths:** the issue's `apps/cli/**` becomes `apps/worker/**`.
- **Review:** this is POLY-98's "each later operator command needs its own grant review", so seceng-89 reviews the grant in this loop.

## R7. Scope of screens: corrected

POLY-139's criteria cover the Sign-in and Settings → Sessions screens only. No issue owns the screens for setting up a second step (password, then the emailed code, then the factor), for `/sign-in/second-step`, or for Confirm it's you (DESIGN `#flow-second-step`). This loop builds no screen beyond R5's placeholder. Until such an issue lands, nobody can enrol in a browser, so nobody can create a non-Person entity or invite. That fails closed.

What an e2e test can show on existing pages (`apps/web/tests/e2e`, real server):
- a new user whose only entity is their own Person signs in at `/sign-in` and reaches `/dashboard` with no redirect (C1);
- a user enrolled through the API is held at `/sign-in`, with no session cookie and `/dashboard` refusing (C4, C5);
- after `reset-mfa`, a manager's request for `/dashboard` lands on `/settings/second-step`, and Settings → Sessions has nothing to show because every session is gone (C6).

Everything else is in `tests/db`.

## R8. Migration order and tests

- **`0012_second_step_tables`** (Drizzle `generate`): the two tables, `two_factor.verified` NOT NULL DEFAULT false, and the schema files.
- **`0013_second_step_guards`** (custom): R1.4's grants; poly_authz `own_person_exempt`, `second_step_required`; poly_govern definers (R2, R3 #1, #3, #5–#11, `enrolment_grant_live`, R6); triggers named as in R3. Postgres fires same-event triggers in name order, so the prefixes fix it: the `_05_` refusals run before 0003's `_10_` owner gates, `user_30` after 0007's `user_10` and `user_20`, and the `_80_` syncs after the `_10_` and `_20_` guards. Every new definer is listed in `packages/db/sql/definers.json`.
- **Tests:** ARCH §3.1c Tests stand (C11). Add one test per criterion, R1.2's forge triple, R1.3's role and catalog tests, and the exact-call refusal for each definer granted to a login role (C12, C13).
- **Out of this loop:** C2's export, purge and bank link have no routes yet. Their gate is the first-enrolment rule (step-up needs a factor), tested through the step-up class of `/api/auth`.

## Open (no ruling owed here; for the lead)
- **No writer of `recent_auth_at` exists apart from the first-enrolment stamps.** Confirm it's you is not built. So an enrolled user passes the step-up class only within 5 minutes of first enrolment: no adding a second method later, no removing one. The fix needs a re-authentication route against an existing session, which BetterAuth 1.7.18 lacks for TOTP. It needs its own ruling and issue, before POLY-110 or POLY-144.
- Enrolment in production also waits on POLY-137's mailer (R2).
