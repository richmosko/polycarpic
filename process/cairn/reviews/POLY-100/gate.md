# POLY-100 gate (qa-100) — current as of the commit that carries it

Plan: `test-plan.md` (pins), `red-run.md` (mutants). Numbers are this Mac, my worktree, one suite at a time. Linux CI is the authority for the container suites.

## Results by CI job

| Job / command | Result | Wall time | Budget (ruling R13) |
|---|---|---|---|
| ops unit: `unittest discover -p 'test_deploy_*.py'` + `test_staging_auth.py` | 148 tests green | 38 s earlier, 52 s on a busy machine (other teammates' suites) | 40 s (architect-100, 52910589): re-measure on a quiet machine |
| ops unit: the other `tests/infra/ops/test_*.py` (POLY-98/99 pins), file by file | green | — | — |
| lint: `vitest run -c tests/infra/vitest.config.ts` | 539/539 | 23.4 s vs control (main, 390 tests) 13.7 s = **+9.7 s** | ≤ 15 s |
| ci: `vitest run -c tests/ci/vitest.config.ts` | 587/587 | — | — |
| db: `tests/db/runner.test.ts` | 44/44 | 21.2 s vs control (main's file) 13.2 s = **+8 s** | ≤ 10 s |
| provision: `vitest.provision.config.ts` | **189/189** | ≈ 83 s vs control (main, 171 tests) 72.4 s = **+10.6 s** | ≤ 60 s box fixture |
| image: `vitest.image.config.ts` | 88/90 | — | 0 s added (no new file; harness fixed for the required image variables) |
| backup: `vitest.backup.config.ts` | 93/112 on this Mac | ≈ 11 min | — |

Reds, with my reading:
- image `postgres.test.ts` ×2 (0440 file ownership refusals): Docker Desktop does not enforce bind-mount uid/gid; CI on Linux decides.
- backup: uploader hook and backup/restore timeouts, `drill` ×5, "no mode exits 0": `infra/backup` is unchanged on the branch, so I read these as this Mac's load; CI decides.

## Acceptance criteria

1. Pull-based deploy: T1–T5, T7, T14, T15, T16 (`test_deploy_*.py`).
2. Rollback inside 120 s: T10 (`test_deploy_flow.py`), T-probe, T10q.
3. Quarantine: T10, T10q (S18), T11.
4. Timers and units: `deploy-wiring.test.ts`.
5. Runbook inputs: T12, T13 (`test_deploy_t13.py`); the 60 minutes is POLY-116's.
6. Failing migration file leaves schema unchanged: `tests/db/runner.test.ts` "a failing file leaves schema and tracking unchanged" (already green).
7. Concurrent migrate: T-lock (`runner.test.ts`).

## Open

- T13 as a container case against POLY-99's fake ssh and real restore: not written; the unit version holds the line's grammar against restore's own regexes.
- The ruling's real-render drift check runs in the lint job (`compose-real.test.ts`); it fails, never skips, without the compose plugin only by virtue of the `docker compose` call failing.
