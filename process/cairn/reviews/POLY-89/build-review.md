# POLY-89 — seceng build review at `a8370f78`

*seceng, 2026-11-16. Code and tests as at `8e2a82e4`, reviewed against the ruling at `35e375b5`, my conditions C-a to C-f, and the early rulings.*

**Verdict: accepted. Nothing blocks.** I found no way around any guard. Three conditions are worth fixing in this PR (N1–N3, each under an hour). The rest are notes.

## What I re-ran myself
- **The four second-step suites** (gates, flow, challenge, reset), from my own worktree: `pnpm vitest run -c tests/db/vitest.config.ts tests/db/second-step-{gates,flow,challenge,reset}.test.ts --exclude '.claude/**'`. Result: 4 files, 147 tests pass.
- **My own probes against a fresh migrated clone.** I wrote a throwaway file, ran it, deleted it and did not commit it. 7 of 7 passed:
  - **P1.** `app.consume_passkey_grant()` called by poly_app with a live grant is refused, both called directly and through `RETURNING` on an UPDATE that fires triggers. So a grant cannot be turned into a step-up stamp without inserting a passkey.
  - **P2.** `app.take_recent_auth_stamp()` called directly returns false.
  - **P3.** An unmarked copy of another user's `two_factor.secret` is refused. An unmarked copy of `backup_codes` succeeds, which is D1 as decided.
  - **P4.** Marked as user A, an UPDATE of B's factor row is refused, and so is an unmarked passkey DELETE.
  - **P5.** The `user_email_unique` index lets in `Dup@qa.test` and `dup@qa.test` together (this is N2).
  - **P6.** A poly_app session INSERT that names `recent_auth_at` is refused by the column grant.

## The conditions, checked against the build

| Condition | Status | Where |
|---|---|---|
| **C-a**: sign-in carve-out, row's own user, verified rows only, counter may not go down | **Met** | `guard_two_factor` lets unmarked writes touch only a verified row, never `verified`, `secret`, `user_id` or `id` (0013:642-647). `guard_passkey` lets unmarked writes change `counter` only, never down (:697-702). `sync_second_step` and `two_factor_consistent` compute for the row's own user (:327, :363-369). Tests cover the lockout, passkey sign-in and backup-code sign-in (gates :385, flow :151, :186). |
| **C-b**: read after the lock, VOLATILE, two-connection test | **Met** | `check_factor_removal` takes `FOR UPDATE` (:177), and #10 and #11 take `FOR SHARE` (:400, :429). Each then reads in a later statement, and the functions are VOLATILE. |
| **C-c**: the passkey stamp hits exactly one row | **Met** | `consume_passkey_grant` checks `GET DIAGNOSTICS` and refuses unless one row (:268-272). The leftover risk is now in SECURITY R-2. |
| **C-d**: passkey delete and rename | **Met** | The ruling sentence is fixed. #6 and #7 are the floor against SQL (P4). |
| **C-e**: the anchor's password half is an app check | **Met** | `anchor.ts` checks the password, or a session under 5 minutes old. SECURITY §4.1 states it. |
| **C-f**: the operator reset | **Partly met** | The email is lower-cased, an unknown email exits 2, and the reset writes an audit event and a notification. Not met: duplicates differing only in case (N2) and refusing a tombstone (N3). |
| Early (1): exact call | **Met** | All four definers use 0011's `IS DISTINCT FROM` form. `anchor.ts` reads the default column names. |
| Early (2): the commit header | **Met** | It is honoured only for `/second-step/confirm-code` with a 403 (`handler.ts` `keeps`) and stripped on every path. Tested at flow :203 and :215. |
| Early: `emailVerified` | **Met** | `send-code` refuses an unverified address. Tested at flow :229. |
| R1.3: superuser and `SET ROLE` | **Met** | The definer guards check `session_user` superuser **and** `role = 'none'`. The invoker guards check `current_user`. Tested at gates :496-530. |
| id_token | **Met** | The hook returns `idToken: null`. The stored row is NULL on account create and on update (flow :246, :254). |

## Findings

**N1. R1.5 does not list five functions that poly_app may execute. Not blocking; fix the ruling text and pin it in a catalog test.**
- **How it works.** poly_app holds EXECUTE on `step_up_fresh`, `enrol_proof`, `check_factor_removal`, `consume_passkey_grant` and `take_recent_auth_stamp` (0013:569-571). It needs them because the invoker triggers call them. None has the exact-call check. R1.5 names only `second_step_required` and `enrolment_grant_live` as exempt.
- **What an attacker reaches.** Nothing new:
  - two only read the caller's own state;
  - `check_factor_removal` locks the caller's own user row, then refuses or returns;
  - the two that write refuse outside a trigger (P1, P2).
- **Fix.** R1.5 lists all seven, each with the property that makes it safe. A catalog test pins the exact set of POLY-89 functions poly_app may execute, so a new one fails CI until someone reviews it.

**N2. The operator reset can reset the wrong user when two emails differ only in case. Not blocking; fix in this PR.**
- **How it works.** `user_email_unique` is case-sensitive (P5). `reset_second_step` matches `lower(email)` and takes the first matching row (0013:544). With `A@x` and `a@x` both present, which user is reset is undefined.
- **What an attacker reaches.** None. Today such a pair should not arise, because BetterAuth lower-cases addresses at sign-up (unmeasured). The harm would be an operator locking out and signing out the wrong person.
- **Fix.** Count the matches and raise when more than one, with the CLI's exit 1. Add a test.

**N3. A deleted user's account (the tombstone) is not refused (C-f). Not blocking.**
`user` has no tombstone column yet, because account deletion (C-52) is not built. The condition moves to that issue: `reset_second_step` must refuse a tombstoned user.

**N4. Accepting a manager or owner invitation can be marked done without the raise. Not blocking.**
- **How it works.** `seat_claimed_invitations` inserts with `ON CONFLICT DO NOTHING`, then sets `accepted_at` either way (0013:314-315). An invitee who already holds a viewer seat on that entity is marked accepted, and the raise never happens.
- **What it reaches.** No access; the user simply does not get the role they were invited to.
- **Fix.** Refuse the claim, or apply it as a raise (POLY-91's hold). File it with POLY-91.

**N5. The sign-in gate's redirect drops the refreshed session cookie. Not blocking, and not a security issue.** `hooks.server.ts` returns the 303 before `loaded.setCookie` is added. A gated user's cookie is not extended on those requests.

**Confirmed open as decided:** D1 (b). The unmarked `backup_codes` copy succeeds (P3), and SECURITY R-2 now states it. It closes with POLY-149's revocation, and the Principal's deploy gate covers it.

## SECURITY edits in this commit (1.9.22, current state only)
- **R-2:**
  - the backup-code copy and the unguarded `user.email` are added under injection outside a marked transaction;
  - the 5-minute step-up leftover is added under a stolen poly_app password;
  - the deploy gate sits beside the review date.
- **R-25:** the second-factor mitigation is built in the database and the auth routes, but no screen reaches it.
- **§4.1:**
  - for a user with no password, a session under 5 minutes old stands in for the password, so the mailbox alone anchors their first enrolment;
  - the code has no link form and a 24-hour cap on wrong entries, and is stored as `sha256(code:id)`;
  - the password half of the anchor is the app's check.
- **T1:** the hook sets `idToken` to null, tested on the stored row.
- **`consumed_txid` → `consumed_xid`** in C-03 and §4.1, matching the built column.
- **A-33 needs no change.** Its SECURITY wording does not mention the ID token, and ARCH already says `idToken: null`.

## Docs outside my ownership
- **INFRA:** the first-deploy checklist (INFRA §7) should state that no real household data goes in before POLY-149's revocation merges. That belongs to devops-engineer; the lead should place it.

## Delta at `4ef34421`: accepted

The delta is `git diff a8370f78 4ef34421 -- packages apps tests`. I re-ran `second-step-reset` and `second-step-gates`: 2 files, 98 tests pass.

- **N1: closed.**
  - R1.5 (`d88aa7ae`) lists the seven functions poly_app may execute without the exact-call check, each with the reason it is safe.
  - The catalog pin (`second-step-gates`, "N1") fixes three things:
    - the exact set of `app` functions poly_app may EXECUTE;
    - which of them carry the `current_query()` check;
    - that poly_operator holds `reset_second_step` and nothing of poly_app's among these.
  - A new grant fails CI.
- **N2: closed.**
  - **The fix.** `reset_second_step` counts the lower-cased matches before it locks anything. It raises `P0002` for none and `21000` for more than one, and resets neither. The CLI maps 21000 to exit 1, "failed: nothing was reset". Neither message names an email.
  - **What it can reveal.** Only poly_operator can run it. The operator already learns whether an address exists from exit 0 versus exit 2, so 21000 adds one fact for the same person: that two case variants exist. No runtime role reaches it.
- **N5: closed.**
  - **The fix.** The gate's 303 now carries `loaded.setCookie`.
  - **What it can leak.** That value is the same refreshed session cookie the user's normal response would carry, for the user's own session, httpOnly and Secure. A gated user receives nothing they would not get on an ungated page.
  - **Test.** `hooks.server.gate.test.ts` asserts the cookie set is identical on the 303, on the placeholder, and on an ungated page.

Still carried: N3 (refusing a tombstone) moves to account deletion (C-52), and N4 is filed with POLY-91.
