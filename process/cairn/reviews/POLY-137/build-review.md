# POLY-137: seceng build review at `2f65e869`

**Verdict: ACCEPT.** The build matches the ruling, as accepted at `fab91743` with Addenda 1 and 2, on every point I checked. Two notes follow (§7), neither blocking. The SECURITY edits are in the same commit as this file.

I read `git diff main...2f65e869`. Everything here is code-read; I ran nothing, because qa had the machine for the gate.

## 1. Migrations 0020 and 0021, against R9
| Item | At `2f65e869` | Result |
|---|---|---|
| Tables | `method_hold` and `mail_outbox`: CHECKs, unique keys, a cascade on the user, row-level security enabled and forced, `REVOKE ALL … FROM PUBLIC`, no-truncate triggers | **Met** |
| Table grants | `poly_govern`: SELECT, INSERT and UPDATE on both. `poly_purge`: SELECT and DELETE on the outbox. Policies for those two roles only. **No login role holds anything** | **Met** (R9.2) |
| Column grants | `poly_govern`: SELECT of `account (user_id, provider_id)` and `audit_event (subject_user_id, kind, actor, created_at)`. The audit policy covers only the two second-step kinds | **Met** |
| Definers | `method_held` and `cancel_method_hold`: EXECUTE for `poly_auth`. `claim_mail`, `arm_hold_cancel`, `mail_sent` and `mail_failed`: `poly_worker`. `note_codes_replaced` and `note_password_changed`: no login role (EXECUTE to `poly_owner` for creating the triggers, then revoked). `purge_mail_outbox`: owned by `poly_purge`, `poly_worker` only. All eight are revoked from PUBLIC, with `search_path = ''` | **Met** (R9.3) |
| Exact-call checks | On `cancel_method_hold`, `claim_mail`, `arm_hold_cancel`, `mail_sent`, `mail_failed` and the replaced `complete_step_up`. `method_held` has none: it is called inside a trigger, and it only answers whether a given id is held | **Met** |
| Invoker trigger functions | `guard_method_hold` and `refuse_email_change`, owned by `poly_owner`. The triggers are `_12_` (BEFORE UPDATE OF the named columns), `user_21_email_fixed`, `two_factor_84_codes_replaced` and `account_80_password_changed` | **Met** |
| `CREATE` on `app` | Granted to `poly_govern` and `poly_purge` for the file, and revoked at its end | **Met** |
| `roles.sql` | `ALTER ROLE poly_auth SET idle_in_transaction_session_timeout = '15s'` | **Met** (R4.2) |

## 2. The hold, and how it fails closed
- **Held means:** `cancelled_at IS NULL AND (notice_sent_at IS NULL OR usable_at > now())`. The same predicate appears in `method_held`, `cancel_method_hold` and `arm_hold_cancel`. **RC2 is met.**
- **Who sets the columns:**
  - `arm_hold_cancel` only moves `usable_at` later (`GREATEST(…, clock_timestamp() + 24 h)`), and only while the hold is held;
  - `mail_sent` is the only writer of `notice_sent_at`;
  - no login role can write either column.
- **Held or first set-up, decided in `sync_second_step`.** An add is held when `second_step_at` was already set, or when the user removed one of their own methods after the operator's last reset (R3.3 rule 2). The decision is made before `second_step_at` changes.
- **Rows written in the same transaction:**
  - the audit row, unchanged and first;
  - the outbox row, merged per transaction;
  - one hold row per held method, all pointing at that outbox row (RC4).
- **What skips the hold and the mail:** a superuser with no role set, and a user being deleted. Nothing else.
- **Every use of a held method is refused:**
  - `guard_method_hold` refuses a success reset (`failed_verification_count = 0`) or any change to `backup_codes` on a held `two_factor` row, and any counter update on a held passkey. `poly_govern` and superusers pass.
  - `complete_step_up` refuses `totp` and `backup_code` while the verified row is held.
  - `reauth.ts` runs the passkey counter update under a savepoint and maps `method_on_hold` to 403.
- **`check_factor_removal`** leaves held rows out of the count of remaining methods. **M4 is met.**
- **`note_codes_replaced`** returns early when the transaction has a `step_up_pending` row.
  - **Unmarked:** it refuses a list that does not shrink (`backup_codes_not_a_spend`), and otherwise writes `backup_code_used`.
  - **Marked:** it writes `backup_codes_replaced`.
  - **RC3 is met.**

## 3. The cancel link and the three pages
- **The worker** draws 32 bytes from `randomBytes`, arms them as a SHA-256, and mails them in base64url after `#`. A NULL from the arming sends the form with no link.
- **The definer** checks the token's shape, then decodes it and re-encodes it to confirm the canonical form. It finds a held hold by hash under `FOR UPDATE`, locks the user row, and then for every held method of that user:
  - deletes the method row (as `poly_govern`, so the last-method rule does not apply);
  - marks the hold cancelled;
  - clears `two_factor_enabled` when no verified TOTP row is left.

  It then deletes **every session of the user**. **RC4 and M13 are met.**
- **The endpoint:**
  - `POST` only, with no session middleware;
  - one `cancel_link_invalid` for every refusal;
  - class `open` in `route-policy.ts`, on `LIMITED`;
  - `NO_MARKER` sends it to `withSignInTx` before the session branch.
- **The pages:**
  - `cancel-method` and `reset` read `location.hash`, then `history.replaceState` removes it;
  - only the button's handler sends a `fetch` POST, so a visit changes nothing;
  - each `+layout.server.ts` sets `referrer-policy: no-referrer` and `cache-control: no-store`;
  - `forgot` posts no `redirectTo`;
  - `/reset-password/:token` is `blocked`.

  **RC5 and M12 are met.**

## 4. Mail, the cap and the key
- **`resendMailer`:**
  - a 5 s `AbortSignal.timeout`, plain text only;
  - `MailError` carries a status and never the body;
  - the key is used only in the `Authorization` header.
- **`config.secrets.RESEND_API_KEY_FILE.reveal()`** is called only where the mailer is built (`apps/auth/src/main.ts`, `apps/worker/src/main.ts`).
- **`check.ts`:**
  - refuses a staging or production `auth` or `worker` without the key, or without a `MAIL_FROM` once a key is set;
  - checks `MAIL_FROM` against a single-address pattern with no CR or LF, which guards against header injection;
  - refuses `MAIL_FROM` in any other service.
- **`RecipientCap`:**
  - 10 sends over a sliding 60 minutes, with the key trimmed and lower-cased;
  - a refused take records nothing, and empty entries are deleted.
- **The senders** (`packages/auth/src/mail.ts`):
  - **magic link:** runs in the background, looks the address up, mails no address without an account, and counts with `cap.take` before the send;
  - **reset:** runs in the background, with the cap before the send; the URL is the fragment form only;
  - **send-code:** `allow()` before the challenge, otherwise 429 `mail_capped`, and the send is awaited.

  `disableSignUp: true` and `resetPasswordTokenExpiresIn: 900` are set. **RC1, RC8, M14 and R1.9 are met.**
- **The worker** never counts a notice: `mail.ts` holds no cap object.
- **Templates:** fixed text. The only placeholders are our own: a URL, a code, a token, a method enum and timestamps. No passkey name and no user agent.

## 5. Every log call's fields (no address)
| Call | Fields |
|---|---|
| `mail.failed` | `kind` (an enum of three) and `status` (only when numeric) |
| `mail.capped` | `kind` and `user_id` (a uuid) |
| `job.run` | `job`, `outcome`, and the counts `sent`, `failed` and `deleted`; plus `ms`, and `err` on failure |
| `mail.unconfigured` | none |

- `log.schema.json` is closed (`additionalProperties: false`). `kind` is an enum, `status` is an integer from 100 to 599, and the counts and `ms` are bounded integers.
- `err` holds only `type` and `code`, both pattern-bound, so a Postgres error message, which can quote a row value, never reaches the log.
- `apps/auth` passes the schema-bound logger.
- The default sink (`console.error`) is used only where no logger is passed, which is the tests and development.

## 6. permission-matrix.json and gate-check
- **Matrix:** two `not role-scoped` rows, for `app.method_hold` and `app.mail_outbox`, each naming its covering test file. They are correct: no login role holds a privilege on either table.
- **Gate lines 15–24, against R3.8 and Addendum 1:**
  - lines 15 and 16: SELECT by any runtime role on the new tables; the triggers run the right functions on the right `UPDATE OF` columns;
  - line 17: labelled a tripwire in the SQL comment;
  - line 18: the nine definers, each with its owner, SECURITY DEFINER and its exact executor set;
  - line 19: no notice unsent for over an hour, stated not to be a standing monitor;
  - lines 20 and 21: the three notice triggers, and `15s` for `poly_auth`;
  - lines 22–24: the purge-age wording of Addendum 1.

  `query_to_xml` turns a missing table into a FAIL line instead of a script error. Good.

## 7. Notes (not blocking)
- **N1. A failed magic-link lookup is silent.** The background `findUserByEmail` error falls into `.catch(() => {})`, so a database fault there leaves a member without their link and nothing in the log. Log `mail.failed {kind: 'magic_link'}` with no status, as a send failure already does. A one-line change; a follow-up is fine.
- **N2. `refuse_email_change` exempts only a superuser `current_user`.** That is as ruled (D1): an operator corrects an address as a superuser at the box. The INFRA runbook should say so when it next touches account administration.

## 8. SECURITY edits (this commit; current state only)
- **C-02:** reset deletes every session; `/change-password` refuses unless `revokeOtherSessions` is `true`.
- **C-03:** the hold, the cancel link and the database-written notices; the `accountLockout` dependency; email fixed; send-code with no mailer in development only.
- **C-04:** the new limited routes, `/reset-password/:token` blocked, and the token mail cap with its accepted cost.
- **T1:** reset tokens: 900 s, fragment only; the cancel token stored as a hash.
- **§6.1:** one sending-only Resend key per service; no start without it; the key only in the header. The backup-code copy is now refused or emailed.
- **§9:** the mail log fields; the notices that are built and those that are not; the purge is scheduled.
- **R-2:** `poly_auth` cannot change the email; a planted method is held and emailed; the two-credential path (`poly_auth` plus `poly_worker`) makes one live unannounced.
- **R-12:** the cancel-link token is not redeemable from a database read.
- **R-24:** the limits and the 15 s timeout, and their limit: a compromised service can `SET` its own timeout.
- **R-25, R-26, R-28:** stale "until the mailer exists" text replaced. R-26 says the cap after 3 locks is deferred. R-28 states the mailbox residual.

**Delta `c74a8920` (MAIL_FROM moved from compose to `host.env`): ACCEPT.** No code changed (`packages/config` is untouched), so `check.ts` still refuses a staging or production `auth` or `worker` without `MAIL_FROM`. `APP_ENV` is required and never defaulted, so the check cannot be skipped. `MAIL_FROM` is a non-secret sender address, now listed with `PUBLIC_ORIGIN` among D-1's non-secret host settings. `RESEND_API_KEY_FILE` and every other secret stay as files mounted per container in compose, and no secret moved.
