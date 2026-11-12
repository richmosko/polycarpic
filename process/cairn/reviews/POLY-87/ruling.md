# POLY-87 ruling (gate 1): invite-only sign-up

Architect, read at af7921c. Each claim below is marked **read** (with its file), **measured** (with the command), or **(unmeasured)**. An unmeasured claim is a condition that a red test settles; no build step rests on it alone.

## R0. Size: two loops

- **POLY-87 (this loop): the sign-up transaction.** It covers criteria 1, 3, 4 and 6–16.
- **New issue, blocked by POLY-87: the operator CLI.** It covers criteria 2 and 5. Its text is under "Part B seam" below.
- After either loop ships, sign-up is still closed:
  - After A alone, a fresh instance has no user, so nobody can issue an invitation.
  - After B, the only new way in is a link the operator issues on the box.
- The lead moves criteria 2 and 5 to the new issue. The new issue takes the `apps/cli/**` path, renamed `apps/worker/**`.

## R1. Invitation model (migration 0006, generated from `schema/tenancy.ts`)

- **Token.** 32 bytes from `crypto.randomBytes`, sent base64url-encoded (43 characters). Only `sha256(token)` is stored, in the existing `token_hash bytea UNIQUE`. A new check requires `octet_length(token_hash) = 32`. The plaintext token is never stored or logged. The link is `<baseURL>/sign-up?invitation=<token>`.
- **New columns:**
  - `claimed_user_id uuid REFERENCES public."user"(id)`
  - `claimed_at timestamptz`
- **New checks:**
  - `(claimed_user_id IS NULL) = (claimed_at IS NULL)`
  - `accepted_at IS NULL OR claimed_at IS NOT NULL`
- **New index:** a partial index on `lower(email)` `WHERE claimed_at IS NULL AND revoked_at IS NULL`.
- **States.**
  - *Live* means `claimed_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.
  - *Claimed* means the invitation is bound to one user, which makes it single use.
  - *Accepted* means its membership has been seated, or for an invitation with no entity, that it has been claimed.
  - A manager or owner invitation stays claimed but not accepted until the second step is enrolled. That happens in POLY-89's enrolment write. Nothing in this loop seats it.
- **Expiry.** The issuer sets the expiry; this loop issues no invitations. Claiming checks `expires_at > now()`. Once claimed, expiry no longer applies to the later accept, but revocation does.
- **Revocation.** The existing `poly_app` `UPDATE (revoked_at)` covers owners. Claim and accept both refuse a revoked row.
- **No-entity rows** carry any role. Accepting one ignores the role, and the invitee gets only their own Person. B's migration sets the role rule for operator rows.

## R2. Definers (migration 0007, custom; all `SET search_path = ''`; each one also goes in `packages/db/sql/definers.json`)

| Function | Owner | EXECUTE |
|---|---|---|
| `app.stamp_signup_user()`: BEFORE INSERT ON `public."user"`, invoker | — | — |
| `app.invitation_set_once()`: BEFORE UPDATE ON `invitation`, invoker | — | — |
| `app.signup_stamp_cleared()`: deferred constraint trigger AFTER INSERT OR UPDATE ON `user`, invoker | — | — |
| `app.enter_new_user(uuid)` | `poly_authz` | `poly_app` |
| `app.claim_invitations(bytea, text) → void` | `poly_govern` | `poly_app` |
| `app.accept_invitations(bytea) → uuid` | `poly_govern` | `poly_app` |

- **The sign-up marker** (measured; the probe is in addendum 1).
  - A new column on the user table: `user.signup_txid bigint`, added in 0006 with an index.
  - `stamp_signup_user` stamps only an insert made by `poly_app`, the sign-up role (`current_user = 'poly_app'`). It overwrites the column with `pg_current_xact_id()::text::bigint`, the top-level transaction id even inside BetterAuth's savepoint.
  - An insert by any other role (superuser fixtures, `poly_owner`, `poly_worker`, a restore) has the column forced to NULL, whatever was supplied.
  - It raises `42501` if this transaction has already stamped a user: one user per transaction.
  - `poly_app` gets no INSERT or UPDATE on the column. The column grants in 0005 already leave it out.
  - "The user `p` was inserted by this transaction" means `signup_txid = pg_current_xact_id()`. A setting cannot forge this, and an UPDATE does not change it.
  - No `app.signup_user_id` setting exists.
- **`enter_new_user(p)`** raises `42501` unless all of these hold:
  - user `p` was inserted by this transaction;
  - `app.user_id` is empty, which refuses a second call;
  - no `entity` has `self_user_id = p`.

  It then runs `set_config('app.user_id', p::text, true)`. That setting outlives the function (measured by seceng, P1).
  - `poly_authz` is granted `SELECT (id, signup_txid)` on `user` and `SELECT (self_user_id)` on `entity`, with the policy `FOR SELECT TO poly_authz USING (true)`.
- **`claim_invitations(hash, email)`** refuses with `42501` when `app.user_id` is non-empty, so it is no oracle from a signed-in transaction (S4).
  - It runs with `SET lock_timeout = '5s'` and locks the live rows `FOR UPDATE ORDER BY id`. Which rows:
    - with a hash: the row with `token_hash = hash AND lower(email) = lower($2)`;
    - with a null hash: every live row with `lower(email) = lower($2)`.
  - If no row is locked, it raises `42501 invitation_required`. It returns void and writes nothing.
  - A racing sign-up blocks on the lock, then re-checks the row after the first commits and finds it claimed (seceng P3).
- **`accept_invitations(hash)` → the entity to land on, or null.** It runs with the same `lock_timeout`, under the same ordering.
  - It raises `42501` unless `app.current_user_id()` is set and that user was inserted by this transaction (S12). Existing-user acceptance is POLY-90's.
  - It raises `42501` on a null hash unless `user.email_verified` is true (S2).
  - It reads the email from the `user` row, never from the caller.
  - It re-selects the rows `claim_invitations` would lock. If there are none, it raises `42501`.
  - On each row it sets `claimed_user_id` and `claimed_at`.
  - It seats a viewer membership only for an entity row with role `viewer`, and sets `accepted_at` there and on a no-entity row. A manager or owner row is claimed and left unseated, whatever `second_step_at` holds (S6; POLY-89 seats it).
  - It returns the newest seated `entity_id`.
- **Set once (S10).** `invitation_set_once()` refuses with `42501` any change to `revoked_at`, `claimed_user_id`, `claimed_at` or `accepted_at` once that column is non-null.
- **Grants and policies added for `poly_govern`:**
  - on `invitation`: `SELECT`, plus `UPDATE (claimed_user_id, claimed_at, accepted_at)`;
  - the policies `FOR SELECT TO poly_govern USING (true)` and `FOR UPDATE TO poly_govern USING (true) WITH CHECK (claimed_user_id = app.current_user_id())`;
  - on `membership`: `FOR INSERT TO poly_govern WITH CHECK (user_id = app.current_user_id() AND role = 'viewer')`, beside `seat_creator`'s policy (S6);
  - on `user`: `SELECT (id, email, email_verified, signup_txid)`, and `UPDATE (signup_txid)` (C32).
- **Grants for `poly_app`:** `SELECT (claimed_user_id, claimed_at)` on `invitation`. `token_hash` stays unselectable, and `poly_app` still has no `INSERT` on `membership` (POLY-62 R4).
- **Migrations are forward-only.** 0006 is generated (the claim columns, `user.signup_txid`, checks and indexes) and 0007 is custom, the 0003 pattern. `poly_owner` writes the tracking row, and each definer owner gets `CREATE ON SCHEMA app` for that file only.

## R3. The sign-up transaction (one `withContextFreeTx`, in this order)

1. **Route hook (`route-policy.ts`, `/sign-up/email`).**
   - A token is refused with 403 `invitation_required` unless it decodes to exactly 32 bytes and re-encodes to the same string (S9). The hash is `sha256` of the decoded bytes, through `hashInvitationToken` alone.
   - Otherwise the hook calls `claimInvitation(currentTx(), { email: body.email, token })`. A refusal is 403 `invitation_required`.
   - The answer is the same for an unknown, expired, revoked, claimed or mismatched token. Because the hook runs before BetterAuth's existing-email check, it does not reveal which emails have accounts.
   - With no context-free transaction open, the hook refuses.
2. **`user.create.before`**, on every path in `USER_INSERTING`:
   - It calls `claimInvitation` again. The mode is chosen by the route template, never by whether a body field is present (S1):
     - `/sign-up/email` passes the body token, and a missing one is refused;
     - only `/callback/:id` and `/magic-link/verify` pass a null token.
   - The token-less claim matches by email, and acceptance then requires `email_verified` (S2).
   - The row lock is already held, so the second claim is idempotent.
3. **BetterAuth inserts the user** inside its savepoint. The trigger stamps `signup_txid`.
4. **`user.create.after`** (read, `better-auth/dist/db/with-hooks.mjs`: after-hooks are queued until BetterAuth's own transaction ends, then run with `"throw"` semantics, so they run in our outer transaction and a throw surfaces):
   - `tx.enterNewUser(created.id)`;
   - `provisionPerson(tx)`;
   - `acceptInvitations(tx, { token })`.
5. **Commit or rollback.** Any throw, or any BetterAuth failure response, rolls back through `RollbackWith` (read, `handler.ts`), which also strips the cookies. The user, Person, membership, invitation claim and session go together.
   - `app.user_id` is local, so it ends with the transaction (C11). `signup_txid` stays on the row; it never matches a later transaction.
6. **Landing.** `@poly/tenancy` exports `landingEntity(tx)`: the newest entity seated by an accepted invitation, or else the user's own Person.
   - `apps/web/src/routes/+page.server.ts` redirects a signed-in user to `/dashboard?entity=<id>`, using `withTenant` from `locals.identity`.
   - The `entity` parameter is the seam for the entity selector, which does not exist yet.
   - A new `/sign-up` page (`+page.svelte`, the `/sign-in` pattern) reads `?invitation=`, posts it as `invitationToken`, offers Google and GitHub, and goes to `/` on success. It answers with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and it removes `invitation` from the address bar with `history.replaceState` once the token has been read (S9).
- **"Seeded accounts"** in criterion 7 means what `provisionPerson` writes today: the Person and its owner membership. The GL chart seed joins `provisionPerson` in the ledger issue. Until then, criterion 7 is ticked against those rows.

## R4. The new-user step on the handle

- `context.ts`, for the `withContextFreeTx` kind only, attaches a non-enumerable `enterNewUser(id)` to the `Tx` it creates. It is a per-transaction closure over `client` and a `used` flag.
- The method calls `enterNewUserOn(client, id)` from a new file, `packages/db/src/new-user.ts`. That file runs `SELECT app.enter_new_user($1)` and nothing else.
- Exported type: `ContextFreeTx = Tx & { enterNewUser(id: string): Promise<void> }`. `withContextFreeTx` passes a `ContextFreeTx`, and `currentTx()` returns one when the kind is `withContextFreeTx`.
- The TypeScript side refuses three things; the database side (R2) still decides:
  - a second call (`used`);
  - a call after the transaction ends (`TransactionClosed`, already in place);
  - a call on any other kind of transaction: the method is absent there.

## R5. Confinement (POLY-140 pattern, generated from `layers.json`)

- **`layers.json` gains two keys:**
  - `"confined": { "packages/db/src/new-user.ts": ["packages/db/src/context.ts"] }`
  - `"reservedLiterals": { "enter_new_user": ["packages/db/src/new-user.ts"], "claim_invitations": ["packages/tenancy/src/invitation.ts"], "accept_invitations": ["packages/tenancy/src/invitation.ts"] }` (S7)
- **`scripts/layers/plugin.mjs` gains three rules:**
  - `poly/confined-module`: every import form in POLY-140 C1 that resolves to a confined file is refused unless the importer is a named caller. Inside the package too, which covers `auth.ts` and `index.ts` re-exporting it.
  - `poly/reserved-literal`: any string or template literal in `apps/**` or `packages/**` source whose cooked value contains a reserved name is refused outside that name's file. "Cooked" means escapes are decoded first.
  - `poly/confined-member`: `enterNewUser` used as a property name, whether called, read or destructured, is refused outside `packages/auth/src/user-hooks.ts` and `packages/db/src/context.ts`. This includes a computed member with a literal key, such as `tx['enterNewUser']`. This is driven by `"confinedMembers": { "enterNewUser": [those two files] }`.
- All three sit under `poly/*`, so an inline disable is already refused. `eslint.config.js` also turns on `no-eval`, `no-implied-eval` and `no-new-func` for `apps/**` and `packages/**` (S7).
- **The import boundary must refuse:**
  - `db/auth` from outside `packages/auth` (already in place);
  - `new-user.ts` from any file but `context.ts`;
  - a reserved definer name outside its one file;
  - `enterNewUser` outside the two named files.

## R6. Tests (placement is POLY-141 C7)

| File | Area | Group | Covers | Cost (unmeasured) |
|---|---|---|---|---|
| `tests/db/auth-signup-invite.test.ts` (new) | `auth` | parallel | C1–C4, C6–C11, C24–C28 | ≤ 5 s CI file time |
| `tests/db/auth-new-user-step.test.ts` (new) | `auth` | parallel | C5, C12–C14 | ≤ 3 s |
| `tests/db/pgtap/05_invitation.sql` (new; already run by `pgtap.test.ts`) | `tenancy` | parallel | C15–C19, C29–C31 | ≤ 1 s |
| `tests/db/auth-signup-wrap.test.ts` (edited: its mock moves to `vi.spyOn`, or it seeds real invitations) | `auth` | parallel | POLY-86 C11 stays green | 0 |
| `tests/layers/` fixtures | `layers` job | — | C20–C22 | lint job |

- **Guard:** the `db` job median stays ≤ 100 s. qa states the summed CI file time of the new files at gate 2 and the job median at gate 3. If the median is above 92 s, the loop brings its own cut.

## R7. How A's tests create invitations, and why A opens no way in

- **Fixture.** A new helper, `tests/db/helpers/invitation.ts`, exports `seedInvitation({ entityId?, email, role, expiresAt?, as })` and returns the plaintext token. The helper hashes the token with the same `hashInvitationToken` that `@poly/tenancy` exports.
  - **Entity rows** go in as `poly_app` under `withTenant` for an owner who has signed up through a seeded no-entity row. They use the existing owner policy and `gate_owner_changes` (a sole owner is allowed), so the fixture uses the production grant.
  - **No-entity rows** go in as superuser through `must()`. A has no path that writes them, and that is the point.
  - **Expired, revoked and claimed rows** are set up as superuser afterwards.
- **A opens no way in** (read; condition 23 measures it).
  - Every user-creating route in `USER_INSERTING` must claim a live invitation row.
  - In A, an invitation row is written only by a `poly_app` INSERT under the owner policy, and that needs an existing user who owns an entity.
  - The definers A adds only UPDATE `invitation`. `poly_govern` gets no INSERT on it, and no function in `app` inserts into it.
  - On a fresh instance there is no user, so no owner and no row. Every sign-up is refused, and only B's bootstrap changes that.
  - The session-loader backstop provisions a Person for an existing user only. It never creates a user.

## Conditions (each one becomes a red test for qa and a build target for backend-lead)

**Step 1: schema and definers (0006, 0007)**
1. Each of these is refused with 403 `invitation_required`, and afterwards no `user` row exists for that email:
   - `/sign-up/email` with no token;
   - a malformed token;
   - an unknown token;
   - an expired token;
   - a revoked token;
   - a claimed token;
   - a valid token with another email.

   The response bodies are byte-identical across all of these.
2. No configuration input reopens sign-up. A test builds `authOptions` with every `AuthInput` variant and `NODE_ENV` values, and every one still refuses condition 1's cases. `authOptions` also carries no key that bypasses or disables `databaseHooks` (S11).
3. An accepted link replayed by a second sign-up is refused, and the invitation's `claimed_user_id` is unchanged.
4. Two concurrent `/sign-up/email` requests on one token, each with its own connection, end with exactly one `user`, Person and membership. The loser leaves no row and gets 403.
5. After `enterNewUser`, `current_setting('app.user_id')` equals the new id until the end of the transaction. Measured inside the hook.

**Step 2: hooks and transaction**
6. A viewer entity invitation, through each of the three `USER_INSERTING` routes, seats a viewer membership on that entity and sets `accepted_at`. `landingEntity` returns the entity, and `/` redirects to `/dashboard?entity=<it>`.
7. A no-entity invitation leaves the user with their own Person only: `visible_entities()` has one element. `landingEntity` returns the Person.
8. A manager or owner invitation is claimed with no membership and `accepted_at` null, and the user lands on their Person.
9. After a forced rollback (a test trigger refusing the `session` insert), no `user`, `entity`, `membership` or `account` row exists, and the invitation is unclaimed.
10. A throw from `provisionPerson` (a test trigger on `entity`) and a throw after the step (from `acceptInvitations`) each leave none of those rows.
11. After commit, and separately after rollback, the next checkout of the same backend (a pool of `max: 1`) reads `app.user_id` empty, and a context-free count of `entity` returns 0.

**Step 3: the step's refusals**
12. With the `enterNewUser` call removed (the test passes a hook variant), the same sign-up fails with 42501 from RLS and leaves no user row.
13. `enterNewUser` refuses each of these, each test on its own transaction:
    - an existing user's id;
    - an existing user's id after this transaction UPDATEd that user's row (its xmin is now this transaction's; `signup_txid` is not);
    - a second call;
    - a call after the transaction ended;
    - an id whose insert was rolled back to a savepoint.

    A `poly_app` INSERT or UPDATE that supplies `signup_txid` is refused with 42501. A second user insert in one transaction is refused with 42501.
14. `@poly/db`, `@poly/db/auth` and `@poly/db/session` export no function whose source calls `enter_new_user`, and `Object.keys` of each contains no step. A `withTenant` or `withSystem` `Tx` has no `enterNewUser`.

**Step 4: catalog (pgTAP)**
15. `poly_app` has no INSERT on `membership`. `accept_invitations` seats `app.current_user_id()` only against a matching live invitation, and only as viewer. With `second_step_at` set by a superuser, an owner invitation is claimed and not seated. A body scan shows that only `seat_creator` and `accept_invitations` insert into `membership`, and the `poly_govern` INSERT policies on `membership` are exactly `seat_creator`'s and R2's (S6).
16. A no-entity invitation is visible to no `poly_app` SELECT or UPDATE policy. A `poly_app` INSERT of one is refused with 42501 (`gate_owner_changes`). `claim_invitations` and `accept_invitations` handle it.
17. `accept_invitations` called outside a sign-up transaction refuses with 42501, and no membership is written. This covers:
    - a signed-in user;
    - `app.user_id` forged to an existing, provisioned user who holds a live viewer invitation;
    - the same forgery after this transaction UPDATEd that user's row;
    - a user inserted in an earlier transaction (S12).
18. Calling `stamp_signup_user()`, `invitation_set_once()` or `signup_stamp_cleared()` directly fails. Each new definer appears in `definers.json` with its owner and EXECUTE list, and `search_path = ''` (C-15 check).
19. `poly_app` selecting `invitation.token_hash` is refused with 42501, and inserting a `token_hash` of 31 bytes fails `23514`.

**Step 5: lint**
20. Each of these is red, in every form POLY-140 C1 covers:
    - `packages/db/src/auth.ts` → `./new-user.ts`;
    - `packages/db/src/index.ts` → `./new-user.ts`;
    - `packages/auth/src/x.ts` → `@poly/db/new-user`;
    - the same import by a relative path.

    `context.ts` → `./new-user.ts` is green.
21. Each of these is red in a `.ts` or `.svelte` source file:
    - `` sql`SELECT app.enter_new_user(…)` `` in `packages/auth/src/x.ts`;
    - `'enter\x5fnew_user'`;
    - `claim_invitations` outside `packages/tenancy/src/invitation.ts`;
    - `eval(…)`, `new Function(…)`, and `setTimeout('x', 0)`, all under the repo's real `languageOptions.globals`, so `no-implied-eval` is shown to fire.

    Each reserved name in its own file is green. A `.sql` migration is not linted (S7).
22. `tx.enterNewUser(...)`, `tx['enterNewUser']` and `const { enterNewUser } = tx` are red in `packages/auth/src/handler.ts` and green in `user-hooks.ts`. A bare or inline disable is red.

**Step 6: closure**
23. On a freshly migrated database with no user:
    - every `USER_INSERTING` route, and `/sign-up/email` with any token, is refused, and no `user` row exists afterwards;
    - pgTAP shows no INSERT on `invitation` for any role but `poly_app`;
    - no function in schema `app` whose body inserts into `invitation` or `public."user"` exists (a `pg_proc` source scan, S11).

**Step 7: seceng conditions (addendum 1)**
24. **(S1)** With invitations A and B both live for one email, a `/sign-up/email` with A's token claims A only, and B stays live. A `/sign-up/email` that reaches the user hook with no token is refused, and no user row exists.
25. **(S2)** Token-less sign-up:
    - A mocked Google callback with `email_verified=false` for an invited address leaves no user, and the invitation stays unclaimed.
    - `options.ts` sets GitHub's `getUserInfo` override (not `mapProfileToUser`, which cannot do this on 1.7.18). The email is the `/user/emails` entry that is both primary and verified, never the profile email. With no such entry it returns null and the sign-in is refused. This is measured with a mocked fetch.
    - The fallback is tested too: with the override removed, `authOptions` refuses a `github` input.
    - A GitHub callback whose profile email is invited but unverified claims nothing.
    - A GitHub callback whose primary verified email is invited claims it.
26. **(S3)** After `/sign-up/email`, `email_verified` is false. A Google callback for the same address then fails as account-not-linked and adds no `account` row.
27. **(S5)** A claim blocked longer than `lock_timeout` answers 403 `invitation_required`, not 500. Two token-less sign-ups for one address, which has two live invitations, end without `40P01`.
28. **(S8)** Every refusal on `/sign-up/email` gets the same 403 `{ code: 'invitation_required' }` body, with no SQLSTATE, message or hint. That covers the route hook, the second claim, `42501` and `55P03`. On `/callback/:id` and `/magic-link/verify`, no invitation, an unverified email and a revoked invitation redirect to one and the same error target.
29. **(S9)** Token handling:
    - A non-canonical 43-character token that decodes to the same bytes is refused.
    - Captured console and BetterAuth logger output holds no plaintext token, across condition 1's cases and one successful sign-up.
    - `/sign-up` answers with `no-referrer` and `no-store`.
    - An e2e check in `apps/web/tests/e2e/` shows the address bar without `invitation` after load.
30. **(S4, pgTAP)** `claim_invitations` under `withTenant` (`app.user_id` set) raises 42501 and takes no lock, so a concurrent claim on the same row is not blocked. Its return type is void.
31. **(S10, pgTAP)** Once `revoked_at`, `claimed_user_id`, `claimed_at` or `accepted_at` is non-null, a `poly_app` or `poly_govern` UPDATE that changes it is refused with 42501.

32. **(S13; corrected in place, probed on postgres:17.10)** No committed `user` row carries a sign-up stamp.
    - Stamping is in R2: only `poly_app` inserts are stamped, and every other role's insert is forced to NULL.
    - `accept_invitations` sets the stamp to NULL on the new user before it returns. `poly_govern` gets `UPDATE (signup_txid)` on `user`, and no other role does.
    - A deferred constraint trigger, `app.signup_stamp_cleared()` (`AFTER INSERT OR UPDATE ON user`, `DEFERRABLE INITIALLY DEFERRED`, invoker), re-reads the row by id at commit. It raises `42501` if the stamp is non-null, for every role.
    - Probe results:
      - a committed superuser fixture insert that supplies 42 reads null;
      - a `poly_worker` insert reads null;
      - a `poly_app` sign-up with accept commits with null;
      - a `poly_app` insert without accept is refused at commit, and no row is left;
      - a superuser-planted stamp is refused at commit.
    - Tests:
      - after a committed sign-up on each of the three `USER_INSERTING` routes, the stamp is null;
      - a hook variant that skips `acceptInvitations` fails at commit and leaves no user row;
      - a superuser `INSERT … signup_txid` commits with null;
      - pgTAP: inside one transaction, a superuser-planted stamp that differs from the current xid passes neither `enter_new_user` nor `accept_invitations`, and the commit is refused.
    - **Test impact:** any test that creates a user through BetterAuth (as `poly_app`) must now go through a real invitation (`seedInvitation`), not the `claimInvitation` mock alone. Otherwise its commit is refused. Superuser fixtures (`seedUser`, `seedTenancy`) are unaffected.

## Paths outside the issue's current `paths`

`scripts/layers/**` and `tests/layers/**` (R5), and `apps/web/tests/e2e/**` (C29). The fixture helper in R7 is under `tests/db/**`. Remove `apps/cli/**`; it goes to loop B as `apps/worker/**`.

## For seceng (plainly)

- **The step's residual (S12).** The new-user step and acceptance trust `user.signup_txid`, never a setting, so a forger who can run SQL as `poly_app` cannot reach an existing user, provisioned or not.
  - What remains is R-2's own power: such a forger can INSERT a fresh `user` row, because `poly_app` holds that grant. That new user can accept a live invitation addressed to an email that has no account. This is equivalent to a magic-link holder, and no worse than R-2 already allows.
- **Email as proof.** On the token-less OAuth and magic-link paths, a verified email alone claims every live invitation for that address. On `/sign-up/email`, possessing the token is the proof of the email. `emailVerified` stays false.
- **Policy width.** The new `poly_govern` membership INSERT policy is limited to `role = 'viewer'` (S6).
- **Lock time.** The row lock is held across BetterAuth's password hashing. (unmeasured) At most one sign-up per invitation waits.
- **Token in the URL.** The token sits in the page query string. `/sign-up` sends no referrer and loads no third-party asset. Access logs: Caddy's log format must drop the query (INFRA), so this is a deploy condition.
- **Not closed here:**
  - acceptance by an existing user (POLY-90);
  - seating a claimed manager or owner after enrolment (POLY-89);
  - the 1 → 2 revocation on acceptance (POLY-90; unreachable now, since no owner seats at sign-up);
  - `/change-email` (step-up) could later point an account at an invited address, so any future existing-user acceptance must not match by email alone;
  - loop B adds a second context-free path, `db/operator`, which changes the wording of SECURITY C-84 (the only context-free path is `db/auth`).

## Part B seam (file verbatim as the new issue)

**Title:** Operator invite CLI

**Description.** The operator's command on the box: `polycarpic user invite <email> [--bootstrap]`. Without the flag, it issues a single-use, audited invitation that shares no entity. With `--bootstrap`, it creates the first user's invitation on an empty instance, and only once. It runs in the worker container: INFRA §7.5 has `polycarpic-ops cli …` execute it there. It reaches the database as `poly_worker`, through a context-free operator transaction that never sets `app.user_id`. It builds on POLY-87's claim and accept definers (`process/cairn/reviews/POLY-87/ruling.md`). PRD §4 invite story; SECURITY C-01; INFRA S-1.

**Acceptance criteria**
- [ ] The first user on an empty instance is created only by `polycarpic user invite <email> --bootstrap`, once. With any `user` row present it exits non-zero and writes nothing. An empty instance accepts no other first sign-up (INFRA S-1).
- [ ] `polycarpic user invite <email>` issues a single-use invitation that shares no entity, and writes an `audit_event` of kind `invitation.issued` (`entity_id` null, `actor` `operator:cli`). The invitee sees only their own Person.
- [ ] Without `--bootstrap`, the command refuses on an empty instance, so it cannot create the first user.
- [ ] A second `--bootstrap` on an empty instance revokes the earlier unclaimed bootstrap invitation. Two concurrent runs leave exactly one live one, because the issuing definer serialises them on an advisory lock.
- [ ] `claim_invitations` refuses a bootstrap invitation once any user exists (`issued_via = 'bootstrap'`).
- [ ] `withOperatorTx` (subpath `@poly/db/operator`) runs on the `poly_worker` pool and sets only `app.actor`, locally. It refuses to nest with the other three wrappers. Lint refuses to import it from anywhere but `apps/worker/src/cli/**`.
- [ ] The invitation is written only by `app.issue_operator_invitation` (owner `poly_govern`, EXECUTE `poly_worker` alone), and `poly_worker` holds no INSERT on `invitation`.
- [ ] The link is printed once to stdout. The plaintext token is never logged or stored, and the expiry is 7 days.
- [ ] Exit codes: 0 issued, 2 refused (instance state), 1 anything else. `check-config` validates the worker's `DATABASE_*` first.

**Proposed paths:** `process/cairn/issues/<ID>.md`, `process/cairn/reviews/<ID>/**`, `apps/worker/**`, `packages/db/**`, `packages/tenancy/**`, `tests/db/**`, `tests/layers/**`, `scripts/layers/**`, `infra/ci/changes.mjs`, `layers.json`, `eslint.config.js`, `package.json`, `pnpm-lock.yaml`, `docs/ARCH/**`, `docs/SECURITY/**`, `docs/INFRA/**`. Its tests go in a new `db` area, `operator`, with paths `^apps/worker/src/cli/`, added to `TABLE.db`.

**What A leaves in place for B:**
- the `invitation` claim columns and `claim_invitations` / `accept_invitations`;
- no-entity acceptance, which gives the invitee their own Person only;
- `hashInvitationToken` exported from `@poly/tenancy`;
- the `confined` key in `layers.json` and the `poly/confined-module` rule, which B reuses for `db/operator`;
- `seedInvitation` in the test helpers;
- condition 23's closure test.

B changes condition 23 to "only `issue_operator_invitation` and the `poly_app` owner policy insert". seceng re-words C-84 in B: `db/auth` and `db/operator` are the two context-free paths, and only `db/auth` sets `app.user_id`.

## Addendum 1: seceng S1–S12 (`seceng-ruling-review.md` @ fcc376b)

| S | Ruling | Where |
|---|---|---|
| S1, S3, S4, S8, S9, S11 | Accepted as written. | R2, R3; C2, C23, C24, C26, C28, C29, C30 |
| S2 | Accepted, and built in this loop: the database refuses a token-less accept without a verified email, and `options.ts` gets the C-05 GitHub mapping. If the mapping cannot be measured on the 1.7.18 pin, `authOptions` refuses a `github` input, so GitHub stays off and the other paths ship. No pin change. | R2; C25 |
| S5 | Accepted, with a 5 s timeout. | R2; C27 |
| S6 | Accepted. Viewers only; the C15 clause and the policy are amended in place. | R2; C15 |
| S7 | Amended: the definer names are reserved per file, and `no-eval`, `no-implied-eval` and `no-new-func` are turned on. There is no setting left to reserve. | R5; C21, C22 |
| S10 | Accepted. It covers all four set-once columns. | R2; C31 |
| S12 | Amended. The marker is `user.signup_txid`, stamped by a BEFORE INSERT trigger, not the xmin test. My probe on `postgres:17.10` reproduced P5, and also found that an UPDATE of an existing row in the same transaction passes the xmin test, so a forger could UPDATE user U and then pass as U. With the stamp, an old row gives f, a released savepoint gives t, the next transaction gives f, an updated old row gives f, `poly_app` writing the column is denied, and a second insert is refused. The setting is gone. | R2; C13, C17 |

Follow-ups: POLY-89 seats claimed manager and owner rows (seceng §6). POLY-90 requires the token plus consent for existing users, the 1 → 2 revocation, and the stamp rule. POLY-142 takes the bootstrap refusal, the C-84 wording and the token printed once. INFRA: Caddy drops the query from its log. The lead decides on a limit for `/callback/:id` and `/magic-link/verify`, and on `idle_in_transaction_session_timeout` for `poly_app` (a POLY-86 residual).

## Addendum 2: seceng S13 and two amendments (`seceng-ruling-review.md` @ 6578fd1)

- **S13: accepted, and enforced at commit (C32).** The fix is seceng's: `accept_invitations` clears the stamp, and `poly_govern` gets `UPDATE (signup_txid)` alone.
  - Is there a path that leaves a stamp because it has nothing to accept? No. Every route in `USER_INSERTING` ends in `acceptInvitations`, which raises when nothing is claimed, so the transaction rolls back and the row goes with it.
  - The deferred trigger turns that fact into an enforced invariant: whatever path a future change adds, a committed row never holds a stamp. A logical restore therefore carries only nulls, and no restore-runbook step is needed.
- **S7:** C21 gains the `setTimeout('x', 0)` fixture under the real globals.
- **S2:** C25 names the `getUserInfo` override, and tests the null return and the `github` fallback.
- **Totals:** 32 conditions. R2's table gains `app.signup_stamp_cleared()`, and C18's direct-call check covers it. The ruling is closed.
