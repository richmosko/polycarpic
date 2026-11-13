# POLY-145 — options compared (seceng)

The question: which component may tell Postgres who the user is. Each option below is a mechanism sketch only; what it stops, what it costs to trust, and how it treats the worker and the operator are in `comparison.md`. Vendor behaviour is stated only in `prior-art.md`, with sources; nothing here relies on it.

Two attacker capabilities recur, and they differ:

- **SQL as the role** — SQL injection, or a stolen database password. The attacker can run any statement the role is granted, and nothing else.
- **Code in the process** — remote code execution in web or worker, or a malicious dependency. The attacker has everything the process has: its database credential, its keys, and every cookie or token that passes through it while they are there.

## (a) Today's design, with its mitigations

web connects as `poly_app`, worker as `poly_worker`. Before any query, `withTenant` runs `set_config('app.user_id', <id>, true)`; every RLS policy reads `app.current_user_id()`. Postgres trusts whatever value is set, so any code that can send SQL as either role can name any user. BetterAuth runs inside web as `poly_app` and can read the `session` table, whose `token` column holds live session tokens in plaintext (`packages/db/src/schema/auth.ts`). Mitigations: parameterised SQL with lint and CodeQL (C-44); a branded `SessionUserId` and no exported raw pool (C-11); the sign-up stamp, so a forged id cannot enter an existing user through sign-up or invitation acceptance (C-84); web cannot open bank credentials (C-30); no DDL or TRUNCATE (C-10); `poly_worker`'s tenant writes are limited to the import path (SECURITY §4.4); `poly_worker` reads tenant data through the same RLS under whatever user it names.

## (b) Postgres verifies a signed token; sign-in moves to a small separate service

A new sign-in service (BetterAuth moves there) is the only holder of a private signing key. On every request, web passes the user's short-lived signed token (minutes) to Postgres as its first statement. A Postgres extension verifies the signature against the service's public key and exposes the verified claims; policies read the verified user id, never a GUC the app can set. web and worker hold the public key only, so they cannot mint a token for anyone; they can only replay tokens they have been handed. The session table moves out of `poly_app`'s reach. Needs: an extension that verifies JWTs inside Postgres (an existing one or our own), key rotation, and a refresh path from browser to service.

## (c) A thin generic data-access layer in front of Postgres (Supabase / PostgREST style)

web and worker hold no database credential at all. They call a small HTTP service that holds the only login role, verifies the caller's signed token itself, switches to an unprivileged role, places the verified claims in transaction-local settings, and runs a query it generates from the request (or a named function). Policies read those settings. The trusted code is the gateway plus the token verifier, not our app. Our app's queries become HTTP calls; ledger postings that need one transaction become database functions the gateway calls by name. Sign-in still has to live somewhere that holds the signing key — a separate service, as in (b).

## (d) One database role per user

Every user is a Postgres role; policies read `current_user` (or `session_user`) instead of a setting. Two very different forms: **(d1)** the app connects once as a login role that is a member of every user role and runs `SET LOCAL ROLE <user>` per transaction — whoever can send SQL as that login role can switch to any user, so this has today's weakness under a different name; **(d2)** each user's own credential reaches Postgres (a per-user password or certificate, or a short-lived per-user credential issued by the sign-in service), so the app cannot become a user it was not given. (d2) breaks shared connection pooling, puts role creation and deletion on the sign-up and deletion paths, and needs the superuser-adjacent `CREATEROLE` somewhere.

## (e1) Postgres checks an opaque session itself (no JWT)

The cousin of (b) without signatures. The sign-in service is the only writer and reader of the session table; `poly_app` and `poly_worker` lose all grants on it. web passes the cookie's session token to one allowlisted definer, `app.enter_session(token)`, which hashes it, finds a live session, and marks the transaction as that user in a form the caller cannot set itself — for example a setting paired with a keyed tag that only the definer's role can compute, checked by `app.current_user_id()`, which returns null on a mismatch. Revocation is immediate (delete the row); no key management, no extension beyond `pgcrypto`. Sessions are stored as hashes, so the table is useless to whoever reads it. This option tests R-2's claim that "poly_app has to read the session table for auth anyway": that is true only while BetterAuth runs inside web.

## (e2) Worker: scoped job grants

Applies on top of (b), (c), (d2) or (e1); on its own it changes nothing. When a user links a connection, the sign-in service mints a job grant bound to that connection and entity, stored as a hash. The worker presents it to a definer (`app.enter_job(grant)`) that marks the transaction with the linking user *and* a job scope, and policies give a job scope only the import-path writes for that entity. The worker can no longer name an arbitrary user; it can act only for connections it holds a grant for, and only in the import path. The grants themselves are sealed under the worker's keyring, so code execution in the worker still reaches every grant it holds — the scope, not the secrecy, is what limits it.

## (e3) Worker: parser sandbox

Independent of identity. The code that parses provider responses and uploaded files (the untrusted input) runs in a separate process with no database credential, no keyring and no network, and returns plain typed rows to a small writer that validates them and holds the database connection. A parser exploit then reaches only the rows of the file it is parsing. This shrinks the worker's attack surface at the place it actually meets hostile input, whatever the identity design.

## Not separately listed

- **A "trusted gateway" module inside web** — same process, same compromise as (a); not an option.
- **Read-only role for read requests** — narrows SQL injection on GET paths, but does not answer who the user is; noted in `comparison.md` as a mitigation to (a).
