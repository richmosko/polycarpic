# POLY-146 — verdict (qa-engineer)

Verified tree: product and tests identical to branch tip `b9ca83db` (product last changed at `abee547b`; docs after it do not touch code). Runs were made at `60ccbc8a`; `git diff 60ccbc8a b9ca83db -- packages apps infra tests bin` is empty.

## Criteria

| # | Criterion | Proving test | Result |
|---|---|---|---|
| 1 | Reset and magic-link tokens stored hashed; stored value ≠ emailed value; each verifies once; a value read from `verification` is refused | `packages/auth/src/options.test.ts` (2 option tests); `tests/db/auth-route-policy.test.ts` "POLY-146" (6: stored identifier, stored value refused at `/reset-password`, `/reset-password/:token`, `/magic-link/verify`, once-only for both) | pass |
| 2 | `AUTH_SECRET_FILE` web-only; worker mounts no auth secret; lint refuses one | `tests/config/check-config.test.ts` (3 + registry block); `packages/config/src/loader.test.ts`; `tests/infra/lint.test.ts` rows "prod/staging worker mounts auth_secret" + static compose read | pass |
| 3 | `poly_operator` LOGIN, same hygiene, CONNECT + USAGE app + EXECUTE issuer only; pgTAP catalog-exact | `pgtap/06_operator_invitation.sql` C13 block + A1.2 effective-privilege rows; `01_roles.sql`, `03_role_hygiene.sql` | pass |
| 4 | `poly_worker` loses EXECUTE; C12 names the new role | `pgtap/06` C12 (EXECUTE held by poly_operator alone; worker refused 42501 incl. bootstrap, no row left); `operator-invite.test.ts` definers.json case | pass |
| 5 | `withOperatorTx` on the operator pool; fails closed in a worker process | `operator-invite.test.ts` "POLY-146 AC5" (5: runs as poly_operator; `OperatorPoolRefused` from configure and from process.env, no connection; child CLI with `DATABASE_USER=poly_worker` exits 1 `config.refused`; child with `AUTH_SECRET_FILE` refused); `wrappers.test.ts` | pass |
| 6 | `operator` one-shot service; no long-running service has the operator password | `tests/infra/lint.test.ts`: fail rows (worker/web, prod and staging, mounting `db_password_operator` → `secret-matrix`; restart, profile, extra profile, logging none/json-file → `operator-one-shot`) and the static prod/staging compose reads (operator exists, one secret, logging none; no other service names it) | pass |
| 7 | `pg_hba` prod and staging admit poly_operator from the app subnet with scram | `tests/infra/lint.test.ts` static pg_hba reads (2) | pass |
| 8 | Existing operator-invite tests pass against the new role | `operator-invite.test.ts` (27 → 32 tests, child env is poly_operator, no `AUTH_SECRET_FILE`), `pgtap/06` behaviour rows run as poly_operator | pass |
| 9 | SECURITY C-01, C-84, R-2, R-12, secrets table, T1 row; INFRA §7.5; ARCH §7 | no automated test; docs landed at tip (SECURITY 1.9.19 `81a9a9dd`, INFRA 1.3.10 `b5a37021`, ARCH 1.15.22 `2eaa54b1`). Wording is seceng's and the architect's to sign; I checked presence only | **not tested by QA** |

## Suites at the verified tree

- `pnpm lint`, `pnpm -r typecheck`: clean. `pnpm test` (turbo): one find, fixed — `packages/config/src/loader.test.ts` still required `AUTH_SECRET_FILE` for the worker (10 failures); updated, 298/298 (`b9ca83db`).
- `tests/config` 97 passed, 15 skipped (pre-existing skips); `tests/infra` 163; `tests/ci` 534; `tests/layers` 519; `tests/db` (22 files) 457 passed + 2 expected-fail, three runs.
- Skipped tests added by this loop: none.

## Red-gate record (detail: red-gate hand-off, summarised)

Red observed with the product paths restored to `6a1781d8` (pre-build), tests as written: options 2, check-config 6, lint 15, db 15 (pgTAP 01/03/06 + route-policy 4 + operator-invite 8), wrappers 2. Only the two "emailed token works once" tests passed there, by design (regression guards). A1.2 rows shown to catch a fault: with EXECUTE, USAGE, CREATE and TEMP granted to PUBLIC in a scratch run, all four go `not ok`. Test faults found only after the build and fixed: pool-refusal tests must close pools first (pool built once); A1.2 EXECUTE predicate excludes extension members (pgTAP); wrappers and loader tests were stale (missed by the R5 table).

## Test time (`db` project, same day, same machine, sequential runs)

| | run 1 | run 2 | run 3 | mean |
|---|---|---|---|---|
| main (`origin/main`, 446 tests) | 52.43 s | 51.29 s | 51.79 s | 51.8 s |
| branch (457 tests) | 55.22 s | 53.56 s | 51.73 s | 53.5 s |

Delta +1.7 s (+3 %), inside the ruling's +2–4 s estimate and inside run-to-run spread; no new `db` file, so CI areas are unchanged.

## Open

- Criterion 9 needs seceng/architect sign-off; nothing else is open.
- Adjacent: the operator-secret rows prove the repo's compose files and the lint, not a deployed host (POLY-97 provisioning).
