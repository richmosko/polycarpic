# POLY-87 ruling (gate 1): invite-only sign-up

Architect, read at af7921c. Each claim below is marked **read** (with its file), **measured** (with the command), or **(unmeasured)**. An unmeasured claim is a condition that a red test settles; no build step rests on it alone.

## R0. Size: two loops

- **POLY-87 (this loop): the sign-up transaction.** It covers criteria 1, 3, 4 and 6–16.
- **New issue, blocked by POLY-87: the operator CLI.** It covers criteria 2 and 5, and R7 sets its seam.
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
| `app.record_signup_user()`: AFTER INSERT ON `public."user"`, invoker | — | — |
| `app.enter_new_user(uuid)` | `poly_authz` | `poly_app` |
| `app.claim_invitations(bytea, text) → int` | `poly_govern` | `poly_app` |
| `app.accept_invitations(bytea) → uuid` | `poly_govern` | `poly_app` |

- **`record_signup_user`**
  - Writes `set_config('app.signup_user_id', NEW.id::text, true)`.
  - If that setting is already non-empty in the transaction, it raises `42501`: only one user per transaction.
  - The setting's name appears only in 0007.
- **`enter_new_user(p)`** raises `42501` unless all of these hold:
  - the recorded setting equals `p`;
  - `app.user_id` is empty, which refuses a second call;
  - a `user` row with id `p` exists;
  - no `entity` has `self_user_id = p`.

  It then runs `set_config('app.user_id', p::text, true)`.
  - `poly_authz` is granted `SELECT (id)` on `user` and `SELECT (self_user_id)` on `entity`, with the policy `FOR SELECT TO poly_authz USING (true)`.
  - (unmeasured) A local `set_config` inside a function with a `SET search_path` clause outlives the function, because it is a different variable from the one the clause sets. Condition C5 settles this.
- **`claim_invitations(hash, email)`**
  - Locks the live rows `FOR UPDATE`, then counts them. Which rows:
    - with a hash: the row with `token_hash = hash AND lower(email) = lower($2)`;
    - with a null hash: every live row with `lower(email) = lower($2)`.
  - A count of 0 raises `42501 invitation_required`.
  - It writes nothing. Its job is the early refusal and the lock: a racing sign-up on the same invitation blocks on that lock, then re-checks the row after the first one commits and finds it claimed.
- **`accept_invitations(hash)` → the entity to land on, or null**
  - Raises `42501` unless `app.current_user_id()` is set and equals the recorded `app.signup_user_id`. This confines it to the sign-up transaction; existing-user acceptance is POLY-90's.
  - Reads the user's email from the `user` row, never from the caller.
  - Re-selects the rows `claim_invitations` would lock, `FOR UPDATE`. If there are none, it raises `42501`.
  - Sets `claimed_user_id` and `claimed_at` on each row.
  - For an entity row with role `viewer`, or with `user.second_step_at IS NOT NULL`, it inserts the membership and sets `accepted_at`.
  - For a no-entity row, it sets `accepted_at`.
  - It returns the newest seated `entity_id`.
- **Grants and policies added for `poly_govern`:**
  - `SELECT`, plus `UPDATE (claimed_user_id, claimed_at, accepted_at)`, on `invitation`;
  - the policies `FOR SELECT TO poly_govern USING (true)` and `FOR UPDATE TO poly_govern USING (true) WITH CHECK (claimed_user_id = app.current_user_id())`;
  - on `membership`, `FOR INSERT TO poly_govern WITH CHECK (user_id = app.current_user_id())`, which sits beside `seat_creator`'s policy;
  - `SELECT (id, email, second_step_at)` on `user`.
- **Grants for `poly_app`:** `SELECT (claimed_user_id, claimed_at)` on `invitation`. `token_hash` stays unselectable, and `poly_app` still has no `INSERT` on `membership` (POLY-62 R4).
- **Migrations are forward-only.** 0006 is generated and 0007 is custom, the 0003 pattern. The tracking row is written by `poly_owner`, and every definer owner gets `CREATE ON SCHEMA app` for that file only.

## R3. The sign-up transaction (one `withContextFreeTx`, in this order)

1. **Route hook (`route-policy.ts`, `/sign-up/email`).**
   - A token that is not 43 characters of base64url is refused with 403 `invitation_required`.
   - Otherwise the hook calls `claimInvitation(currentTx(), { email: body.email, token })`. A refusal is 403 `invitation_required`.
   - The answer is the same for an unknown, expired, revoked, claimed or mismatched token. Because the hook runs before BetterAuth's existing-email check, it does not reveal which emails have accounts.
   - With no context-free transaction open, the hook refuses.
2. **`user.create.before`**, on every path in `USER_INSERTING`:
   - It calls `claimInvitation` again. On `/sign-up/email` it uses the body token. On `/callback/:id` and `/magic-link/verify` it passes a null token, so the claim matches by email, which the IdP or the magic link has verified.
   - The row lock is already held, so the second claim is idempotent.
3. **BetterAuth inserts the user** inside its savepoint. The trigger records the id.
4. **`user.create.after`** (read, `better-auth/dist/db/with-hooks.mjs`: after-hooks are queued until BetterAuth's own transaction ends, then run with `"throw"` semantics, so they run in our outer transaction and a throw surfaces):
   - `tx.enterNewUser(created.id)`;
   - `provisionPerson(tx)`;
   - `acceptInvitations(tx, { token })`.
5. **Commit or rollback.** Any throw, or any BetterAuth failure response, rolls back through `RollbackWith` (read, `handler.ts`), which also strips the cookies. The user, Person, membership, invitation claim and session go together.
   - `app.user_id` and `app.signup_user_id` are local, so they end with the transaction. This is condition C9.
6. **Landing.** `@poly/tenancy` exports `landingEntity(tx)`: the newest entity seated by an accepted invitation, or else the user's own Person.
   - `apps/web/src/routes/+page.server.ts` redirects a signed-in user to `/dashboard?entity=<id>`, using `withTenant` from `locals.identity`.
   - The `entity` parameter is the seam for the entity selector, which does not exist yet.
   - A new `/sign-up` page (`+page.svelte`, the `/sign-in` pattern) reads `?invitation=`, posts it as `invitationToken`, offers Google and GitHub, and goes to `/` on success. Its response sets `Referrer-Policy: no-referrer`.
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
  - `"reservedSettings": ["app.signup_user_id"]`
- **`scripts/layers/plugin.mjs` gains three rules:**
  - `poly/confined-module`: every import form in POLY-140 C1 that resolves to a confined file is refused unless the importer is a named caller. Inside the package too, which covers `auth.ts` and `index.ts` re-exporting it.
  - `poly/reserved-setting`: any string or template literal in `apps/**` or `packages/**` source that contains a reserved name is refused.
  - `poly/confined-member`: `enterNewUser` used as a property name, whether called, read or destructured, is refused outside `packages/auth/src/user-hooks.ts` and `packages/db/src/context.ts`. This is driven by `"confinedMembers": { "enterNewUser": [those two files] }`.
- All three sit under `poly/*`, so an inline disable is already refused.
- **The import boundary must refuse:**
  - `db/auth` from outside `packages/auth` (already in place);
  - `new-user.ts` from any file but `context.ts`;
  - the reserved literal anywhere in source;
  - `enterNewUser` outside the two named files.

## R6. Tests (placement is POLY-141 C7)

| File | Area | Group | Covers | Cost (unmeasured) |
|---|---|---|---|---|
| `tests/db/auth-signup-invite.test.ts` (new) | `auth` | parallel | C1–C4, C6–C11 | ≤ 4 s CI file time |
| `tests/db/auth-new-user-step.test.ts` (new) | `auth` | parallel | C5, C12–C14 | ≤ 3 s |
| `tests/db/pgtap/05_invitation.sql` (new; already run by `pgtap.test.ts`) | `tenancy` | parallel | C15–C19 | ≤ 1 s |
| `tests/db/auth-signup-wrap.test.ts` (edited: its mock moves to `vi.spyOn`, or it seeds real invitations) | `auth` | parallel | POLY-86 C11 stays green | 0 |
| `tests/layers/` fixtures | `layers` job | — | C20–C22 | lint job |

- **Guard:** the `db` job median stays ≤ 100 s. qa states the summed CI file time of the new files at gate 2 and the job median at gate 3. If the median is above 92 s, the loop brings its own cut.

## R7. Seam for loop B (the CLI)

The CLI is a command in the worker container. INFRA §7.5 already runs `polycarpic-ops cli …` inside the worker as the operator.

- **Entry point.** `apps/worker/src/cli.ts`, with the body in `apps/worker/src/cli/` (the migrate `run.ts` split).
- **Database.** A new `@poly/db/operator` subpath exports `withOperatorTx(fn)`: `workerPool` (`poly_worker`), context-free, `app.actor = 'operator:cli'` local, nesting refused. It is confined to `apps/worker/src/cli/**`.
- **Issuing.** `@poly/tenancy` gains `issueOperatorInvitation(tx, { email, bootstrap })`, which calls `app.issue_operator_invitation(text, bytea, boolean)` (owner `poly_govern`, EXECUTE `poly_worker`). That definer:
  - takes `pg_advisory_xact_lock`;
  - with `--bootstrap`, refuses if any `user` row exists, and revokes every earlier unclaimed no-entity row;
  - without it, refuses if no `user` row exists;
  - writes `audit_event` `invitation.issued` with `entity_id` null.
- **Claiming.** B's migration adds `issued_via`. `claim_invitations` then refuses a `bootstrap` row once any user exists.
- **Delivery.** The CLI prints the link once to stdout. Emailing it is a follow-up.

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
2. No configuration input reopens sign-up. A test builds `authOptions` with every `AuthInput` variant and `NODE_ENV` values, and every one still refuses condition 1's cases.
3. An accepted link replayed by a second sign-up is refused, and the invitation's `claimed_user_id` is unchanged.
4. Two concurrent `/sign-up/email` requests on one token, each with its own connection, end with exactly one `user`, Person and membership. The loser leaves no row and gets 403.
5. After `enterNewUser`, `current_setting('app.user_id')` equals the new id until the end of the transaction. Measured inside the hook.

**Step 2: hooks and transaction**
6. A viewer entity invitation, through each of the three `USER_INSERTING` routes, seats a viewer membership on that entity and sets `accepted_at`. `landingEntity` returns the entity, and `/` redirects to `/dashboard?entity=<it>`.
7. A no-entity invitation leaves the user with their own Person only: `visible_entities()` has one element. `landingEntity` returns the Person.
8. A manager or owner invitation is claimed with no membership and `accepted_at` null, and the user lands on their Person.
9. After a forced rollback (a test trigger refusing the `session` insert), no `user`, `entity`, `membership` or `account` row exists, and the invitation is unclaimed.
10. A throw from `provisionPerson` (a test trigger on `entity`) and a throw after the step (from `acceptInvitations`) each leave none of those rows.
11. After commit, and separately after rollback, the next checkout of the same backend (a pool of `max: 1`) reads `app.user_id` and `app.signup_user_id` empty, and a context-free count of `entity` returns 0.

**Step 3: the step's refusals**
12. With the `enterNewUser` call removed (the test passes a hook variant), the same sign-up fails with 42501 from RLS and leaves no user row.
13. `enterNewUser` refuses each of these, each test on its own transaction:
    - an existing user's id;
    - a provisioned id planted with `set_config('app.signup_user_id', …, true)`;
    - a second call;
    - a call after the transaction ended;
    - an id whose insert was rolled back to a savepoint, after which the setting reads empty.
14. `@poly/db`, `@poly/db/auth` and `@poly/db/session` export no function whose source calls `enter_new_user`, and `Object.keys` of each contains no step. A `withTenant` or `withSystem` `Tx` has no `enterNewUser`.

**Step 4: catalog (pgTAP)**
15. `poly_app` has no INSERT on `membership`. `accept_invitations` seats `app.current_user_id()` only against a matching live invitation. It does not seat manager or owner while `second_step_at` is null, and does seat them once it is set (superuser fixture).
16. A no-entity invitation is visible to no `poly_app` SELECT or UPDATE policy. A `poly_app` INSERT of one is refused with 42501 (`gate_owner_changes`). `claim_invitations` and `accept_invitations` handle it.
17. `accept_invitations` called outside a sign-up transaction refuses with 42501. This covers a signed-in user, and a `set_config` of `app.signup_user_id` that differs from `app.user_id`.
18. Calling `record_signup_user()` directly fails. Each new definer appears in `definers.json` with its owner and EXECUTE list, and `search_path = ''` (C-15 check).
19. `poly_app` selecting `invitation.token_hash` is refused with 42501, and inserting a `token_hash` of 31 bytes fails `23514`.

**Step 5: lint**
20. Each of these is red, in every form POLY-140 C1 covers:
    - `packages/db/src/auth.ts` → `./new-user.ts`;
    - `packages/db/src/index.ts` → `./new-user.ts`;
    - `packages/auth/src/x.ts` → `@poly/db/new-user`;
    - the same import by a relative path.

    `context.ts` → `./new-user.ts` is green.
21. The literal `app.signup_user_id` is red in a `.ts` or `.svelte` source file. A `.sql` migration is not linted.
22. `tx.enterNewUser(...)`, and `const { enterNewUser } = tx`, are red in `packages/auth/src/handler.ts` and green in `user-hooks.ts`. A bare or inline disable is red.

## Paths outside the issue's current `paths`

`scripts/layers/**` and `tests/layers/**`, both for R5. Remove `apps/cli/**`; it goes to loop B as `apps/worker/**`.

## For seceng (plainly)

- **The step's residual.** `poly_app` can forge `app.signup_user_id`. `enter_new_user` then still acts for an existing but unprovisioned user, which is the documented C-84 residual. Confirm that it stays acceptable now that `accept_invitations` trusts the same setting. An attacker who forges it can accept only invitations addressed to that user's email.
- **Email as proof.** On the token-less OAuth and magic-link paths, a verified email alone claims every live invitation for that address. On `/sign-up/email`, possessing the token is the proof of the email. `emailVerified` stays false.
- **Widened policy.** The new `poly_govern` membership INSERT policy (`user_id = app.current_user_id()`, any role) is broader than `seat_creator`'s. It rests on the C-15 allowlist alone.
- **Lock time.** The row lock is held across BetterAuth's password hashing. (unmeasured) At most one sign-up per invitation waits.
- **Token in the URL.** The token sits in the page query string. `/sign-up` sends no referrer and loads no third-party asset. Access logs: Caddy's log format must drop the query (INFRA), so this is a deploy condition.
- **Not closed here:**
  - acceptance by an existing user (POLY-90);
  - seating a claimed manager or owner after enrolment (POLY-89);
  - the 1 → 2 revocation on acceptance (POLY-90; unreachable now, since no owner seats at sign-up);
  - `/change-email` (step-up) could later point an account at an invited address, so any future existing-user acceptance must not match by email alone;
  - loop B adds a second context-free path, `db/operator`, which changes the wording of SECURITY C-84 (the only context-free path is `db/auth`).
