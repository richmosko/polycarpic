# POLY-145 — seceng's recommendation

Author: seceng. Written without reading the architect's recommendation. Based on `threat-model.md`, `comparison.md` and `prior-art.md` in this directory.

## Recommendation

**Adopt (e1): Postgres checks the session itself. Add (e2) for the worker. Do the (a+) fixes now, whatever is decided. Build (e3) when import lands.**

In plain words:

1. **Sign-in moves out of the web app** into a small separate service with its own database role. Only that service can read or write sessions, password-reset links, magic links and second-factor secrets, and only it holds the auth secret. The browser reaches it directly on the `/api/auth/*` path, so the web app never sees a password or a second-factor code.
2. **The web app asks Postgres who the user is, rather than telling it.** For each request it hands Postgres the session token from the cookie; one short database function checks that token against the session table and marks the transaction with that user in a way the web app cannot imitate. The web app's database password, on its own, names nobody.
3. **The worker acts only through grants.** When someone links a bank, the sign-in service issues a grant for that one connection. The worker can use it only for importing into that connection's entity, not to read or change anything else as that person.
4. **Now, before anything else:** store reset and magic-link tokens hashed; take the auth secret out of the worker; give the operator's CLI its own database login with only the power to issue invitations.

### Why this one

- **It closes the two attacks that are total today.** Today one SQL-injection bug, or a leaked app password, gives the attacker every family member's books and, through the plain reset links, their accounts for good (`threat-model.md` S1, S5). Under (e1) both reach only the user whose request it is, or nobody.
- **The part that must be trusted is small enough to read in full.** The database side is one function of the order of 50 lines and a changed `current_user_id()`, using `pgcrypto` only. It can be tested exhaustively with pgTAP: a forged setting, a copied tag, an expired, revoked or unknown token must each give no rows. Nothing native of ours or of a third party runs inside the database.
- **Revoking a session works at once**, because the database checks the session row on every request. A signed-token design keeps a revoked token alive until it expires, unless it also checks the row.
- **It tests R-2's earlier claim and finds it wrong.** R-2 said a database-verified token "would gain little" because `poly_app` reads the session table anyway. That is only true while sign-in runs inside the web app. Move sign-in out and the claim falls; with it falls most of the reach R-2 accepts.

### Why not the others

- **(a+) alone** is worth doing and cheap, but it leaves "one SQL bug is every user" in place. Defence would still rest on never writing that bug.
- **(b) signed tokens checked in Postgres** gives nearly the same protection, with one real advantage: a web compromise sees only tokens that expire in minutes. Against it: a native extension in the database that we cannot audit ourselves; that extension's README says a connecting client may supply the key, which would undo the whole point unless proven otherwise (`prior-art.md`); and slower revocation. If the Principal wants the short-token advantage, it can be added to (e1) later without changing who verifies.
- **(c) a Supabase-style gateway** is the Principal's instinct, and it is a respectable design, but it does not do what it appears to do. Supabase's Postgres checks nothing: `auth.uid()` reads a setting that their gateway fills in, and the safety comes from only their own components holding the database password that can become any user (`prior-art.md`). For us that would move today's weak point into a new component and rewrite all our data access around HTTP. The real lesson from Supabase — keep the power to name a user in as few hands as possible — is exactly what (e1) does, at the database instead of at a gateway.
- **(d) one database role per user**: the cheap form (`SET ROLE`) is today's weakness renamed; the real form (a credential per user) gives (e1)'s protection at a higher price and with a more powerful sign-in service.

### What (e1) does not fix — said plainly

- **An attacker running code inside the web app, and staying there, can act as every user who uses the app while they are there.** No design prevents that: the process serving a user can act as that user. In a single family that is probably everyone within a week. What (e1) changes is that they cannot act as anyone who does not show up, cannot capture passwords or second factors, and lose all reach once evicted and the captured sessions are revoked.
- **The worker still opens every bank credential.** That is the worker's job, not an identity question. Only (e3) narrows it.
- **The sign-in service becomes the crown jewel.** Whoever controls it can create a session for anyone. It is safer than the web app because it exposes only the sign-in routes — no pages, no uploads, no bank data — not because it is small in code.

## What would change my mind

- **The tag check is too slow.** If checking the transaction's identity on every policy call costs more than the architect's budget for a page, and the protected-setting variant is not available, I would move to (b) — but only after the key-in-startup-packet question is measured and closed.
- **Hosting other families becomes a real plan.** Then (e1) is the floor, not the answer, and I would add (e4), one instance per family. A shared web process would hold every family's sessions.
- **Splitting sign-in cannot carry POLY-89's second-step guards.** If the architect finds the guards cannot be rebuilt on the sign-in service's own transactions without weakening them, the split needs another design before it is adopted.
- **The cost.** If the architect's price for (e1) is out of proportion for a single-family instance, I would recommend (a+) now plus (e1) before any second family or any hosted use — and say plainly that until then, one SQL bug remains every user.

## Open questions for the Principal

1. Is hosting for other families still a non-goal for the foreseeable future? The answer decides whether (e4) is on the table.
2. Do you accept that no design stops an attacker who stays inside the web app from acting as the users who use it while they are there? The alternative is not a design choice but faster detection and response.
3. Will you accept a second always-on service (sign-in) on the box? Its running cost is the architect's to state.
4. Should the (a+) fixes go ahead now, before the decision lands? They hold under every option. The hashed-token fix in particular closes a lasting-takeover path that is open today.
