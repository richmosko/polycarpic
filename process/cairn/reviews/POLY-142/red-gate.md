# POLY-142 red gate (gate 2)

QA, against ruling @ 6d74446. Every test below fails now; none passes for a wrong reason except where noted.

## Where each condition is tested

| Cond | File | Notes |
|---|---|---|
| R4 helpers | `tests/db/operator-invite.test.ts` | `newInvitationToken`, `invitationLink`, `validOperatorEmail`; hash oracle is `node:crypto` |
| C1, C1b | same | C1 on the main clone; C1b on a second empty clone via a verified token-less Google callback |
| C2, C6, C8 | same | in-process `runUserInvite`; exact payload keys; `expires_at - created_at = 7 days` for both kinds |
| C3, C4 | same | exit 2 writes nothing; revoke + audit; two concurrent `--bootstrap` both exit 0 |
| C5 | same | planted bootstrap row refused on `/sign-up/email`, magic-link verify, Google callback; operator row claimed in preference |
| C6 (origin), C9 | same, child process | `sh bin/polycarpic cli user invite`; origin is `PUBLIC_ORIGIN` with `BETTER_AUTH_URL`/`ORIGIN` set to others; bad argv, bad config: exit 1, no connection (a counting TCP listener) |
| C7 | same | ledger over the whole file: stderr/stdout, table rows, and a spy on `pg.Client.prototype.query`; forced commit failure prints no link |
| C10 | same | a session holds the advisory key; exit 1 inside 3 s; nothing written |
| C11 | `tests/db/wrappers.test.ts` | the nesting matrix is now 4 x 4; `current_user`, `app.actor`, empty `app.user_id`, no `enterNewUser`; `max: 1` pool; export surfaces |
| C12-C15, G1 | `tests/db/pgtap/06_operator_invitation.sql`; `definers.json` half in `operator-invite.test.ts` | |
| C16 | `tests/layers/fixtures/33-operator-wrapper/` (17 files) | operator wrapper and issuer: package-path, relative, dynamic, re-export, plus the literal (plain, escaped, other tenancy file); two pass cases |
| R7 CI map | `tests/ci/db-areas.test.ts`, `tests/ci/db-filter-imports.test.ts` | `operator-invite` joins `auth`; `apps/worker/src/cli/**`, `apps/worker/src/startup.ts`, `apps/worker/package.json`, `bin/polycarpic` run the `auth` area |
| C9 dispatcher | `tests/image/dockerfile.test.ts` | `cli) exec node "$here/apps/worker/src/cli/main.ts" "$@"` |

## Assumed surface (not in the ruling's text; builder reconciles in the test, not the other way round, if the ruling is silent)

- `runUserInvite({ email, bootstrap }, { stdout, stderr, origin })`: `stdout` and `stderr` are `{ write(s: string) }`.
- `withOperatorTx` also exports `close` from `@poly/db/operator` (R3 says so).
- Audit payload for `invitation.revoked` is only required to contain the revoked invitation's id; its other keys are free.
- The bad-address table omits NUL in SQL (a text literal cannot hold it); the TS test covers NUL.
- pgTAP 06 aborts at the first missing object (the harness runs psql with ON_ERROR_STOP), so it goes green one migration at a time: 0008 first, then 0009.

## Suite cost (unmeasured; the new file cannot run green yet)

Estimate: one extra clone for C1b, about five BetterAuth sign-ups, four child processes (concurrent), one 2 s lock wait. Measured at gate 3 against a same-day control on main.

## Paths and CI

No `.github/workflows` edit. Tests only.
