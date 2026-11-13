# POLY-145 — the architect's recommendation

Author: architect. I wrote this without reading `seceng-recommendation.md`. It draws on `current-state.md`, `pricing.md` (mine), and seceng's `options.md`, `threat-model.md`, `comparison.md` and `prior-art.md`. Sizes are in loop-days as `pricing.md` §0 defines them, calibrated on POLY-86 (3), POLY-87 (2) and POLY-142 (1).

Independence: before I wrote this, I saw seceng's lean towards (e1), both in `comparison.md` and in their message. By then I had already priced (e1) as the cheapest option that stops SQL injection, and had sent seceng the marker-table mechanism and the staged variant. The lean did not change my recommendation, though I cannot rule out that it reinforced it.

## Recommendation

**Move to (e1), Postgres checking an opaque session, in the staged order (e1-staged; `pricing.md`). Add the (a+) hardening items, and finish both stages before POLY-89 resumes.** Fold (e2) into POLY-64, and (e3) into the first real parser (POLY-64 or POLY-77).

Concretely:

1. **Stage 1, about 5.5–6.5 loop-days in 2 loops.**
   - The transaction marker (K) replaces the settable GUC for every reader.
   - The worker enters only through a scoped job definer (J), and loses the auth secret (X).
   - Web keeps asserting identity, but only through one poly_app-only definer (I).
   - Reset and magic-link tokens are stored hashed.
   - The operator CLI moves to its own login role, run from a one-shot service.
   - Web queries go in extended mode, the marker comes first in the transaction, and the definer refuses a second marker (`comparison.md` §7).
   - At the end, the worker can name no user, and nothing in the database honours a `set_config` from any role. For web, a single injected statement inside a marked transaction reaches only the requesting user. An injection on an unmarked path, a stolen poly_app password and code execution in web still reach any user until stage 2.
2. **Stage 2, about 9–11.5 loop-days in 3 loops.**
   - The sign-in service (S) takes BetterAuth, the auth secret and every grant on BetterAuth's tables.
   - Web enters through `app.enter_session(handle)` (E). The database holds only a hash of the handle (H, `comparison.md` §7 point 1), so a backup holds nothing a reader can present.
   - I is revoked.
   - After stage 2, SQL injection in web, a stolen poly_app password and a database read at rest each reach no user, or only the requesting user.
3. **POLY-89 then specifies its guards once, against the marker.** POLY-137, POLY-144 and POLY-129 follow unchanged in size.

Total: **14.5–18 loop-days, about 5 loops**, before POLY-89. That is roughly twice the POLY-86 + POLY-87 + POLY-142 span. Confidence is **M**: it is built up from the files that change, not measured.

## Why this one

- **It removes the assertion rather than moving it.** Every policy and definer reads identity through one function (`current-state.md` §4). Changing how that function learns the user changes no policy. The part that decides identity inside the database is one definer, one marker table and one function body, short enough to read line by line and to test exhaustively in pgTAP. (b) and (c) move the trust into a component this team does not own or review: a native extension, or PostgREST.
- **It is the cheapest option that stops SQL injection.**
  - Against (b), it costs 13–16 loop-days where (b) costs 15–22, and needs no key rotation, no native code in Postgres, and has no revocation gap.
  - (b)'s only candidate extension, `pg_session_jwt`, takes its key "by client request" per its README, so a compromised web could supply its own key. As it stands, (b) is not buildable.
  - (d2) costs more, needs CREATEROLE, and puts roles in every backup, for the same protection.
  - (c) costs two to three times as much, plus a standing tax on every data feature, and its security rests on the gateway's password, just as ours rests on poly_app's today.
- **SQL injection is the bug class this codebase will grow.** The ledger, import, reports and tax packages are all SQL-heavy. Today one injection anywhere in web reaches every user, plus lasting takeover through the plain reset tokens (`comparison.md` S1). The defence rests entirely on never writing that bug. I would rather the database refuse than rely on lint.
- **Now is the cheapest moment it will ever be.** Nothing is deployed, so no data or sessions need migrating. `withSystem` has no caller. POLY-89, the largest piece of work on this path, is not built. Building POLY-89 first adds 2–3 loop-days to any later pivot, and specifies POLY-89 twice.
- **The staging puts the worker first.** The worker parses untrusted provider and file data, and today it can act as any user. Stage 1 closes that in about 5 loop-days and throws nothing away. If stage 2 had to be deferred, the instance would still be better than today, and nothing would need undoing.
- **The running cost is one Node container.** Same image, same deploy, plus one role and one secret directory. I guess 150–250 MB RSS. It fits ARCH §7.3's 8 GB, but that budget is itself unmeasured.

## What it does not buy (stated plainly)

- **Code execution in web still acts as every user who is active while the attacker is there** (`comparison.md` S2, S3). In a single family, over a week that is most users. Stage 2's gains are against SQL injection, a stolen poly_app password, the database at rest, and anything after eviction. They are not gains against a live web compromise.
- **The worker still opens every bank credential** if its process is compromised. Only (e3) narrows that, which is why I put it in the import milestone.
- **The sign-in service becomes the most valuable process.** Whoever controls it can create a session for anyone. Its protection is a narrow exposure: only `/api/auth/*`, no pages, no uploads, no provider data.
- **The sign-in pages are still served by web.** A persistent attacker in web can change the sign-in page's script and capture passwords as they are typed, so seceng's S3 proviso ("no passwords or seeds") holds only if S also serves `/sign-in` and `/sign-up`. I have not priced that. My guess is +1–2 loop-days and a DESIGN change, and I list it as an open question below rather than fold it in.

## Costs I accept

- Every request writes one marker row, so read-only requests now assign an xid. The cost is unmeasured. It is checked against POLY-63's under-2 s dashboard criterion, and a ruling on K sets the threshold before build.
- Development and e2e need two servers behind a proxy.
- Auth routes cross a process boundary when debugging.
- POLY-89 waits about 14.5–18 loop-days more.

## What would change my mind

- **The marker measures badly.** If the per-request write adds more than about 5 ms at p95, or the WAL growth matters for the backup volume, I would switch K to a protected-setting variant: an extension-defined superuser-only variable plus `GRANT SET ON PARAMETER`, which is unverified (`pricing.md` §7). Failing that, an HMAC tag with policies rewritten to evaluate it once. The design stays (e1); only the marker changes.
- **The sign-up transaction cannot move cleanly into S.** That would mean poly_auth needs tenancy grants broader than BetterAuth's tables plus the existing definers, or S's price passes about 8 loop-days. Then I would recommend stopping at stage 1 plus (a+) and re-opening stage 2 at the first deploy.
- **seceng's threat ranking puts a live web compromise far above SQL injection.** Stage 2's case then weakens, and moving the sign-in pages into S, or a separate auth origin, becomes the work that matters.
- **The hosting non-goal (R-6) is reversed.** Then (e4), one instance per family, becomes the containment that matters, (e1) becomes the floor inside each instance, and (e2) and (e3) become mandatory, not import-milestone items.
- **A measured way appears for Postgres to verify a signature with a key no client can set.** That makes (b)'s stateless check available, but I would still choose (e1) for its immediate revocation unless a hosted scale makes the per-request lookup costly.

## Judgment calls the lead or the Principal might make differently

- I put both stages before POLY-89. Stopping at stage 1 plus (a+) (about 5 loop-days) and resuming POLY-89 is defensible. It costs +2–3 loop-days later if stage 2 follows, and leaves SQL injection in web reaching every user until then.
- I priced the marker table (K), not seceng's HMAC tag, because it needs no secret inside the database and no per-row evaluation. seceng has the variant (message of 2026-11-12) and may weigh it differently.
- I kept (e2) and (e3) out of this pivot and in the import work, because they change policies and processes that do not exist yet.

## Findings outside the decision

- The worker holds the BetterAuth secret and has no use for it (`current-state.md` §8.1). It should be removed whatever is decided.
- ARCH and code disagree in four places (`current-state.md` §8.2–8.5): the routing pool's size and scope, who reads `app.session_id`, R-2's `job_targets` reasoning, and the brand's strength. They are folded in when ARCH changes after the decision.

## Open questions for the Principal

1. Pivot fully before POLY-89 (about 14.5–18 loop-days), or stage 1 plus (a+) now (about 5.5–6.5) and stage 2 later at +2–3 extra?
2. Is a third long-running process acceptable for a self-hosting operator? It is the same image and deploy, but one more thing to watch.
3. Should the sign-in service also serve the sign-in and sign-up pages, so that a persistent web compromise cannot capture passwords? That is unpriced: a guess of +1–2 loop-days and a DESIGN change.
4. Does the hosting non-goal (R-6) still stand? The answer decides whether (e4) is ever planned and whether (e2) and (e3) are optional.
5. Does the Vercel tertiary target (ARCH §7.6) stay? The sign-in service adds a third Vercel project to it.
