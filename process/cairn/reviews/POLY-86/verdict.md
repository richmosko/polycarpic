# POLY-86 verdict (gate 4): architectural review of the build @ f99b888

Architect, 2026-11-11. Against `ruling.md` (final @ 82a7d49, addendum 1 @ 326aa1b) and seceng S1–S18 (@ 8e98d78).
Method: code-read of the diff 326aa1b..f99b888 and the builder's gate-3 report. The suites are not re-run here: the full suite is the gate owners' (WORKFLOW → Four gates).

**Result: pass.** Both conditions are met. F1 at 385ef78: `routing-pool.test.ts`, with `AuthUnderSystemJob` raised on `connect()` and `query()`. F2 at f6cde68: `userCreateBefore` asserts the wrapper and calls `claimInvitation` on every call, and the image rule is the pure `stripImage`.

| Axis | Result | Evidence |
|---|---|---|
| M1 hold | pass. The twoFactor hook is found by behaviour, exactly one or a throw, and wrapped as `original ‖ SIGN_IN_PATHS` (S10). The passkey-only after-hook deletes the session and strips its queued cookie. The idToken branch is refused. | f99b888 `packages/auth/src/second-step.ts`; the hold is measured on all three paths (gate-3 report) |
| R1 layout and pinned options | pass. The layout matches R1, plus `recent-auth.ts` split out. Cookies measured: `__Host-`, HttpOnly, Secure, Lax, `Path=/`, no Domain (S17), so C-02 needs no change. | f99b888 `options.ts`; gate-3 report S17 |
| R2 routing pool | pass. The statement grammar is closed (S4). A lease is serialised with a 5 s timeout and its waiter is cancelled (S5). `AuthUnderSystemJob` is thrown. In db: the store's `live` flag, `TransactionEnded` from `currentClient()`, the handle refusing queries after the end (S3), and the COMMIT result checked (S2). | f99b888 `routing-pool.ts`, `packages/db/src/context.ts` |
| R3 allowlist | pass. The handle 404s unlisted and blocked paths after normalising them (S7). Redirect keys must stay on our origin (S12). `drizzleAdapter` is banned through the layers generator. | f99b888 `route-policy.ts`, `hooks.server.ts`, `scripts/layers/generate.mjs` |
| R4 wrapping and commit-on-success | pass. The withTenant, withContextFreeTx and plain-pool branches match R4. `RollbackWith` fires on status ≥ 400 and on an error redirect, and its Set-Cookie is dropped (S1). Moving the claim and the wrapper assertion to `user.create.before` is right: an after-hook runs once the row is written. | f99b888 `handler.ts`, `user-hooks.ts` |
| R5 session, step-up, Sessions | pass. The 23505 retry walks `.cause`, runs once, and logs no token or email (S15). Step-up uses the database's `now()` and refuses a future stamp. Revoking another session requires step-up (S13). The 30-day cap is enforced on both paths (S14). | f99b888 `session.ts`, `recent-auth.ts` |
| R6 hooks.server | pass. `locals.session` is the token-free projection. `next` must stay on our origin. Only BetterAuth's Set-Cookie is forwarded (S15). | f99b888 `apps/web/src/hooks.server.ts` |
| R7, R8 schema and image | pass. `image` is always null (S16b). Column-level INSERT/UPDATE grants, measured as enough with no trigger (S16a). The fields map adds `twoFactor` and `passkey`. | f99b888 migrations 0004, 0005; gate-3 report S16a |
| Layers | pass. packages/auth imports no `pg` and no `PostgresDialect`, enforced by `boundaries.test.ts`. `changes.mjs` triggers the db job on `packages/auth`. | f99b888 |
| Addendum 1 item 2 | **fail (F1)**. There is no unit test for `AuthUnderSystemJob`. Only a "not covered" note in `tests/db/auth-routing-pool.test.ts`. | f99b888 |
| A test branch in production code | **fail (F2)**. `userCreateBefore` runs the wrapper assertion and the invitation claim only `if (typeof data.email === 'string')`. The branch exists so that a pure test can call the hook. It is an unguarded path through the A-40 / C-01 check. | f99b888 `user-hooks.ts` |
| CI time | open. The db battery takes 101 s locally. The PR run's db-job time is reported at finish against R10's 150 s guard. | gate-3 report |

## Conditions

- **F1.** Add `packages/auth/src/routing-pool.test.ts`, with `@poly/db/auth`'s `currentClient` mocked to `{ kind: 'withSystem' }`. Assert that `connect()` and `query()` both reject with `AuthUnderSystemJob`.
- **F2.** Make the check unconditional. The hook throws `SignUpOutsideTransaction` whenever `currentClient()?.kind !== 'withContextFreeTx'`, whatever `data` holds. Move the image rule into its own pure function (`stripImage(data)`), which the hook calls and the pure test calls directly. A non-string email reaches `claimInvitation` and is refused there.

## ARCH

§3.1c holds the M1 result, the route-policy test path and the idToken refusal. §2.2 gains the C-02 session lifetimes, `cookieCache` off, in-memory rate limits, and the idToken refusal. ARCH is now 1.15.15.

## Follow-ups (lead to file after the merge, in addition to the ruling's 1–8)

9. The handle's `/api/auth` tree test runs on the raw pathname. `/API/AUTH/...` falls through to the page routes and gets SvelteKit's 404. That is safe today, and worth one test once routes exist under `/api`.
10. Providers (Google, GitHub) are not wired in apps/web: config has no client-id variable yet. Goes to POLY-88 with Open 1.
