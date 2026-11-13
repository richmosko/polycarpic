# POLY-145 — the lead's independent read

Author: team-lead, 2026-11-13 (UTC). Written from `options.md`, `threat-model.md`, `comparison.md`, `prior-art.md`, `current-state.md` and `pricing.md` at `0afd404`, before opening `seceng-recommendation.md` or `architect-recommendation.md`. One caveat on independence: seceng's hand-off message told me their recommendation is (e1) with (e2), the (a+) fixes now and (e3) later, so I knew their conclusion, not their reasoning.

## What I checked myself

| Claim | How I checked | Result |
|---|---|---|
| Identity is one unverified setting | `packages/db/migrations/0001_app_foundation.sql:17-19`; `packages/db/src/context.ts:160,179` | Confirmed. `app.current_user_id()` reads `app.user_id`, and the wrappers set it with `set_config`. |
| The worker holds the auth secret | `packages/config/src/registry.ts:17`; `infra/compose/prod.yml:72,75` | Confirmed. |
| Magic-link tokens are stored plain | `better-auth@1.7.18` `dist/plugins/magic-link/index.mjs:42`; `packages/auth/src/options.ts` sets no override | Confirmed. |
| `poly_app` can read `verification`, which has no RLS | `0001_app_foundation.sql:27` | Confirmed. |
| Session tokens are stored plain, with no option to hash them | `dist/db/internal-adapter.mjs` (`token: generateId(32)`); a search of `dist` for a session-token hashing option | Confirmed plain. No hashing option found. |
| Supabase's `auth.uid()` reads a setting and verifies nothing | A second fetch of the same migration file in `supabase/auth`, 2026-11-13 | Confirmed. The body reads `request.jwt.claim.sub`, then `request.jwt.claims`, through `current_setting`; no cryptographic check. |

Not checked by me: the password-reset default (`verification.storeIdentifier`), the PostgREST, Hasura and `pg_session_jwt` pages, and every loop-day figure.

## The answer to the Principal's instinct

The instinct is right about the goal and wrong about the example. Supabase's Postgres does not verify who the user is. Its `auth.uid()` reads an ordinary setting, the same kind ours does, and a gateway fills it in. Supabase is safer than our design today only because the component holding that power is generic, widely used and runs none of the customer's code. Option (c) would buy us that, at the price of rewriting every query and taxing every later feature.

Option (e1) gets closer to the goal than Supabase does. The code that decides who the user is shrinks to one database function and a sign-in service that serves only the auth routes. Postgres itself refuses an identity that did not come from a live session. That part is short enough to read line by line and to test exhaustively.

## My read of the options

- **(c), (d1), (d2): no.** (c) moves the trust; it does not remove it. (d1) has today's weakness. (d2) buys what (e1) buys for more cost and a sign-in service that can create database roles.
- **(b): no.** The only maintained verifier found lets the connecting client supply the key, by its own README. Building our own means native code inside the database that nobody here can audit. Sign-out also stops being immediate.
- **(a+): yes, now, whatever else is decided.** It is cheap and it closes the hole that turns one SQL bug into permanent account takeover.
- **(e1) is the right target.** I would reach it in the architect's stages, with a checkpoint between them.

## Where I differ from, or add to, the source files

**1. Hashed session storage is a requirement of (e1), not a bonus, and it is not priced.** Today a session token read from a backup is useless without the auth secret, because the cookie is signed. Under (e1) web no longer holds that secret, so web cannot check the signature, and the database function accepts the raw token. If tokens stay plain in the table, anyone who reads a backup can present a token and be let in. That would be a step backwards on scenario S8. `options.md` says sessions are stored as hashes; `prior-art.md` says the library has no such setting; `pricing.md` prices the sign-in service as BetterAuth "unchanged in substance". Those three do not agree. How the service stores a hash while BetterAuth looks sessions up by plain token must be worked out and measured before stage 2 is committed.

**2. Stage 1 does more against SQL injection than `pricing.md` claims.** The marker is keyed by transaction, one row per transaction. An injected statement runs inside a transaction that already has its marker, so a second attempt to name a user is refused. That takes scenario S1 from "any user" to "the requesting user" before the sign-in service exists. It does not help against a stolen `poly_app` password, which can still open a fresh transaction and name anyone until stage 2. This should be proven by a test, not taken from my reasoning.

**3. The marker's running cost is the main technical unknown.** Every request, including read-only ones, would write a row. `app.current_user_id()` changes from reading a setting to reading a table, and row-level security calls it often. Neither cost is measured. Stage 1 is where it gets measured, against POLY-63's two-second dashboard criterion, with a fallback design (a keyed tag on the setting) if it fails.

**4. The gain in a single-family instance should not be oversold.** If an attacker runs code inside web for a week, they act as nearly everyone under every option. What (e1) changes is narrower and still worth having:
- a SQL bug or a leaked app password no longer means every user;
- passwords, authenticator seeds and backup codes never pass through web, the process with the large attack surface (pages, uploads);
- the attacker cannot keep minting identities after being evicted.

**5. The sign-in service becomes the most valuable process.** It holds the auth secret and can create a session for anyone. Its protection is that it exposes only the auth routes. BetterAuth is still a large library facing the internet. The decision should record that as the residual risk that replaces R-2, not present R-2 as closed.

## What I would put to the Principal

1. **Now:** the (a+) fixes. Hashed reset and magic-link tokens (already on POLY-137), the auth secret out of the worker, the operator CLI on its own database role.
2. **Next, one loop (about 3.5 loop-days):** stage 1. The transaction marker, scoped worker entry, and web entering through one function. It includes the measurements in point 3 and the test in point 2.
3. **A short spike before stage 2:** hashed session lookup with BetterAuth (point 1), and BetterAuth as a separate same-origin service behind Caddy.
4. **Then stage 2 (about 8 to 10 loop-days):** the sign-in service, and web entering by session token. POLY-89 resumes after stage 1, specified against the marker.
5. **With import:** scoped job grants (e2) and the parser sandbox (e3). The sandbox is the only thing on the list that limits the worker's access to every bank credential.
6. **If hosting is ever taken up:** one instance per family (e4) on top.

The cost is real: (e1) in full is 11.5 to 14 loop-days by the architect's estimate, about twice what the identity work has cost so far. Nothing is deployed, so this is the cheapest moment it will ever be.

## What would change my mind

- The marker fails the dashboard budget and the keyed-tag fallback does too.
- Hashed session lookup cannot be done without forking BetterAuth. Then (e1)'s at-rest story needs another answer before it is safe to adopt.
- BetterAuth does not run cleanly as a separate same-origin service.

## Open for the Principal

- Whether to commit to (e1) in full now, or to stage 1 plus the spike, with stage 2 decided on their results. I recommend the second.
- Whether the plain-token fix waits for POLY-137 or lands as its own small change first.

## After reading both recommendations (added 2026-11-13)

All three reads name (e1) as the target and reject (b), (c) and (d). They differ on order: the architect puts both stages before POLY-89; seceng supports staging without fixing POLY-89's place; I put POLY-89 after stage 1 with a spike before stage 2.

One correction to my point 4. The architect notes that web still serves the sign-in and sign-up pages, so an attacker who stays inside web can alter the page script and capture passwords as they are typed. "Passwords never pass through web" holds only if the sign-in service serves those pages too, which is unpriced (the architect guesses 1 to 2 loop-days and a DESIGN change). I had missed that.

Neither recommendation addresses my point 1 (hashed session storage as a requirement of stage 2). It stays open.

The architect's file does not carry the line I asked for about having seen seceng's lean towards (e1) before writing.
