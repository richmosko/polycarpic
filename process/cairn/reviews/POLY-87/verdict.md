# POLY-87 verdict (gate 4, qa-87)

Code measured: 9051d1d (everything after it is docs and tracker; `git diff 9051d1d..HEAD` touches only ruling.md). **Verdict: pass** — all 14 criteria and conditions 1–33 are proven by a test that ran green; the caveats are labelled below.

## Suites (local, 9051d1d, this Mac)
| suite | result |
|---|---|
| db battery (`vitest -c tests/db/vitest.config.ts`) | 414 / 414 |
| tests/ci | 528 |
| tests/layers | 502 |
| tests/infra (`-c tests/infra/vitest.config.ts`) | 142 |
| apps/web e2e, whole suite | 52 passed (includes sign-up.spec.ts and the moved root-redirect pin) |
| `pnpm lint` (layers check, eslint, check-migrations) | exit 0 |
| `pnpm test` (turbo) | 17 / 17 tasks |
| cairn python suite (`scripts/cairn/run_tests.py --gate verdict`) | 2017 OK (4 skipped) |
| tests/image | 37 passed, 15 skipped |
CI: PR run 43341511932 on 9051d1d all green (guard, cairn, changes, db, image, lint, unit, app). Five dispatch runs (43341943047, 43342512609, 43343144183, 43343666158, 43345203202): db job conclusion success in each. Main control runs 43344193896, 43344702525, 43345784207 on 7eaa51a: success. I read conclusions, not durations; the 94 s / 93 s medians are the lead's and the architect's ruling note's. tests/infra/image/postgres.test.ts: 30 tests passed in the image job of dispatch run 43345203202 (read by the lead from the job log), caddy.test.ts 10 passed; locally tests/image passed here with no failures.

## Acceptance criteria
| # | proof |
|---|---|
| 1 | auth-signup-invite C1+28, C2 (every input/NODE_ENV), C23 closure |
| 2 | C1 (expired, revoked, claimed), C3 replay, C4 race |
| 3 | C6 (3 routes), C7; apps/web page.server.test.ts; e2e shell.spec root redirect `/dashboard?entity=<uuid>` |
| 4 | C1+28 (route-hook 403), C24 (hook reached without token); route-policy tests |
| 5 | C9, C10, C32 hook variants |
| 6 | new-user-step C5, C13; invite C12 variant (step removed: RLS refuses, no user row) |
| 7 | C10 provisionPerson trigger. **"Seeded accounts" ticked against the Person and its owner membership**, as ruling R3 says; the GL chart seed is not built. |
| 8 | C11 (max-1 pool, after commit and rollback) |
| 9 | new-user-step C13 handle side, C14, lint fixtures 30–32 |
| 10 | C10, C11 |
| 11 | C4, C27 |
| 12 | new-user-step C13 (forged setting, savepoint); pgtap 05 C17, C32 |
| 13 | pgtap 05 C15, C18 |
| 14 | pgtap 05 C16, C23 |

## Conditions 1–33
1 invite C1+28 · 2 invite C2 · 3 C3 · 4 C4 · 5 step C5 · 6 C6 · 7 C7 · 8 C8 · 9 C9 · 10 C10 · 11 C11 · 12 invite C12 variant · 13 step C13 (db and handle side) · 14 step C14 · 15 pgtap 05 C15 · 16 pgtap 05 C16 (incl. claimant reads 0 rows, exact poly_app policy list) · 17 pgtap 05 C17 · 18 pgtap 05 C18 + step definers.json pin · 19 pgtap 05 C19 · 20 layers 30-confined-module · 21 layers 31-reserved-literal (eval, new Function, setTimeout string, under real globals) · 22 layers 32-confined-member · 23 invite C23 + pgtap 05 C23 · 24 invite C24 · 25 invite C25 · 26 invite C26 · 27 invite C27 · 28 invite C28 · 29 invite C29 + e2e sign-up.spec · 30 pgtap 05 C30 + step C30 (NOWAIT-held row, answers 42501 at once) · 31 pgtap 05 C31 · 32 step C32 + pgtap 05 C32 + invite C32 variant (+ wrap: commit-time 42501 is labelled only on the sign-up path) · 33 step C33 + invite C33.

## Labelled: unmeasured, indirect, or passes-without-the-build
1. **Passes-today guards** (not red before the build, so they prove "still true", not "now built"): the three C14 export-surface checks; the "pass-" lint fixtures; the C23 closure describe (the stub already refused everything); C15 "poly_app holds no INSERT on membership".
2. **C25 GitHub is built for real**, not the refuse fallback: options.ts line 45 sets `getUserInfo: githubUserInfo` on the github provider. The test "the GitHub email is the /user/emails entry that is both primary and verified" would fail if it were not (it returns early only when authOptions throws; the first test fails if neither holds), and it ran green with the override present.
3. **hashInvitationToken** has no direct unit test. It is proven indirectly: seedInvitation hashes with node:crypto over the decoded bytes (independent of the build), and every successful sign-up (C3, C4, C6…) can only succeed if the build's hash equals it. A direct pin was proposed and not written.
4. **C14 withSystem** is covered with a replaced `app.job_targets` in the test database (as wrappers.test.ts does).
5. **C29 e2e** form labels/button names were assumed; they matched (52 passed).
6. Not measured: CI per-file seconds against main (no main artifact); the db-time follow-up (seed helpers via sql.ts, shared fixtures, ≈ -3 s) is not in this loop.
7. The S5 lock test costs a real 5 s lock_timeout wait.

## Existing tests changed (red-gate.md): none weakened
- 04_tenancy #19, #27: pins moved to the ruled state (one more trigger, two policies); same strictness.
- helpers/tenancy.ts, tenancy.test.ts: 2-byte hashes → 32 bytes (the R1 check); tests unchanged otherwise.
- permission-matrix.json: md5 → sha256 hash; revoke probe `coalesce(revoked_at, now())` so the set-once rule (S10) does not fail it; still expects ≥ 1 row for the owner, denial for others.
- auth-fields core-calls: real invitation instead of a mock; stronger (real claim).
- auth-signup-wrap: mock records then runs the real claim; claim count 1 → 2 on /sign-up/email as ruled; assertions otherwise kept.
- shell.spec.ts:101: bare `/dashboard` → `/dashboard?entity=<uuid>` (R3 item 6); stricter pattern.
- db-areas.test.ts / changes.mjs: two files added to the auth area.

## Docs
ARCH 1.15.20 and SECURITY 1.9.15: the Version line in each index.html equals the PDF text (pdftotext), and each PDF was last committed with its index.html (db429e4; cc6b44c). I did not diff prose against code line by line; checked: sign-up claim/accept/step, stamp, viewer-only accept, GitHub rule appear and match the tests above.
