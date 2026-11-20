# POLY-150 — seceng build review at `3607aa34`

*seceng-150, 2026-11-19.*

**Reviewed:**
- the build at `3607aa34`, with qa's `gate.md` at `9c594fce` (measured at `dc48d669`; the only code after it is the healthcheck fix);
- against the ruling at its accepted tips: `be15ecae` for R1–R11, then Addenda 3–6 at `fa3bac5c`, `35fd42bd`, `1ff6c9ed` and `df8a4c6f`;
- and against my `ruling-review.md` §1–§14 and later lines.

**Verdict: ACCEPT `3607aa34`. Nothing blocks.** SECURITY is brought to the current state in this loop (§5).

**What I ran:** nothing. My worktree has no install, and the gate wanted a quiet machine. I rely on qa's gate run for counts:
- db 1192/1192, e2e 80/80, ci 542, layers 545, infra 185, config 97;
- packages and apps pass, lint is clean, and the typecheck is uncached;
- I re-read the predicates of the tests I cite, and did not re-run them.

Everything below is code-read against `3607aa34`.

## 1. The database: 0018 and 0019

| Item | Built | Result |
|---|---|---|
| `app.my_second_step()` (0018) | The exact-call check, then the kind `session` test, then a NULL user or session refused. Every read is keyed to the marker's own user; the challenge and grant also to its session. It returns R2's eight columns only, with `resend_available_at` NULL under the 24-hour rule (`v_wrong < 10`). poly_govern, `search_path = ''`, EXECUTE poly_app only | **Matches R2 and Addendum 2.** Accepted at `82608edf`. |
| `begin_step_up`, `complete_step_up` (0019:98-216) | The exact call, a kind `auth` marker, a user and session from the marker only, and `second_step_at` | **Matches A3.1 and A3.2.** |
| | `begin_step_up` also checks that the session row is the marker user's | |
| | `complete_step_up`: no earlier stamp in the transaction; deletes the challenge, which must hit one row (`step_up_challenge` → `challenge_expired`); the lock test on `clock_timestamp()`; for TOTP the window ±1 and `p_step > last_step` under `FOR UPDATE`; for a backup code the pending row; then `recent_auth_at = now()` on exactly one row; then the `step_up` record row in the same transaction | **RC6 is met.** |
| `note_totp_step` (0019:220-236) | Exact call, the ±1 window, `GREATEST` | Matches A3.4. Its reach is a 30-second denial of one re-check (accepted). |
| `record_step_up_failure` (0019:239-260) | Exact call, kind `auth`; spends the session's open challenge; one `step_up_failure` row with `method = 'passkey'` | Matches A4 and Addendum 4. |
| `step_up_challenge_hash` (0019:264-279) | As accepted at `2c3a77c9` | Matches Addendum 6. |
| The A3.3 evidence (0019:282-303, triggers :358-361) | `step_up_spent` deletes this transaction's pending row when `backup_codes` changed; `step_up_pending_resolved` is DEFERRABLE INITIALLY DEFERRED and raises if it is still there | **Matches.** T6 covers both orders. |
| The three tables | RLS forced, `REVOKE ALL FROM PUBLIC`, privileges for poly_govern only, a no-truncate trigger each; `step_up_totp_10_forward` for every role | **Matches.** The `permission-matrix.json` rows (`dc48d669`) state "no login role holds any privilege", which is true of the grants above. |
| `sign_in_record` | Kinds `step_up` and `step_up_failure`; `method` CHECKed to those two kinds; `session_id` required on `step_up` | Matches A4. |
| `sync_second_step` (0019:307-351) | The table is told apart before any field is read. `method_added` / `method_removed` exactly as Addendum 5 counts them. The actor is `user` with a marker, `operator` for `reset-mfa`, otherwise `system`. The payload is method, passkey id, session and `marker_kind`. Still the single writer of `second_step_at` | **Matches Addendum 5.** `method-audit.test.ts` includes the factor planted by SQL as poly_auth. |
| No-truncate on `two_factor` and `passkey` | 0019:356-357 | Matches. |
| `guard_passkey` (0019:367-411) | 0013's body plus "the counter never goes down" for marked updates too | **Stricter, nothing loosened** (A3.5). |
| `refuse_last_method` (0019:414-436) | 0013's logic, with IF/ELSIF by table | **Accepted at `93c67eaa`.** The refusal tests now assert the SQLSTATE and message (`second-step-gates.test.ts:379-382`), and `last-method-guard.test.ts:77` adds the viewer's own passkey delete. |
| Grants | REVOKE FROM PUBLIC on all seven; EXECUTE poly_auth on the five; poly_owner's temporary EXECUTE on the two trigger functions revoked (HEAD 0019:373) | Matches pgTAP 08, accepted at `87f98c46`. |

## 2. The sign-in service

**`reauth.ts`, line by line.**
- **Bodies are exact field sets** (`exact`), so a missing, extra or mistyped field answers 400 `invalid_request`.
- **The order on `/reauth` is the ruled one:**
  1. the lock, before any check;
  2. the password (`password.verify`, against `session.user`'s credential account), whose failure answers `step_up_failed` and touches no counter;
  3. the factor, against the user's own verified row.
- **The factor checks:**
  - the TOTP match is constant-time over three steps (`timingSafeEqual`, :45);
  - the backup-code match is constant-time (`same`, :70), against the decrypted list.
- **A wrong factor** goes through BetterAuth's counter shape, then 403. The database's lock guard sets the real length, whatever the service sends.
- **A right factor**, in this order: `complete_step_up` under a savepoint, then the shortened list re-encrypted, then the correct-code reset.
- **The passkey path:**
  - the challenge is 32 random bytes, stored only as a hash;
  - verification uses `requireUserVerification: true` and an origin and RP id from `baseURL`;
  - `expectedChallenge` compares the hashes in constant time (:215);
  - a credential found by id must be `session.user`'s, or the call goes to `fail()`, which records the failure and spends the challenge;
  - the counter is written before the stamp, and `guard_passkey` keeps it from going down. No session is created and none rotates.
- **`noteTotpStepHook`** recomputes the step after BetterAuth's own successful verify. A step outside the window logs only an event name: no code, no user.
- **Refusal codes match Addendum 4**, with one 403 `step_up_failed` for every failed check.

**`lock-band.ts`:**
- It acts only on BetterAuth's `ACCOUNT_TEMPORARILY_LOCKED`, and only with no session.
- The hold is read through `getSignedCookie` with the auth secret, then needs a live verification row.
- The band only, never a time. **It matches D6 (b) and my §7.4 conditions.**

**Elsewhere in the service:**
- **The route classes** (`route-policy.ts`): `reauth` on the three paths, needing `second_step_at`. They join `LIMITED` and `COMMITS_REFUSAL`, and `trustDevice` is refused on both verify paths.
- **`anchor.ts`:**
  - with no sender, `send-code` answers 503 `mailer_unavailable` before the body, the password or the cap;
  - `sentTo` is masked to the first letter of the local part and of the domain.
- **`handler.ts`:** `no-store` on every `/api/auth` answer.
- **`apps/auth/src/main.ts`:**
  - `requireClientIp: true` in every `APP_ENV`;
  - `deps.sendSecondStepCode` is refused outside development, and `cli()` passes none, as the tests in `apps/auth/src` pin.

## 3. Web

- **The gate** (`hooks.server.ts`) is unchanged in shape: one check before `resolve`. It exempts exactly `/settings/second-step` and its `__data.json`, and redirects to `?setup=1&next=<safeNext(path)>`. Every signed-in answer is `no-store`.
- **Server loads:**
  - `/settings/second-step` returns R2's row, `recentAuthOk` and `held`;
  - `/entities` returns `secondStepOff` and the resume step;
  - neither names an entity, and there are no form actions.
  - `@poly/auth/web`'s `readSecondStep` passes on only R2's columns.
- **The dialogs:**
  - `SecondStepSetup.svelte`, `ConfirmItsYou.svelte` and `PanelAction.svelte` are portaled to `document.body`, with forms that call `preventDefault` and `fetch` only `/api/auth` (`auth-api.ts`).
  - Secrets live only in component state, cleared on close, Escape, the backdrop, `beforeNavigate` (the set-up dialog asks first while unsaved codes are on screen), `onDestroy` and `pagehide`.
  - Confirm it's you clears both fields after a refusal (`ConfirmItsYou.svelte:104-106`), as I asked.
  - The download's object URL is revoked once used.
  - There is no `console` call, no storage, and no `{@html` (the boundary test covers all of web).
  - The QR is an SVG `<path d>` built from `isDark`, not markup.
- **The QR library: `qrcode-generator` 2.0.4, pinned exactly** (`apps/web/package.json:33`, with a lockfile integrity hash).
  - It has no dependencies and no install script (its `scripts` holds `test` only), and is MIT, by Kazuhiko Arase.
  - Its `dist/qrcode.mjs` (2,237 lines) contains no `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`, `eval` or `new Function`, and does not touch `document` or `window`. Its one HTML-string helper, `createImgTag`, is not used.
  - **N3 is closed.**
- **The Vite proxy** sets `x-forwarded-for` from the socket, overwriting the browser's value (dev and e2e only).
- **Caddy** gains `X-Frame-Options "DENY"`, with the lint entry.
- **The healthcheck** (`3607aa34`) sends its own `x-forwarded-for`, as accepted at `c365d11d`.

## 4. Notes (not blocking)

1. **A lock that lands between the service's lock read and `complete_step_up`** answers `step_up_failed` rather than the lock refusal. That is the database's `step_up_refused` path. The user retries and then sees the lock. This is correct and fails closed; it only affects how the refusal is worded.
2. **The flake in `second-step-reauth.spec.ts`** (gate.md) is not a security matter. qa could not reproduce it at the tip (4 runs of 80/80).
3. **Open 5** stands: BetterAuth's own sign-in verify still accepts a reused code within its window. A3.4 stops that code passing a re-check. It needs its own issue.
4. **The two conditions that gate the first real deploy are not built** (POLY-137): the 24-hour delay with an email and cancel for a method added through a re-check, and an email on every method change. SECURITY says so (§5).

## 5. SECURITY edits in this commit (current state only)

- **R-2:** SQL as poly_auth can mark a session freshly confirmed and so plant its own method and lock the user out (§13.2's text), with the Principal as approver. The client address rests on Caddy's default until POLY-138.
- **R-25:** the screens exist. Enrolment in production still waits on POLY-137, and codes captured from altered pages work once at a re-check.
- **R-26:** the lock band, the re-check sharing the counter and the lock, and a trusted browser refused until POLY-154.
- **New R-28:** a found backup code plus the password is a full takeover (D7 b), with the Principal as approver, until POLY-137's delay and email.
- **C-03:** the set-up dialog, Confirm it's you, the 300-second window and what it unlocks, the sign-in gate's single exemption, `trustDevice` refused, and passkey users without backup codes.
- **C-88:** one counter and one lock for sign-in and the re-check.
- **C-89:** the `step_up` and `step_up_failure` kinds, and the `method` column.
- **§4.1:** sign-up asks for the emailed code, and suppression is visible to its own user.
- **§9:** method changes are audited by the database.
- **New T-105:** a forged or replayed re-check, or a planted method.
- **C-04:** the address the limit keys on, and its dependence on Caddy until POLY-138.

**Verdict deviation 6 (`noteTotpStepHook` lets a sign-in stand when `note_totp_step` refuses the step): acceptable as is. No SECURITY change** (code-read).
- **Only one direction of clock skew opens a gap.** Both definers test the step against the same database clock, ±1 step.
  - If the service's clock is **behind** the database's, a step refused at sign-in is further out of the window by the time of any re-check, so `complete_step_up` refuses it too.
  - Only a service clock **ahead** by at least a full step (30 s or more) lets that one code pass a re-check later, while the database clock catches up: at most about a minute.
- **Using that gap still takes the user's session, their password and the code seen at sign-in.**
- **On this deployment the skew is nil.** `auth` and Postgres are containers on one host, sharing the kernel clock.
- **The refusal is logged** (`totp_step_not_noted`), so a skewed host would show up.
- **The rule would change if the database ever moved to another host.** Then the deploy gate should check clock sync, or the hook should refuse the sign-in instead. Nothing needs saying in SECURITY now.

## 6. The new production dependencies in `packages/auth`, and the pin constraint

Read from `git diff origin/main...HEAD` of `packages/auth/package.json`, `apps/web/package.json` and `pnpm-lock.yaml`, with the lockfile compared entry by entry. I ran no install and no `pnpm audit`.

**Verdict: no breach of the constraint.** No better-auth, passkey or simplewebauthn version moves.

- **`@better-auth/utils` 0.5.1 and `@simplewebauthn/server` 13.3.3 only become direct dependencies.**
  - Both were already locked on `main` at exactly these versions, as dependencies of `better-auth` 1.7.18 and `@better-auth/passkey` 1.7.18.
  - Their package and snapshot entries are identical in both lockfiles. The only new lines are the two importer entries under `packages/auth`.
  - `better-auth`, `@better-auth/core` and `@better-auth/passkey` stay at 1.7.18, with unchanged entries.
- **One new package enters the production install: `qrcode-generator` 2.0.4** (web), with no dependencies (§3). Nothing new enters the sign-in service's production install.
- **The rest of the lockfile diff is development tooling, re-resolved because the root `package.json` pins them as `latest`:**
  - eslint 10.14.0 → 10.15.0, with `@eslint/config-array` 0.23.6, `minimatch` 11.0.9 and its new `@isaacs/nonrecursive-glob-match` 1.1.0;
  - turbo 2.11.11 → 2.11.13;
  - vitest 5.1.0 → 5.1.1.

  All of these sit under the root importer's `devDependencies`. The image installs with `pnpm install --frozen-lockfile --prod` (`Dockerfile:15`), so none ships. They are outside the constraint. The PR description should name them, so a reviewer does not take the lockfile churn for an auth change.
- **Advisories, by reading** (spec):
  - The one advisory for `@simplewebauthn/server` is GHSA-6hxq-p678-4hr2: low severity, attestation certificate-chain validation at *registration*, fixed in 13.3.2. 13.3.3 includes the fix, and the re-check uses only `generateAuthenticationOptions` and `verifyAuthenticationResponse`, which do no attestation.
  - I did not check `@better-auth/utils` 0.5.1, `qrcode-generator` 2.0.4 or the dev bumps against an advisory database (unmeasured). The CI audit job covers that.
- **One thing for POLY-137's S9 test and any later better-auth bump.** `packages/auth` now pins `@simplewebauthn/server` and `@better-auth/utils` directly.
  - A better-auth or passkey bump that moves either of them would install a second copy beside ours instead of moving ours.
  - The bump must move all four pins together, and S9 should fail if the lockfile holds two versions of either package.
