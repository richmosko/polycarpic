# POLY-87 gate-1 ruling: security review (seceng)

I read the ruling at 789dd44, plus SECURITY C-01, C-05, C-15, C-84, T-90 and R-2, the 0001–0005 migrations, `context.ts`, `pool.ts`, `route-policy.ts`, `user-hooks.ts`, `handler.ts`, `options.ts`, `@poly/tenancy`, and better-auth 1.7.18 / @better-auth/core 1.7.18 (`sign-up.mjs`, `oauth2/link-account.mjs`, `plugins/magic-link`, `social-providers/github.mjs`).

**Probes.** I ran them on a scratch `postgres:17.10` container, the same tag as `infra/postgres/Dockerfile`, then removed it. Nothing tracked was changed.

- **P1.** A local `set_config('app.user_id', …, true)` inside a `SECURITY DEFINER … SET search_path = ''` function outlives the function. Result: `[abc]` with and without the clause, so C5 holds.
- **P2.** A local setting made inside a savepoint reads `[]` after `ROLLBACK TO SAVEPOINT` and `[u1]` after `RELEASE`. After `COMMIT`, the next transaction on the same backend reads `[]`.
- **P3.** Race: session A runs `SELECT … WHERE claimed_at IS NULL … FOR UPDATE`, sleeps 2 s, then claims and commits. Session B, blocked on the same predicate, re-checks the row after A commits and counts `0`. The R2 lock-then-recheck design works, provided the predicate sits in the locking query itself.
- **P4.** A function-level `SET lock_timeout = '500ms'` makes a blocked `FOR UPDATE` inside the function fail with `55P03` after 500 ms.
- **P5.** "This transaction inserted that row" can be tested from SQL, released savepoints included: `pg_xact_status(<xmin widened to xid8 with the current epoch>) = 'in progress'`. A visible row whose inserting xid is still in progress can only be this transaction's own. Results: an old row gives `false`, a row inserted in a released savepoint gives `true`, and the same row in the next transaction gives `false`.

**Verdict: pass with conditions** (S1–S12 below). The design is sound. Two things need fixing before tests are written: a real gap in email-as-proof (S1, S2), and one place where the stated residual is wrong (item 3, S12).

## 1. Invitation token: pass, with S9

- **Entropy, hashing, comparison.** 32 random bytes, stored as `sha256`, found by an equality lookup on the unique index. A slow hash is not needed for 256-bit secrets. Comparison timing does not matter, because the attacker does not control the preimage of the stored value.
- **Single use, expiry, revocation.** These are correct as specified: the claim predicate holds all three, and P3 shows the loser of a race re-checks.
- **Gap: canonical decoding.** 43 base64url characters carry 258 bits, so two strings decode to the same 32 bytes. That is harmless, but `hashInvitationToken`, the route hook and `seedInvitation` must agree on what gets hashed (S9).
- **Gap: revocation can be undone.** `poly_app UPDATE (revoked_at)` lets an owner set `revoked_at` back to null and revive a link. C-28's 1 → 2 revocation, and the criterion that a revoked link cannot be replayed, both rely on revocation sticking (S10).
- **Enumeration: pass.** The route hook runs before BetterAuth's `findUserByEmail` (read, `sign-up.mjs`), so without a valid token no response depends on whether an account exists.
  - A malformed token is refused before the database, so it answers slightly faster. That reveals only the token's shape, which is public.
  - Unknown, expired, revoked, claimed and mismatched tokens all take one indexed lookup.
  - A valid token for an existing account reaches BetterAuth's 422. Only someone who already holds the token can trigger that.
  - Two of the refusals are not yet covered by condition 1's byte-identical check: a refusal raised by the second claim (in the user hook), and a Postgres error escaping the route hook. Both must map to the same 403 with no SQLSTATE or message text (S8).
- **Token in the URL and in logs: unverified.**
  - The API carries the token in the POST body. BetterAuth logs the email on a duplicate sign-up, never the body (read).
  - The `/sign-up?invitation=` page URL is the exposure: the browser address bar and history, the bfcache, `handleError`, and the access log. The ruling's `Referrer-Policy` covers the outbound OAuth click.
  - Add `Cache-Control: no-store`, `history.replaceState` to remove the token from the address bar, and a log-capture test (S9).
  - Caddy dropping the query string from its access log is an INFRA deploy condition, as the ruling says.

## 2. Claim and accept definers: pass, with S4, S6, S7

- **Owner, grants, `search_path`.** The owner and EXECUTE table is right: no PUBLIC EXECUTE, `search_path = ''`, and each definer listed in `definers.json`, which C18 tests.
- **`claim_invitations` is an oracle from any `poly_app` transaction.** It is EXECUTE to `poly_app`, it takes a caller-supplied email, and it returns a count. Under `withTenant`, `SELECT app.claim_invitations(NULL, 'x@y')` tells the caller whether, and how many, live invitations exist for any address in any tenant. It also takes row locks on those invitations.
  - Fix: refuse when `app.user_id` is set, and return void (S4).
- **`accept_invitations` trusts nothing from its caller except the hash.** It reads the email from the `user` row. That is right; note that `poly_app` holds `UPDATE (email)` on `user` (0001), which only matters to a forger (item 3).
- **The widened membership INSERT policy for `poly_govern`** (any role) is the wrong width for this loop.
  - A brand-new user cannot have `second_step_at` set inside the sign-up transaction, because enrolment is closed and no factor row exists yet. So the "manager or owner once enrolled" branch of `accept_invitations` is reachable only by a forged context (item 3).
  - When reached, that branch seats an owner without C-28's 1 → 2 revocation, which does not exist yet.
  - Fix: remove the branch, and narrow the policy to `role = 'viewer'` (S6). Seating manager and owner belongs to POLY-89's enrolment write, beside the 1 → 2 rule.
- **Can `poly_app` reach a membership, or another user's invitation, through these definers?**
  - Through claim: yes, as an oracle and a lock (S4).
  - Through accept: only with a forged context (item 3, S12).
  - Unverified: the definer bodies do not exist yet.

## 3. The new-user step's residual: fail as stated; S12 fixes it

The ruling says a forger "can accept only invitations addressed to that user's email". That is true, and it is not the C-84 residual.

- C-84's argument was that a forged setting reaches only a user who was never provisioned, because `enter_new_user` refuses a user who already has a Person.
- `accept_invitations` does not go through that check. It needs only `app.current_user_id() = app.signup_user_id`, and under R-2 a forger sets both settings to an existing user U.
- What the forger reaches: they can seat U on any entity that holds a live invitation to U's email, and with the any-role policy that includes owner. They can also, acting as owner A (R-2), insert an invitation to X with a token they chose, then accept it as X.
- That defeats POLY-62 R4: membership only with the invitee's consent. R-2 does not already grant this, because `poly_app` has no INSERT on `membership`.
- **Fix (S12, measured by P5).** `accept_invitations`, and preferably `enter_new_user` too, require that the `user` row was inserted by the current transaction, using the xmin in-progress test.
  - This is database-side, and a setting cannot forge it.
  - It holds across BetterAuth's released savepoint. C-84's objection to xmin was the subtransaction id, and P5 shows the status test handles it.
  - Caveat: the epoch widening could misread an xmin from exactly 2³² transactions ago. That fails safe in practice, and the architect should state it.
  - With S12 the GUC remains, as the one-user-per-transaction marker, but it is no longer the proof.

## 4. The transaction: pass, with S5

- **Ordering.** The order is right: claim lock, then hash, then insert, then the step, then provision, then accept, all inside one `withContextFreeTx`. The race is settled by P3.
- **Rollback.** Rollback leaves nothing behind: P2 shows the settings clear, and `handler.ts` (read) strips cookies on rollback.
- **Pooled backend.** After commit and after rollback, the next checkout reads empty (P2). C11 tests it on `max: 1`.
- **Lock time.**
  - On `/sign-up/email`, the lock is taken only after a valid token and its email match, so only someone who holds the token can make others wait. A waiter holds a pool connection.
  - The token-less paths lock every live row for an email. Two token-less sign-ups for one address can deadlock (`40P01`) unless the rows are locked in id order. That would fail closed, but it should be orderly.
  - Fix: a lock timeout and id-ordered locking (S5).
- **Bigger lever, not this loop's to fix.** `withContextFreeTx` wraps `/callback/:id`, so a pool connection is held across BetterAuth's outbound calls to the provider (token exchange, `/user/emails`). `/callback/:id` and `/magic-link/verify` are not in C-04's limited list. See Bubble-up.

## 5. Email as proof: fail as built; S1–S3 fix it

- **Unverified provider email claims invitations.**
  - BetterAuth creates a new OAuth user even when the provider says the email is unverified. It stores `emailVerified: false` (read, `link-account.mjs`).
  - R3 step 2 then claims by that email, with no check that it is verified.
  - GitHub's default (read, `github.mjs:76–77`): it uses the public profile email when one is set, and `verified` from `/user/emails` for it, else `false`. Primary-only is not enforced.
  - **C-05's GitHub rule ("primary and verified, the public profile email is never used") is not implemented in `options.ts`**: there is no `getUserInfo` or `mapProfileToUser` override. That is a pre-existing gap, and this loop is the first to depend on it.
  - Fix: S2, both in the database and in the provider mapping.
- **Password path.** A leaked or forwarded token lets its holder create a password account for the invitee's address. `emailVerified` stays false.
  - BetterAuth 1.7.18's `accountLinking.requireLocalEmailVerified` defaults to `true` (read, `link-account.mjs:170`). So the real invitee's later Google sign-in does not link into the attacker's account; it fails as "account not linked". That is the safe outcome; pin it (S3).
  - The invitee can still take the account by magic link, which sets `emailVerified` (read), followed by a password reset, which revokes sessions.
  - Residual: a token holder is treated like a magic-link holder. Document it.
- **Token-less paths match every live invitation for the address.** That is acceptable once the email is verified.
  - It must never happen on `/sign-up/email`. Today the token comes from `ctx.body` when present and is null otherwise. Choose the mode by route template, not by whether the field is present (S1).
- **Residual: who can vouch for an email.** A Google Workspace admin for the invitee's domain can mint a verified address. A stale GitHub verified address from a former employer can still pass. Email is already the recovery root, so this is one more line in R-* (Open Risks).
- **`/change-email`.** BetterAuth's `changeEmail` is not enabled in `options.ts`, so the route is inert today.
  - The ruling's note stands: POLY-90's existing-user acceptance must need the token plus a signed-in consent action, never an email match alone.

## 6. Manager and owner invitations claimed, not seated: pass, with S6; follow-ups for POLY-89

- **No way to seat early once S6 lands.** A claimed row is not live, so it cannot be claimed again, and the owner can still revoke it.
- **Stuck.** The invitee lands on their Person with no seat until POLY-89. That is a UX gap, not a security one.
- **POLY-89 must:**
  - seat only `claimed_user_id = the enrolling user`;
  - re-check `revoked_at`;
  - apply an acceptance window, so that a claim does not wait forever. The ruling says expiry no longer applies after the claim;
  - run the C-28 1 → 2 revocation under the entity-row lock, in the same transaction.

## 7. Confinement (R5): pass as an accident guard; S7

The database refusals are the guarantee. The lint is a guard against accidents, not malice. These forms get past the three rules as specified:

- the definer names in SQL: `` sql`SELECT app.enter_new_user(${id})` `` from any `poly_app` file. Neither `enter_new_user`, `claim_invitations` nor `accept_invitations` is reserved, and C14 checks exports only;
- strings built at runtime: `'app.' + 'signup_user_id'`, a template literal split by an expression, `.join('.')`;
- escapes, unless the rule reads the cooked value: `'app.signup\x5fuser_id'`;
- computed access: `tx['enter' + 'NewUser']`, `tx[k]`, `Reflect.get(tx, …)`, `Object.getOwnPropertyDescriptors(tx)`. The method is non-enumerable, but it can still be enumerated by name;
- `eval` and `new Function`: there is no `no-eval` / `no-new-func` rule in `eslint.config.js`;
- in-process dependencies, BetterAuth included: covered by C-80, not by lint.

S7 closes the first three cheaply. The rest stay as residual, which S12 (database-side) makes harmless.

## 8. No way in on a fresh instance; no config reopens sign-up: pass (unverified until C2 and C23 run)

- **Read.** Of the application roles, only `poly_app` can INSERT a `user` row (0001, 0005). Its `user.create.before` refuses outside `withContextFreeTx` and refuses with no live claim.
- **Read.** An `invitation` row needs `poly_app` under the owner policy plus `inviter_user_id = app.current_user_id()`, or a superuser.
- No migration, app or script inserts a `user` row; the only hit, `apps/web/tests/e2e/serve.ts`, is a test harness.
- **Config.**
  - `authOptions` sets no `disableSignUp`, and has no flag to set.
  - BetterAuth's development-only branches change logging only.
  - C2's sweep of every `AuthInput` variant and `NODE_ENV` is the right test.
  - Add one assertion: `authOptions` carries no key that bypasses `databaseHooks`.
- **Condition 23 as written is the closure test.** Extend its `pg_proc` scan to "no function in `app` inserts into `invitation` or `user`".

## 9. Conditions to add before the tests are written

- **S1.** The token mode is chosen by route template. Only `/callback/:id` and `/magic-link/verify` claim and accept with a null hash. On `/sign-up/email`, both calls receive the body token.
  - Test: with invitations A and B live for one email, a sign-up with A's token claims A only, and B stays live.
  - Test: a `/sign-up/email` that reaches the user hook with no token is refused, and no user row exists.
- **S2.** Token-less acceptance needs a verified email.
  - `accept_invitations(NULL)` raises `42501` unless `user.email_verified` is true.
  - The GitHub provider maps the email per C-05: the `/user/emails` entry that is primary and verified, never the profile email.
  - Tests:
    - a mocked Google callback with `email_verified=false` leaves no user, and the invitation unclaimed;
    - a GitHub callback whose profile email has an invitation but is unverified in `/user/emails` claims nothing;
    - a GitHub callback whose primary verified email has an invitation claims it.
- **S3.** After `/sign-up/email`, `email_verified` is false. A Google callback for the same address then fails as account-not-linked and adds no `account` row. This pins `requireLocalEmailVerified` against a later pin change.
- **S4.** `claim_invitations` refuses with `42501` when `app.user_id` is non-empty, and returns void.
  - pgTAP: under `withTenant`, a call raises, and a concurrent claim on the same row is not blocked.
- **S5.** `claim_invitations` and `accept_invitations` carry `SET lock_timeout` (≤ 5 s) and lock rows `ORDER BY id`. A claim blocked past the timeout answers 403 `invitation_required`, not 500.
  - Test: the holder sleeps longer than the timeout.
- **S6.** `accept_invitations` seats viewers only.
  - The `poly_govern` membership INSERT policy is `WITH CHECK (user_id = app.current_user_id() AND role = 'viewer')`.
  - This replaces C15's clause "does seat them once set".
  - pgTAP:
    - with `second_step_at` set by a superuser, an owner invitation is claimed and not seated;
    - a body scan shows that only `seat_creator` and `accept_invitations` insert into `membership`.
- **S7.** `enter_new_user`, `claim_invitations` and `accept_invitations` join the reserved literals, each allowed in exactly one named file: `new-user.ts`, and the one `@poly/tenancy` file that wraps claim and accept.
  - The rule matches the cooked string value.
  - `poly/confined-member` also matches a computed member with a literal key.
  - Red fixtures:
    - `` sql`SELECT app.enter_new_user(…)` `` in `packages/auth/src/x.ts`;
    - `'app.signup\x5fuser_id'`;
    - `tx['enterNewUser']`.
- **S8.** Every refusal on `/sign-up/email` is the same 403 `{ code: 'invitation_required' }`: from the route hook, from the second claim, and from a Postgres `42501` or `55P03`. The body carries no SQLSTATE, message or hint.
  - On `/callback/:id` and `/magic-link/verify`, these cases redirect to the same error target: no invitation, unverified email, revoked.
- **S9.** Token handling:
  - The token must decode to exactly 32 bytes and re-encode to the same string, else 403. The hash is `sha256` of the decoded bytes, through the one `hashInvitationToken` that the fixture also uses.
  - With console output and the BetterAuth logger captured, no output contains the plaintext token, across C1's cases and a successful sign-up.
  - `/sign-up` answers with `Referrer-Policy: no-referrer` and `Cache-Control: no-store`, and the page removes `invitation` from the URL after reading it.
- **S10.** `revoked_at` is set once. A BEFORE UPDATE trigger refuses any change to it once it is non-null, with `42501` (pgTAP).
- **S11.** C23's `pg_proc` scan also asserts that no function in `app` inserts into `public."user"`. C2 also asserts that `authOptions` has no key that bypasses `databaseHooks` or turns them off.
- **S12.** `accept_invitations` raises `42501` unless the `user` row for `app.current_user_id()` was inserted by the current transaction (P5's test). `enter_new_user` should apply the same test; that is the architect's call.
  - pgTAP: with both settings forged to an existing, provisioned user who holds a live viewer invitation, the call raises and no membership is written.
  - The same holds for a user inserted in an earlier transaction.

**Follow-ups, not this loop:**

- **POLY-142.**
  - Refuse a bootstrap claim once any user exists.
  - Reword C-84 for `db/operator`.
  - Print the token once, never log it, 7-day expiry.
- **POLY-89.** Seating claimed manager and owner invitations, as listed in item 6.
- **POLY-90.**
  - Existing-user acceptance needs the token plus a signed-in consent action, never email alone.
  - The 1 → 2 revocation.
  - Reuse S12's test.
- **INFRA, deploy.** Caddy's access log drops the query string.

## What SECURITY will need

- **C-84.**
  - The mechanism is measured on PG17.10 (P1, P2).
  - Add the claim and accept definers, and S12's in-transaction test.
  - Correct the residual: a forged setting no longer reaches acceptance.
  - Add the definer names to the reserved literals.
- **C-01.** The token spec (32 bytes, `sha256`, canonical decoding), the invitation states, and claimed-not-seated for manager and owner.
- **C-05.**
  - The GitHub mapping becomes a live control with S2's tests.
  - Token-less claims require a verified email.
  - `requireLocalEmailVerified` is pinned (S3).
- **C-15.** Allowlist entries for the three new definers. The `poly_govern` membership INSERT policy is limited to viewers (S6).
- **C-28.** Revocation is set once (S10).
- **New threat entries:**
  - an invitation token leaked through the URL, logs or forwarding (C-01, S9);
  - an unverified provider email claiming an invitation (C-05, S2);
  - a cross-tenant invitation oracle (S4).
- **Open Risks:**
  - a token holder is treated like a magic-link holder;
  - an IdP domain admin, or a stale verified address, vouches for an email;
  - a pool connection is held across OAuth provider calls.

## Bubble-up

- **C-05's GitHub rule is documented as a control but is not in the code.** It predates this loop; S2 makes this loop implement it. If the architect would rather split it out, the token-less claim must not ship without it.
- **S6 and S12 change the ruling's text** (the C15 clause, the `poly_govern` policy, the C-84 residual). That needs an architect addendum before qa writes tests.
- **`/callback/:id` holds a pool connection across outbound provider HTTP, and neither `/callback/:id` nor `/magic-link/verify` is rate-limited.** This is a POLY-86-era residual. Suggest `idle_in_transaction_session_timeout` on `poly_app` and a limit on `/callback/:id`; it is the lead's call where that is filed.

## Addendum 1 check (ruling @ 9fbc2ec)

**Verdict: pass. S12, S7 and S2 are confirmed as amended. One new condition, S13, is cheap, and qa can write it with the rest.**

The architect is right about the xmin test I proposed in P5: an UPDATE in the same transaction rewrites xmin, so that test is unsound. The stamp replaces it.

**Probes.** I ran them on a scratch `postgres:17.10` container with an invoker BEFORE INSERT stamp trigger and a role holding 0005's column grants (`INSERT (id, name)`, `UPDATE (name)`), then removed the container.

- **P6. The stamp holds against a forger in one cluster.**
  - A row inserted inside a released savepoint matches `pg_current_xact_id()`: `true`.
  - An old row the same transaction UPDATEd: `false`.
  - An `INSERT … ON CONFLICT (id) DO UPDATE` on an old row, in a clean transaction: `false`. The stamp only exists on the discarded new tuple, and the role cannot SET the column.
  - Supplying `signup_txid` on INSERT, or on UPDATE: `permission denied`.
  - A second insert in one transaction, and an upsert after a first insert: `one user per transaction` (42501).
- **P7. A stale stamp matches again once a fresh xid counter reaches it.**
  - I set a row's stamp to the current xid plus 50, the way a row carried over by a logical restore (`pg_dump` into a new cluster) would look. Then I committed empty transactions as the plain role.
  - The equality hit at xid 801.
  - Inside one cluster this cannot happen: every stored stamp is below the counter, and xid8 never wraps.
  - After a logical restore, or a move to a new box by dump, every user's stamp is a future xid. A SQL-level forger (R-2) can burn transactions until one matches, then pass `accept_invitations` as that user, which is S12's attack again.
  - `enter_new_user` still refuses that user, because they have a Person. `accept_invitations` does not.
- **P8. Lint (eslint 10.14.0, core rules).** Flagged: `eval(…)`, `globalThis.eval(…)`, `(0, eval)(…)`, `new Function`, `Function(…)` and `Function.call(…)`.
  - Not flagged: `globalThis['ev' + 'al']`, `globalThis[k]`, and `setTimeout('…')`.
  - `no-implied-eval` only fires when `setTimeout` is a declared global, and my scratch config declared none.
- **P9. GitHub (read, `@better-auth/core` 1.7.18, `github.mjs:65–88`).**
  - `options.getUserInfo`, when given, replaces the whole lookup, so the C-05 mapping can be built and measured on the pin with a mocked fetch.
  - `mapProfileToUser` cannot do it: it sees only the profile, and `emailVerified` is computed beforehand for `profile.email`.

**Rulings.**

- **S12 (stamp): confirmed, with S13.**
- **S7: confirmed.**
  - Per-file reserved names and cooked matching close the forms that matter.
  - Computed global access (`globalThis[k]`) stays residual. With S12 and S13 the database refuses whatever it reaches.
  - C21's `eval` fixture must run under the repo's real `languageOptions.globals`. Add a red `setTimeout('x', 0)` fixture, so `no-implied-eval` is shown to fire and not merely enabled.
- **S2: confirmed, including the fallback that refuses a `github` input.**
  - The mapping must be a `getUserInfo` override, not `mapProfileToUser`.
  - It returns null, which refuses the sign-in, when no entry is both primary and verified.
  - C25 covers both the override and the fallback.

**New condition**

- **S13.** The stamp does not outlive its transaction.
  - `accept_invitations`, the last step of every sign-up, sets `signup_txid = NULL` on the new user before it returns. It runs as `poly_govern`, which gets `UPDATE (signup_txid)` on `user`; nobody else does.
  - pgTAP:
    - after a committed sign-up, every `user.signup_txid` is null;
    - a row given a future `signup_txid` by a superuser (a restored row) passes neither `enter_new_user` nor `accept_invitations` in any later transaction, and stays null-or-refused.
  - If the architect prefers, a restore-runbook step that nulls the column is the fallback, but the in-transaction clear is the stronger choice.
  - Optional and partial, not a substitute: `accept_invitations` can also refuse when the stamped user already has a membership other than their Person's owner row. An existing user who holds only their own Person passes that check, so S13's clear remains the control.

## Build check (5ad6811)

**Verdict: S1–S13 met.** One new finding, S14. It assumes an attacker who can run SQL as `poly_app`, and it is cheap to close.

**Probe P10.** I ran it on scratch `postgres:17.10`, using the real `roles.sql` and migrations 0000–0007 applied as `poly_migrator` with `SET ROLE poly_owner`. The SQL was run as `poly_app`. Every result below is what the migrations do, not a model of them. The container is removed.

| S | Met | Where | Evidence |
|---|---|---|---|
| S1 | yes | `packages/auth/src/user-hooks.ts:28–37` (`tokenFor` chooses by `ctx.path`; `/sign-up/email` with no token → 403; any other path → 403) | condition 24 tests |
| S2 | yes | `0007:93–95` (null hash and not `email_verified` → 42501); `packages/auth/src/github.ts:19–30` (`getUserInfo` override: the primary and verified entry only, else null); `options.ts:45` | P10: a token-less accept for an unverified new user raised "a verified email is required"; condition 25 |
| S3 | yes | BetterAuth default `requireLocalEmailVerified`; nothing in `options.ts` overrides it | condition 26 |
| S4 | yes | `0007:58–60`, returns void | P10: a claim with `app.user_id` set → 42501; condition 30, pgTAP C30 |
| S5 | yes | `0007:55, 65, 76, 101` (`lock_timeout = '5s'`, `ORDER BY i.id FOR UPDATE`); `invitation.ts:28–31` maps 55P03 to the refusal | condition 27 |
| S6 | yes | `0007:19–20` (policy `role = 'viewer'`), `0007:104–109` (only viewer rows are seated) | P10: an owner invitation for a user whose `second_step_at` a superuser set → claimed, not accepted, no seat; a direct `poly_app` membership INSERT → permission denied |
| S7 | yes | `layers.json` (`reservedLiterals` per file, `confinedMembers`); `scripts/layers/generate.mjs:24, 61–63` (globals declared; `no-eval`, `no-implied-eval`, `no-new-func`); fixtures `tests/layers/fixtures/31-*`, `32-*` (escaped, unicode-escaped, the sql tag, `setTimeout` string, computed literal key) | — |
| S8 | yes | `user-hooks.ts:25, 46–53`; `route-policy.ts` (`/sign-up/email` branch); `handler.ts:59–62` (a 42501 at COMMIT → the same 403 body) | conditions 1, 28, including the callback and magic-link redirect target |
| S9 | yes | `invitation.ts:14–25` (canonical 32-byte decode, sha256 of the bytes); `apps/web/src/routes/sign-up/+page.server.ts:5` (`no-referrer`, `no-store`); `+page.svelte:15–18` (`replaceState`) | condition 29 |
| S10 | yes | `0007:151–164, 179–180` | P10: an owner's revoke followed by an un-revoke → 42501; pgTAP C31 |
| S11 | yes | pgTAP `05_invitation.sql:212–214` (no `app` function inserts into `invitation` or `user`); `auth-signup-invite.test.ts:85–111` | — |
| S12 | yes | `0007:36, 88–92` (`signup_txid = pg_current_xact_id()`); 0005 column grants omit `signup_txid` | P10: accept forged to an existing user U → 42501, also after an UPDATE of U's row in the same transaction; `enter_new_user(U)` → 42501; `poly_app` writing `signup_txid` → permission denied |
| S13 | yes | `0007:115` (accept clears the stamp), `0007:139–141` (a non-`poly_app` insert gets null), `0007:166–182` (the deferred check) | P10: superuser fixture stamps read null; a happy sign-up commits with the stamp null and lands on E (viewer@E, owner@own Person); a token replay → 42501; an insert with no accept → refused at COMMIT, and no row is left |

**`apps/web/src/hooks.server.ts:11`: `isPublic` gains exactly `'/sign-up'`. Pass.**

- The match is exact: `/sign-up/x` stays private, and the query string is not part of `pathname`.
- The page's load sets two headers and returns no data, so an unauthenticated visitor gets the form and nothing else.
- The page reaches the database only through `/api/auth/sign-up/email`, which every condition above guards.

**Two observations, neither blocking.**

- **(a) `handler.ts:59–62` covers more than sign-up.** It maps any `42501` that surfaces at COMMIT to 403 `invitation_required`, on every route that `inTransaction` wraps, `withTenant` ones included.
  - No information leaks, but a commit-time refusal on a signed-in route would carry a misleading code.
  - Suggestion: apply the mapping only on the `withContextFreeTx` branch.
- **(b) The user hooks read `ctx.path`.** If a future BetterAuth reports the concrete path instead of the template, both hooks refuse, so they fail closed. Condition 24 pins this.

**S14 (new; proposed for this loop, since it is a migration-only change).**

- **The gap.** A sign-up transaction can rewrite its own new user's email before calling accept.
  - `poly_app` holds `UPDATE (email, email_verified)` on `user` (0001, 0005), and `accept_invitations` reads the email from the row at call time.
  - Probe P10, as `poly_app`, in one transaction:
    1. insert user M as `mallory@x` (stamped);
    2. `enter_new_user`, then the Person;
    3. `UPDATE user SET email = 'steal@x', email_verified = true`;
    4. `accept_invitations(NULL)`;
    5. set the email back, then commit.
  - Result: M is seated as viewer on E, against an invitation addressed to `steal@x`.
- **Who can do this.** Only an attacker who can run SQL as `poly_app` (R-2): the route hooks never update the email.
- **Why R-2 does not already cover it.** R-2 lets such an attacker act as any existing user. But a forged direct invitation is refused by `gate_owner_changes` on an entity with several owners. This path instead takes any pending viewer invitation, in any tenant, into a durable account the attacker owns.
- **Fix.** A BEFORE UPDATE trigger on `user` refuses (42501) any change to `email` or `email_verified` while `signup_txid IS NOT NULL`, which is the window between insert and accept.
- **Test.** The P10 sequence raises at step 3, and no membership is written.
- **Check first.** No BetterAuth new-user path updates those columns before its after-hook runs. Magic link and OAuth set `email_verified` at create (read). The condition-6 route tests confirm it.
- **If the lead defers S14,** record it as an R-2 residual in SECURITY.

## C33 check (833491f)

**S14 met.** The fix is `app.signup_email_fixed`, a BEFORE UPDATE trigger on `user`, in `packages/db/migrations/0007_invitation_definers.sql:186–199`.

**Probe P11.** I ran it on scratch `postgres:17.10`, applying the real `roles.sql` and migrations 0000–0007 at 833491f, with the SQL run as `poly_app`. The container is removed.

- **The theft sequence is refused.** I re-ran the P10 sequence: insert M, enter the new-user step, create the Person, then `UPDATE email = 'steal@x', email_verified = true`. It raises 42501 at the UPDATE. The transaction rolls back, leaving no user row and no membership.
- **Legitimate updates still pass.**
  - A `name` change while the stamp is set passes.
  - An `email` change on a user whose sign-up committed passes.
  - The happy-path sign-up still commits, with the stamp cleared.
- **The earlier probes are unchanged on this head.** P10's refusals for S2, S4, S6, S10, S12 and S13 give the same results as before.

**SECURITY.** C-84 carries C33. The remaining risk, a SQL-level forger inserting a fresh user for an invited address, sits in C-84 and in R-2, which already covers what such a forger can do. No new R entry is needed.
