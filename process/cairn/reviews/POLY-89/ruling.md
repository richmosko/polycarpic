# POLY-89 — Second sign-in step: ruling (architect)

**Basis.**
- Branch `feature/poly-89-second-sign-in-step` @ 8e3d9d88. better-auth and @better-auth/passkey 1.7.18; no pin changes. The POLY-147 marker (`app.tx_identity`, migration 0011).
- BetterAuth's write order and transaction boundaries were measured by backend-lead-89 on Postgres 17 with `log_statement=all`, as poly_app and as a superuser (order only). The record is in backend-lead-89's worktree, `temp/2026-11-16-backend-lead-89-betterauth-write-order.md`, "Live run".
- seceng-89's attack items 1–19 are answered in place, cited as [Sn].

**Tags.** Criteria are C1–C15 in POLY-89's order. "(code-read)" means read from the 1.7.18 tarball and not run. "(unmeasured)" means qa's red test measures it first.

## R1. Rules every guard follows

1. **Identity.** Every POLY-89 definer and trigger takes the acting user from `app.current_user_id()`. It refuses (`42501`) when that is NULL, except on the few unmarked sign-in columns in R3 #6 [S3]. The operator reset (R6) is the inverse: it refuses when a user marker *is* present, as `app.issue_operator_invitation` does. No function reads `current_setting('app.*')`. `app.promote_held_roles` (POLY-91) takes no parameter and reads `app.current_user_id()` [S6].
2. **The session id narrows a check; it never proves one (C13) [S4].** `app.current_session_id()` is web's word until POLY-149. It is used only as an extra equality that can make a check refuse. The proof in every guard is a row only a definer writes:
   - an `enrolment_grant`, minted by a correct emailed code;
   - that grant's `consumed_xid`;
   - `session.recent_auth_at`, which no login role can write (R1.4).

   A *fresh step-up* means `recent_auth_at` within 300 s on the row with `id = app.current_session_id() AND user_id = app.current_user_id()`. The forge test points the marker at three sessions, and each guard must still refuse:
   - (a) another real session of the same user, holding no grant and no fresh stamp;
   - (b) a uuid with no session row;
   - (c) another user's session that holds a fresh stamp or a live grant.
3. **Role-indifferent.** No guard names poly_app or poly_auth. Only two kinds of role pass a guard unchecked, as in `app.gate_owner_changes`:
   - `poly_govern`, which is NOLOGIN and runs only inside its own definers;
   - a superuser (fixtures, restores).

   Stage 2 therefore changes only the fixtures' role. qa's role tests (POLY-89c):
   - Every refusal path runs as poly_app and as a fixture login role `poly_auth`. The harness creates that role with poly_app's grants on BetterAuth's tables; `roles.sql` gains it only in POLY-149.
   - Positive paths run as poly_app, because `tx_identity_own` does not reach poly_auth until stage 2.
   - A catalog test fails if any POLY-89 function body names `poly_app` or `poly_auth`.
4. **No new poly_app grant on BetterAuth's tables, and no grant to the Principal.** Postgres checks a privilege before any trigger runs, so a guard cannot stand in for a grant. The design avoids the need:
   - BetterAuth's UPDATE no longer names `two_factor_enabled`. A hook takes the column out and calls a definer that flips it (R3 #1).
   - BetterAuth's session INSERT no longer names `recent_auth_at`. A hook strips it (R3 #3).
   - Every new grant goes to a NOLOGIN definer owner:
     - `poly_govern` on `user`: `UPDATE (two_factor_enabled, second_step_at)`.
     - `poly_govern` on `session`: `SELECT (id, user_id, created_at, recent_auth_at)`, `UPDATE (recent_auth_at)`, `DELETE`.
     - `poly_govern` on `two_factor` and `passkey`: `SELECT`, `DELETE`.
     - `poly_govern` on `verification`: `DELETE`.
     - `poly_authz`: `SELECT (id, self_user_id)` on `entity`, and SELECT on `invitation` for `entity_id, claimed_user_id, claimed_at, accepted_at, revoked_at, expires_at`, both with role-targeted policies, as for `membership`.
5. **Exact call.** Every definer a login role may EXECUTE refuses unless `current_query()` is exactly its own parameter-bound call, by the `enter_*` check in 0011. An injected fragment therefore cannot draw an emailed code, confirm one, or flip the factor flag.
6. **Locks against write skew [S7].** `app.refuse_last_method()` takes `FOR UPDATE` on the user's `user` row. R3 #10 and #11 take `FOR SHARE` on the member's or inviter's `user` row. A last-factor delete and a concurrent seat, invite or (later) rollup edge are thereby serialised.

## R2. The emailed code (C3, C8)

**`app.email_challenge`**
- Columns: `id`, `user_id` (FK user, CASCADE), `session_id` (FK session, **ON DELETE CASCADE**, NOT NULL), `purpose` (`first_enrolment` | `account_deletion`), `code_hash` bytea, `created_at`, `expires_at` (created + 10 minutes), `attempts`, `used_at`.
- Code only. The link form is dropped, so no GET can confirm a code and mail scanners cannot prefetch one [S8].
- RLS is `user_id = app.current_user_id()`. poly_app may SELECT `id, purpose, created_at, expires_at, attempts, used_at` and nothing else on the table.

**`app.enrolment_grant`**
- Columns: `id`, `user_id`, `session_id` (FK session, **ON DELETE SET NULL**), `created_at`, `expires_at` (10 minutes), `consumed_at`, `consumed_xid` xid8, `consumed_by` (`totp` | `passkey`), `stamped_at`, `revoked_at`.
- A unique partial index on `user_id WHERE consumed_at IS NULL AND revoked_at IS NULL AND session_id IS NOT NULL` allows one open grant per user.
- *Live* means open and `expires_at > now()`. The definers check expiry, because an index cannot use `now()` [S14].
- poly_app holds no privilege on the table.

**`app.issue_email_challenge(p_purpose text) RETURNS text`**
- poly_govern; EXECUTE poly_app. It needs a marker that carries a session.
- It returns NULL (suppressed) in either case:
  - the user has 3 or more challenges created in the last 15 minutes;
  - the user's wrong entries in the last 24 hours sum to 10 or more [S8].
- Otherwise it voids the open challenge for that user and purpose and makes six digits from the first 32 bits of `uuid_send(gen_random_uuid())`, mod 10^6. That is `pg_strong_random` underneath; pgcrypto is not needed.
- It stores `sha256(code ‖ ':' ‖ id)` and returns the code once.
- This hash can be reversed by brute force from a table read (10^6 candidates). That is accepted only because a code lives 10 minutes and is single-use [S8].

**`app.confirm_email_challenge(p_code text) RETURNS boolean`**
- poly_govern; EXECUTE poly_app.
- It takes the one open, unexpired `first_enrolment` challenge with `user_id = app.current_user_id()` and `session_id = app.current_session_id()`, and hashes the code in Postgres.
- A wrong code increments `attempts`; the 5th wrong entry voids the challenge.
- A right code sets `used_at`, revokes the user's open grant, and inserts one grant for (user, marker session).
- It returns false for every refusal.

**What the database proves, and what it does not.**
- The code is the database's proof; it also proves the mailbox was reached [S9].
- The password half of the anchor is an app control: Postgres cannot check a password. That is why neither definer takes a `reauth_at` argument.
- The anchor does not hold against SQL as poly_app. That role can UPDATE `user.email` and so redirect the code. This is R-2's reach until stage 2, and nothing here claims to close it [S13].

**Routes: a packages/auth plugin, `secondStepAnchor`.** Being a plugin, it moves to the sign-in service with BetterAuth.
- `POST /second-step/send-code`:
  - It takes the password and checks it with BetterAuth's `validatePassword`.
  - A user with no credential account instead needs a session created within the last 5 minutes: the fresh IdP round trip.
  - Inside the request's `withTenant` it calls the issuer, then `AuthInput.sendSecondStepCode` before commit, so a failed send rolls the challenge back.
  - The response is identical whether the code was sent or suppressed.
- `POST /second-step/confirm-code` calls the confirmer.
- Both form a fifth class in `AUTH_ROUTES`, **anchor**. Each needs a session, answers 403 for a user who already has `second_step_at`, and is added to `LIMITED`.
- Web's `sendSecondStepCode` throws "mailer not configured" until POLY-137, as `sendMagicLink` does.

## R3. Triggers and definers, in the measured order (C2, C7, C9, C14, C15)

**Measured order (live run).** Each signed-in `/api/auth` request is one marked transaction, `BEGIN; enter_asserted_user; …; COMMIT`.
- **First TOTP verify:** flip `two_factor_enabled` → session INSERT (a copy of the old row) → old session DELETE → `two_factor.verified = true` last.
- **Disable:** flip off → `DELETE two_factor` → session INSERT (copy) → old session DELETE.
- **Passkey add:** two requests, so two transactions:
  1. `generate-register-options` INSERTs a verification row.
  2. `verify-registration` consumes it and INSERTs the passkey.
- **Before the BEGIN, unmarked:** `getSession`'s sliding refresh `UPDATE session SET expires_at, updated_at`.

**Code-read, not run:**
- passkey delete and rename, by `id` only, with **no ownership check** (`@better-auth/passkey` dist `index.mjs:690`, `:741`);
- passkey sign-in, which UPDATEs `counter`;
- backup-code use, which UPDATEs `backup_codes`.

| # | Where | Name (owner) | Rule |
|---|---|---|---|
| 1 | `userUpdateBefore` (packages/auth) → **`app.set_two_factor_enabled(p_on boolean)`** (poly_govern; EXECUTE poly_app) | The flip, done by a definer. | The hook removes `twoFactorEnabled` from BetterAuth's data, adds `updatedAt`, and calls the definer on `currentTx()`; it throws outside a request transaction. BetterAuth's own `UPDATE … RETURNING` then names only `updated_at` and returns the flipped row. (unmeasured: that the hook's returned data replaces the update. qa's first red test.) **On** [S18] needs an unverified `two_factor` row of the user. For a first factor (`second_step_at` NULL) it consumes the live grant for (user, marker session), setting `consumed_at`, `consumed_xid = pg_current_xact_id()` and `consumed_by = 'totp'`. A later factor needs a fresh step-up. **Off** needs a fresh step-up and passes `app.refuse_last_method()` (#7). Whether the factor is really gone is checked at commit (#9). |
| 2 | `user_30_two_factor_flag` BEFORE INSERT OR UPDATE OF two_factor_enabled ON user | `app.guard_two_factor_flag()` (poly_govern) | INSERT: the flag must be false. UPDATE: refused except under R1.3's exemption, so only #1 and R6 can write it. |
| 3 | `session_10_recent_auth` BEFORE INSERT ON session; `session_11_recent_auth_fixed` BEFORE UPDATE OF recent_auth_at ON session | `app.stamp_recent_auth()`, `app.guard_recent_auth()` (poly_govern) | INSERT sets `NEW.recent_auth_at := now()` only when one grant meets all of these: `user_id = NEW.user_id = app.current_user_id()`, `consumed_xid = pg_current_xact_id()`, `consumed_by = 'totp'`, and `stamped_at` NULL. That grant then gets `stamped_at`, so the stamp fires once [S11, S16]. Every other INSERT gets NULL, whatever it carried. In packages/auth, databaseHooks `session.create.before` also strips `recentAuthAt`, because poly_app has no INSERT on the column. This lets the rotations insert (C15) and makes disable start a fresh window [S19]. UPDATE OF `recent_auth_at` is refused except under R1.3. There is no other session-UPDATE guard: the unmarked refresh (`expires_at`, `updated_at`) and the other granted columns stay as they are, so a refresh never needs the marker and never stamps [S15]. |
| 4 | FK actions | none | Deleting the old session sets `enrolment_grant.session_id` NULL and cascades its challenges. |
| 5 | `two_factor_10_guard` BEFORE INSERT OR UPDATE ON two_factor | `app.guard_two_factor()` (poly_govern) | Marked, and the row's `user_id = app.current_user_id()`. `user_id` never changes [S1]. INSERT, and any change of `secret` or `backup_codes` on an **unverified** row: `verified` false, plus a live grant (first factor) or a fresh step-up (later) [S12]. `verified` false → true: a grant with `consumed_xid = pg_current_xact_id()` (first factor) or a fresh step-up (later). On a **verified** row: `verified` true → false and any change of `secret` are refused [S1]; a `backup_codes` change, marked, needs a fresh step-up (regenerate). Unmarked, only these may change: `failed_verification_count`, `locked_until`, `backup_codes`. That is the sign-in step: lockout counters and one backup code consumed. An unmarked `backup_codes` rewrite is a residual under R-2 until stage 2 [S1, S3]. |
| 6 | `passkey_10_guard` BEFORE INSERT OR UPDATE ON passkey | `app.guard_passkey()` (poly_govern) | INSERT: marked, `user_id = app.current_user_id()`. For a first factor it consumes the live grant (`consumed_by = 'passkey'`) and stamps the marker session's `recent_auth_at` (`WHERE id = marker session AND user_id = me`). A later factor needs a fresh step-up [S1]. UPDATE: `user_id`, `public_key` and `credential_id` never change. Marked: `name` or `counter`, on a row whose `user_id = app.current_user_id()`. That closes BetterAuth's rename-by-id of another user's passkey. Unmarked: `counter` only (passkey sign-in). |
| 7 | `two_factor_20_last_method`, `passkey_20_last_method` BEFORE DELETE; also inside #1 *off* | `app.refuse_last_method()` (poly_govern) | Marked, the row's `user_id = app.current_user_id()`, and a fresh step-up. That closes BetterAuth's delete-by-id of another user's passkey, and a viewer's silent loss of a factor [S1]. It locks the user row (R1.6). It refuses when no method would remain while the user holds manager or owner on an entity where `app.own_person_exempt(entity)` is false. |
| 8 | `two_factor_80_sync` AFTER INSERT OR UPDATE OF verified OR DELETE; `passkey_80_sync` AFTER INSERT OR DELETE | **`app.sync_second_step()`** (poly_govern) | **The single writer of `second_step_at` (C7) [S5].** It recomputes the column for `app.current_user_id()` and refuses a row of another user, except under R1.3, where R6 deletes. The column is set (an existing value kept) while a verified two_factor row or any passkey exists, and NULL otherwise. An `account` row never counts [S10]. NULL → set calls `app.seat_claimed_invitations()`. A catalog test fails if another function body assigns `second_step_at`, or if any role other than poly_govern holds UPDATE on it. |
| 9 | `user_91_two_factor_consistent` CONSTRAINT AFTER UPDATE OF two_factor_enabled ON user; `two_factor_91_consistent` CONSTRAINT AFTER INSERT OR UPDATE OR DELETE ON two_factor; both DEFERRABLE INITIALLY DEFERRED | `app.two_factor_consistent()` (poly_govern) | At commit, `two_factor_enabled` must equal "a verified two_factor row of the user exists". The flip turns on only in the transaction that verifies the factor and off only in the transaction that deletes it (C14) [S2, S18]. Deferred is sound: the live run shows the flip and the delete in one transaction. |
| 10 | `membership_05_second_step` BEFORE INSERT OR UPDATE OF role ON membership | `app.require_second_step_for_role()` (poly_govern) | Refuses manager or owner for a member whose `second_step_at` is NULL, with `second_step_required`. The one pass is the own Person: `NEW.user_id = app.current_user_id()` and `app.own_person_exempt(NEW.entity_id)`. It covers `seat_creator` (creating any entity), `accept_invitations` and an UPDATE raise (C2). The UPDATE refusal is interim; POLY-91 replaces that branch with the hold. |
| 11 | `invitation_05_second_step` BEFORE INSERT ON invitation | `app.require_enrolled_inviter()` (poly_govern) | When `entity_id` is set: `inviter_user_id = app.current_user_id()` and that user has `second_step_at` (C2, sharing). Operator rows (`entity_id` NULL) pass. |
| 12 | called by #8 | `app.seat_claimed_invitations()` (poly_govern; no EXECUTE grant) | For `app.current_user_id()`: each unrevoked invitation with `claimed_user_id = me`, `accepted_at` NULL and role manager or owner becomes a membership row and gets `accepted_at` (POLY-87 R1, R2). POLY-91 adds `promote_held_roles()` here. |

**Route policy (packages/auth), the app half of C9:**
- The enrolment class refuses `body.createSession` on `/passkey/verify-registration` with 400 [S16]. A registration never mints a session, so the only stamped INSERT is the TOTP swap.
- `/two-factor/enable` refuses any `body.method` other than `totp` [S17].
- `createAuth` refuses to start if `twoFactor` is given `otpOptions`, and a test asserts it does [S17].

**Migration:** `two_factor.verified` becomes `NOT NULL DEFAULT false` [F1].

## R4. The one exemption predicate (C1, C10)

**`app.own_person_exempt(p_entity uuid) RETURNS boolean`** (poly_authz; no EXECUTE grant to a login role). It is true when all three hold:
- the entity's `self_user_id = app.current_user_id()`;
- no membership of another user is on it;
- no invitation on it is unrevoked and unaccepted and either claimed or unexpired. This closes the case of enrol, invite a manager, drop the last method, and the invitee seats later.

The `entity_rollup` clause (A-28) goes into the migration that creates `entity_rollup`; that table does not exist yet. That migration replaces the function and adds the `check_rollup_edge` refusal.

**`app.second_step_required() RETURNS boolean`** (poly_authz; EXECUTE poly_app). It is true when the user's `second_step_at` is NULL and they hold manager or owner on an entity where `own_person_exempt` is false.
- It is both the sign-in gate and `SecondStep.required`. No TypeScript re-derives either [S7].
- #7 and #10 call `own_person_exempt` directly, so all four places agree.
- Viewing a shared entity reaches none of them.

## R5. The app guard and the sign-in gate (C3, C4, C5)

- **The enrolment class.** With `second_step_at` NULL, `routePolicyHook` calls `app.enrolment_grant_live()` (poly_govern; EXECUTE poly_app; a boolean for the marker's user and session). It answers 403 `email_confirmation_required` when there is no live grant. This replaces today's flat 403. With `second_step_at` set, `requireRecentAuth` is unchanged.
- **The sign-in gate.** It lives in web's session loader. While `app.second_step_required()` is true, every page except `/settings/second-step` and `/api/auth/*` redirects to `/settings/second-step`. This loop ships that page as a bare placeholder: it names the state and has no form.
- **Google and GitHub.** These sign-ins are held like any `SIGN_IN_PATHS` sign-in, and they never stamp `recent_auth_at` (#3). So they satisfy neither the second step nor a step-up [S10].

## R6. `polycarpic user reset-mfa` lives here (C6), not in POLY-98

The operator CLI already exists: `polycarpic cli user invite`, in `apps/worker/src/cli/`, run by the one-shot `operator` service as poly_operator. POLY-98 is only the `polycarpic-ops` host wrapper, which passes `cli …` through.

- **Command:** `apps/worker/src/cli/user-reset-mfa.ts`, dispatched from `cli/main.ts`.
- **Wrapper:** `packages/tenancy/src/operator-reset.ts`, the one file that names the definer. It runs in `withOperatorTx`, with the `layers.json` confinements to match.
- **Definer:** `app.reset_second_step(p_email text) RETURNS boolean` (poly_govern; EXECUTE **poly_operator only**). It refuses any user marker and checks for the exact call. It:
  - locks the user row;
  - deletes the user's `two_factor` and `passkey` rows; #8 clears `second_step_at`, as the column's single writer;
  - sets `two_factor_enabled` false;
  - deletes every session, challenge and grant of the user, and the trust-device `verification` rows (`value = user id::text`, code-read `verify-two-factor.mjs:53`);
  - writes `audit_event` kind `second_step.reset`, actor `operator`, with `subject_user_id`.
- **Unchanged:** memberships. The command's exit codes are those of `user invite`.
- **Grant review:** seceng-89 reviews this grant in this loop. That is the per-command review POLY-98 asks for.

## R7. Screens: the reading is corrected

POLY-139 covers only the Sign-in and Settings → Sessions screens. No issue owns:
- the screens to set up a second step (password, emailed code, factor);
- `/sign-in/second-step`;
- Confirm it's you (DESIGN `#flow-second-step`).

This loop builds no screen beyond R5's placeholder. Until one lands, nobody can enrol in a browser, so nobody can create a non-Person entity or send an invitation. That failure is closed, not open.

What an e2e can show on today's pages (`apps/web/tests/e2e`):
- A new user whose only entity is their own Person signs in at `/sign-in` and reaches `/dashboard` with no redirect (C1).
- A user enrolled through the API is held at `/sign-in`: no session cookie, and `/dashboard` refused (C4, C5).
- After `reset-mfa`, a manager signs in and every page redirects to `/settings/second-step` (C6).

Everything else is in `tests/db`.

## R8. Migration order and tests

**Migrations.**
- `0012_second_step_tables` (Drizzle `generate`): the two tables, `two_factor.verified NOT NULL DEFAULT false`, and the schema files.
- `0013_second_step_guards` (custom), in this order:
  1. R1.4's grants;
  2. the poly_authz functions;
  3. the poly_govern definers;
  4. the triggers.
- Postgres fires same-event triggers in name order, so the prefixes fix the order:
  - the `_05_` refusals run before 0003's `_10_` owner gates;
  - `user_30` runs after 0007's `user_10` and `user_20`;
  - the `_80_` syncs run after the `_10_` and `_20_` guards;
  - the `_91_` checks run at commit.
- Every new definer is listed in `packages/db/sql/definers.json`.

**Tests.** ARCH §3.1c Tests stand (C11). The ruling adds:
- one test per criterion;
- R1.2's three forge cases (C13);
- R1.3's role and catalog tests (C12);
- the exact-call refusal for every definer granted to a login role;
- passkey delete and rename by another user's id, refused;
- `createSession: true` and `method: otp`, refused;
- the unmarked refresh, passing.

**Not testable here.** C2's export, purge and bank link have no routes yet. Their gate is that a step-up needs a factor, which is tested through `/api/auth`'s step-up class.

## Open (no ruling owed here; for the lead)

- **Nothing writes `recent_auth_at` except the first-enrolment stamps; Confirm it's you is not built.** An enrolled user therefore passes the step-up class only within 5 minutes of first enrolment. After that they cannot add or remove a method. It needs a re-authentication route against an existing session, which BetterAuth 1.7.18 lacks for TOTP. That is its own ruling and issue, before POLY-110 or POLY-144.
- **Enrolment in production waits on POLY-137's mailer** (R2).
