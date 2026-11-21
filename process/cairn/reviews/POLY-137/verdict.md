# POLY-137e: verdict (architect)

**Build** `c74a89209f639211702cea5f68df7a0abf3f4750`; **qa's gate** at `13c1e405576b17cd7c3cca617af293e92bc26cdb`; **head** `66096adc3f4f7ce18bf62c16f72133213f0896e2`. `git diff --stat 66096adc HEAD -- packages apps infra/postgres layers.json` is empty: after the gate only tests and `infra/ci/image.sh` changed.

**Verdict: APPROVE** at `cb27be1e11991fbc762904e59ea0fd4c07c9dd79` (backend `cb27be1e` on frontend `b82feb5f`): every axis below passes.

| Axis | Result | Evidence |
|---|---|---|
| The ruling (`fab91743`, Addenda 1–2) against the tree, **checked directly** | Pass | At head:<br>• `options.ts:18`: C-04's list holds `/callback/*`, `/magic-link/verify`, `/reset-password` and `/second-step/cancel-hold`. `:54` sets `resetPasswordTokenExpiresIn: 900`, and `:162` passes `magicLink({… storeToken: 'hashed', disableSignUp: true})`.<br>• `route-policy.ts:39`: `/reset-password/:token` is blocked. `:184`: `revoke_other_sessions_required`.<br>• `handler.ts:64,182`: `NO_MARKER`. `:146`: the `with=code` rewrite.<br>• `roles.sql:42`: `idle_in_transaction_session_timeout = '15s'`.<br>• Migrations `0020_method_hold_outbox.sql` and `0021_method_hold_rules.sql`, and the 9 new definers in `definers.json`.<br>• `apps/worker/src/jobs/index.ts:12-18`: 15 min, 24 h, 24 h and 30 s.<br>• `packages/mail/src/index.ts:40-48`: `RecipientCap` is 10 per 60 min, normalised. |
| One deviation from the ruling's letter | Accepted | R3.7 says the cancel runs "without a marker". The build runs it in `withSignInTx` (`handler.ts:182`). That wrapper checks that no user marker is set (`packages/db/src/context.ts:238`, `app.current_user_id() IS NULL`), so `sync_second_step`'s own-user check has nothing to compare and cannot refuse. That meets the rule's purpose, and the wrapper's rollback-on-failure applies to the cancel too. seceng's ACCEPT names this seam (`build-review.md` §3, "The endpoint", @ `91fe1b35`). |
| Tests and the four gates (taken from qa) | Pass | `gate.md` @ `66096adc`, run at `13c1e405` on a clean tree with the machine quiet: layers 556, ci 553, infra 187, config 97, every package's own tests 19/19, db 1400 passed with 2 expected failures, e2e 80. The 3 failures in `tests/infra/image` `postgres.test.ts` also fail on `origin/main` on this Mac (Docker Desktop file permissions), and CI's Linux runner covers them. |
| The 15 rows | Pass | Each row of POLY-137.md is ticked with its `**Proof:**` test (qa, `gate.md`). Mutations are in `red-run.md` for every test that was green on arrival. |
| db suite time, **ruled here** | Accepted: no new job, no split | Against a same-day control on main, 3 runs each, the branch is about 30 s (+27%) slower: main 114–138 s, branch 147–150 s. That is 5 more files and 210 more tests, about 0.14 s per added test, in line with the suite's existing cost. Main's control times are a lower bound, because 33 environmental fast-fails ran in its scratch directory. The new files sit in the existing `auth` area, and `gate-check-role-setting` runs in the serial project. Watch the next loop's delta against the same control. |
| Security (taken from seceng) | Pass | `build-review.md`: ACCEPT @ `91fe1b35`, and the delta at `c74a8920` ACCEPT @ `d7e6376a`. SECURITY's edits are in that commit. N1 and N2 are non-blocking and listed as follow-ups below. |
| Browser leg (taken from the lead) | Pass | `temp/poly-137-lead-browser/README.md` @ `66096adc`, all checks pass:<br>• the Forgot link;<br>• the three pages: 200, `no-store`, `no-referrer`;<br>• the same text for a known and an unknown address;<br>• the fragment stripped from the URL;<br>• the cancel page sends no non-GET request on a plain visit, and a bad token gets one POST, a 400 and the ruled text.<br>A real reset or cancel with a mailed token is not covered there; the db suites cover both. |
| Architecture drift | Pass, with ARCH updated | `layers.json` matches ARCH §2.2 (`check.mjs` exit 0 at the gate). ARCH §3.1c and §3.3 are brought to the built state in the commit after this file. |
| CI | Pass | Run 44934342417 on `66096adc`: all eight jobs green. Run 44934982685 on `cb27be1e`: success on all eight jobs (image, lint, unit, db, app, cairn, guard, changes). |
| ux wording of the three pages | Pass | `wording-review.md` @ `fdfc39af`: 28 strings accepted, 3 changed (#17, #18, #29; #29 is ruled below). Built at frontend `b82feb5f` and backend `cb27be1e`. Both #29 strings are present verbatim, checked directly: `grep -c` gives 1 in `cancel-method/+page.svelte` and 1 in `templates.ts`, and no "Settings, Second step" remains under `apps/web/src` or `packages/mail/src`. qa's delta gate passes: `gate.md` "Delta gate" @ `cf899f92`. |

## Follow-ups (the lead files them after merge)

The ruling's nine follow-ups stand. Add:
- **N1 (seceng):** a failed background `findUserByEmail` in the magic-link sender should log `mail.failed {kind: 'magic_link'}`.
- **N2 (seceng):** INFRA's account-administration runbook should say that an operator corrects an address as a superuser at the box (D1).
- **The gate's item 3:** no file in this repository delivers `MAIL_FROM`, like every other host setting. That is the ops bundle's job (INFRA D-1), and the fail-closed config check covers a gap at the first deploy.

## Wording #29 (ruled; `wording-review.md` @ `fdfc39af`)

The Settings panel is titled "Sign-in and second step" (DESIGN 5.11), so both strings name it that way. Each must match exactly:
- **The cancel page, on 400** (R3.7): `This link no longer works. It may have been used already, or the 24 hours are over. Sign in, check Settings, Sign-in and second step, and change your password if anything there is not yours.`
- **The `method_added` mail, held, link not armed** (R1.7), third paragraph: `If you did not add it, someone else may be signed in as you. Sign in, remove it under Settings, Sign-in and second step, change your password, and tell your operator.`

This changes where the text points the user, and nothing else: it has no security effect. The ruling's two strings are amended in place (`ruling.md` lines 63 and 263). qa pins both strings red first in `auth-pages-137.test.ts` and `jobs.test.ts`. Frontend changes `cancel-method/+page.svelte`, and backend changes `packages/mail/src/templates.ts`.
