# POLY-137: gate-1 ruling (architect)

This ruling replaces the one at `ad35aa31`. It adds the per-recipient cap (the row added @ `3c6e5bee`). It answers seceng-137's review (`ruling-review.md`, RC1–RC9) and checklist (`temp/2026-11-21-seceng-137-ruling-checklist.md`, M1–M31), and each answer cites its item.

Scope: the 15 rows of POLY-137 "Acceptance criteria (this loop)". Everything under "Deferred to a second auth loop" stays out; where a seam here must leave room for one, it says so in one line.

**Evidence tags.** *Measured* claims give the command and its result. *Code-read* claims give `file:line` in better-auth 1.7.18, `@better-auth/passkey` 1.7.18, or this tree at `bf58b44e`. Everything else is tagged *(unmeasured)*. The dist was read from the main checkout's `node_modules` (the worktree has none), against the same `pnpm-lock.yaml`.

**R0. The threat this ruling is built against** (seceng, `POLY-150/ruling-review.md` §13.2). An attacker holds SQL as `poly_auth`, through an injection bug or the stolen database password. With it they can create a session for any user, stamp it as freshly confirmed, plant their own authenticator or passkey, remove the owner's methods, and come back over HTTP after being evicted. Every control below rests on data `poly_auth` cannot write, or on a trigger it cannot avoid. The sign-in service's own code is assumed honest: an attacker who runs code in the service already had everything (R-2).

---

## R1. The mailer seam

**R1.1 Package.** New package `@poly/mail` at `packages/mail`, layer 0. `layers.json` gets `"mail": { "dir": "packages/mail", "name": "@poly/mail", "layer": 0, "subpaths": ["./fake"], "allow": [] }`, and `mail` is added to the `allow` lists of `auth`, `auth-app` and `worker`. It has no runtime dependency: Resend is a single HTTPS POST made with `fetch`.

```ts
// packages/mail/src/index.ts
export interface Mail { to: string; subject: string; text: string; idempotencyKey?: string }
export interface Mailer { send(m: Mail): Promise<void> }          // resolves once the provider accepts the mail; throws MailError otherwise
export class MailError extends Error { readonly status: number | null }  // the HTTP status, or null for a timeout or network fault. Never the response body.
export function resendMailer(o: { apiKey: string; from: string; fetch?: typeof fetch; timeoutMs?: number }): Mailer
export * from './templates.ts';
// packages/mail/src/fake.ts, exported at '@poly/mail/fake'
export function fakeMailer(o?: { fail?: boolean }): Mailer & { sent: Mail[] }
```

**R1.2 The Resend adapter.** `POST https://api.resend.com/emails`, with `Authorization: Bearer <key>` and `Content-Type: application/json`. The body is `{from, to: [m.to], subject, text}`. `Idempotency-Key` is sent when the caller gives one (at most 256 characters, kept by Resend for 24 h). These shapes come from Resend's API reference, fetched 2026-11-21; *(unmeasured against the live API)*.
- **Timeout:** `timeoutMs`, default 5000, through `AbortSignal.timeout`. Any non-2xx answer or abort throws `MailError`.
- **Logging:** the adapter logs nothing itself. A caller logs `mail.failed` with `{kind, status}`, and never the address, subject, text, code or link.
- **Plain text only:** no HTML part is ever sent. Open and click tracking stay off on the sending domain, so the cancel token never passes through Resend's link rewriting (M10). That is a domain setting, so INFRA's runbook carries it (Follow-up 7).
- **Links:** every link is built from configured values, never from the request's `Host`. BetterAuth builds the magic link from `ctx.context.baseURL`, which is `AuthInput.baseURL` from config; the reset link is ours, built from config `{origin}` (R2.1). The worker builds the cancel link from its own `PUBLIC_ORIGIN` (M10).
- **The key:** it is read from its file into a `Secret` (`packages/config/src/check.ts:199`). `check-config` names a missing key, never its value. No `Authorization` header or request object is logged anywhere (M23). The key is a Resend key with *sending access* for the one domain only, never full access, which could read sent mail (M24; INFRA, Follow-up 7).

**R1.3 Where the key lives.**
- **Sending-only keys, one per service (RC7).** `auth` and `worker` each get their own Resend API key, with *sending access* restricted to the sending domain. A full-access key can read sent mail back through the API, valid links and codes included. With it, a compromise of `worker` would become account takeover through `auth`'s mail. INFRA §6.1 and its rotation runbook say so. The runbook checks it once on staging before the first deploy: `GET https://api.resend.com/emails` with each key answers 401 or 403, and the same call with a full-access key is shown to succeed (Follow-up 7).
- `RESEND_API_KEY_FILE` already exists for `auth` and `worker` (`packages/config/src/registry.ts:21`; `infra/compose/prod.yml:71`, `staging.yml:66`). It becomes **required when `APP_ENV` is staging or production**, and stays optional in development.
- New `MAIL_FROM` (not a secret), e.g. `polycarpic <no-reply@<domain>>`, for `auth` and `worker`. It is required whenever the key is set, and must parse as `name <addr>` or `addr`.
- `check-config` refuses a staging or production `auth` or `worker` that lacks either one. **That refusal is the "no mail, no deploy" control at the service level** (R3.8 is the control at the database level).

**R1.4 No mailer configured** (development only, after R1.3). Each sender answers as it does today:
- `sendMagicLink` throws `mailer not configured`, so the route answers as it does today. (With a mailer, the magic link follows R1.9.)
- `sendSecondStepCode` is left unset, so `/second-step/send-code` answers 503 `mailer_unavailable` (`anchor.ts:57-59`, unchanged).
- `emailAndPassword.sendResetPassword` is left unset, so `/request-password-reset` answers 400 `RESET_PASSWORD_DISABLED` for every caller (`password.mjs:51-57`, code-read).
- The worker logs `mail.unconfigured` (warn) once at start and does not drain the outbox.

**R1.5 One seam into BetterAuth.** `AuthInput` loses `sendMagicLink` and `sendSecondStepCode` and gains `mailer?: Mailer`. `authOptions` builds all three senders from `mailer` and the templates, and each is set only when a mailer is present. `apps/auth/src/main.ts` builds `resendMailer` from the config. `startAuthService`'s development-only `deps.sendSecondStepCode` becomes `deps.mailer`, under the same refusal outside development (`main.ts:24-27`). Tests pass `fakeMailer()` and read the code or link from `sent[i].text`.

**R1.6 Fake.** `fakeMailer` records each `Mail` in `sent`. With `{fail: true}` it throws `MailError(502)`. No non-test file imports `@poly/mail/fake`: `packages/mail/src/boundary.test.ts` greps the repository's `src/` trees for it, excluding `*.test.ts` and `tests/`.

**R1.7 What each email says, word for word.** These are fixed strings with placeholders. **No user-supplied string appears in any mail:** no name, no passkey name (a planted passkey's name is the attacker's text) and no user agent. The placeholders are:
- `{origin}` from config;
- `{url}`, `{code}` and `{token}` generated by us;
- `{method}`: "an authenticator app" or "a passkey";
- `{when}`, `{until}`: UTC, formatted `2026-11-21 18:04 UTC`.

| Kind | Subject | Text |
|---|---|---|
| `magic_link` | Your polycarpic sign-in link | `Use this link to sign in to polycarpic. It works once, for 5 minutes:\n\n{url}\n\nIf you did not ask for it, ignore this email. Nobody can sign in without the link.` |
| `second_step_code` | Your polycarpic confirmation code | `Your code is {code}. It works once, for 10 minutes, to set up a second step for signing in to your polycarpic account.\n\nNobody from polycarpic will ask you for this code. If you did not ask for it, someone may know your password: change it.` |
| `reset_password` | Reset your polycarpic password | `Use this link to choose a new password. It works once, for 15 minutes:\n\n{origin}/sign-in/reset#{token}\n\nChoosing a new password signs your account out on every device. If you did not ask for this, ignore this email: your password has not changed.` |
| `method_added`, held | A sign-in method was added to your polycarpic account | `{Methods added} as a second step for signing in to your polycarpic account on {when}.\n\nIt will not work until {until}, at least 24 hours from this email.\n\nIf you added it, you need do nothing.\n\nIf you did not add it, someone else may be signed in as you. Cancel it before {until}:\n\n{origin}/sign-in/cancel-method#{token}\n\nCancelling removes the new method and signs your account out on every device. Then change your password.` |
| `method_added`, held, link not armed (R3.7; only after a cancel) | (same) | The same first two paragraphs, then: `If you did not add it, someone else may be signed in as you. Sign in, remove it under Settings, Sign-in and second step, change your password, and tell your operator.` |
| `method_added`, first set-up | A sign-in method was added to your polycarpic account | `{Method} was added as a second step for signing in to your polycarpic account on {when}. It is your first second step, so it works now.\n\nIf you did not add it, someone else may be signed in as you: change your password at once and ask your operator to reset your second step.` |
| `method_removed` | A sign-in method was removed from your polycarpic account | `{Methods} removed from the second step for signing in to your polycarpic account on {when}.\n\nIf you did not remove {it/them}, someone else may be signed in as you: change your password and tell your operator.` |
| `backup_codes_replaced` (D2) | New backup codes were made for your polycarpic account | `New backup codes were made for your polycarpic account on {when}. Your old backup codes no longer work.\n\nIf you did not make them, someone else may be signed in as you: change your password and tell your operator.` |

`{Methods}` reads "An authenticator app was", "A passkey was", or "2 sign-in methods were" when one transaction removed several (R3.6). `{Methods added}` follows the same pattern for adds, and the held add's `{until}` then covers them all (RC4). The 10 minutes comes from `0013_second_step_guards.sql:484` (code-read); the 5 minutes from `magic-link/index.mjs:98` (the 300 s default, code-read).

**Room left for the second loop:** the lock notice, the voided-code mail and the operator-reset mail are further `kind`s of the R3.6 outbox, each a CHECK-list addition and one template. `/change-email`'s old-address notice is one more. Nothing here needs to change for them.

**R1.8 The per-recipient cap** (row added @ `3c6e5bee`; M26–M31).
- **What it covers:** every token mail kind (`magic_link`, `reset_password`, `second_step_code`). The three share **one counter per address**. Notices (R3.6) are never counted and never refused: they are sent by the worker, which has no cap object at all (M31).
- **The number:** **10 per rolling 60 minutes** per address. It is a sliding log of send times, not a clock hour, which would allow 20 across the boundary (M28).
- **The key:** the address normalised with `trim().toLowerCase()`.
  - Every token mail goes only to an address that has an account (R1.9). For those, the requested address and the stored one are the same.
  - An address with no account is never mailed, so it needs no counter.
  - **Why this differs from RC1's key:** RC1 keys on the requested address because the magic-link plugin mails any address (`magic-link/index.mjs:90-113`), which would make the route an open relay to non-members. R1.9 closes that relay outright: the sender sends nothing to a non-member. RC1's reason is met, and a stranger's address is never mailed at all (M27).
- **When it counts:** one is taken **before** the provider call, and a failed send keeps it, so a failing provider cannot be looped (M28).
- **Where the count lives:** in memory in the `auth` process, as `class RecipientCap { take(address: string, now?: number): boolean }` in `@poly/mail`. It is never in a request's transaction, where a rolled-back request would erase it (M29).
  - There is one `auth` instance, so there is one cap. A restart clears it, and an attacker cannot cause a restart.
  - Entries older than 60 minutes are dropped on each `take`, and an address with no entries is deleted, so the map stays bounded by the senders of the last hour.
- **What a capped request answers** (M30):
  - **Magic link and reset:** exactly the answer for an unknown address (same status, body and timing), because both senders already return before any send (R1.9). The mail is simply not sent.
  - **Second-step code:** the caller is signed in and knows their own account, so the answer is 429 `mail_capped`. It is decided before the challenge is issued, so no challenge is written.
- **What shows:** each refusal logs `mail.capped {kind, user_id}` at warn, never the address (S4). A restart of `auth` resets every counter.
- **Tests:**
  - On a fake clock, the 11th token mail to one address within 60 minutes is not sent. Kinds share the counter: 6 magic links plus 5 resets means the 11th mail is not sent. At 61 minutes the address can be mailed again.
  - The 11th magic-link request and the 11th reset request for a known address are byte-identical in status and body to a request for an unknown address, and `fakeMailer.sent` is unchanged.
  - An address with no account: every request answers byte-identically to a member's, and no mail is ever sent.
  - The 11th send-code answers 429 `mail_capped` and writes no `email_challenge` row.
  - A `fakeMailer({fail: true})` send still counts.
  - After 10 token mails to an address, a `method_added` notice to it is sent by the worker, and the counter is unchanged.

**R1.9 Every place that sends mail** (M26).

| Sender | Process | Kind | Counted by the cap | Sent when | Answer is independent of the send |
|---|---|---|---|---|---|
| `sendMagicLink` | auth | token | yes | the address belongs to a user (a `SELECT` on `public."user"` by normalised email, which `poly_auth` holds) and the cap allows | yes, RC8 (a): the lookup, the cap and the send are started and not awaited, so the route answers 200 before any of them finish. `/sign-in/magic-link` runs in no transaction of ours (it is in none of `handler.ts`'s sets), so the lookup uses the plain `poly_auth` pool. A failure logs `mail.failed`, and the answer never changes |
| `sendResetPassword` | auth | token | yes | BetterAuth calls it only for a known user (`password.mjs:60-72`); the cap allows | yes: started, not awaited (R2.2) |
| `sendSecondStepCode` | auth | token | yes | signed-in, verified address, the cap allows | no: awaited before commit (R2 of POLY-89: a failed send rolls the challenge back) |
| `mail.drain` | worker | notice | never | the outbox row is claimed (R5.2) | not applicable |
| operator invitation | none | none | not applicable | no mail is sent: `user-invite` prints the link to stdout (`apps/worker/src/cli/user-invite.ts:29`) | not applicable |

A magic link is no longer sent to an address that has no account, and `magicLink({..., disableSignUp: true})` turns off its sign-up as defence in depth (seceng §5.2). `/magic-link/verify` stays in `USER_INSERTING`, because that is harmless and changes nothing else. **The cost:** an invitee can no longer make their account through a magic link. They sign up through the invitation's own `/sign-up` link, which is how they do it today, since no page offers a magic link yet (code-read: `apps/web/src/routes/sign-in/+page.svelte` has none).

## R2. Password reset

**R2.1 Wiring.** The reset token travels only in a URL fragment (RC5).
- **The mail:** the sender ignores BetterAuth's `url`, which is `{baseURL}/reset-password/{token}?callbackURL=…` (`password.mjs:81`), and mails `{origin}/sign-in/reset#{token}`. It is given `token` (`password.mjs:85`).
- **The GET route:** `/reset-password/:token` becomes `blocked` in `route-policy.ts` (today `open()`, line 39). Its redirect to `?token=` (`:127`) is never reached.
- **No `redirectTo`:** none is sent.

So the token never reaches a path, a query, an access log or the browser history.

`emailAndPassword` gains:
- `sendResetPassword`, built from the mailer;
- `resetPasswordTokenExpiresIn: 900`. The library default is 3600 (`password.mjs:73`, code-read).

`revokeSessionsOnPasswordReset: true` stays (`options.ts:46`).

**R2.2 The sender never changes the answer** (M18).
- `/request-password-reset` answers the same 200 whether or not the address has an account (`password.mjs:59-71`, code-read).
- So the sender **starts the send and returns without awaiting it**. It catches its own failure and logs `mail.failed {kind:'reset_password', status}`.
- The response time and status then do not depend on Resend, or on whether the account exists.
- The verification row is written before the send, outside any transaction of ours (the path is in no wrapper set, `handler.ts:153`). A failed send leaves a token that expires unused in 15 minutes.
- No send runs inside a request transaction except the second-step code's (M22, R1.9).
- **The token in logs (M19):** our logs carry the route template only (`handler.ts:130`), never the path or query. The reset and cancel tokens travel only in fragments, which no server sees. The magic link's `?token=` must stay a GET query, because that GET sets the cookie. So Caddy's access log must not record that route's query: Follow-up 8 (POLY-138's area).
- **An account with no password** (magic-link or OAuth only): a reset creates one (`utils/password.mjs:35-41`). That reaches nothing the magic link does not reach already (M20).

**R2.3 What a reset does to sessions** (M16). `resetCredentialPassword` consumes the token, deletes **every** session of the user (and, by cascade, each `app.session_handle` row and every enrolment grant or challenge tied to them), then writes the hash. All of this runs in one `runWithTransaction` (`utils/password.mjs:31-45`, code-read). A reset does not touch the second step. A user with one still needs it at the next sign-in.

**R2.4 The rate limit.** `/reset-password` (the POST) joins C-04's list (R4.1). `/request-password-reset` is already on it.

**R2.5 Pages** (D3). These are bare public pages under `/sign-in/`, so web's `isPublic` (`hooks.server.ts:49`) needs no change.
- `/sign-in/forgot`: one email field. It POSTs `/api/auth/request-password-reset {email}`, then shows `If that address has an account, we have sent it a link. The link works for 15 minutes.`
- `/sign-in/reset`: reads the token from `location.hash`, then removes it with `history.replaceState`, as the cancel page does. It takes the new password twice and POSTs `/api/auth/reset-password {token, newPassword}`.
  - On 200 it shows `Your password is changed and every device is signed out.` and a link to `/sign-in`.
  - On `INVALID_TOKEN` it shows `This link no longer works. Ask for a new one.` and a link to `/sign-in/forgot`.
- Both pages send `Referrer-Policy: no-referrer` and `Cache-Control: no-store`.
- `/sign-in` gains a link, `Forgot your password?`.

**R2.6 Tests.**
- **(a) Expiry:** on a fake clock, a token used at 899 s resets the password, and one used at 901 s answers `INVALID_TOKEN`.
- **(b) Sessions:** after a reset, every one of the user's sessions and handles is gone, and the next sign-in still holds for the second step.
- **(c) No mailer:** `RESET_PASSWORD_DISABLED` for a known address and an unknown one alike.
- **(d) A failing mailer:** a known address and an unknown one each get the same 200 and body; `mail.failed` is logged once, with no address in it.
- **(e) No usable token is stored (M15):** no `verification` row's identifier equals or contains the token sent in the mail.
- **(f) No open redirect, no token in a URL (M17, RC5):**
  - `redirectTo: 'https://evil.example/x'` is refused with 403 `invalid_redirect` (`route-policy.ts:162-163`).
  - The mailed text contains no `/api/auth/` and no `?token=`.
  - `GET /api/auth/reset-password/x` answers 404.
- **(g) Unknown addresses:** a request for an unknown address and one for a known address with a failing mailer give byte-identical answers.

## R3. Method-change emails and the 24-hour hold

**R3.1 Where the decision lives.** Two new tables in schema `app`, generated by Drizzle (`packages/db/src/schema/`). Row-level security is enabled and forced on both, with policies for `poly_govern` (and, on the outbox, `poly_purge`) only. **No login role holds any privilege on either table.** `poly_backup` reads them through `pg_read_all_data`, as it does every table.

```
app.method_hold
  id uuid pk default gen_random_uuid()
  user_id uuid not null -> public."user"(id) on delete cascade
  method text not null check (method in ('totp','passkey'))
  two_factor_id uuid null, passkey_id uuid null   -- no FK: the row outlives a cancelled method; check (num_nonnulls(two_factor_id, passkey_id) = 1)
  created_at timestamptz not null default now()
  usable_at timestamptz not null                 -- created_at + interval '24 hours', set by the writer, never updated
  cancel_hash bytea null check (cancel_hash is null or octet_length(cancel_hash) = 32)
  cancelled_at timestamptz null
  mail_id uuid not null                          -- the outbox row that announces it (no FK; R3.2)
  notice_sent_at timestamptz null                -- set by app.mail_sent for that row, never otherwise
  unique (two_factor_id), unique (passkey_id); index (user_id) where cancelled_at is null

app.mail_outbox
  id uuid pk default gen_random_uuid()
  user_id uuid not null -> public."user"(id) on delete cascade
  kind text not null check (kind in ('method_added','method_removed','backup_codes_replaced','backup_code_used','password_changed'))
  tx xid8 not null default pg_current_xact_id()
  to_address text not null                       -- user.email when the row is written
  payload jsonb not null                         -- {methods: ['totp'|'passkey',...], at, usable_at?, hold_id?}; never a token, code or user string
  created_at timestamptz not null default now()
  claimed_at timestamptz null, attempts int not null default 0, sent_at timestamptz null, last_status int null
  unique (user_id, kind, tx); index (created_at) where sent_at is null
```

A method is **held** when a `method_hold` row names it with `cancelled_at IS NULL AND (notice_sent_at IS NULL OR usable_at > now())`.
- **It goes live only after its email is accepted (M6).** If the worker, Resend or the key is down, the method never activates, and gate line 19 shows it.
- **`usable_at` only moves later.** It is set at the add. `arm_hold_cancel` (R3.6) moves it to at least 24 hours after the arming, so the owner always has 24 hours from the mail (RC2). No login role writes either column (M2).
- **The cost to the owner:** a broken mailer keeps their own new method off until it is fixed. That shows, and it is the right way to fail.

**R3.2 Who writes the hold: `app.sync_second_step()`, replaced.** It stays owned by `poly_govern`, `SECURITY DEFINER`, executable by no login role, and remains the one writer of `second_step_at`. In addition to 0019's body (audit event first, unchanged), it does the following:
- **Superuser sessions:** when `session_user` is a superuser (fixtures, restores), it writes no hold and no mail, as `two_factor_consistent` passes them today.
- **A user being deleted:** when the user row is gone (a cascade from a user delete), it writes neither, and returns as today. The `NOT FOUND` check moves above the new writes.
- **On `second_step.method_added`:** it decides *held* or *first set-up* **before** it touches `second_step_at` (R3.3). Either way, it first inserts or merges a `method_added` outbox row. If held, it then inserts one `method_hold` row per method, each with `usable_at = now() + interval '24 hours'` and `mail_id` set to that outbox row's id (TOTP: at the verified false→true transition; passkey: at the insert, M2).
- **On `second_step.method_removed`:** it inserts or merges a `method_removed` outbox row.
- **The merge:** `INSERT ... ON CONFLICT (user_id, kind, tx) DO UPDATE` appends to `payload.methods`, so one transaction sends one mail per kind. An operator reset of three methods sends one `method_removed` mail.

**R3.3 First set-up versus a later add** (M1). An add is **first set-up**, and is not held, only when both of these hold:
1. `user.second_step_at IS NULL` when the trigger runs. The database already uses this test (`enrol_proof`, `consume_passkey_grant`, `set_two_factor_enabled`, 0013:135, 214, 255). A first method spends the emailed-code grant; any later one needs a fresh step-up.
2. No `audit_event` with `subject_user_id` = the user, `kind = 'second_step.method_removed'` and `actor <> 'operator'` is later than the user's latest `actor = 'operator'` removal, or exists at all if the operator has never reset them.

Every other add is held.

**Why rule 2:** without it, the R0 attacker deletes every method of a non-manager (the step-up is forged), drops `second_step_at` to NULL, and re-enrols. `issue_email_challenge` returns the code to its SQL caller (0013:452), so the attacker is never sent anything and holds a "first set-up" with no hold. With rule 2, that add is held and the owner can cancel it. An operator's `reset-mfa` still leads to an unheld re-enrolment.

**Its cost:** someone who removes all their own methods and adds one again waits 24 h. So does a second method added straight after the first in the set-up dialog, because `second_step_at` is then set.

**Grants this needs:** `GRANT SELECT (subject_user_id, kind, actor, created_at) ON public.audit_event TO poly_govern`, a policy `audit_event_second_step_govern FOR SELECT TO poly_govern USING (kind IN ('second_step.method_added','second_step.method_removed'))`, and an index on `audit_event (subject_user_id, kind, created_at)`.

**R3.4 What a held method cannot do, and who refuses it** (M3). The guard is a new invoker trigger function, `app.guard_method_hold()`, owned by `poly_owner` like `guard_passkey`. It passes writes by `poly_govern` and by a superuser, then asks a new definer, `app.method_held(p_table text, p_id uuid) RETURNS boolean`: owned by `poly_govern`, executable by `poly_auth` only, true while the row is held. When the write is refused it raises `42501 'method_on_hold'`.

| Trigger | Fires on | Refuses, while the row is held |
|---|---|---|
| `two_factor_12_method_hold` | `BEFORE UPDATE OF failed_verification_count, backup_codes ON public.two_factor` | `NEW.failed_verification_count = 0` (the success reset that every right TOTP or backup code at sign-in writes: `totp/index.mjs:170`, `backup-codes/index.mjs:234`, and reauth's `reauth.ts:194`), or `NEW.backup_codes IS DISTINCT FROM OLD.backup_codes` (a code spent, or new codes made) |
| `passkey_12_method_hold` | `BEFORE UPDATE OF counter ON public.passkey` | any such update. Kysely's update names `counter` in its `SET` even when the value is unchanged (a constant-0 authenticator), so the trigger fires *(code-read; test R3.10.1 uses a counter-0 authenticator to show it)*. Passkey sign-in always writes the counter before it creates the session (`passkey/dist/index.mjs:581,583`, code-read), and so does reauth (`reauth.ts:244`). A rename (`/passkey/update-passkey`) sets only `name` and passes. |

Wrong-code increments still pass, so tries during the hold count toward the lock. A held TOTP row's backup codes are held with it, because they live on the same row.

**The TOTP refusal depends on one BetterAuth option (RC6).** BetterAuth writes `failed_verification_count = 0` on a right code only while `accountLockout` is enabled (`verify-two-factor.mjs:191-193`). It is enabled by default (`:122`), and `options.ts` does not set it. One line, `accountLockout: {enabled: false}`, would switch off the hold on TOTP and backup-code sign-in. So `options.test.ts` asserts that the two-factor plugin's `accountLockout?.enabled` is not `false`, with the message `the method hold (POLY-137 R3.4) needs accountLockout`.

**Trust this device is not live (M7):** `routePolicyHook` refuses `trustDevice` on both verify routes (`route-policy.ts:183`), so no trusted-device cookie is ever issued and none can skip a hold.

**What each path then answers.** Every one of these transactions rolls back, so nothing a held method touched survives (code-read; each is shown by test R3.10):
- **Sign-in with a held TOTP or backup code:** the exception escapes BetterAuth's verify, and `SIGN_IN_TX` rolls back on the 500. No session is created.
- **Passkey sign-in:** the passkey plugin's catch turns the exception into 400 `AUTHENTICATION_FAILED` (`index.mjs` catch block), and the transaction rolls back.
- **Confirm it's you (code paths):** `app.complete_step_up` is replaced. 0019's body is kept, with one check added before the stamp: for `totp` and `backup_code`, it raises `42501 'method_on_hold'` when the user's verified `two_factor` row is held. `reauth.ts`'s `fromComplete` maps that message to 403 `method_on_hold`, and no stamp is written.
- **Confirm it's you (passkey):** `reauth.ts` runs the counter update inside `guarded()`. A `42501 'method_on_hold'` there maps to 403 `method_on_hold`, before `complete_step_up`.

**R3.5 What a held method does not count for** (M4). `app.check_factor_removal` is replaced (0013's body, owned by `poly_govern`). Its count of remaining methods (`v_left`) leaves held rows out. So an owner or manager cannot have their last *usable* method removed while a planted one waits. `sync_second_step`'s `second_step_at` computation is unchanged. A held method only ever exists for a user whose `second_step_at` is already set, or who is covered by rule 2. Removal is never held, so a lost phone can still go, and it is emailed.

**The cost for the lost-phone user:** they cannot remove the lost authenticator if it is their only *working* method, and the replacement is held. Until the 24 hours are up they sign in with a backup code, or ask the operator for `reset-mfa`.

**R3.6 The emails go through the database** (M8). A notice written by the service could be skipped by the R0 attacker. A notice written by the trigger cannot. So the trigger writes the outbox row in the same transaction as the change (R3.2), and the worker sends it (R5.2).

Mails that carry a secret (the magic link, the code, the reset link) are sent synchronously by `auth` and are **never** written to the outbox, so no stored row holds a usable token. These new definers belong to `poly_govern`, are executable by `poly_worker` only, and each has an exact-call check like the others (`current_query()` must equal the one statement shown):

| Definer | Exact call | Does |
|---|---|---|
| `app.claim_mail()` | `SELECT * FROM app.claim_mail()` | Picks the oldest unsent row with `attempts < 10` that is unclaimed or was claimed more than 5 minutes ago (`FOR UPDATE SKIP LOCKED`). Sets `claimed_at = clock_timestamp()`, `attempts += 1`. Returns `(id, kind, to_address, payload, attempts)` or no row |
| `app.arm_hold_cancel(p_mail uuid, p_hash bytea)` | `SELECT app.arm_hold_cancel($1, $2)` | For the holds whose `mail_id = p_mail`, while they are held and the mail is unsent: sets `cancel_hash = p_hash` (32 bytes) and `usable_at = greatest(usable_at, clock_timestamp() + interval '24 hours')` on **every** such hold (RC4: one transaction's adds share one mail), then returns the latest `usable_at`, which the mail shows as `{until}`. With no held hold it returns NULL, which now happens only after a cancel. Each re-arm replaces the hash. A stolen `poly_worker` can delay a method or re-arm a link, and it cannot make one live sooner. **But it can make one live unannounced:** it can arm the hold and call `mail_sent` without ever sending. That needs two credentials, `poly_auth` to plant the method and `poly_worker` to mark its mail sent, and an injection in `auth` yields only the first |
| `app.mail_sent(p_mail uuid)` | `SELECT app.mail_sent($1)` | Sets `sent_at`, and `notice_sent_at` on every hold whose `mail_id = p_mail` |
| `app.mail_failed(p_mail uuid, p_status int)` | `SELECT app.mail_failed($1, $2)` | Sets `last_status`. Stores no message text |

**R3.7 The cancel link** (M11–M13).
- **The token:** the worker draws 32 bytes from the CSPRNG for each send attempt and arms the hash with `sha256(token bytes)`. The mail carries 43 characters of canonical base64url in the **fragment**, `#{token}`, so it never reaches Caddy's log or a Referer.
- **Only the last mail's link works:** `Idempotency-Key` is `mail-{id}-{attempts}`. A retry after an unknown result may send a second mail, and that mail's link is then the only one that works.
- **If arming returns NULL** (only after a cancel, R3.6), the mail is sent in its "not armed" form (R1.7).
- **The route:** `POST /api/auth/second-step/cancel-hold {token}` is a new endpoint in the anchor plugin, class `open`, with no session middleware, on C-04's list.
- **Its transaction:** the handler runs it **without a marker, even when the request carries a session**. A new set, `NO_MARKER = {'/second-step/cancel-hold'}`, is checked before the session branch (`handler.ts:146`). A signed-in other user in the same browser must not turn the cancel into `sync_second_step`'s "belongs to its own user" refusal.
- **The definer it calls:** `app.cancel_method_hold(p_token text) RETURNS boolean`, owned by `poly_govern`, executable by `poly_auth` only. Exact call: `SELECT app.cancel_method_hold($1)`. It decodes the token canonically (anything not exactly 32 bytes answers false), then looks for a hold `WHERE cancel_hash = sha256(bytes)`, locked `FOR UPDATE`, that is held in R3.1's sense. A link stops working once the method is live, so a mailbox thief cannot remove a working method without Confirm it's you. With none it returns false. Otherwise, for that hold's user, it:
  1. deletes the method row of **every** held hold of the user (RC4: an owner who did not add one wants them all gone), and nothing else; the last-method rule does not apply, because a held row is not a working method (`two_factor` by id, its backup codes going with it, also setting `user.two_factor_enabled = false` when no verified TOTP row remains, as `two_factor_consistent` requires; or `passkey` by id);
  2. sets `cancelled_at = now()` on each of those holds;
  3. deletes **every session of the user**. There are no trusted-device rows to revoke (M7);
  4. returns true.

  Step 1's delete fires `sync_second_step`, so a `method_removed` audit row and mail follow.
- **The route answers** 200 `{status: true}`, or 400 `cancel_link_invalid` for every refusal: unknown, malformed, already used, lapsed.

**What a stolen cancel link can do:** while the hold lasts, once, remove every method of that user that does not work yet, and sign the user out everywhere. It cannot add a method, remove a working one, sign anyone in, or read anything. The token is 256 bits behind a 5-a-minute limit.

**The page** `/sign-in/cancel-method` (D3) is a bare public page with no `load`. Its script reads `location.hash`, then removes it with `history.replaceState`.
- It shows the heading `Cancel the new sign-in method`, the text `Someone added a sign-in method to your account. If it wasn't you, cancel it. This removes the new method and signs your account out on every device.`, and a button, `Cancel the new method`.
- On 200: `Cancelled. The new method is removed and every device is signed out. Sign in and change your password now.`
- On 400: `This link no longer works. It may have been used already, or the 24 hours are over. Sign in, check Settings, Sign-in and second step, and change your password if anything there is not yours.`
- On 429: `Too many tries. Wait a minute and try again.`
- **A GET never cancels**, because mail scanners open links.
- The page sends `Referrer-Policy: no-referrer`.

**R3.8 The deploy gate.** `infra/postgres/gate-check.sql` gains these lines. Each has a planted fault in `tests/db/gate-check.test.ts` on a migrated scratch database that breaks exactly that one thing. The test asserts the exact `FAIL` line **and** a non-zero exit from `gate-check.sh`.
- In `gate-check.sql`, line 17's comment labels it a tripwire.
- **15.** `app.method_hold` and `app.mail_outbox` exist, with row-level security enabled and forced. No login role holds any of SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on either, at table or column level; `poly_backup`'s SELECT is the allowed exception.
- **16.** `two_factor_12_method_hold` and `passkey_12_method_hold` exist, are enabled, run `app.guard_method_hold()`, and `pg_get_triggerdef` contains `BEFORE UPDATE OF failed_verification_count, backup_codes` and `BEFORE UPDATE OF counter` respectively.
- **17.** The body of `app.sync_second_step()` contains `app.method_hold` and `app.mail_outbox`. The body of `app.complete_step_up(text,uuid,bigint)` and the body of `app.check_factor_removal(uuid,text,uuid)` each contain `method_hold`. **This line is a tripwire, not a proof:** a comment would satisfy it. The proof is behavioural: R3.10's tests 3, 7 and 8 against the migrated schema. The gate is read-only and cannot run them.
- **18.** Each of these is owned by `poly_govern`, is `SECURITY DEFINER`, and is executable by exactly the listed login role: `app.method_held(text,uuid)`, `app.cancel_method_hold(text)` (`poly_auth`); `app.claim_mail()`, `app.arm_hold_cancel(uuid,bytea)`, `app.mail_sent(uuid)`, `app.mail_failed(uuid,integer)` (`poly_worker`). `app.purge_mail_outbox()` is owned by `poly_purge`, is `SECURITY DEFINER`, and is executable by `poly_worker` only. `app.note_codes_replaced()` (D2) is owned by `poly_govern`, is `SECURITY DEFINER`, and is executable by no login role.
- **19.** No unsent `app.mail_outbox` row is more than 1 hour old (`FAIL mail: <n> notices unsent for over an hour`). `gate-check` runs at INFRA §7.1 step 16, before the first account, and again only when the operator reruns it, so this line is not a standing monitor (RC2). The standing control is the hold itself: an unsent notice keeps its method off. An unsent row can also be a notice that can never be delivered (an address that bounces, all 10 attempts used). The runbook says what the operator does then (Follow-up 3).
- **20.** `user_21_email_fixed`, `two_factor_84_codes_replaced` and `account_80_password_changed` exist and are enabled (D1, D2, D4).

**"The email is missing" is a runtime fact the SQL gate cannot see.** Three checks see it: `check-config` refusing a staging or production `auth` or `worker` without the key (R1.3), the worker refusing to start without one, each with a test, and line 19 at step 16. So with R1.3, the email cannot be missing at deploy: a staging or production worker without a key refuses to start, and line 19 catches one that stopped sending.

**R3.9 Settings.** No change in this loop (Follow-up 2, which is seceng's S3). The mail says when the method starts to work.

**R3.10 Tests** (database area `tests/db/auth-method-hold.test.ts`, plus `apps/auth` service tests with `fakeMailer`). Shown red first:
1. A passkey added through Confirm it's you, on a virtual authenticator whose counter stays 0, is refused at passkey sign-in over HTTP against the real service (`AUTHENTICATION_FAILED`, no session row).
   - With the notice not yet sent and `usable_at` in the past, it is still refused (M6, RC2).
   - With `usable_at` moved to 1 s from now by a superuser, it is still refused.
   - Moved to 1 s in the past, with the notice sent, it signs in.
2. The same for a TOTP added after a passkey: sign-in with the right code creates no session; after the backdate, it does.
   - A backup code of the held row is refused and stays unspent.
   - Wrong codes during the hold still count toward the lock.
3. Confirm it's you with a held TOTP answers 403 `method_on_hold`, and no `step_up` stamp is written. With a held passkey, the same.
4. First set-up (second step NULL, emailed-code grant) writes no hold, and the method works at once.
   - After the user removed every method themselves, an add is held.
   - After the operator's `reset-mfa`, an add is not held.
5. **Cancel:**
   - The armed token cancels: the method row is gone, `cancelled_at` is set, and every session of the user is gone.
   - A sign-in with that method then fails, even after a backdate.
   - The same token again answers 400; so do a lapsed hold, a 31-byte token and a non-canonical one.
   - A GET to the route answers 404, or 405 if BetterAuth answers that.
   - A cancel for user A carrying user B's session cookie still cancels A's hold, raises no `sync_second_step` refusal, and leaves B's sessions alive (RC9).
   - Two passkeys held in one transaction, one token: both rows are gone and both holds are cancelled (RC4).
   - A hold whose mail is still unsent 25 hours after the add is refused at sign-in. A mail sent 23 hours late makes the method usable 24 hours after the arming, and not before (RC2).
6. **The R0 attacker:** as `poly_auth` with a forged marker and stamp, plant a passkey and confirm that:
   - the hold row and the outbox row exist;
   - `poly_auth` cannot select, update or delete either;
   - `poly_auth` cannot execute `claim_mail`, `mail_sent` or `arm_hold_cancel`;
   - `poly_auth` cannot update `user.email` (D1);
   - `poly_auth` cannot INSERT into `audit_event`, because rule 2 of R3.3 trusts its `actor = 'operator'` rows (RC9; today only `poly_govern` holds INSERT, 0003:15).
7. **Mail:**
   - Every add and every removal writes exactly one outbox row per kind per transaction.
   - No payload holds a token, code, name or user agent.
   - A superuser fixture insert writes none.
   - A user-delete cascade writes none.
8. `check_factor_removal`: a manager with one working method and one held method cannot remove the working one (`second_step_required`).
9. The gate: lines 15–20 each fail on a planted fault (for 19, a backdated unsent row).

Existing tests that seed a second method and then use it are unaffected, because superuser seeds write no hold (R3.2). Any test that adds a second method **through the service** and then uses it within the run must backdate `usable_at`.

## R4. The limiter and the idle-in-transaction timeout

**R4.1 C-04's list** (`options.ts:16`) gains `'/callback/*'`, `'/magic-link/verify'`, `'/reset-password'` and `'/second-step/cancel-hold'`, at 5 a minute each.
- **Why `/callback/*` and not `/callback/:id`:** BetterAuth matches `customRules` keys by exact path or by wildcard (`rate-limiter/index.mjs:263-266`, code-read). The template would never match.
- **What the limiter keys on:** `${ip}|${path}`, where `path` is the concrete request path (`index.mjs:248`; `@better-auth/core` `utils/ip.mjs:228`, code-read). So each provider's callback has its own bucket per address.
- **What `ip` is:** the single `X-Forwarded-For` entry (`options.ts:160`), with IPv6 grouped by /64, and refused before the limiter when it does not resolve (`handler.ts:126-131`).
- **The dependency:** that address is only as good as the header Caddy writes. **POLY-138** (`header_up X-Forwarded-For {remote_host}` and its container test) is what makes it the client's. This loop does not touch Caddy.
- **`GET /reset-password/:token` is blocked (R2.1).** It could not be limited anyway: every guessed token is its own path, and so its own bucket. Its defence is the token's entropy (24 characters from `generateId`, `password.mjs:74`), not the limiter.
- **BetterAuth's built-in special rules** (`getDefaultSpecialRules`, `index.mjs:249`) apply wherever no `customRules` key matches. `/change-password` and the other `/sign-in*` paths that are not on our list keep the built-in 3 per 10 s. `/request-password-reset` is on our list, so ours applies: 5 per 60 s *(code-read; the test in this item pins it for `/change-password`)*.
- **Test:** a 6th `GET /api/auth/magic-link/verify?token=x` and a 6th `GET /api/auth/callback/google?...` from one address within 60 s each answer 429, while a different address is not limited. The google provider is configured with a dummy client and `tlsMode` `real-domain`.

**R4.2 Idle in transaction.** `ALTER ROLE poly_auth SET idle_in_transaction_session_timeout = '15s'`, in `packages/db/sql/roles.sql`. `ALTER ROLE` needs a superuser, so it does not go in a migration.
- **Why 15 s:** it bounds how long a callback can hold a pool connection while it waits on an IdP (R-24). It is above the mailer's 5 s timeout, which runs inside `/second-step/send-code`'s transaction. A slow IdP fails that one callback, and the user retries *(unmeasured: BetterAuth sets no timeout of its own on the IdP fetch)*.
- **It is a floor against floods, not against a compromised service:** any role can `SET` the timeout for its own session (M21). The mailer's 5 s timeout sits below it. A fetch timeout on the IdP call belongs with POLY-88, where the providers arrive; until then this timeout bounds that call (Follow-up 9).
- **Gate line 21:** `pg_db_role_setting` holds `idle_in_transaction_session_timeout=15s` for `poly_auth`.
- **Test:** connected as `poly_auth`, `SHOW idle_in_transaction_session_timeout` answers `15s`.

## R5. The worker

**R5.1 The jobs module.** A new confined subpath, `@poly/db/jobs` (`packages/db/src/jobs.ts`), holds every SQL string the worker runs:
- `purgeTxIdentity()`, `purgeSignInRecord()`, `purgeMailOutbox()`;
- `claimMail()`, `armHoldCancel(id, hash)`, `mailSent(id)`, `mailFailed(id, status)`.

`layers.json` changes:
- `db.subpaths` gains `./jobs`, and `worker.allow` gains `db/jobs`;
- `confined` gains `"packages/db/src/jobs.ts": ["apps/worker/src/jobs/purge.ts", "apps/worker/src/jobs/mail.ts"]`;
- `reservedLiterals` sets `purge_tx_identity`, `purge_sign_in_record`, `purge_mail_outbox`, `claim_mail`, `arm_hold_cancel`, `mail_sent` and `mail_failed` to `["packages/db/src/jobs.ts"]`, and `cancel_method_hold` to `["packages/auth/src/anchor.ts"]`.

Each call is one autocommit statement on `workerPool()` as `poly_worker`. There is no marker and no `withSystem`: none of these definers reads one.

**R5.2 The schedule.** In `apps/worker/src/main.ts`, after `startupGuard()`, this replaces the idle `setInterval`. Each job runs once at start, then at a fixed interval, and never overlaps itself (a run still going skips the next tick).

| Job | Interval | What it does |
|---|---|---|
| `purge.tx_identity` | 15 min | `SELECT app.purge_tx_identity()`: deletes markers over 1 hour old (0011:139) |
| `purge.sign_in_record` | 24 h | `SELECT app.purge_sign_in_record()`: 400 days, and rows of deleted users (0016:203) |
| `purge.mail_outbox` | 24 h | `SELECT app.purge_mail_outbox()`, new, owned by `poly_purge`, `SECURITY DEFINER`, executable by `poly_worker` only: deletes **sent** outbox rows created over 30 days ago. An unsent row is never purged: it keeps its method held (R3.1) and keeps gate line 19 failing |
| `mail.drain` | 30 s | Up to 20 per tick: `claimMail()`. For a held `method_added` row, it mints the token and arms it, renders the template, and sends with `Idempotency-Key: mail-{id}-{attempts}`. Then `mailSent(id)`, or on `MailError`, `mailFailed(id, status)`. With no mailer configured (development only) it does not run |

**Logging:** every run logs `job.run` with `{job, outcome: 'ok'|'error', deleted|sent, ms}` at info, or at error on failure. A failure never stops the schedule.

**R5.3 How a missed run shows.**
1. **In the logs:** the `job.run` lines stop.
2. **In the database, at the next deploy:** gate lines 22–24.
   - **22:** no `app.tx_identity` row is older than 6 hours whose transaction is not in progress.
   - **23:** no `app.sign_in_record` row is older than 401 days.
   - **24:** no sent `app.mail_outbox` row is older than 31 days.

   Line 19 covers mail.

An alert on the missing log lines is INFRA's (Follow-up 3).

**R5.4 Tests.**
- On a fake clock: the schedule runs each job at start and again at its interval; a run that throws is logged and the next tick still runs.
- Against the database: as `poly_worker`, each purge deletes only what it should; `poly_app` and `poly_auth` cannot execute any of them.
- The drain: one row sends exactly one mail through `fakeMailer`. With `{fail: true}` it records `last_status` 502, and the row is retried after its 5-minute claim.

## R6. S9: the dist-enumeration test

**R6.1 Where.** `packages/auth/src/dist-enumeration.test.ts`, a unit test with no database. Its fixture is `packages/auth/src/dist-sites.json`. It finds each dist from `packages/auth`'s own resolution of `better-auth` and `@better-auth/passkey`.

**R6.2 The scan.** In every `*.mjs` under both dist trees, each match of `\b(createUser|createOAuthUser|createSession|setSessionCookie)\(` is a *site*: `(pkg, file relative to dist, line, writer)`.

Measured on 1.7.18, with the loop below at the main checkout's root, where `D` is better-auth's dist and `P` is `@better-auth/passkey`'s:

```
for s in createUser createOAuthUser createSession setSessionCookie; do
  grep -rnoE "\b$s\(" $D --include='*.mjs' | wc -l; grep -rnoE "\b$s\(" $P --include='*.mjs' | wc -l
done
```

| Writer | better-auth | passkey | In plugins we do not load |
|---|---|---|---|
| `createUser` | 11 | 0 | 8 |
| `createOAuthUser` | 0 | 0 | 0 |
| `createSession` | 27 | 2 | 15 |
| `setSessionCookie` | 42 | 2 | 21 |

**R6.3 The classification rule.** Every site falls in exactly one class.
- **`unloaded`:** the file is under `plugins/<dir>/` and `<dir>` is not `two-factor` or `magic-link`. These sites are classified by rule and have no fixture row.
- **Every other site needs a fixture row** `{pkg, file, line, writer, class, routes?, option?}`, with class one of:
  - `definition`: the line defines the function;
  - `blocked`: every route in `routes` has class `blocked` in `AUTH_ROUTES`;
  - `user-inserting`: every route is in `USER_INSERTING`. This is the only class besides `unloaded`, `definition`, `blocked` and `option-off` that a `createUser` or `createOAuthUser` site may take;
  - `sign-in-tx`: every route is in `SIGN_IN_TX` (newly exported from `handler.ts`) or in `USER_INSERTING`;
  - `with-session`: every route is in `AUTH_ROUTES`, is not `blocked`, and its endpoint answers 401 without a session (the row's `why` names the middleware; a reviewed claim);
  - `option-off`: the site sits behind the BetterAuth option at path `option`, which `authOptions(sample)` sets to the value that disables the site (the row carries `disabledBy`: `falsy` or `true`). The test asserts that. The magic-link `createUser` site (`plugins/magic-link/index.mjs:179`) is `option-off` by `disableSignUp`, which must be `true` (R1.9).

**R6.4 The test fails when any of these holds:**
- the set of scanned sites outside `unloaded` differs from the fixture's rows in any `(pkg, file, line, writer)`;
- any row breaks its class's rule;
- any route a row names is not in `AUTH_ROUTES`;
- the plugin ids of `authOptions(sample)` are not exactly `two-factor`, `magic-link`, `second-step-anchor`, `passkey` and `cookie-lifetime`;
- in `pnpm-lock.yaml`'s `packages:` section, `better-auth`, `@better-auth/passkey`, `@better-auth/core`, `@better-auth/utils` or `@simplewebauthn/server` has more than one version;
- the four packages `packages/auth/package.json` pins differ from the lockfile, or `@better-auth/core` differs from `better-auth`.

Today the lockfile holds one version of each: `@better-auth/core@1.7.18`, `@better-auth/passkey@1.7.18`, `@better-auth/utils@0.5.1`, `@simplewebauthn/server@13.3.3` and `better-auth@1.7.18` (measured: `grep -nE "^  '?(@simplewebauthn/server|@better-auth/utils|better-auth|@better-auth/passkey|@better-auth/core)@" pnpm-lock.yaml` gives one key per package under `packages:` and one under `snapshots:`).

**Upgrades:** any pin bump moves line numbers, so it fails this test until someone re-reviews the fixture. That is the gate.

**R6.5 Red first.** The scan, the classification and the lockfile reader are pure functions inside the test file. Each failing condition above has a case run on synthetic input: a dropped row, a misclassed row, a lockfile with `@simplewebauthn/server@13.3.3` and `@13.4.0`, an extra plugin id.

## R7. The held magic-link sign-in answers 302

**R7.1 The seam.** This goes in `handler.ts`, on the final `Response`, after commit. A `GET` to `/magic-link/verify` that answers 200 with a JSON body whose `twoFactorRedirect === true` is rewritten to `302 Location: /sign-in/second-step?with=code`. Every `Set-Cookie` of the original is kept: the signed two-factor hold cookie must reach the browser. The body is dropped and `no-store` stays.

**Why here and not in a hook:** the order between twoFactor's plugin after-hook and our global after-hook is not pinned *(unmeasured)*, and the response is the one thing both leave behind. `passkeyOnlyHold` already redirects a GET (`second-step.ts:47`) and is unchanged. **For POLY-88:** `/callback/:id` joins the same check, by adding its template to the one set the rewrite reads.

**R7.2 Test.** An enrolled TOTP user with a fake mailer:
- requests a link and follows it with `GET` and `redirect: 'manual'`;
- gets 302 to exactly `/sign-in/second-step?with=code`, a two-factor cookie, and no session cookie;
- completing `/two-factor/verify-totp` with that cookie signs in.

## R8. The small fixes

| Row | Seam | Test (red first) |
|---|---|---|
| Routing pool, query-config object | `routing-pool.ts` `Lease.query`. When `q` is not a string, `textOf(q)` is tested against `CONTROL` **and** `PASS`. Any match, or a `text` that is not a string, throws `UnsupportedTransactionControl` before any statement is sent. Strings keep today's rewrite | `routing-pool.test.ts`: `{text: 'COMMIT'}`, `{text: ' begin '}`, `{text: 'ROLLBACK TO SAVEPOINT x'}`, `{text: 'SAVEPOINT x'}`, `{name: 'x'}` each throw, and the fake client receives nothing. `{text: 'SELECT 1'}` passes through |
| `/change-password` forces revocation | `routePolicyHook`: on `/change-password`, `body.revokeOtherSessions !== true` throws 400 `revoke_other_sessions_required`. A refusal, not a rewrite of the body: it does not depend on how BetterAuth merges a hook's return *(unmeasured)* | Without the flag, or with `false`: 400, and the password is unchanged. With `true`: 200, the user's other sessions are gone, and the caller's new session has a handle *(unmeasured; the test shows it)* |
| Sessions revoke, non-uuid id | `packages/auth/src/web/sessions.ts` `revokeSession`. An `id` failing the uuid regex (the same one as `reauth.ts:17`) throws `HttpError(404, 'not_found')` before any SQL | Unit test with a fake `Tx`: `'x'`, `''`, `'1; DROP'` each answer 404 and `execute` is never called. The page action returns `fail(404)` |
| `/API/AUTH/...` | Today's raw-pathname checks are kept: `hooks.server.ts:48,75` and `apps/auth/src/public.ts:11`. No code change | `hooks.server.authtree.test.ts`: `/API/AUTH/get-session` and `/Api/Auth/list-sessions` answer 404, and no auth or database call is made. `apps/auth` gets the same pair through `handlePublic` |
| e2e step-up stamp | The `serve.ts:55-57` stamp is removed. A helper `stampStepUp(email)` in `apps/web/tests/e2e/support.ts` writes it inside `sign-in-flow.spec.ts`'s Sessions spec, right before the revoke | The spec passes with a 6-minute wait inserted before the helper (a one-off check, run locally and reported). The CI run then has no stamp written before `vite build` |
| SECURITY R-12 | R-12 has no plain-token sentence left: `sed -n 1583p docs/SECURITY/index.html \| grep -c -i plain` → `0` (measured). The row is met as it stands. T1's "Password reset is not enabled … (POLY-137)" becomes false with R2: seceng rewrites it at the verdict stage | None |

## R9. Migration order, grants and definers

**R9.1 Order.**
1. `packages/db/sql/roles.sql`: the `ALTER ROLE poly_auth SET idle_in_transaction_session_timeout = '15s'` (R4.2). Idempotent.
2. `0020_method_hold_outbox.sql`, generated by Drizzle: the two tables, their FKs, the CHECKs, the unique keys and the indexes, plus the `audit_event (subject_user_id, kind, created_at)` index.
3. `0021_method_hold_rules.sql`, custom. It ends on `poly_owner`, with the `CREATE` on `app` revoked, as 0013 and 0019 do.
   1. RLS enable and force on both tables; the policies for `poly_govern` and `poly_purge`; the no-truncate triggers.
   2. The grants in R9.2.
   3. As `poly_govern`: `method_held`, `cancel_method_hold`, `claim_mail`, `arm_hold_cancel`, `mail_sent`, `mail_failed`, and `CREATE OR REPLACE` of `sync_second_step`, `check_factor_removal` and `complete_step_up`. Each replacement carries its earlier body in full, plus its change.
   4. As `poly_purge`: `purge_mail_outbox`.
   5. As `poly_owner`: `guard_method_hold()` and `refuse_email_change()` (D1, both invokers), then the triggers `two_factor_12_method_hold`, `passkey_12_method_hold`, `user_21_email_fixed`, `two_factor_84_codes_replaced` and `account_80_password_changed` (D2, D4; their functions `app.note_codes_replaced()` and `app.note_password_changed()` are created in step 3.3 as `poly_govern`), under the file-scoped EXECUTE grant pattern of 0013:582 and 777.
4. `packages/db/sql/definers.json`: the nine new entries (R9.3).
5. `infra/postgres/gate-check.sql`: lines 15–24.

**R9.2 New grants.** No login role gains a table privilege anywhere.
- `poly_govern`:
  - `SELECT, INSERT, UPDATE ON app.method_hold, app.mail_outbox`;
  - `SELECT (user_id, provider_id) ON public.account`, for D4's trigger to find the user;
  - `SELECT (subject_user_id, kind, actor, created_at) ON public.audit_event`, with its policy (R3.3).
  - It already holds `DELETE` on `two_factor`, `passkey` and `session`, `UPDATE (two_factor_enabled)` and `SELECT (email)` on `user` (0013:10-12).
- `poly_purge`: `SELECT, DELETE ON app.mail_outbox`, with a policy.
- `poly_auth`: EXECUTE on `app.method_held(text,uuid)` and `app.cancel_method_hold(text)`.
- `poly_worker`: EXECUTE on `app.claim_mail()`, `app.arm_hold_cancel(uuid,bytea)`, `app.mail_sent(uuid)`, `app.mail_failed(uuid,integer)` and `app.purge_mail_outbox()`.
- `poly_owner`: EXECUTE on the two invoker trigger functions, for trigger creation only, revoked in the same file.

**R9.3 New definers** (for `definers.json`):

| Function | Owner | Execute |
|---|---|---|
| `app.method_held(p_table text, p_id uuid)` | poly_govern | poly_auth |
| `app.cancel_method_hold(p_token text)` | poly_govern | poly_auth |
| `app.claim_mail()` | poly_govern | poly_worker |
| `app.arm_hold_cancel(p_mail uuid, p_hash bytea)` | poly_govern | poly_worker |
| `app.mail_sent(p_mail uuid)` | poly_govern | poly_worker |
| `app.mail_failed(p_mail uuid, p_status integer)` | poly_govern | poly_worker |
| `app.purge_mail_outbox()` | poly_purge | poly_worker |
| `app.note_codes_replaced()` | poly_govern | (none) |
| `app.note_password_changed()` | poly_govern | (none) |

These are replaced with unchanged signatures and existing entries: `app.sync_second_step()`, `app.check_factor_removal(...)`, `app.complete_step_up(...)`. Invoker trigger functions, which are not listed in `definers.json`: `app.guard_method_hold()` and `app.refuse_email_change()`.

## The 15 rows, as amended

The amendments are made in place in POLY-137.md, in the same commit as this file.

## Decisions for the lead

**D1. `user.email` can be changed by no login role.** Ruled in; the Principal may strike it. This answers seceng's M9 more strongly than a notice to the old address would: the change cannot be made at all.
- **The mechanism:** `poly_auth` holds `UPDATE (email)` on `public."user"` (`0014_sign_in_service.sql:13`). So the R0 attacker can point the account at their own address first. Every notice then goes to them, and a later password reset follows the new address.
- **The control:** a `BEFORE UPDATE` trigger, `user_21_email_fixed`, refuses any change of `email` unless the session is a superuser. No route of ours changes it: `/update-user` takes a name and a null image (`route-policy.ts:177-179`), and `/change-email` stays off (POLY-150 Open 6).
- **What it closes:** the redirect of the hold's mail.
- **Cost:** one trigger, one gate line, one test, about $2 *(unmeasured guess)*. An operator who must fix a user's address does it as a superuser at the box.
- **For `/change-email`:** when it comes, it replaces this with a definer that mails the old address.

**D2. A notice when backup codes change outside a spend we can see.** Ruled in; the Principal may strike it. RC3 widened it.
- **The mechanism:** with Confirm it's you accepting a backup code (DECISIONS 2026-11-19), someone with the password and one found code can make ten fresh codes. They can then sign in at will until the password changes, and nothing tells the owner.
- **The control:** a trigger, `two_factor_84_codes_replaced`, `AFTER UPDATE OF backup_codes`, executing `app.sync_second_step()`'s sibling, `app.note_codes_replaced()` (poly_govern, executable by nobody). It acts on **every** change of `backup_codes` on a row that was verified before the update and has no `app.step_up_pending` row in this transaction, with a marker or without one:
  - **With a marker:** a `backup_codes_replaced` row (codes made through Confirm it's you).
  - **Without a marker:** a `backup_code_used` row. The sign-in spend is unmarked. So is SQL that copies another account's encrypted list into the victim's row: the list is encrypted under the instance-wide auth secret and is not bound to the user (`two-factor/backup-codes/index.mjs:19`, RC3).
  - **Also without a marker:** the change is refused, `42501 'backup_codes_not_a_spend'`, unless `octet_length(NEW.backup_codes) < octet_length(OLD.backup_codes)`. A spend removes a code; a copied longer list does not shrink (seceng's optional S, taken). A copied *shorter* list still passes, and still writes its notice.
- **The `backup_code_used` mail:** subject `A backup code was used on your polycarpic account`; text `A backup code was used to sign in to your polycarpic account on {when}.\n\nIf it was not you, someone has your password and one of your backup codes: change your password and make new codes.` It shows no count.
- **Kinds:** the outbox CHECK list gains `backup_code_used`, and the D2 trigger is added to gate line 20.
- **This also covers DECISIONS 2026-11-19:** the owner is told each time a found code is used to sign in.
- **Tests:**
  - An unmarked UPDATE that copies another verified row's longer list is refused.
  - A copied shorter one writes one `backup_code_used` row.
  - A real sign-in by backup code writes one.
  - A Confirm it's you spend writes none. It is named `_84_` so that it fires before `two_factor_85_step_up_spent` resolves that row (0019).
- **What it tells apart:** a spend at sign-in is unmarked, and a spend at Confirm it's you has its pending row. A first set-up's codes are written while the row is unverified.
- **No hold on the new codes.** Holding them would leave the user with no backup codes for a day, and the password still bounds the attacker.
- **The residual:** someone with the password and one found code makes ten codes that work at once. The owner is emailed at once. The new codes stop helping the attacker when the owner changes the password.
- **The stronger option** (seceng M5): hold the new codes for 24 hours while the old ones keep working. That means two code sets on one row, and a change to BetterAuth's verify path, which reads one encrypted list. About $10 more *(unmeasured guess)*, and it fits the second auth loop with "backup codes left".
- **Cost:** about $3 *(unmeasured guess)*. The alternative is to defer it to the second auth loop, with "backup codes left".

**D3. The three bare pages** (`/sign-in/forgot`, `/sign-in/reset`, `/sign-in/cancel-method`) are built in this loop, with the wording above. ux-designer reviews the wording at the verdict, in a short DESIGN entry.
- **Why:** without them, reset and cancel are wired but unreachable. A cancel link that leads nowhere fails the criterion.
- **Cost:** about $5 *(unmeasured guess)*.

**D4. A notice when a password is changed.** Ruled in; the Principal may strike it (seceng S1).
- **The mechanism:** the R0 attacker's surest step is setting a password hash it knows, by SQL or by a reset.
- **The control:** a trigger, `account_80_password_changed`, `AFTER UPDATE OF password ON public.account`, executing `app.note_password_changed()` (poly_govern, `SECURITY DEFINER`, executable by nobody). When the new value differs from the old and the session is not a superuser, it writes a `password_changed` outbox row; the kind is added to the CHECK list.
- **The mail:** subject `Your polycarpic password was changed`; text `The password for your polycarpic account was changed on {when}.\n\nIf you did not change it, someone else may be signed in as you: reset your password at {origin}/sign-in/forgot and tell your operator.`
- **What it covers:** a reset, `/change-password` and an SQL write alike.
- **What it misses:** a reset that *creates* the first password (an INSERT, M20). Follow-up 5 covers that.
- **Cost:** about $3 *(unmeasured guess)*. It adds gate line 20's third trigger, and one test.

**Residuals for the Principal, stated plainly:**
- **A mailbox plus one found backup code** is still a takeover the owner hears of only by email: reset the password, Confirm it's you with the code, plant a method. The thief can delete our mails. The hold delays the takeover by 24 hours, but the only warning outside the mailbox is the Settings line in Follow-up 2 (seceng S3). I recommend that follow-up go first in the second auth loop.
- **The cap's own cost:** someone can use up a member's 10 token mails and block that member's own magic link or reset for up to an hour (DECISIONS 2026-11-21).

**Not a decision, stated so nobody is surprised:** a second method added straight after the first, in the same set-up dialog, waits 24 hours (R3.3).

## Follow-ups (the lead files these after merge)

1. A held method at sign-in answers 500 on the TOTP and backup-code paths (R3.4). The answer should be a clear `method_on_hold`, which needs a before-hook on `/two-factor/verify-*`. The second auth loop's reused-code hook is the natural place.
2. Settings shows "Works from {when}" under a held method. `app.my_second_step()` would gain `totp_usable_at` and a per-passkey `usable_at`, which is a return-type change (DROP and CREATE).
3. INFRA (devops-engineer): an alert when the `job.run` lines stop, and a runbook step for a notice that cannot be delivered, which keeps its method held (seceng note on line 19).
4. `idle_in_transaction_session_timeout` for `poly_app`. R-24 first named that role, before sign-in moved to `poly_auth`.
5. D4 covers a password update. A reset that *creates* a first password (an INSERT on `account`) is not yet noticed.
6. The routing pool passes a multi-statement string sent with no values, such as `'SELECT 1; COMMIT'`, as one simple-protocol query. BetterAuth never sends one *(code-read: kysely passes parameters)*. An injection as `poly_auth` already has more than this.
7. INFRA (devops-engineer): the Resend domain with open and click tracking off; two sending-only keys for that one domain, one per service, and the 401/403 check of RC7; key rotation; SPF, DKIM and DMARC `p=reject` on the sending domain (seceng M24, S2).
8. POLY-138: the edge access log records no query string for `/api/auth/magic-link/verify` (seceng RC5 and M19; follow-up 1 of `ruling-review.md`).
9. POLY-88: an explicit fetch timeout, under 15 s, on the IdP token exchange (seceng M21).

## Addendum 1: qa's assumed seams (test-plan.md @ 78cbbc94) and R8

1. **Worker and `@poly/db/jobs`: confirmed as qa wrote them.** `startSchedule(jobs, log)`, `buildJobs({mailer, origin, log})`, `drainMail({mailer, origin})`. `claimMail()` returns `null` or `{id, kind, toAddress, payload, attempts}`, with snake_case mapped to camelCase in `jobs.ts`. `armHoldCancel(id, hash)` returns a `Date` or `null`.
2. **`dist-sites.json`: confirmed.** The row shape is `{pkg, file, line, writer, class, routes?, option?, disabledBy?: 'falsy'|'true', why?}`, and `option` is a dotted path where `plugins[<id>]` selects a plugin by id.
3. **Gate FAIL wording: confirmed.** qa's strings for lines 15–18, 20 and 21 are the canonical wording. For lines 22–24 the canonical lines are:
   - `FAIL purge: app.tx_identity holds rows older than 6 hours`;
   - `FAIL purge: app.sign_in_record holds rows older than 401 days`;
   - `FAIL purge: app.mail_outbox holds sent rows older than 31 days`.

   Each of these matches qa's patterns.
4. **D1's refusal: fixed.** It raises `42501`, message `a user's email is changed by no login role`. The exact-call refusals keep their existing message, `a second-step definer must be called on its own`.
5. **Logs: one seam added.** `packages/auth` may not import `@poly/config/log` (`layers.json`). So `AuthInput` gains `log?: (event: string, fields: Record<string, unknown>) => void`.
   - `apps/auth` passes its pino logger.
   - The default is `console.error(JSON.stringify({event, ...fields}))`, as in `handler.ts:130`. qa's `captureLogs` on `console` holds with the default.
6. **Outbox payload: corrected.** After RC4, holds point to their mail through `method_hold.mail_id`, so the payload carries **no `hold_id`**. Its keys are:
   - `methods` and `at`;
   - `usable_at`, present on a held `method_added` only.

   qa's assertion (each key one of the four, and `methods`, `at` and `usable_at` present on a held add) already passes. Nothing changes in the tests.
7. **The old helpers:** `sendMagicLink` and `sendSecondStepCode` are removed from `AuthInput` (R1.5), as qa's plan says. Moving the four helpers to `mailer` is part of the green gate.
8. **R8 `/API/AUTH/...` on web: the 303 is accepted.** A signed-out caller meets the sign-in gate before any route. A 303 to `/sign-in?next=…` or a 404 both meet the rule, which is that the path is never treated as the auth tree, never proxied, and makes no auth or database call. qa's test, which accepts either, stands. The auth service's own answer stays 404.

## Addendum 2: R7.1 corrected; S9 judgment rows; log fields

1. **R7.1's premise was wrong.** The builder measured it, and the code-read reproduces it. `/sign-in/magic-link` always puts a `callbackURL` in the mailed link (`magic-link/index.mjs:105`, default `/`). So verify *throws* a redirect to it (`:209`), and the twoFactor after-hook's JSON (`two-factor/index.mjs:376-378`) never becomes the answer. The hook's `.two_factor` cookie is still set, and `setNewSession(null)` (`:340`) leaves no session cookie. A 200 with `twoFactorRedirect` happens only with no `callbackURL` (`:204`).
2. **R7.1 is replaced.** On a `GET` to `/magic-link/verify`, the seam rewrites either shape to `302 Location: /sign-in/second-step?with=code`:
   - (a) a 3xx whose `Set-Cookie` sets the two-factor cookie (`ctx.authCookies`' `two_factor` name, not a hard-coded literal) and sets no session-token cookie with a value;
   - (b) a 200 JSON with `twoFactorRedirect === true`.

   Every `Set-Cookie` is kept, the body is dropped, and `no-store` stays. A 3xx without that cookie (an ordinary signed-in redirect, or `passkeyOnlyHold`'s) is left alone. R7.2 adds two tests: the 302-shape case, and an ordinary magic-link sign-in with no second step, whose redirect is not rewritten.
3. **S9, `email-verification.mjs:228, 260`:** class `with-session` is accepted. The sites sit behind `if (session)`, and with a session the handler runs `withAuthSession`.
4. **S9, `sign-in.mjs:212` and `passkey/dist/index.mjs:485, 495`:** class `with-session` is **refused**. Its rule (the endpoint answers 401 without a session) is false for `/sign-in/social` and `/passkey/verify-registration`. A new class replaces it:
   - **`refused-by-hook`,** with `refusal: {path, body}`.
   - The test sends that body through `routePolicyHook` with a fake context and expects a 4xx: `{idToken: 'x'}` gives 400, and `{createSession: true}` gives 400 `create_session_refused` (`route-policy.ts:179-187`).
   - The class is allowed for `createSession` and `setSessionCookie` only.

   **This changes qa's test:** `dist-enumeration.test.ts` gains the class and its check.
5. **Log fields:** `log.schema.json` gains `ms`, `deleted`, `sent` and `failed`. Each is an `integer` with `minimum: 0`; `ms` has `maximum: 86400000` and the counts have `maximum: 1000000`. They carry no string and no address. If `job` or `kind` is added too, each is an `enum` of exactly the values ruled in R5.2 and R1.7.
