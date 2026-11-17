# POLY-152 — Sign-in service: security review of the build at `af6f69de` (seceng)

**Reviewed:** the gate sha `af6f69de`, with qa's record `red-run.md` at `38600317` (docs only after the gate). Read against the ruling at `646e35ed` and its comments at `9f6dd25a`, `f16e92d1` and `322c6174`, and my `ruling-review.md` §2 and §5–§9.

**Verdict: ACCEPT `af6f69de`.** No blocking finding. Six findings are not blocking (§3). Every PASS that rests on a stand-in is marked in §2.

## 1. My own re-run (my worktree, at `af6f69de` content, 2026-11-17)
| Suite | Command | Result |
|---|---|---|
| tests/db | `pnpm exec vitest run --config tests/db/vitest.config.ts` | 34 files: 751 passed, 2 expected-fail (`it.fails`), 0 failed. This matches qa's 753. **First run:** 33 failures in `ops-hardening` and `ops-status` alone, because `$app/tsconfig` was missing (a fresh worktree has had no `svelte-kit sync`). After the sync both files passed, 35 of 35. Not a product failure (§3 N5). |
| tests/infra | `--config tests/infra/vitest.config.ts` | 4 files, 180 passed |
| tests/layers | `vitest run tests/layers` | 6 files, 551 passed |
| packages/auth | `vitest run` | 7 files, 43 passed |

**Not re-run by me:** e2e (I rely on qa's 55/0/0), tests/ci, tests/config, tests/image, the other packages, lint and typecheck as a whole, and `tests/infra/image` (POLY-143). I ran eslint on my plant files only (§2.4).

## 2. The five checks, with probes
Each probe below was run, then removed. None is committed.

### 2.1 backend-lead's live measurements I did not re-run
- **Savepoints: PASS, on a stand-in.** backend-lead measured BetterAuth's inner BEGIN and COMMIT becoming savepoints with `withContextFreeTx` as the outer transaction, because `withSignInTx` did not exist yet (`backend-lead-152/temp/…-measurements.md` §5): no inner write was visible from a second connection, and none survived a throw. The shipped proof on the real wrapper is `auth-signin-tx`'s forced failure. A test plugin (**stand-in** for a 5xx or the handle INSERT) throws after the session INSERT, on the paths that `handler.ts:58,127` sends through `withSignInTx`, and no session row remains. A real inner COMMIT would leave that row behind, so the test would catch one. I did not mutation-test it.
- **A rolled-back magic-link verify leaves its token reusable: safe.**
  - **How it works:** the verify deletes the token's `verification` row inside our transaction. A throw or a 5xx rolls that delete back, so the same link works again (measured: 302).
  - **What an attacker reaches:** nothing new. Only the holder of the emailed link can use it. A rolled-back attempt created no session, because the session rolled back with the token. The token is stored hashed (`options.ts:151`) and still expires as BetterAuth sets it (default 5 minutes, code-read). A success still commits the delete, so the link stays single-use after any sign-in that worked. A retry after a server error is a feature, not a hole.

### 2.2 pgTAP 08: the poly_app-membership plant. **Shown to bite.**
I ran the file with the plant added inside its own transaction (the pgtap.test.ts method):

| Plant | `not ok` lines |
|---|---|
| none (control) | 0 |
| `GRANT poly_app TO poly_auth` | 7: #3 (member of no role), #10, #12, #18 (effective table, column, function), #20 (`enter_asserted_user` …), #27, #28 |
| `… WITH INHERIT FALSE, SET TRUE` | 1: **#3 only** |
| `… WITH INHERIT FALSE, SET FALSE, ADMIN TRUE` | 1: #3 only |
| `GRANT poly_auth TO poly_app` (the reverse) | 1: #21 |
| `ALTER ROLE poly_auth BYPASSRLS` | 1: #2 |

- **The non-inheriting membership is the dangerous one, and only assertion #3 sees it.** has_*_privilege does not count it, yet `SET ROLE poly_app` works from poly_auth (probe: `current_user` became `poly_app`). That reaches the whole of poly_app, `enter_asserted_user` included. #3 holds, so the pin is sound. But the planted-grant list in `pgtap.test.ts` does not carry these plants (§3 N2).

### 2.3 Did qa's narrowing of 08, or the poly_app positives turned into refusals, weaken anything? **No.**
- 08 now excludes objects owned by an extension (`pg_depend deptype = 'e'`), so pgTAP's own functions in `public` are not counted. Production holds no extension but plpgsql. A production check for that is a POLY-97 follow-up (POLY-147 review). §3 N4.
- 08's granted-column line widened from `user`, `session` to the eight allowed tables. That is correct: a table-level grant lists every column in `role_column_grants`. The effective column check is the strict one, and it is unchanged.
- **identity-marker R2 (the `query_to_xml` route)** now runs on the routing pool as poly_auth. It accepts "permission denied for `enter_asserted_user`", so for poly_auth it passes by permission. poly_app's coverage stays elsewhere in the same file: the exact-call shapes as poly_app (`:87-113`) and `query_to_xml` refused for poly_app (`:182`). Nothing was lost.
- **second-step-gates** `refusedAs` (`:78-81`): for tenancy writes, poly_auth is refused by permission (it holds no tenant privilege, R2), and the guard's own message is still asserted for poly_app, the role that reaches the guard. Correct. Positive paths through the nine helpers run as poly_auth (`:15`), so a lost grant would fail them. The file's header (`:2-3`) still describes the old fixture role (§3 N6).
- `auth-service-grants` keeps my B1 (a token read as poly_auth, then entering with it, reaches no tenant table) and A1 (poly_app differs by exactly the twelve).

### 2.4 Can web reach BetterAuth, the secret or the poly_auth pool? **No: every plant was caught.**
I put eight files under `apps/web/src/lib/server/` and ran eslint and `tests/layers/auth-service.test.ts` (the transitive scan):

| Plant | eslint | Transitive scan |
|---|---|---|
| `import 'better-auth'` | **not caught** | caught |
| `import('better-auth')` (dynamic) | **not caught** | caught |
| `import '@better-auth/passkey'` | **not caught** | caught |
| `import { x } from '@poly/auth'` | caught | caught, with the whole chain to `better-auth` |
| `import '@poly/db/auth'` (poly_auth's pool) | caught | caught |
| `createRequire(...)('better-auth')` | caught (POLY-140 rules) | n/a |
| relative `../../packages/auth/src/handler.ts` | caught | n/a |
| `readFileSync('/run/secrets/auth_secret')` | not caught | not caught. **Safe:** the secret is not mounted in web (#17, §2.5), so the read finds nothing |

Web cannot hold poly_auth's password: it is mounted for `auth` alone (#17). So it cannot open that pool any other way. The direct `better-auth` imports are refused only by the scan, which is a test (§3 N3).

### 2.5 Compose: the internal listener and #17. **PASS, with one gap.**
- `apps/auth/src/bind.ts` refuses a missing host, a name, any spelling of `0.0.0.0` or `::`, and an internal port equal to the public one. There is no default bind. `tests/config/auth-bind.test.ts` covers it.
- prod: `auth` binds `AUTH_INTERNAL_HOST: 10.201.40.3`, its `ipv4_address` on `web-auth` (`internal: true`, a /29). Only web and auth are on it. No `ports:`. The public listener is on `0.0.0.0:3000` (`main.ts:55`), on `default` and `edge-prod`. That listener serves only `/api/auth/*`, the same as through Caddy. Staging is the same, with 10.202.40.3.
- **#17 bites.** I added `auth_secret__auth` to the worker's secrets in `prod.yml`. `tests/infra/auth-service.test.ts` then failed "no service but auth mounts the auth secret…", 1 of 17. I reverted the file.
- **Gap (§3 N1):** no test ties `AUTH_INTERNAL_HOST` to auth's address on `web-auth`, or web's `AUTH_INTERNAL_URL` to it. Set the host to auth's `edge-prod` address instead, and the listener would bind where Caddy can reach it, with every test green.
- The live probe from the Caddy container stays (unmeasured) until POLY-97, as the ruling says. **The "Caddy cannot reach the internal port" PASS rests on rendered compose and the bind unit test, which stand in for that probe.**

### 2.6 Other PASS lines that rest on a stand-in
- R9's commit-together test: a throwing test plugin stands in for the handle INSERT failure (POLY-153 repeats it with the real INSERT).
- R7's refresh and cap tests, and the lockout's 900 s pin, run on a fake clock (`Date` only).
- Magic-link and email-code tests read a captured mail list in place of Resend (POLY-137).
- The OAuth callback runs against the check-owned fake provider.
- The e2e seed signs in through `tests/db/helpers/e2e-auth.ts` against the running service, not through the browser form.
- Not a stand-in any more: poly_auth is the real role from `roles.sql` in every db suite. The `IN ROLE poly_app` fixture is gone (`helpers/second-step.ts`).

## 3. Findings (none blocking)
- **N1. The internal listener's address is not tied to its network (before POLY-97).** A rendered-compose assertion should check that `AUTH_INTERNAL_HOST` equals auth's `ipv4_address` on the `internal: true` network, and that web's `AUTH_INTERNAL_URL` host equals it, in prod and staging. Owner: devops-engineer, on POLY-153 or POLY-97.
- **N2. Add the membership plants to 08's planted-grant list.** Add `GRANT poly_app TO poly_auth` and `… WITH INHERIT FALSE, SET TRUE`. The second is caught only by #3, and it reaches all of poly_app through `SET ROLE`. Owner: qa, on POLY-153.
- **N3. eslint does not refuse `better-auth` or `@better-auth/*` in apps/web.** The transitive scan does, but only when the tests run. Add both to web's restricted imports, so the editor and `pnpm lint` show it. Owner: backend-lead, any later loop.
- **N4. Production extensions.** 08 skips extension-owned objects. The POLY-97 provisioning check (production `pg_extension` holds only plpgsql) is what keeps that skip safe. It is not built yet; POLY-97 carries it.
- **N5. Harness:** in a fresh worktree, `tests/db` needs `svelte-kit sync` first. Otherwise `ops-hardening` and `ops-status` fail on `$app/tsconfig`. A pretest step, or a clear message: POLY-143.
- **N6. A stale comment:** `tests/db/second-step-gates.test.ts:2-3` still says the harness creates poly_auth by membership. Owner: qa, next touch.

## 4. SECURITY
No SECURITY edit in this loop: the docs are POLY-149's. What POLY-149 must state from this loop:
- the sign-in service's reach (ruling R11);
- a database read of session tokens plus the auth secret gives every live session (R6.2);
- R-24 covers every OAuth callback;
- the lock-cycle guessing budget, once the Principal decides (my brief).

## 5. Delta at `adfea672`
Read: `git diff -M af6f69de adfea672 -- . ':!process' ':!docs'`, 2 files, +3/−6. **No assertion was removed or weakened.**
- `bind.test.ts` moved to `apps/auth/src/`. Only its header comment and its import path changed.
- `auth-signin-tx` lost two `writeFileSync` lines into `temp/` and its `fs` import. One measurement is now a `console.log`, and the lock-expiry line is no longer recorded. No `expect` changed.
