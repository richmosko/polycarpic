# POLY-145 — threat model of the identity assertion (seceng)

Scope: one question only — who can make Postgres believe a request belongs to a given user, and what they can do with that belief. Authorization inside a correct identity (what an owner may do to their own entity) is out of scope; so is the operator's superuser (R-1).

What is true today, read from the tree on 2026-11-13:

- Every RLS policy reads `app.current_user_id()`, which is `nullif(current_setting('app.user_id', true), '')::uuid`. Any role can set a dotted setting (Postgres docs, `prior-art.md`), so `poly_app` and `poly_worker` can each name any user in any transaction they open.
- `poly_app` holds `SELECT` on `session`, `account` and `verification`, and none of the three has RLS (`packages/db/migrations/0001_app_foundation.sql` line 27; no `ENABLE ROW LEVEL SECURITY` for them in any migration). `poly_worker` holds no grant on them.
- BetterAuth stores session tokens in the clear (R-12). It also stores **password-reset tokens and magic-link tokens in the clear**: in 1.7.18 `verification.storeIdentifier` and the magic-link plugin's `storeToken` both default to plain, and `packages/auth/src/options.ts` sets neither (`db/verification-token-storage.mjs`, `plugins/magic-link/index.mjs` line 42; code-read). This is not in R-12, which says "A DB read alone cannot forge one" — true of the session cookie, not of these links.
- The auth secret (`BETTER_AUTH_SECRET`) is in web's environment; it signs session cookies and encrypts TOTP seeds, backup codes and OAuth tokens.
- The worker holds the credential keyring and opens every sealed bank credential (C-30). It reads tenant data through RLS as whatever user it names, and writes only the import path (SECURITY §4.4).

## Attackers

| # | Who | Typical way in |
|---|---|---|
| A1 | An outsider attacking the web app over the internet | A SQL-injection bug, a code-execution bug in our code or a dependency, a malicious upload (CSV/OFX is parsed in web, TB-11) |
| A2 | Anyone who can put bytes into provider data | Payee and memo text (anyone who sends the user money), a hostile or compromised aggregator or price feed; reaches the worker's parsers |
| A3 | A malicious package or image (supply chain) | A dependency of web or worker, or a poisoned release image (TB-12); persistent code execution |
| A4 | Someone who obtains a database password | A leaked secrets file, a misconfigured backup of the secrets directory, a foothold in another container on the box. Postgres is on the internal compose network only, so A4 needs a network path too |
| A5 | Someone who obtains a user's session | Malware or a shared device on the user's side, XSS, a cookie in a log |
| A6 | A family member acting beyond their role | Out of scope here (authorization, not identity); noted because hosting turns family members into strangers |

## Scenarios and today's reach

Each scenario is reused in `comparison.md`.

**S1 — SQL injection in web (one injectable statement in a request).**
Injected SQL runs inside a transaction that already names the requesting user, and it can call `set_config('app.user_id', …, true)` again. Reach: read and write as any user, within `poly_app`'s grants (everything the app itself can do), for the length of that transaction. It can also read every live session token, every pending password-reset and magic-link token, and all TOTP and OAuth secrets in their encrypted form. The tokens convert a one-off injection into a lasting takeover: request a reset or magic link for any address through the open route, read the token from `verification`, use it. Whether a magic-link sign-in still asks an enrolled user for their second factor was not measured. Limits: no DDL or TRUNCATE (C-10), no bank credential (C-30), cannot enter an existing user through sign-up or acceptance (C-84), cannot write `recent_auth_at` or `second_step_at` (column grants).

**S2 — Code execution in web, brief (one exploit, no foothold).**
Everything in S1, without needing an injectable statement, plus the auth secret. With the secret it can turn any stored session token into a valid cookie, and decrypt every user's TOTP seed and backup codes — so it can pass any user's second factor from then on. Reach outlives the exploit until the auth secret is rotated, every session is revoked and every user re-enrols their authenticator.

**S3 — Code execution in web, persistent (A3, or A1 who stays).**
Everything in S2, plus every password typed at sign-in, every cookie and every page as users use the app. No identity design inside the database removes this: the process that serves a user can always act as the users it is serving. What a design can change is whether it can act as users who are *not* currently using it, and whether it can mint identity after it is evicted.

**S4 — Code execution in the worker through hostile provider or import data (A2).**
The worker opens every sealed bank credential (independent of identity; only isolating the parser changes this). Through the identity setting: read every user's books, write import-path rows (raw transactions, drafts, transfer matches, auto-posted journal entries, provider status) into any entity, and issue no-entity operator invitations (C-01). It cannot read the session, account or verification tables, so it cannot sign in as anyone.

**S5 — Stolen `poly_app` password, with a network path to Postgres (A4).**
S1's reach without the time limit of one request, and without any bug in our code: any user, any time, plus every stored token. Not the auth secret, which is not in the database.

**S6 — Stolen `poly_worker` password, with a network path (A4).**
S4's reach in the database (every user's books readable, import-path writes anywhere), without the keyring.

**S7 — Stolen session (A5).**
Acts as that one user until the session ends (7 days idle, 30 absolute) or is revoked. Step-up (C-03) and the second-factor gates protect the high-impact actions. Every option in `comparison.md` honours a valid session, so this scenario mostly measures token lifetime and revocation speed.

**S8 — Database contents at rest (a backup or a read replica).**
Backups are encrypted before leaving the box (TB-7). If one is opened: plain session tokens (useless without the auth secret), plain pending reset and magic-link tokens (usable if still unexpired, 15 minutes), encrypted TOTP and OAuth secrets.

## What the scenarios show

1. Today, any SQL as `poly_app` — injection or a stolen password — equals **every user, indefinitely**, mostly through the plain reset and magic-link tokens rather than through `app.user_id` itself. Fixing only the setting would leave that door open.
2. The worker's largest power (all bank credentials) has nothing to do with the identity setting. Its identity reach is wide but bounded by the import-path grants.
3. Code execution in web is the one scenario where the difference between "any user" and "users currently signed in" is real but not total; in a single-family instance, the users signed in during a week are probably all of them.
4. R-2's premise that `poly_app` "has to read the session table for auth anyway" holds only while BetterAuth runs inside web with `poly_app`'s grants. It is a consequence of today's layout, not a law.
