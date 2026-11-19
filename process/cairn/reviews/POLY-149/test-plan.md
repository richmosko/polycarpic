# POLY-149 — test plan (qa-engineer-149)

Written against `ruling.md` @ 4b421984 (R0–R9, R5 addendum) and `ruling-review.md` §3 (T-L1..T-L5, T-S1..T-S4). Criteria are in `POLY-149.md` order. "Red because" is the reason the test fails on the tree today; `red-run.md` records the real first failure per file.

## Conventions

- **Refusals assert the state**: the row, its streak and `xmin`/value read back unchanged after the 42501 (`refusedUnchanged`, `codeOf`, `msgOf`). 42501 alone proves nothing (POLY-152 review §5.2).
- **"Fake clock" = row facts** (ruling R2): `lapseLock(db, userId)` in `tests/db/helpers/lock.ts` (superuser, one transaction, `session_replication_role = replica`). Node's `Date` is faked only by T-L1.
- **Both paths** (`/two-factor/verify-totp`, `/two-factor/verify-backup-code`) run through `handleAuthRequest` as poly_auth. A hold allows 5 wrong codes, so 10 counted wrong codes open two holds (`wrongCodes`).
- **Plants.** Every catalog pin has a plant in `tests/db/sign-in-controls-pins.test.ts`, run in the pgTAP file's own rolled-back transaction; the control (no plant) must be clean, so no plant passes vacuously.
- New `tests/db` files are in `DB_AREAS` (`infra/ci/changes.mjs`, area `auth`) and in the `db-areas.test.ts` TABLE row. No test writes to `temp/`.
- Shared helper: `tests/db/helpers/lock.ts` (factor setup, `lockOnce`, `streakOf`, `recordRows`, `captureStatements`).

## Criteria

| Criterion | Test (file › name) | Red because |
|---|---|---|
| **V1** poly_app: no grant on any BetterAuth table | `revocation.test.ts` › "SELECT token FROM public.session", "INSERT into public.verification", "UPDATE of public.two_factor", "every one of the six tables refuses a SELECT as poly_app"; `pgtap/11_poly_app_grants.sql` (table and column privileges, effective and granted, six tables + session_handle + sign_in_record + second_step_streak + email_challenge named) | grants still held |
| **V1** no EXECUTE on any `enter_*` but `enter_session`; complete EXECUTE set on `app` pinned (F2) | `pgtap/11` (ten functions, both ways, effective incl. PUBLIC, and `routine_privileges`); plants in `sign-in-controls-pins.test.ts` (extra EXECUTE on `enter_auth_session`; a new function granted to PUBLIC; a listed EXECUTE revoked) | `enter_asserted_user` held |
| **V1** `enter_asserted_user` gone, web marker refused | `revocation.test.ts` › "does not exist (to_regprocedure NULL)", "a web marker is refused by the tx_identity CHECK", "audit_membership has no web branch" | function and `web` kind exist |
| **V1** email_challenge read and policy revoked (R1, beyond the criterion) | `revocation.test.ts` › "poly_app cannot read app.email_challenge"; `pgtap/11` | grant and `email_challenge_own` exist |
| **V1** names, layer config, subpath, harness revoke, fixtures gone (R1 "what goes with") | `tests/layers/revoked-names.test.ts` (grep over apps/, packages/, tests/; `layers.json`; `packages/db` subpath; fixture dirs 12, 13, 31; tsc probe; `revoke-target.ts` and `e2e-revoke-scope.test.ts`; serve.ts) | all present |
| **V1** two migrations, revocation separate | `revoked-names.test.ts` › "0016 and 0017 exist… only 0017 revokes"; "definers.json lists the new definers, not enter_asserted_user" | no 0016/0017 |
| **V1** poly_auth fixture is the real role | `pgtap/08_poly_auth_grants.sql` + `pgtap-membership.test.ts` (N2 plant `GRANT poly_app TO poly_auth`, already shown to fail); `helpers/second-step.ts` `ROLES`/`enterAs` (poly_app entry now by handle) | met by the pin; nothing to build |
| **L1** 15…960, then 1440 ±1, both paths | `second-step-lock.test.ts` › "L1 consecutive locks double" (×2 paths, 9 locks each) | the second lock is 15 (BetterAuth's 900 s) |
| **L2** only a correct code resets | › "L2 … two locks, a lapse, then a correct code" (×2 paths); "a lapse, a held email sign-in and a passkey sign-in each leave the doubling"; "a magic-link sign-in and a password change leave the doubling" | no streak, no reset |
| **L3** right code refused during a lock, no session, every length | › L1 loop (right code at each of the nine lengths); T-L1: "Date faked past locked_until so BetterAuth's check passes" (×2 paths) | no guard: the lazy clear passes |
| **L4** state in the database, restart | › "L3 a fresh createAuth and fresh pools between two locks" | no streak table |
| **L5** database refuses shortening/clearing; no login role has a privilege on the streak | › "L5 poly_auth cannot shorten, clear, lower or delete a lock": `locked_until = NULL`, `= now()`, one minute out, the lazy-clear statement, the success-reset statement, `DELETE`, each 42501 and unchanged; "T-L3"; "the streak table: no statement as any login role"; `pgtap/12` | no guard; no table |
| **L6** passkey passes during a lock; reset-mfa works on a locked user | › "passkey during a lock: 200 and a session" (**passes today; a pin**); "app.reset_second_step as poly_operator on a locked user … streak row is gone" | reset leaves the streak (no streak yet) |
| **L7** each red before the build | `red-run.md` | — |
| T-L2 race at the 10th code | › "T-L2 two wrong codes at once at count 9" | no streak |
| T-L4 factor DELETE during a lock | › "T-L4 delete during a lock: refused…; lapse; delete + re-insert keeps the streak" | no delete guard |
| T-L5 no clock a role can change | `pgtap/12` (current_setting names, literal names, no `set_config`) + 2 plants | passes on today's chain for the scan; the file is red on absent objects |
| unmeasured (R2): no other write sends the reset shape | › "unmeasured (R2): no other BetterAuth write sends the reset shape" (statement log, values included; prints enrolment, regenerate, disable) | measured in `red-run.md` |
| **S1** one record row per committed session INSERT, database-written | `sign-in-record.test.ts` › "as poly_auth: insert, attach, delete, commit: one row remains…", "real sign-ins: email, Google and a held sign-in each add exactly one row" | no table |
| **S2** delete leaves the row; rolled-back leaves none | › same first test; "a rolled-back insert leaves none" | no table |
| **S3** no login role writes it; owner/superuser refused; purge owner can't delete fresh rows | › "effective: no INSERT, UPDATE, DELETE, TRUNCATE for any of the six login roles; no SELECT for the five runtime roles"; "UPDATE, DELETE of a fresh row and TRUNCATE are refused for the owner and for the superuser"; "SET ROLE poly_purge, then DELETE of a fresh row: 42501"; `pgtap/12` + plants | no table |
| **S4** retention: 400 days and deleted accounts, purge path only | › "retention: as poly_worker: a 401-day row and a deleted user's row go; … a second call deletes nothing" (T-S4); EXECUTE for poly_worker only (same test and `pgtap/12`) | no function |
| **S5/S6** counted refusal and lock rows | › "10 counted wrong codes add 10 second_step_failure rows … and one second_step_lock row of 15 minutes" (×2 paths) | no guard writes |
| **S7** no row without a valid hold | › "no cookie, an unknown hold and a dead hold's 6th try add no row" | no table |
| **S8** typed code never stored | › "no column of the record holds a typed code" | no table |
| **S9** no login role reads it | `pgtap/12` effective SELECT for the five runtime roles, plant `GRANT SELECT … TO poly_worker`. **poly_backup is not asserted** (Principal Decision 1 open) | no table |
| T-S1, T-S2 | › "T-S1 a client address that is not an inet… address NULL"; "T-S2 a session with a 10 KB address and browser … cut to 512" | no table |
| T-S3 | `pgtap/12` (no login role: DELETE on `user`, UPDATE of `user.id`, TRUNCATE) + plant | passes only once the file's other objects exist |
| F1 record written by the database, not service code | the S1 tests send no record statement (service code has none); `pgtap/12` pins the session trigger (+ dropped/disabled plants) | no trigger |
| **S10** INFRA §7.1 step 16 check | **not mine**: `tests/infra`, devops (ruling R5 table). The R5 line "no runtime role reads the record" is the same predicate as S9 | — |
| **N1** slide writes only when the expiry moves forward | `enter-session-slide.test.ts` › "a session at its 30-day cap … two entries leave xmin, updated_at and expires_at unchanged"; controls: a slide below the cap still writes; settles at the cap | the UPDATE runs unconditionally |
| Addendum 2 non-blocking slide | `enter-session-slide.test.ts` › "Addendum 2: a second entry on a slide-due session, while the first transaction is still open, returns within 2 s; after both commit expires_at moved once" (red: it waits the full 2 s statement_timeout on the row lock) | the slide takes the row lock and waits |
| **D1–D3** docs, backup-code item removed, RSS | no executable test (docs and devops measurement). `revoked-names.test.ts` pins only the code-side removals | — |

## Fixtures that ran as poly_app (ruling R1, "Test fixtures")

`tests/db/helpers/second-step.ts` `enterAs` for poly_app and `tests/db/helpers/{marker,tenancy,matrix,cross-tenant,invitation}.ts`, plus the `withTenant` callers listed by `revoked-names.test.ts`, move to `app.enter_session` with a handle from `sessionWithHandle`. The scratch measurement in `red-run.md` lists which tests break under the real revocation, as a check on the ruling's list of ten.

## Open points

Both answered in ruling Addendum 1 (44ef4ed4): T-L3 is one outcome, refused 42501 with count, `locked_until` and streak unchanged (test tightened); the delete guard is an invoker outside `definers.json`, pinned with `sign_in_record_immutable` in pgTAP 12 (owner, `prosecdef` false, search_path, no login-role EXECUTE). The Principal chose (a) on both decisions: no tests for either.
