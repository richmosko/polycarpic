# POLY-150 — red run (qa-engineer-150)

Run on the tree at the test commit, before any build. Every file is shown red for the reason in its row, or marked a **pin** (passes today, on purpose, with the reason it is not vacuous). Output is in the worktree's `temp/` (`red-db.txt`, `red-e2e-2.txt`, `red-e2e-rl.txt`), not tracked. Counts are `red / total`.

## Unit and db (vitest)

| File | Red | First failure, and why it is the right one |
|---|---|---|
| `apps/web/src/lib/safe-next.test.ts` | 14 / 14 | `Cannot find module ./safe-next.ts`: the rule is private to `hooks.server.ts` |
| `apps/web/src/routes/second-step-boundary.test.ts` | 7 / 8 | no `sign-in/second-step` page, no `settings/second-step/+page.server.ts`, the placeholder text is still there, `hooks.server.ts` does not import `safe-next`. The one that passes ("no `+server.ts` under either route") is a pin: it asserts the Settings page exists first |
| `apps/auth/src/seam.test.ts` | 7 / 7 | `main.ts` has no `deps`; `requireClientIp` still reads `appEnv !== 'development'`; the sender that throws is still wired. Staging and production cases use a complete valid env, so the only fault is the stand-in (measured: loadConfig accepts that env) |
| `tests/db/second-step-screens.test.ts` | 20 / 24 | send-code answers 500 (not 503) when no mailer; no `sentTo`; `app.my_second_step()` and `two_factor.created_at` absent (42883, empty catalog row); `trustDevice: true` returns 200 and signs in; no response carries `Cache-Control`; a development service answers 200 to a request with no `x-forwarded-for`. Passing: the anonymous 401 on send-code (a pin: the 503 must not reach a caller without a session) and the two hold-lifetime measurements (below) |
| `tests/db/pgtap/11_poly_app_grants.sql` (via `pgtap.test.ts`) | 1 / 1 file | the eleven now include `app.my_second_step()`: the function is missing and ungranted, so the "executes every one of the eleven" and `routine_privileges` lines fail |
| `tests/db/sign-in-controls-pins.test.ts` | 3 / 3 for file 11 | the control (no plant) fails because 11 is red; the new plant (`REVOKE … my_second_step`) errors on a missing function |
| `tests/db/gate-check.test.ts` | 1 / (all plants) | the new plant `poly_app loses my_second_step` errors on the missing function. `infra/postgres/gate-check.sql`'s own list of ten is the builder's to move to eleven; the plant names the object the gate must print |
| `tests/db/second-step-flow.test.ts`, `tests/ci/*` | 0 | green: the `totp` helper moved to `helpers/totp.ts` and is re-exported, and `infra/ci/changes.mjs` gained `second-step-screens` (DB_AREAS and the `db-areas.test.ts` row) and `apps/auth/src/` in `TABLE.e2e` (the e2e entry now imports it; 542 / 542) |

## Addendum 1 additions (ruling e3e2b003)

| File | Red | Reason |
|---|---|---|
| `apps/web/src/routes/second-step-rc.test.ts` | 4 / 5 | RC2 prerender ban (red: the trees have no held page yet; its plant test passes: the rule sees `export const prerender = true`, a string value and a re-export, and not `ssr`), RC3 (`pagehide` and destroy clearing, `no-store` in the load), RC4 widened (`{@html` across settings, sign-in and `ConfirmItsYou.svelte`) |
| `tests/infra/lint.test.ts` | 1 / 144 | new case `Caddy snippet lacks X-Frame-Options DENY`: the Caddyfile has none and the lint's `need` list does not require it, so removing it fires no rule. RC2's Caddy half; the e2e header test stays for the CSP |

**Addendum 2 (7d87cbfa).** `second-step-screens.test.ts` is now 22 red of 25 (new: the three `resend_available_at` cases; the header test also reads `generate-backup-codes`). `apps/web/src/lib/second-step-actions.test.ts`: 6 / 6 red (module missing); its contract is in the file's header: `actionStates(row, recentAuthOk)` returning `shown|disabled|hidden` for `removeApp`, `removePasskey`, `makeNewCodes`, `addPasskey`; rename in one place if the builder prefers. Spec 1 gained Make new codes (new ten codes differ; leave/back/forward show none; an old code is refused at a held sign-in); it fails earlier today at the same place as before, so the new steps are not yet shown running. "10 wrong in 24 hours" is seeded as one challenge with `attempts = 10`: the builder reports if the rule counts another way.

D5 (lock wording): no test written; the boundary test still bans `locked_until` in sources.

## Playwright

`playwright test`: **57 passed, 10 red, 4 did not run**. The 4 are specs 4 and 5 (skipped after spec 3 failed in a serial describe) and the two `rate-limit` tests (a failed dependency), so that project was run on its own with `--no-deps` (below). Before my changes the same suite was 57 / 57 in 24 s, so nothing existing went red.

| Spec | First failure |
|---|---|
| spec 1 enrol by app (Enid) | `next` is null on the held page: the gate's redirect carries no `?next=` |
| spec 2 enrol by passkey (Pia) | no Password field on `/settings/second-step` (the placeholder has no form) |
| RC3 (Rae) | same: no set-up form to reach the codes screen |
| C6, `?next=` carried | `next` is null (same gate gap) |
| spec 3 (Tess) | no `6-digit code` field: nothing at `/sign-in/second-step` |
| spec 4, spec 5 | not reached: they follow spec 3 in a serial describe (spec 5 would fail at the same place) |
| spec 6 (Lou, out of order) | passes only once reached: **see Pins** |
| spec 7 held page the same | `/sign-in/second-step` answers 404 |
| spec 7b forged address | `sign_in_record.ip_address` is `198.51.100.9`: the dev proxy forwards the browser's header |
| spec 8 panel + interim dialog, spec 9 RC4 | the passkey name is not on the page: the placeholder lists nothing |
| RC2 headers | `/sign-in/second-step` is a 404, not 200 or 303 |
| `rate-limit` 6th confirm-code | no Code field: nothing to submit |
| `rate-limit` logs scan | **pin**: passes (nothing leaks today); its control proves the scan finds a planted needle of each kind |

### Pins (pass today, on purpose)

- Spec 6 sits with the others and is red only if the service trusts screen order; the service does not today (POLY-89), so it passes once the page it starts from loads. It guards the build, not today's gap. Today it is among the 57: the `/settings/second-step` placeholder loads for Lou.
- Logs scan: see above.

## Unmeasured claims the ruling handed me

| Claim | Result |
|---|---|
| R7: the hold's lifetime is 600 s | **Measured, true.** The hold cookie's `Max-Age` is 600 and the `verification` row's `expires_at` is 600 s ± 5 after the sign-in; a row moved past `expires_at` answers 401 and no session follows. Both tests pass today. DESIGN's "10 minutes" stands |
| R10: BetterAuth sends no `Cache-Control` on `enable` | **Measured for the sign-in response only**: none (`''`). The test stops at the first response that lacks it, so `enable` itself is not separately measured; the ruling sets the header on every response either way |
| R2: `two_factor.created_at` filled by the default when BetterAuth's INSERT does not name it | not measured yet: the column does not exist. The db test that enrols a factor through the real handler and reads `created_at` comes with the 0018 build; it is the second `totp_added_at` test (a direct INSERT, which names no column, so it measures the same default) |
| R8: the whole browser suite fits the 5-a-minute sign-in limit from one address | **It does not fit.** The baseline suite already spends 5 `/sign-in/email` calls (`sign-in-flow` 3, `second-step` 2); this loop's specs add at least 7 (C6 now 1, Enid's re-sign-in 1, Tess 3, Kay 1, forged-address 1), and 6 `/two-factor/verify-totp` calls. BetterAuth's bucket reopens only 60 s after its last counted call, so the specs cannot share one window. Reordering cannot fix it: C4's subject is the sign-in itself. Nothing is raised, forged or reset; instead `support.ts` `slot(path)` mirrors the limiter in one ledger file all workers share, and a spec takes a slot before the click that sends a limited call. Measured on this run (most new specs red early, so a lower bound): 6 sign-in calls, one forced wait of 58.6 s. Expect two to three such waits (about 2 to 3 minutes) on a green suite; `slot-waits.jsonl` and `slot-calls.jsonl` in `.auth/` record them per run. Per-test timeout is raised to 150 s, action timeout 15 s |

## Held, not written

D1 (sign-up asks the emailed code), D2 (passkey shows backup codes), the locked screen's wording about time, bare page vs app shell. Spec 2 asserts nothing about backup codes; spec 3 does not read `#locked`; the page chrome is not asserted.

## Notes for the build

- The e2e specs read the screens by DESIGN's labels and button names (`Password`, `Code from the email`, `Enter the 6-digit code it shows`, `Turn on second step`, `Finish`, `6-digit code`, `Backup code`, `Use a passkey`, `Close`, `Name this passkey`) and need two hooks DESIGN draws but does not name: `data-testid="totp-key"` on the typed-out key and `data-testid="backup-code"` on each of the ten codes. The step-3 choice is found by the text "authenticator app" and "passkey". Errors are `role="alert"`.
- `startAuthService(env, deps)` must accept `deps.sendSecondStepCode`; `apps/web/tests/e2e/auth-entry.ts` already calls it. A `deps` argument under staging or production must throw `ConfigError` whose problems name `deps` or `sendSecondStepCode` (the seam test reads them).
- `app.my_second_step()`'s return columns, in order, are asserted: `second_step_at, totp_added_at, passkeys, challenge_expires_at, resend_available_at, grant_expires_at, needs_a_method, codes_paused`. `resend_available_at` has one assertion: in the future after three challenges in 15 minutes. The ruling's "NULL both while the 10-wrong rule suppresses and when nothing suppresses" is left unasserted because it conflicts with "now() when it would issue now".
- The web safe-next module is expected to export `safeNext(value: unknown): string`; the name is the one `hooks.server.ts` uses today.
