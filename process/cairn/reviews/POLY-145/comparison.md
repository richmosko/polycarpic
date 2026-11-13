# POLY-145 — options against the same attacks (seceng)

Options are defined in `options.md`, scenarios S1–S8 in `threat-model.md`, vendor facts in `prior-art.md`. Running cost and rework are the architect's; this file covers what each option stops, what must be trusted, and what it does to the worker and the operator. Claims about mechanisms we have not built are marked (unmeasured).

## 1. Reach per scenario

"Any user" means every user on the instance, indefinitely. "Requesting user" means only the user whose request the attacker is riding, for that request. "Active users" means users whose requests pass through the compromised process while the attacker is in it.

| Scenario | (a) today | (a+) hardened | (b) DB-verified JWT | (c) gateway | (d1) SET ROLE | (d2) per-user credential | (e1) DB-checked session |
|---|---|---|---|---|---|---|---|
| S1 SQL injection in web | Any user, and lasting takeover through plain reset / magic-link tokens | Any user, for that transaction only; no lasting takeover from the database | Requesting user only | Not applicable as such: our app sends no SQL. Injection moves into the gateway's query builder (generic, widely tested) or our SQL functions | Any user (`RESET ROLE`, `SET ROLE` again) | Requesting user only | Requesting user only |
| S2 brief code execution in web | Any user, and lasting: the auth secret signs cookies and decrypts every TOTP seed | Same as (a): web still holds the auth secret | Active users, until their short tokens expire (minutes) | Active users (web still sees every token) | Any user | Active users | Active users, until those sessions are revoked |
| S3 persistent code execution in web | Every user who signs in, with passwords and second factors captured | Same as (a) | Active users; sign-in traffic bypasses web if routed straight to the service, so no passwords or seeds | Active users; same proviso | Any user | Active users | Active users; same proviso |
| S4 code execution in worker | Every bank credential; every user's books readable; import-path writes anywhere | Every bank credential; books and writes as (a); no auth secret | Without (e2): as (a+). With (e2): connections it holds grants for, import scope only | Same as (b) | As (a+) | With (e2)-style per-job credentials: as (b)+(e2) | Same as (b) |
| S5 stolen `poly_app` password | Any user, lasting | Any user, no lasting takeover | No user: it can connect but cannot name anyone | The gateway's password is the new `poly_app`: any user | Any user | One user per stolen credential | No user |
| S6 stolen `poly_worker` password | Every user's books readable; import writes anywhere | Same | With (e2): nothing without the grants, which are sealed under the keyring | Same as (b) | Same as (a) | Per-job | Same as (b) |
| S7 stolen session | That user, until revoked | Same | That user; a revoked session lives until its token expires (Supabase default 1 h, `prior-art.md`) unless every request also checks the session row | Same as (b) | That user | That user | That user; revocation is immediate |
| S8 database at rest | Plain session tokens (need the auth secret), plain reset links (15 min) | Hashed reset links; plain session tokens | Refresh tokens must be stored hashed by the service | Same as (b) | As (a) | Credentials must be hashed | Sessions stored hashed: useless to the reader |

What no option stops: a persistent attacker inside web acting as the users who use the app while they are there (S3), and the worker's access to every bank credential (S4) — only (e3) narrows that. A stolen session (S7) is honoured by every option.

## 2. Each option in plain words

**(a) today.** Postgres believes whatever web or worker tells it. One SQL bug, or a leaked app password, gives every family member's books and, through the plain reset tokens, their accounts. Defence rests on never writing that bug (C-44 lint and CodeQL). Trusted code: all of web and worker and every dependency they load — far more than anyone can audit; it is tested only by the absence of known bug patterns.

**(a+) today, hardened.** Same trust model, smaller damage. A SQL bug still reaches every user, but only while the bad statement runs; it can no longer turn into a permanent account takeover, and a worker compromise can no longer forge cookies or issue invitations. It does not change who asserts identity. Trusted code: unchanged. Tests: one per fix (a reset token in the table does not equal the emailed one; the worker's environment carries no auth secret; the worker role cannot execute the issuer). These fixes are worth doing under every other option too.

**(b) Postgres checks a signed token.** A separate sign-in service signs a short-lived token; Postgres checks the signature and believes only that. web can no longer invent a user; SQL alone gets nothing. Code execution in web still uses the tokens of users it is serving, but only until they expire. Trusted code: the sign-in service (BetterAuth plus our hooks, about the size of today's `packages/auth`), a JWT verifier running *inside the database process* (an extension in native code; Neon's `pg_session_jwt` is one), and the key plumbing. Two open problems: the extension's own README says the key may be supplied "by client request in the connection startup packet" — read literally, web could hand Postgres its own key, which must be measured and closed before (b) is secure (`prior-art.md`); and a token outlives a sign-out unless each request also checks the session row, which is (e1) again. Tests: pgTAP with tokens forged, expired, wrongly signed, signed by a rotated-out key, and a connection that supplies its own key. Audit: the extension is third-party native code in the database; it would need a pinned build and a review we cannot easily do ourselves.

**(c) a generic gateway (PostgREST style).** Our app stops talking SQL. A small generic service holds the only database password, checks the token and runs only queries it generates. This is what Supabase does: its security rests on "only Supabase's own components hold the password that can switch to any user" — `auth.uid()` reads an ordinary setting that PostgREST fills in, and Postgres checks nothing (`prior-art.md`). So (c) moves today's trust from our app into the gateway rather than removing it: whoever holds the gateway's password, or runs code in the gateway, is any user. Its strength is that the gateway is generic, widely deployed and does not run our code, so an injection bug in our app is far less likely to exist. Its cost is that every multi-statement ledger operation becomes a database function called by name, and Drizzle and our wrappers go. Trusted code: the gateway binary (PostgREST is a Haskell program we would not audit ourselves; we would rely on its wide use), its configuration, the sign-in service, and every SQL function we expose. Tests: the same RLS battery, run through HTTP.

**(d1) SET ROLE per user.** Looks stronger, is not. The login role must be allowed to switch to every user role, and any SQL as that login role can `RESET ROLE` and switch again (Postgres docs, `prior-art.md`). It is today's design with role names in place of a setting, plus role churn on every sign-up and deletion. Rejected.

**(d2) a database credential per user.** Postgres itself authenticates each user, so web cannot become a user whose credential it was not given. In practice the sign-in service must create a role per user and hand web a short-lived password per session; that service needs `CREATEROLE`, shared pooling stops working (one connection set per user), and `pg_hba` and role cleanup become part of sign-up and deletion. It gives the same protection as (e1) with Postgres's login machinery doing the check, at a higher cost and a more privileged sign-in service. Not recommended.

**(e1) Postgres checks an opaque session.** The sign-in service owns the session table; web and worker lose every grant on it. web hands the cookie's token to one definer, which hashes it, finds a live session, and marks the transaction as that user in a way the caller cannot imitate. The architect's mechanism, which I prefer to the keyed tag in `options.md`: a marker table `app.tx_identity(xid8 primary key = pg_current_xact_id(), user_id, session_id)` that only the definers' owner may insert into, with `app.current_user_id()` reading that row and ignoring any setting. Postgres's own grants then enforce it, with no key to guard and no extension — the same stamp idea as C-84's `signup_txid`. SQL alone, or a stolen app password, names nobody. Revocation is instant. Trusted code: the sign-in service (as in (b)), one definer of the order of 50 lines of SQL, the changed `app.current_user_id()`, and the marker table's grants; nothing native in the database. Tests: pgTAP — a forged `app.user_id` alone yields no rows; `poly_app` and `poly_worker` cannot insert, update or delete a marker row; a marker committed by an earlier transaction gives a later one nothing; expired, revoked and unknown tokens yield none; the definer refuses a second call; `poly_app` cannot read the session or verification tables. Open points (unmeasured): the cost of the marker lookup on every policy call (a primary-key read, likely cheap, to be measured), that `pg_current_xact_id()` assigns a transaction id even to read-only requests, and the cleanup of committed marker rows, which grow by one per request.

**(e2) scoped job grants for the worker.** Today the worker can name any user. With (e2) it can act only for the connections it holds a grant for, and only on the import path of that connection's entity. A worker compromise still reaches every grant it holds (they are sealed under its keyring), but no longer every user's whole books. A stolen worker password without the keyring reaches nothing. Trusted code: one more definer and the grant-minting step in the sign-in service. Tests: a job without a grant reads 0 rows; with a grant, it cannot read another entity or a non-import table.

**(e3) parser sandbox.** The parsers of provider responses and uploads run in a separate process with no database password, no keyring and no network. A parser exploit reaches only the file it is parsing. It is the only option that touches the worker's biggest power (every bank credential). Trusted code: the small writer that validates parsed rows. Tests: the sandbox process has no secret files, no network and no database socket; malformed and oversized inputs are refused at the writer.

**(e4) one instance per family.** Hosted only. A compromise in one family's stack reaches that family; nothing else contains a cross-family breach as completely.

**(e1-staged) the architect's staged variant.** Stage 1 adds the marker table, a scoped worker entry (the (e2) idea) and an interim definer that only `poly_app` may call, which web uses as it sets the setting today. Stage 2 adds the sign-in service and `enter_session(token)`. Stage 1 alone closes the worker half of R-2: a worker compromise or a stolen worker password can no longer name an arbitrary user. It leaves the web half as it is today, because the interim definer believes whatever user `poly_app` names — so S1 and S5 stay "any user" until stage 2. Nothing in stage 1 is thrown away by stage 2. I support staging on that understanding; stage 1 must not be read as closing R-2.

### Would it have contained the plain verification tokens on its own?

The finding: `poly_app` can read password-reset and magic-link tokens in the clear (`threat-model.md`; filed on POLY-137). Per option, without the POLY-137 fix:

| Option | Contained? | Why |
|---|---|---|
| (a) | No | `poly_app` reads `verification`, which has no RLS |
| (a+) | Yes | The fix is part of it |
| (b) | Yes, against web | `verification` moves to the sign-in service's role; SQL in web cannot read it. SQL injection *inside* the sign-in service would still read plain tokens |
| (c) | Only if the gateway's roles hold no grant on the auth tables | The gateway's login can become any role it is granted; containment depends on the grant list, not on the design |
| (d1) | No | BetterAuth stays in web on the login role |
| (d2) | Yes, against web | Same reason as (b) |
| (e1), (e1-staged) stage 2 | Yes, against web | Same reason as (b). Stage 1 alone: no |
| (e2), (e3), (e4) | No / no / per family | They do not touch the auth tables |

So every option that moves sign-in out of web contains it against web, and none contains it against the sign-in service itself. Hashing the tokens is needed under every option.

## 3. Trusted code, side by side

| Option | Code that decides who the user is | How it is audited | How it is tested |
|---|---|---|---|
| (a), (a+) | All of web and worker and their dependencies | Lint and CodeQL for known patterns; no exhaustive review possible | Absence of known patterns; RLS battery assumes the id is honest |
| (b) | Sign-in service; a native JWT extension in Postgres; key handling | Sign-in service by us; the extension by its vendor | pgTAP negative tests; key-injection test |
| (c) | Gateway binary and config; sign-in service; every exposed SQL function | Gateway by its community; SQL functions by us | RLS battery through HTTP; function-level tests |
| (d2) | Sign-in service with `CREATEROLE`; `pg_hba` | By us | Role lifecycle tests |
| (e1) | Sign-in service; one definer; `current_user_id()` | By us, in full: the database part is short enough to read line by line | pgTAP negative tests, exhaustive for the definer |

In every option except (a) and (a+), the sign-in service becomes the most valuable process: whoever controls it can create a session for anyone. It earns that place by being small in what it exposes — only the `/api/auth/*` routes, no pages, no uploads, no provider data — not by being small in code (BetterAuth is a large library).

## 4. The worker and the operator

- **Worker.** (b), (c), (d2) and (e1) leave the worker unchanged unless (e2) comes with them: a job still needs a user to act as, and without scoped grants the worker keeps a "may name anyone" power, which is today's weakness. `withSystem` has no caller yet (`current-state.md` §8.4), so the worker side is cheapest to change now. (e3) is independent and pays off whichever option wins.
- **Operator CLI (`polycarpic cli user invite`, POLY-142).** It needs no user identity: it asserts the setting is empty and calls a definer that writes its own actor. Under (b), (d2) and (e1) it keeps working as it is. Under (c) it stays outside the gateway on a direct database role, as admin paths normally do. Under every option it should move off `poly_worker` onto its own login role holding only `EXECUTE` on the issuer, so that a worker compromise stops being able to issue invitations; that move is part of (a+).
- **Sign-up and invitation acceptance (C-84).** Under (b) and (e1) these move into the sign-in service, which creates the user and its first session in one transaction of its own. The stamp mechanism stays useful as a second check inside the database.
- **POLY-89's guards** read `app.session_id`, which BetterAuth's writes see today because they run inside the tenant transaction (`current-state.md` §9). With the sign-in service doing those writes in its own transactions, the guards must read the session the service itself verified. The design changes; the protection need not.

## 5. Single-family self-hosted versus hosted multi-family (R-6)

**Single family, self-hosted (today's scope).** "Any user" means the handful of people in one family, and over a week most of them will use the app. So under code execution in web, (e1) and (b) reach almost as many people as (a); their real gain is elsewhere: SQL injection and a stolen app password stop being total, the at-rest tokens stop being usable, and identity can no longer be minted after the attacker is evicted. Members still differ in what they may see — separate Persons, trusts with different trustees, adult children — so "any user" is not the same as "the owner", and it matters.

**Hosted, many families.** "Any user" becomes every customer. Under (a) or (a+) one SQL bug is a cross-customer breach, which is the case R-6 already calls unacceptable, and would be a reportable incident under the regimes R-6 lists. (e1) or (b) becomes the floor, (e2) and (e3) become necessary, and the stronger answer is (e4): separate stacks per family, so a web compromise reaches one family. A shared web process serving all families would hold every family's sessions, so an in-database check alone does not contain a web compromise across families.

## 6. What was not settled

- Whether a magic-link sign-in still asks an enrolled user for their second factor (affects how bad S1 is today) — not measured.
- Whether `pg_session_jwt` lets a connecting client override the server's key — not measured; the README sentence is the only evidence. The architect read it the same way independently, and also notes it has no releases and calls its API subject to change.
- The per-call cost of the marker lookup in `app.current_user_id()` under (e1) — not measured.
- How Supabase's other components (Edge Functions, Realtime, Storage) reach Postgres — no source found, so not used.

## 7. Rulings on the lead's points 1 and 2 (`lead-read.md`)

### Point 1 — hashed session storage under (e1): a requirement of stage 2. The lead is right.

Why: today a session token read from a backup is useless because the cookie is `token.HMAC(auth secret)` and the secret is not in the database (R-12). Under (e1), web forwards the cookie to `enter_session` and holds no secret, so nothing checks the signature. Putting the secret in the database for the definer to check would put it in every backup too. So the database must hold only something a reader cannot present: a hash. Without it, stage 2 makes S8 worse than today. My `options.md` line ("sessions are stored as hashes") stated the requirement without saying how, and `prior-art.md` shows BetterAuth 1.7.18 cannot do it by setting.

How, in order of preference (all unmeasured; the lead's pre-stage-2 spike measures them):

1. **Leave BetterAuth's token alone and give the database its own handle.** When the sign-in service creates a session, it also issues a second random value, the request handle, in its own cookie, and stores only `sha256(handle)` in our table `app.session_handle(session_id FK → session ON DELETE CASCADE, handle_hash, …)`. `enter_session` takes the handle, never BetterAuth's token. BetterAuth's plain token stays in a table only the sign-in service's role can read, and it is usable only at the sign-in service, which checks the cookie signature. A backup then holds plain BetterAuth tokens that need the secret, and handle hashes that are useless. Revocation stays instant through the cascade. Nothing in BetterAuth's lookup changes. To measure: that every way BetterAuth creates or replaces a session (sign-in, the second-factor step, the session rotation at first TOTP verify, refresh) reaches our hook, and that the service can set the second cookie on each of those responses.
2. **Rewrite the token at the adapter, both ways.** In the sign-in service's database adapter, store `sha256(token)` on session writes, hash the value in every `where token = …` before it reaches SQL, and put the plain value back on the rows returned. R-12's objection ("a hook that rewrites the token breaks the lookup") applies to a write-side hook only; a symmetric rewrite does not break the lookup. It does couple us to every place BetterAuth reads or writes `session.token`, which is why it ranks second; it needs the version pin and a test that fails when a release changes those places.
3. **Not recommended: BetterAuth's `secondaryStorage`.** Its `get(token)` interface could be backed by a table keyed by a hash, but the source shows it also keeps an `active-sessions-<userId>` list whose values contain plain tokens (`db/internal-adapter.mjs`, `mirrorSessionToSecondaryStorage`).

Tests the requirement implies: no column in a backup equals a live cookie's handle or token, by query; `enter_session` with a value copied from the database, rather than the cookie, gives no rows; deleting the session kills the handle in the same transaction.

### Point 2 — does one marker per transaction stop injection in stage 1? It holds for the common case and fails for three others. The flat "any user" in this file and in `pricing.md` overstates stage 1's weakness.

Where the lead's reasoning holds: web's request transaction inserts its marker as its first statement. The marker's primary key is the transaction id, so a second insert in the same transaction fails, and `poly_app` holds no `UPDATE` or `DELETE` on the table. An injected fragment inside one later statement of that transaction cannot add a second marker, change the first, or start a new transaction. If it calls the interim definer naming someone else, the call fails. So for **a single injected statement inside a marked transaction**, stage 1 already gives "the requesting user only". That is the usual shape of an injection bug, since node-postgres sends a parameterised query in the extended protocol, which carries one statement.

Where it fails:

1. **Multi-statement injection.** A query sent with no parameters goes over the simple protocol (`pg@8.23.1` `lib/query.js`, `requiresPreparation`), which accepts several statements in one string. An injection there can send `COMMIT; BEGIN; select app.<interim definer>('<victim>'); …`, which is a fresh, unmarked transaction naming anyone. Closing it: every `poly_app` query from web is sent with `queryMode: 'extended'` (an option the installed driver has), enforced in `packages/db` and tested by showing that a two-statement string is refused.
2. **Savepoints.** `ROLLBACK TO SAVEPOINT` undoes a marker inserted after the savepoint. The marker must be inserted before any savepoint can exist, at the top of the real `BEGIN`, never inside a routing-pool savepoint, and a test must show that rolling back to any later savepoint leaves it in place.
3. **Unmarked transactions.** Web runs some statements outside any marked transaction: BetterAuth on the plain pool (session lookup, sign-in), and the context-free sign-up path. An injection there, or any code running SQL on that path, opens or sits in an unmarked transaction and can call the interim definer with any id. Stage 1 can narrow this (the interim definer refuses any transaction not opened by `withTenant`'s own first statement), but it cannot close it while web chooses the id. Stage 2 closes it.

A stolen `poly_app` password (S5) stays "any user" until stage 2, as the lead says. The same goes for code execution in web (S2, S3).

Ruling for the stage 1 claim: **S1 drops to the requesting user for single-statement injection inside a marked transaction, provided that (i) every web query is sent in extended mode, (ii) the marker is the first statement of the real transaction, and (iii) the definer refuses a second marker. Each of the three needs its own test in stage 1's red gate.** Injection on an unmarked path, a stolen password and code execution still reach any user until stage 2. R-2's interim wording should say exactly that, not "closed" and not "unchanged".
