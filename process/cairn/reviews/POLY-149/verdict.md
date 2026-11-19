# POLY-149 — Stage 2 revocation and docs: verdict (architect)

**Gate sha:** `9fc167f4`. Read against the ruling and its Addenda 1–6 (last at `b3e4035c`). After `9fc167f4`, the branch carries only `gate.md`, the issue file, and this verdict's ARCH line and file (`git diff --stat 9fc167f4 HEAD`).

**Verdict: APPROVE.** No blocking finding.

## 1. The criteria

| Block | Result | Evidence |
|---|---|---|
| V: revocation; poly_app's complete EXECUTE set | PASS | pgTAP 11, both ways, granted and effective, with its plants; `revocation.test.ts`; e2e 57/0/0 on the migrated chain with no harness revoke (`gate.md`). Read by me: 0017 revokes all six tables and `email_challenge`, drops `enter_asserted_user` as poly_authz, narrows the kind CHECK, and maps `session` and `auth` to `user` in `audit_membership` |
| L: growing lock | PASS | `second-step-lock.test.ts` (15 → 1440 on both paths, the reset, restart, refusals read back unchanged, passkey and `reset-mfa`); pgTAP 12. Read by me: the guard follows R2 steps 1–5 on `clock_timestamp()`; the delete guard is an invoker; `reset_second_step` deletes the streak |
| S: sign-in record | PASS | `sign-in-record` tests and pgTAP 12 (privileges both ways, the three refusal triggers, purge, typed-code scan, the address check). Read by me: no FK; `05_refuse` per statement before the row check; only poly_purge's DELETE reaches the 400-day / deleted-account test |
| N1 and Addendum 2 | PASS | the cap test (no write) and the concurrent-entry test. Read by me: `FOR UPDATE SKIP LOCKED` on `expires_at < v_new` |
| F1: written by the database | PASS | AFTER INSERT trigger on `public.session`, from `NEW` only; second-step rows from the guard |
| INFRA §7.1 step 16 | PASS | `gate-check` 94/94 against R5 and Addendum 4's membership list (devops; plants in `gate-check.test.ts`) |
| poly_auth fixture is the real role | PASS | pgTAP 08's N2 plant |
| D: docs, running cost | PASS for ARCH (§6) | R7 measured by devops (`r7-auth-memory.md`), recorded in ARCH §7.3. SECURITY and INFRA are seceng's and devops's |

Counts from qa's single clean-tree run at `9fc167f4` (`gate.md`): db 1057/0/0, e2e 57/0/0, ci 542, layers 545, infra 184, lint and typecheck clean. db time is 96 s against a same-day main control of 76 s (+20 s for +155 tests; one run each, with load stated). Not run: `tests/infra/image` and `tests/log`.

## 2. The rulings, against the build

| Ruling | Built as ruled? | Note |
|---|---|---|
| R1 revocation, fixtures | Yes | `session.ts`, the R7.4 harness revoke, its scope test, and fixture dirs 12, 13 and the `enter_asserted` cases of 31 are gone; `revoked-names.test.ts` pins absence |
| R2 lock, delete guard | Yes | |
| R3 record, purge, address | Yes | the service sends both settings in `withAuthSession`, `withSignInTx` and `withContextFreeTx` (`context.ts:251`, `handler.ts:140-143`) |
| R4, Addendum 2 | Yes | |
| R5, Addenda 2 and 4 | Yes | |
| R6 order | Yes | 0016 seven steps, then 0017; temporary CREATE and EXECUTE grants revoked in-file |
| Addenda 1, 3, 5, 6 | Yes | `05_refuse`; the dead lint rule removed; `36-reserved-literal`; setting scope and the EXECUTE ban over every non-system schema |

## 3. Architectural review

- **No drift.** Web has one way in (`withSession` → `enter_session`). poly_app holds nothing on BetterAuth's tables, the handle, the record or the streak. The asserted-user path no longer exists in code or schema.
- **Interim items left: none from stage 2.** The worker's reach until POLY-64 is the standing residual SECURITY R-2 states.
- **Not run by anyone:** the purge has no scheduled caller (POLY-137); the staging memory cap (192 MB); the live Caddy probe and a real-domain TLS run (POLY-97).

## 4. Findings (none blocking)

| # | Finding | Owner |
|---|---|---|
| N1 | `app.sign_in_address` is declared `IMMUTABLE` but calls `pg_input_is_valid`, which Postgres marks `STABLE` (from the docs; not checked against this catalog). inet parsing does not depend on settings, so the result is the same, but the label overstates it. Change to `STABLE` next time the function is touched; no index uses it | backend-lead, next migration that touches it |
| N2 | Both purges are unscheduled, so the 400 days and the deleted-account rule are not enforced yet; ARCH and SECURITY state it | lead, POLY-137 (filed) |
| N3 | db suite +26 % time for +17 % tests. Within the trend, but the second-step lock suite (8 locks × 10 codes × 2 paths) is the largest single addition; watch it | qa, next loop |

## 5. Checked myself, and taken from others

- **Myself, at `9fc167f4`:** read 0016 and 0017 whole against R1–R6 and the addenda; the service's settings path in `context.ts` and `handler.ts`; `definers.json` (no `enter_asserted_user`); greps for the removed names and files; `scripts/layers/check.mjs` exits 0 after the ARCH line below.
- **From qa** (`gate.md`): every count, the timing and the plants.
- **From devops:** `gate-check` and the R7 memory figures.
- **From seceng:** the attack review of the build, in parallel (`build-review.md`).

## 6. Docs

ARCH 1.21.0 states the current state:
- §2.1: six wrappers; one web entry.
- §2.2: the `db` and `auth` rows.
- §3.1c: the growing lock (five steps, the delete guard, the reset as the service's word) and the sign-in record (writers, the address check, the three refusal triggers, purge unscheduled, what can still erase it).
- §3.3: poly_app's role line and ten functions; four ways in; the non-blocking slide; and, added with this verdict, the schema-wide pins: no dynamic `EXECUTE`, no `pg_settings`, four allowed settings.
- §7.3: the auth container's measured memory.

`ARCH.pdf` is not regenerated.
