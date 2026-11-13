# POLY-145 — pricing the options (architect)

Prices every option in seceng's `options.md` (@ `dd4757c`) against the tree described in `current-state.md`. Every figure is labelled with a confidence level; **guess** means no measurement or close analogue stands behind it.

## 0. Units and calibration

- **Loop-day**: one calendar day of a full Implement→Validate team loop (ruling, tests red, build green, verdict). The only calibration we have is shipped work on this same path (git log dates and commit counts, read 2026-11-12): POLY-86 (BetterAuth, routing pool) took 2026-11-08 to 11-11, about **3 loop-days** over 55 commits. POLY-87 (invite-only sign-up) took 11-11 to 11-12, about **2** over 50. POLY-142 (operator CLI) took 11-12, about **1** over 36. Every estimate below is in loop-days and scaled against those three.
- **Loops**: the number of separate issues/PRs. Each one carries a fixed cost of about 0.3 loop-day for gates and CI, whatever its size.
- **Running cost** is per instance on the single 4 vCPU / 8 GB VPS (ARCH §7.3): new long-running containers, their RAM, new secrets, and recurring operator tasks.
- **Confidence**: **H** means measured or a direct analogue exists in the tree. **M** means it was built up from the files that change, sized against those analogues. **L / guess** means nothing stands behind the number.

One fact changes every price: **nothing is deployed** (`process/STATE.md`). No live sessions, user rows or data have to be migrated, so a pivot now costs only code and tests. The first deploy (POLY-97/100) is the point after which every option except (a) gains a data-migration step.

## 1. The shared building blocks

Several options are built from the same pieces, so each piece is priced once here.

| Block | What it is | Files it changes (from `current-state.md`) | Loop-days | Conf. |
|---|---|---|---|---|
| **K: transaction marker** | `app.tx_identity(xid xid8 PK, user_id, session_id, kind)`. Only the owner of the `enter_*` definers (poly_authz) holds INSERT on it. `app.current_user_id()` becomes `SELECT user_id FROM app.tx_identity WHERE xid = pg_current_xact_id()`, and a GUC set by the caller is ignored. `enter_new_user` writes the marker instead of `set_config` (`0007:42`). A purge definer clears old rows. Readers get SELECT under a policy `xid = pg_current_xact_id()`, so no one can see another transaction's user. `pg_current_xact_id()` returns the top-level xid inside a savepoint (`0007:128` relies on this already). The catalog test pinning the function body (`01_roles.sql:86`) is updated, and pgTAP adds "forged `set_config` grants nothing" for every role. | new migration; `context.ts:157-200` (each wrapper calls a definer instead of `set_config`); pgTAP `01`, `05`, `06`; `wrappers.test.ts` | 2–2.5 | M |
| **J: scoped job entry** | `app.enter_job(job, entity, connection)` replaces `withSystem`'s `set_config`. It resolves the principal inside the definer (folding in `app.job_targets`) and writes the marker with `kind = 'system:<job>'`. poly_worker loses every way to name a user directly. | `context.ts:170-181`, `0001:35-41`; no production caller exists yet | 0.5 | H |
| **I: interim web entry** | `app.enter_asserted_user(uuid)`: EXECUTE for poly_app only, writes the marker. Web behaves exactly as today: it still asserts identity, but it is now the only role that can. | `context.ts:157-162` | 0.25 | H |
| **X: worker loses the auth secret** | Remove `worker` from `AUTH_SECRET_FILE` (`registry.ts:17`) and the mount (`prod.yml:72,76`). | config registry + its tests, compose, lint policy | 0.25 | H |
| **S: sign-in service** | A third process, `polycarpic auth`, built from the same image. It holds BetterAuth, the auth secret and a new login role poly_auth. poly_app's grants on `session`, `account`, `verification`, `two_factor` and `passkey` move to poly_auth (`0001:25-27`, `0005`). Caddy routes `/api/auth/*` to it on the same origin. Sign-up (POLY-87's `withContextFreeTx` → `enter_new_user` → `provisionPerson` → claim/accept) runs inside it. The sign-up stamp's role test changes from `poly_app` to `poly_auth` (`0007:139`), and the definers' EXECUTE moves the same way. Dev needs a Vite proxy, and Playwright needs two servers. | new `apps/auth` (thin entry); `packages/auth` unchanged in substance (handler, routing pool, route policy and hooks move with BetterAuth); roles.sql, pg_hba, compose, Caddyfile, config registry; `tests/db/auth-*` retargeted to poly_auth; e2e harness | 4–5 | M |
| **E: web enters by session token** | `app.enter_session(token)`: a definer reads `session` (poly_auth's table; poly_app holds no grant) and refuses a session that is expired, past the 30-day cap or unknown. It writes the marker and returns the shell projection. `loadSession` (`packages/auth/src/session.ts:57-91`), Settings → Sessions and `requireRecentAuth` become definers (`app.my_sessions()`, `app.revoke_my_session(id)`, `app.recent_auth_ok()`). The `SessionUserId` brand and `withTenant(userId…)` give way to `withSession(token)`. I is revoked. | `packages/auth/src/session.ts`, `recent-auth.ts`, `handler.ts:97-100`, `apps/web/src/hooks.server.ts:37-43`, `db/src/session.ts`, layers.json; `tests/db/auth-session.test.ts` | 2–3 | M |
| **D: docs** | ARCH §3.1, §3.1c, §3.3, §7; SECURITY R-2, T-18, A-31, A-39, C-84; INFRA §2.2, §7.5. | doc owners | 1–1.5 | M |

## 2. Each option priced

### (a) Today, with its mitigations

- **Shipped rework:** none. X should land whatever is chosen, because the worker holds the auth secret and has no use for it (`current-state.md` §8.1). That costs 0.25 loop-day.
- **Backlog:** unchanged.
- **New components / running cost:** none.
- **Worker / operator:** unchanged. The worker can still act as any user, and its reach grows once import and the ledger give it write policies.
- **Harder to test or deploy:** nothing.
- **Total:** about 0.25 loop-day in 1 loop. **H**

### (a+) Today, hardened cheaply

- **Hashed reset and magic-link tokens:** two options set in `packages/auth/src/options.ts`, plus a test that the stored value is not the emailed one. The defaults are from seceng's dist read (`threat-model.md`). Cost: 0.25 loop-day. **M** It fits as an item in POLY-137, where seceng has already filed it.
- **X:** 0.25. **H**
- **The operator CLI on its own login role** (poly_operator, holding only EXECUTE on `app.issue_operator_invitation`). This helps only if the credential stays out of the worker container. If its password file is mounted into the worker, code in the worker reads it and nothing is gained. So the CLI moves to a one-shot compose service under its own profile, as `migrate` already is (`prod.yml:84-101`), and POLY-98's `polycarpic-ops cli` wrapper targets that service.
  - Rework to POLY-142: a new pool for `withOperatorTx` (`context.ts:195`, `pool.ts`), roles.sql, pg_hba, compose and its lint policy, and the grants in pgTAP `06` (EXECUTE moves from poly_worker to poly_operator). About 1 loop-day. **M**
- **Backlog:** POLY-98 runs the command in a different service: +0.25.
- **Running cost:** +1 login role and +1 secret file. No long-running container.
- **Total:** about 1.5–2 loop-days in 1–2 loops. **M** Web and worker still assert identity, so R-2 stands for both.

### (e4, seceng) One instance per family (hosted only)

- No cost for a single-family instance, and no gain there either.
- If the R-6 non-goal is ever reversed: per family, a Postgres (prod cap 3 GB, `prod.yml:25`), web, worker and S. Idle footprint is a guess of 1–1.5 GB per family, so about 4–6 families fit on an 8 GB VPS. That would need building provisioning, per-family deploy, backup, keyring and upgrade fan-out tooling: 5–10 loop-days plus ops that grow linearly with families. **guess** It complements the identity choice rather than replacing it: within one family, a compromised web can still act as any of that family's users.

### (b) Postgres verifies a signed token; sign-in moves to a separate service

The build is S + E, with the lookup replaced by signature verification, plus:
- BetterAuth's JWT plugin in the service. Read 2026-11-12, better-auth.com/docs/plugins/jwt: EdDSA/Ed25519 by default, 15-minute tokens, keys in a `jwks` table encrypted with AES-256-GCM, rotation off by default. The docs say it "is not meant as a replacement for the session". Web needs a token for every request, so it either calls the service on each request or caches tokens. A cache is exactly the store an attacker running code in web would harvest. Cost: +1.5 loop-days. **M**
- An extension inside Postgres to verify the signature. The only maintained candidate found, `pg_session_jwt`, fails here. Its README (github.com/neondatabase/pg_session_jwt, read 2026-11-12) says the JWK "can only be set at postmaster startup, from the configuration file, or by client request". A compromised web could connect with its own JWK and mint any user, which is the very attack (b) exists to stop. The README also says "API subject to change" and the repo has no releases. A fork or our own extension (Rust/pgrx or C) would need: a toolchain in `infra/postgres/Dockerfile`, a rebuild and re-scan on every Postgres minor (the image is pinned to `postgres:17.10@sha256:…`), and an audit of native code that runs inside the database. Cost: +5–10 loop-days. **guess**
- Revocation is no longer immediate: a revoked session's token stays valid for up to its lifetime (15 minutes by default), unless Postgres also checks a deny list, and then (b) has become (e1) with extra steps.
- **Shipped rework:** POLY-86 about 3 (most of its runtime moves to S, and `session.ts` is replaced). POLY-87 about 1 (sign-up moves to poly_auth). POLY-142 about 0.25 (`withOperatorTx`'s empty-identity check reads the new source).
- **Backlog:** POLY-89 +0.5 to re-spec if (b) lands first, or +2–3 if POLY-89 lands first: its guards depend on `app.session_id` being in the same transaction as BetterAuth's writes. POLY-137 ±0.5 (the mailer and the per-email limit live in S). POLY-144 and POLY-129 +0 if (b) lands first, +0.25 each otherwise.
- **Running cost:** +1 container (S, Node; RSS unmeasured, guess 150–250 MB against web's 768 MB cap), +1 login role, +1 secret directory, a key-rotation procedure, and the extension rebuilt with every Postgres update.
- **Total:** about 15–22 loop-days in 5–6 loops. **L**

### (c) A thin generic data-access layer (PostgREST style)

Read 2026-11-12, docs.postgrest.org/en/stable/references/auth.html. PostgREST verifies the JWT itself, not Postgres. It logs in as an "authenticator" role and runs `SET LOCAL ROLE` per request. Claims reach SQL through the `request.jwt.claims` setting. "JWTs that pass JWT Signature Verification are cached, regardless if they pass JWT Claims Validation", and revocation is left to a `db-pre-request` function. So the boundary in (c) is "the app can send no raw SQL", not "Postgres verifies identity". The claims are still a setting that any SQL can overwrite.
- Build: S, plus a PostgREST container, plus every database call in the app rewritten as an HTTP call or a named SQL function. Shipped code in that position: `packages/db/src/context.ts` and every `withTenant` caller (`packages/auth/src/session.ts`, `packages/tenancy/*`), plus nearly every file under `tests/db` (8,400 lines in all; `current-state.md` §7). The Drizzle layer model (ARCH §2.1, §6.2) would be reversed.
- **Shipped rework:** POLY-86 about 3, POLY-87 about 2, POLY-142 about 1, and the db platform (POLY-83/62 test harness) 5–8. **guess**
- **Backlog:** every data feature from here on, including POLY-89, 129 and 144 and the whole ledger and import, has each operation written as a SQL function behind an HTTP call. Guess: +30–50% on each such feature, forever. **guess**
- **Running cost:** +2 containers (S and PostgREST; PostgREST RSS unmeasured), a JWT key-rotation procedure, and a second query language to review.
- **Total:** about 30–45 loop-days in 8–10 loops, plus the standing tax. **L**

### (d1) One role per user, switched by a shared login

It has today's weakness under another name: the login role can `SET ROLE` to any user (`options.md`). Building it means K-like rework plus creating and dropping a role per user, for no security gain. **Not worth building.** About 6–8 loop-days if it were. **guess**

### (d2) One role per user, with the user's own credential

- Build: S. The service creates a role at sign-up and drops it at deletion; that needs CREATEROLE on poly_auth. PG17's CREATE ROLE page defers what CREATEROLE allows to the "Role Creation" section, which I have not read, so the blast radius is **open**. The service also issues a short-lived per-user password at each sign-in. Web opens connections per user, so the shared pool goes and each request pays a connect and SCRAM handshake (latency unmeasured; guess 5–20 ms). `app.current_user_id()` maps `current_user` to a uuid, which is again a one-function change. `pg_hba` admits a role pattern, and `max_connections` has to be sized against concurrent users.
- Backups: per PG17 pg_dump docs (read 2026-11-12), "pg_dump only dumps a single database… global objects… (such as roles)… use pg_dumpall". The backup, restore drill and staging clone (INFRA §7.2) then need a roles dump as well, kept in step.
- What it buys over E: none against code in web. Web still receives every active user's per-user credential, just as it receives their session token under E.
- **Shipped rework:** POLY-86 about 3, POLY-87 about 1.5 (role creation joins the sign-up transaction; `CREATE ROLE` is transactional, but cluster-wide). POLY-142 about 0.5.
- **Running cost:** +1 container, roles that grow with the user count, and a new backup artifact.
- **Total:** about 18–25 loop-days in 5–6 loops. **L**

### (e1) Postgres checks an opaque session itself

The build is **K + I + J + X + S + E + D**, in that order. I is revoked at the end.

- K: 2–2.5. I: 0.25. J: 0.5. X: 0.25. S: 4–5. E: 2–3. D: 1–1.5. Fixed cost of 4 loops at 0.3 each: 1.2.
- **Shipped rework, by issue:**
  - **POLY-86**, about 3: BetterAuth's runtime moves unchanged into S. `session.ts` and `recent-auth.ts` become definers. `handler.ts`'s `withTenant` branch becomes the service's own marked transaction. The auth tests change role.
  - **POLY-87**, about 1: the sign-up stamp's role and the definers' EXECUTE move to poly_auth, and `enter_new_user` writes the marker. The transaction design itself, the stamp and claim/accept, is reused unchanged.
  - **POLY-142**, about 0.25: `withOperatorTx`'s empty check and `issue_operator_invitation`'s `current_user_id() IS NULL` (`0009:39`) keep working through the new body. Only the `wrappers.test.ts` lines change.
- **Backlog:**
  - POLY-89: +0.5 to re-spec if (e1) lands first. Its guards stay triggers on BetterAuth's tables and read the session from the marker. If POLY-89 lands first: +2–3.
  - POLY-137: about ±0. The routing-pool item, the S9 test, the per-email limit, `/change-password` and the Sessions 404 all stay, now in S or a definer.
  - POLY-144: +0 if (e1) lands first. The issuer reads the inviter from the marker, and the email send stays where POLY-137 puts the mailer.
  - POLY-129: +0 if first, +0.25 otherwise (a mechanical swap of the wrapper call).
- **Running cost:**
  - +1 Node container (S, guess 150–250 MB RSS; that fits inside 8 GB on ARCH §7.3's own unmeasured budget).
  - +1 login role and +1 secret directory.
  - One marker INSERT per request, which forces an xid on read-only requests. Its WAL and latency cost is unmeasured. A guard: re-measure against POLY-63's under-2 s dashboard criterion.
  - No key management and no extension. The purge runs as a worker job.
- **Neon / Vercel tertiary target (ARCH §7.6):** the marker is plain SQL and scoped to one transaction, so it works through a transaction-mode pooler (unmeasured on Neon). S becomes one more Vercel project or route group.
- **Total:** about **11.5–14 loop-days in 4 loops**. **M**

### (e2) Worker: scoped job grants

- On top of K, J already removes the worker's power to *name* any user. (e2) also limits a job to the import-path writes for one connection. Policies give a `kind = 'system:<job>'` marker only those writes.
- **Shipped rework:** none. `withSystem` has no caller.
- **Backlog:** +1.5–2.5 loop-days on the first job feature (POLY-64, the import adapter interface), where the policies are written anyway. Sealing the grants under the keyring (`options.md`) reuses `packages/secrets`. **M**
- **Running cost:** none.

### (e3) Worker: parser sandbox

- Build: a parser container with `network_mode: none`, no secrets, read-only and non-root (the compose lint already enforces the last two). It is fed through a shared tmpfs or socket volume, and a small validated writer sits in the worker. A child process in the same container does **not** qualify: it runs as the same uid, and `/run/secrets` is readable to that uid (`prod.yml:73-77`).
- **Shipped rework:** none.
- **Backlog:** +3–4 loop-days, best placed in POLY-64 or POLY-77 (the first real parser). **M**
- **Running cost:** +1 container (guess 100–200 MB), one more image surface to scan.
- It is independent of the identity decision and worth pricing into the import milestone whatever is chosen.

### (e5) Staged (e1): a variant I propose (seceng's (e4) is the per-family instance, priced below)

- Stage 1 is **K + I + J + X**: about 3.5 loop-days, 1 loop, **M**.
  - It closes the worker half of R-2 at once: poly_worker can no longer name a user.
  - It turns "any SQL as poly_app" into "only a call to one poly_app-only definer", which a catalog test can pin.
  - Nothing is thrown away: stage 2 deletes I and adds S + E.
- Stage 2 is **S + E + D**: about 8–10 loop-days in 3 loops.
- The total matches (e1). The difference is that the riskier half (the worker, which parses untrusted input) is closed before POLY-89 resumes, and POLY-89 can be specified once against the marker.

## 3. Side by side

| Option | Shipped rework (86 / 87 / 142) | Backlog delta, landing first (89, 137, 144, 129) | Total loop-days | Loops | New containers | Recurring ops | Conf. |
|---|---|---|---|---|---|---|---|
| (a) + X | 0 / 0 / 0 | 0 | 0.25 | 1 | 0 | none | H |
| (a+) hardened today | 0 / 0 / 1 | +0.25 (POLY-98) | 1.5–2 | 1–2 | 0 (one-shot service) | one more secret | M |
| (e4, seceng) instance per family | 0 | 0 single-family | 0 single-family; 5–10 + linear ops if hosted | — | ~4 per family | per-family everything | guess |
| (b) JWT in Postgres | 3 / 1 / 0.25 | +0.5–1 | 15–22 | 5–6 | 1 | key rotation, extension rebuild per PG minor | L |
| (c) PostgREST | 3 / 2 / 1 (+5–8 platform) | +30–50% on every data feature | 30–45 + tax | 8–10 | 2 | key rotation, second query surface | L |
| (d1) role per user, shared login | — | — | 6–8, no gain | — | 0 | role churn | guess |
| (d2) role per user, own credential | 3 / 1.5 / 0.5 | +0.5–1 | 18–25 | 5–6 | 1 | roles dump in every backup, connection sizing | L |
| (e1) DB-checked opaque session | 3 / 1 / 0.25 | +0.5 | 11.5–14 | 4 | 1 | none beyond one more service | M |
| (e5) staged (e1), stage 1 only | 0 / 0.25 / 0.25 | +0 (POLY-89 specs against the marker) | 3.5 | 1 | 0 | none | M |
| (e2) job grants (on K) | 0 | +1.5–2.5 on POLY-64 | 1.5–2.5 | 0 (inside POLY-64) | 0 | none | M |
| (e3) parser sandbox | 0 | +3–4 on POLY-64/77 | 3–4 | 0–1 | 1 | one more image | M |

The (a+) items can be added to any option, and no other row includes them. With (e1) or (e5), the operator-role item is still the only thing that takes invitation issuing away from the worker credential. J removes the worker's power to name a user, not its EXECUTE on the issuer.

"Landing first" is the honest comparison: every pivot option costs +2–3 more on POLY-89 if POLY-89 ships before it.

## 4. Migration order, for any pivot

1. **K + I + J + X** (stage 1). The marker replaces the GUC for every reader in one migration. Web enters through I, the worker through J, sign-up through `enter_new_user`. CI gains the forge tests. This step can ship and deploy on its own.
2. **S.** The sign-in service runs beside web. poly_auth is created and BetterAuth's grants are copied to it (not yet revoked). Caddy routes `/api/auth/*` to S. Sign-up moves.
3. **E.** Web switches to `enter_session(token)`. Then, in one migration: revoke I from poly_app, and revoke every BetterAuth-table grant from poly_app. A catalog test asserts poly_app holds no grant on `session` and no EXECUTE on any `enter_*` except `enter_session`.
4. **POLY-89** on the new path, then POLY-137, POLY-144, POLY-129.

There is no live-data migration while nothing is deployed. If step 3 lands after the first deploy, existing sessions keep working: the token format is unchanged, and only who reads it changes.

## 5. What gets harder

- **Local development and e2e** (S): two Node servers behind a proxy instead of one; Playwright's `serve.ts` starts both. About +0.5 loop-day, inside S's price. **M**
- **Debugging a request** crosses a process boundary for auth routes only. Page loads stay in one process plus one definer call.
- **POLY-89's guard tests** run in poly_auth transactions. Their logic is unchanged, but the fixtures change role.
- **Performance:** the marker write per request (unmeasured; see e1). For (d2), a connection per request (unmeasured).
- **(b) and (c)** add a component in another language (a native extension; Haskell PostgREST) that this team reviews no other code in.

## 6. Hosted, multi-family (SECURITY R-6)

The prices above assume one family on one VPS. For a hosted instance, (a)'s residual risk would mean one family's web compromise reaches every family, which R-6 already calls unacceptable. The (e1) build cost does not change with scale. The marker's per-request write and S's footprint would need measuring at that load (unmeasured). (d2)'s role count and `max_connections` grow with users, and per-user connections stop being viable somewhere in the hundreds of concurrent users (**guess**).

## 7. Sources read

- PostgreSQL 17, "Customized Options" (runtime-config-custom.html), GRANT, CREATE ROLE, pg_dump: postgresql.org/docs/17, read 2026-11-12. The custom-options page does not say who may set a placeholder; the tree shows that any role can (`tests/db/pgtap/06_operator_invitation.sql:86`, poly_worker sets `app.user_id` and only the definer's own check refuses).
- PostgREST, Authentication: docs.postgrest.org/en/stable/references/auth.html, read 2026-11-12.
- BetterAuth JWT plugin and Session Management: better-auth.com/docs/plugins/jwt and /docs/concepts/session-management, read 2026-11-12 (no version stated on either page; we pin 1.7.18). Session Management documents no option to hash the stored token, which agrees with SECURITY R-12's measurement.
- pg_session_jwt README and Neon's extension page: github.com/neondatabase/pg_session_jwt and neon.com/docs/extensions/pg_session_jwt, read 2026-11-12.
- Not verified: whether an extension-defined `SUSET` variable plus `GRANT SET ON PARAMETER` could stand in for K. Only pgsql-hackers threads from 2022 cover it, so I priced K instead, which needs no native code.
