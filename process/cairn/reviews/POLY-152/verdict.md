# POLY-152 — Sign-in service process: verdict (architect)

**Gate sha:** `af6f69de`. Read against the ruling at `646e35ed` and my three correcting comments on POLY-152: the poly_govern grant (`9f6dd25a`), the lockout and the layer checker (`f16e92d1`), and the lockout test shape (`322c6174`). The layer-boundary comment at `c36bf83e` is included. Everything after `af6f69de` up to this verdict is docs and issue files only (`git diff --stat af6f69de 4be2f1ec`: four issue files, `build-review.md`, `red-run.md`).

**Verdict: APPROVE.** No blocking finding.

## 1. The nine criteria

| # | Criterion | Result | Evidence |
|---|---|---|---|
| C1 | `polycarpic auth` as poly_auth; the secret mounted for it alone; Caddy routes `/api/auth/*`; web refuses the tree | PASS | qa `red-run.md` @ 38600317 (`tests/infra/auth-service`, `auth-service-main`, `hooks.server.authtree`); seceng build-review §2.5, where #17 was shown to bite by a planted mount. Read by me: `hooks.server.ts` answers 404 for the tree. The Caddy-side probe is a stand-in until POLY-97 |
| C2 | poly_auth's grants catalog-exact; the stamp names poly_auth only | PASS | pgTAP 08 (granted and effective, PUBLIC included); seceng §2.2 showed seven plants biting; `auth-provision-person` (poly_app cannot finish a sign-up) |
| C3 | No tenancy write grant; `provision_person` | PASS | `auth-service-grants` B1 (a token read as poly_auth, entering with it, reaches no tenant table); `auth-provision-person`. Read by me: 0014 grants poly_govern `SELECT (name)` on `user` only (line 58, as `9f6dd25a` rules) |
| C4 | The service enters by its own session; no `enter_asserted_user` | PASS | `auth-enter-session` (exact call, expired, capped, unknown, second marker, earlier write); pgTAP 08 #20. Read by me: `handler.ts:124` calls `withAuthSession(token, …)` |
| C5 | `recent_auth_at` stripped, not granted | PASS | `auth-second-step`, run as poly_auth (the rotations commit, and the column is absent from the INSERT) |
| C6 | Session and handle commit together | PASS for this loop's half | `auth-signin-tx`: a throwing test plugin (stand-in) leaves no session row on each `withSignInTx` path. The handle half is POLY-153's (`8129f982`). Read by me: `handler.ts:58` lists the four paths, and the `USER_INSERTING` routes keep `withContextFreeTx` |
| C7 | The cap clears the cookie at its own path | PASS | `auth-refresh` C7, with a non-`__Host-` prefix, as qa corrected it. Read by me: `handler.ts:95` builds the cookie from BetterAuth's attributes |
| C8 | Refresh as ruled, tested after day 6 | PASS | `auth-refresh` on a fake clock (stand-in): day 0 `Max-Age` ≈ 30 d; day 6 slides; day 8 signed in with no new cookie; idle day 8 signed out; `rememberMe:false` has no `Max-Age`. `auth-internal-session`: a session used daily is refused on day 30. The rotation's `Max-Age` is tested on a fresh row, not a real first-verify rotation (unmeasured, as R7 allowed). Read by me: `cookie-lifetime.ts:38` matcher `() => true`; web relays no `Set-Cookie` |
| C9 | Sign-up and the POLY-89 guards in the service's transactions; every auth test as poly_auth | PASS | db 753 (751 pass and 2 expected failures, seceng's re-run); the `IN ROLE poly_app` fixture is gone; the refusal halves assert that nothing was written. Read by me: 0014 revokes exactly twelve EXECUTEs from poly_app (line 104 and lines 148–153) |

Counts from qa's clean-tree run at `38600317`: vitest 2634 passed, 0 failed, 15 skipped over 100 files; db 753; e2e 55/0/0; lint and typecheck clean.

## 2. The rulings, against the build

| Ruling | Built as ruled? | Note |
|---|---|---|
| 646e35ed R1–R11 | Yes | R6.2 bind: `AUTH_INTERNAL_HOST` is auth's fixed address on `web-auth` (`internal: true`, web and auth alone), with no `ports:`, as seceng verified |
| 9f6dd25a (poly_govern grant) | Yes | `SELECT (name)` alone |
| f16e92d1 (b) (layers) | Yes | `check.mjs:39` no longer requires the base for a subpath allow. `layers.json` has `auth-app` (`@poly/auth-app`), `auth.subpaths ["./web"]`, web `auth/web`, and both `reservedLiterals`. `node scripts/layers/check.mjs` exits 0 against the ARCH below (run by me) |
| f16e92d1 (a) and 322c6174 (lockout) | Yes | No `accountLockout` option (`options.ts`, read by me). Tests: 5 tries per hold, 10 per factor across two holds, a lock of 900 s ± 60, and the right code refused while locked |

## 3. Architectural review: drift and missed integration points

- **No drift.** Web imports only `@poly/auth/web`, and a transitive scan refuses BetterAuth, `@poly/db/auth` and the `@poly/auth` root. The service imports `db` only through `db/startup` and `@poly/auth`.
- **Interim by design, each with its exit:**
  - web's per-page call to the internal `/session` listener and its entry by `enter_asserted_user`: POLY-153, then POLY-149;
  - BetterAuth's cookie at `Path=/`: POLY-153;
  - poly_app's grants on BetterAuth's tables: POLY-149.
  ARCH states each as interim.
- **Cost not yet measured:** the extra hop per page load and the auth container's RAM. POLY-149 measures the RSS (its criterion). The hop goes away in POLY-153.

## 4. Findings (none blocking)

| # | Finding | Owner |
|---|---|---|
| N1 | No test ties `AUTH_INTERNAL_HOST` and web's `AUTH_INTERNAL_URL` to auth's address on the internal network (seceng) | devops-engineer, POLY-153 or POLY-97 |
| N2 | Add the membership plants (`GRANT poly_app TO poly_auth`, and the `INHERIT FALSE, SET TRUE` form) to 08's planted list (seceng) | qa, POLY-153 |
| N3 | eslint does not refuse `better-auth` or `@better-auth/*` in apps/web; only the test-time scan does (seceng) | backend-lead, a later loop |
| N4 | 08 skips extension-owned objects; the production check that only plpgsql is installed is not built (seceng) | POLY-97 |
| N5 | A fresh worktree needs `svelte-kit sync` before `tests/db` (seceng) | POLY-143 |
| N6 | A stale header comment in `second-step-gates.test.ts:2-3` (seceng) | qa, next touch |
| V1 | **The lock-cycle guessing budget** (≈ 960 tries a day per factor, gated by the password) waits on the Principal's decision (seceng's brief) and is not yet on an issue | lead |
| V2 | **The ruling's open question 1**, a durable record of session creation that poly_auth cannot delete, is not on POLY-149 yet; R-2's residual depends on it | lead, POLY-149 |

## 5. Checked myself, and taken from others

- **Myself, at the gate content:**
  - read 0014: the poly_govern grant and the twelve revocations;
  - read `layers.json` and `check.mjs:39`, and ran the layer check (exit 0);
  - read `options.ts`: no `accountLockout`, `cookieCache` off;
  - read `handler.ts`: the sign-in paths, the refusal-commit set, `withAuthSession` and the clearing cookie;
  - read `cookie-lifetime.ts`: the matcher;
  - read `hooks.server.ts`: 404 for the tree, no cookie relay;
  - confirmed the diff after the gate is docs only.
- **From qa** (`red-run.md` @ 38600317): every test count and the e2e run.
- **From seceng** (`build-review.md` @ ff2701f1): the re-run of db, infra, layers and auth; the plants for pgTAP 08, the web imports and the compose mount; the bind and network check; the stand-in list.
- **Not run by anyone yet:** the live probe from the Caddy container (POLY-97).

## 6. Docs

ARCH 1.19.0 states the current state, interim items marked as such. The edits:
- §2: six transaction wrappers; the `db/auth` subpath carries the poly_auth pool.
- §2.2: from the earlier release, at 1.18.0.
- §3.1c: BetterAuth runs only in the service, as poly_auth. The routing pool runs on poly_auth. `withAuthSession` and `withSignInTx` are added, with the refusal-commit rule and the measured lockout. poly_auth reaches no tenant table. The factor guards meet both roles. The sign-in gate relays no cookie.
- §3.3: the poly_auth role. Four ways into the marker, `enter_auth_session` added, with `enter_asserted_user`'s interim stated. `enter_new_user` is poly_auth's. Extended mode covers four pools. `withSignInTx` and the stamp.
- §7: auth in the topology diagram; the sign-in service bullet (routes, internal listener and its bind, the interim cookie lifetime); auth in the no-ports list; the auth secret mounted into `auth` alone.

No PDF. SECURITY and INFRA are POLY-149's and seceng's.
