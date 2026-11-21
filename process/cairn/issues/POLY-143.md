---
id: POLY-143
title: CI and test-time follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
labels: [ci, tooling]
priority: null
pr: null
created: 2026-11-12
updated: 2026-11-21
---

An umbrella for small CI and test-time items found in the POLY-141 and POLY-87 loops. None blocks a feature; each is taken when the `db` job's same-day median on `main` nears its 100 s warning budget, or when a loop is already in the files concerned. The timing rule these serve: a loop's cost is the branch's battery-step median minus `main`'s at the merge base, same session, at least three runs each (POLY-87 ruling, "Timing guard").

## Acceptance criteria

- [ ] The sign-up test seeds run through the `sql.ts` worker, not one `docker exec psql` per statement, with one owner and entity shared per describe block; `tests/db/auth-signup-invite.test.ts` loses about 3 s of CI file time and no condition (qa-87's analysis, 26.0 s on run 43342512609).
- [ ] The `ci:db` timing record reads the job's wall time; today its clock starts after checkout and reads about 9 s short.
- [ ] A `workflow_dispatch` run with a `base` input runs the cairn filter, so a timing or area run does not pay the full cairn suite (about 110 s) each time.
- [ ] If the `db` job's same-day median on `main` passes 100 s: the serial group runs beside the parallel one on a second Postgres cluster (POLY-141 ruling, criterion-1 tuning), with `ops-hardening`'s timing test re-measured under contention.
- [ ] The host-psql fallback in `tests/db/helpers/pg.ts` either checks for psql >= 16 or is removed: the POLY-147 helpers use `\bind`, CI runs psql inside the Postgres image (17.x), and a developer's host psql can be older (14 on the Principal's machine).
- [ ] `tests/infra/image` is explained on macOS: on 2026-11-15 two local runs on the POLY-148 branch (which changes nothing those tests read) failed different tests each time (a 10 s hook timeout in `postgres.test.ts` and a 5 s timeout in `caddy.test.ts`; then three permission and `archive_command` assertions in `postgres.test.ts`). No control was run on `main`, and CI skipped the `image` job for that PR. Either the suite is made reliable locally or the difference from Linux is written down.

## Comments

### @team-lead — 2026-11-12

From the POLY-142 loop (`process/cairn/reviews/POLY-142/build-gate-qa.md` @ 1e8868c; architect verdict @ b168176): `tests/db/operator-invite.test.ts` runs 12.4 s as a file against the ruling's 7 s estimate, and the db battery median moved +7 s locally (57 s against 50 s on main, n = 3). The architect's suggestion: one cloned database and one fewer child process. Candidate for this umbrella.

### @team-lead — 2026-11-15

Follow-up from POLY-147 (merged via PR #127) added to the list above; source: `process/cairn/reviews/POLY-147/` (ruling, security-review, verdict) and devops-147's findings.

### @team-lead — 2026-11-15

Follow-ups from POLY-148 (merged via PR #129) added above; source: `process/cairn/reviews/POLY-148/spike.md` (§1, §2, §6 and seceng's reading in §7).

### @team-lead — 2026-11-16

From the POLY-89 loop (merged 2026-11-17, PR #131). (1) `ops-status` (30 tests) and `ops-hardening` (3) fail on a fresh checkout with `Failed to load tsconfig '$app/tsconfig': Tsconfig not found` (apps/web/src/ops/status.ts): `.svelte-kit/tsconfig.json` comes from `svelte-kit sync`, which a fresh worktree lacks. Run the sync before `tests/db`. (2) POLY-89 added about 17 s (32%) to the db suite: 70 s against 53 s on main, same day, two runs each, for 147 more tests in 4 files. Two of those files run serial because they share the poly_auth fixture role.

### @team-lead — 2026-11-18

From POLY-152 and PR #134:
- **N5 (second sighting):** `svelte-kit sync` has to run before `tests/db` in a fresh worktree.
- **Re-check by 2026-12-17:** the dependency audit ignores GHSA-fc5q-39xc-vjpf (`picomatch`, no patched release; `process/DECISIONS.md` 2026-11-17). `tests/ci/audit-exemption.test.ts` fails after that date. On or before it: check for a fixed release, then remove the `auditConfig.ignoreGhsas` entry in `pnpm-workspace.yaml` or move the date with a note here.
- seceng's note on PR #134: the pin checks that the audit step and the guard step carry the same condition; narrowing both together would pass it.

### @team-lead — 2026-11-18

**Test Postgres containers leak (Principal asked for a long-term fix, 2026-11-18).** On 2026-11-18 the dev machine had 24 `poly83-qa-*` containers running, 13 of them between 30 hours and 5 days old (removed by hand, with `poly147-bench`); 11 more were left by one loop's runs within 25 minutes.

Diagnosis, from reading the code (not yet reproduced):
- `tests/db/helpers/pg.ts:42-53` starts `docker run -d --rm --name poly83-qa-<random>` and returns a `stop()`. The container is removed only if that `stop()` runs.
- Callers: `tests/db/global-setup.ts:15`, `tests/db/bench/global-setup.ts:8`, `apps/web/tests/e2e/serve.ts:24`. Nothing stops the container when the process is killed (a tool timeout, a cancelled run, a teammate shutdown, Playwright killing `serve.ts`), and `serve.ts` can throw between `startServer()` and its first `stop()` (it did this loop: the seed check at line 51 throws with the container already up).
- The name is random and the container carries no label, so nothing can tell a live run's container from an orphan, and nothing reaps.

Criteria for the fix (one change in `tests/db/helpers/pg.ts` plus its callers; qa-engineer owns the harness):
- [ ] Every harness container carries labels: a fixed marker, the owner's pid and start time, and the checkout path.
- [ ] `startServer()` first removes labelled containers whose owner pid is no longer alive on this host; a test starts an orphan (owner pid dead) and shows the next start removes it, and shows a container with a live owner is left alone.
- [ ] The container ends on its own when its owner dies, even on SIGKILL: either a hard lifetime (for example 2 hours) or a lifeline the container watches. A test kills the owner with SIGKILL and shows the container gone within the stated time.
- [ ] `stop()` is registered for exit, SIGINT and SIGTERM as soon as the container starts, and `serve.ts` cannot throw past it; a test makes the seed check throw and shows no container left.
- [ ] `poly147-bench` and any other fixed-name container get the same treatment.
- [ ] A one-line `pnpm` script removes every labelled orphan; the team-lead runs it at loop close.
- [ ] CI is unaffected (`POLY_TEST_PG_URL` path starts no container).

### @team-lead — 2026-11-19

From the POLY-149 loop (`process/cairn/reviews/POLY-149/gate.md`, verdict N3). Four additions:
- **The db suite is 28% slower.** 76 s on `main` (902 tests) to 97 s (1,059 tests) locally, one control and one branch run at low load; CI's `db` job went from 2 min 22 s to 3 min 12 s. `tests/db/second-step-lock.test.ts` is the largest addition (eight nine-lock sequences of real sign-ins on two paths). Look for a cheaper way to reach a lock in a test.
- **Parallel suites overload the machine.** With three teammates running db suites at once the load average reached 32 to 63; runs took 1,048 s and hit 60 s timeouts, test Postgres failed to become ready, and containers vanished mid-run. All passed on a quiet machine. A gate must be measured alone; consider a lock or queue so only one db suite runs at a time.
- **The e2e server leaks its container every run.** `apps/web/tests/e2e/serve.ts` left one `poly83-qa-*` container after each of three gate runs (the leak already described above).
- **Typecheck in a local gate is mostly cache.** 18 of 19 packages came from the turbo cache; say so in gate.md or force a clean run.

### @team-lead — 2026-11-20

From POLY-150 (merged 2026-11-20, PR #141). First to fix: CI's `unit` job went from 1 min 46 s to about 5 min 24 s.

1. **Sign-in limiter waits.** The e2e suite waits about nine times for the 5-per-minute sign-in limit: 2.3 to 2.7 min locally, 4.3 min on the runner (80 tests). It grows with every sign-in test.
2. **Leaked containers.** The e2e server leaves one `poly83-qa-*` container per run; six were left by one teammate in one sitting.
3. **"Too many clients".** `tests/db/helpers/sql`'s `must` keeps one open client per database, so a file that clones per plant hits the limit. `gate-check.test.ts` moved to the psql helper; others may hit it.
4. **Failure output is wiped.** A failed e2e run's output in Playwright's `test-results/` is overwritten by the next run. Keep failures somewhere that is not overwritten. Kit's passkey re-check test failed once on 2026-11-20 and its cause is unproven for this reason.
5. **Dev tools on `latest`.** The root `package.json` asks for `latest`, so an install in a feature branch moves them unasked (this loop: eslint 10.15.0, turbo 2.11.13, vitest 5.1.1, minimatch 11.0.9; CI ran vitest 5.1.1 while the local gate ran 5.1.0). Pin them exactly.
6. **Hand-pinned route count.** `infra/ci/image.sh` pins the auth route count (49 to 52 this loop) and only CI runs it. Derive it, or pin it in `tests/ci` beside route-policy-shape so the local gate catches it.
7. **Seam test cold import.** `apps/auth/src/seam.test.ts` timed out at 5 s on the runner; it now imports once in `beforeAll`. Watch it.
8. **gitleaks.** `tests/db/second-step-screens.test.ts:306` writes a literal dummy auth secret that the `generic-api-key` rule flags; one fingerprint is in `.gitleaksignore` (seceng build-review §7, SECURITY C-82). Replace the literal with a generated value. Run gitleaks in the local gate or pre-push so a finding shows before the PR opens, and have the CI step print the rule, file and line with the value redacted.
9. **Push guard.** `cairn guard-push` checks the sub-issue's paths, not the parent's, so a file added to the parent alone is refused. A teammate ran the guard and the push in one step and the push went out past the refusal. Make the push depend on the guard's exit code.

### @team-lead — 2026-11-21

From the POLY-138 loop (2026-11-21): `tests/db/auth-routing-pool.test.ts` "a timer scheduled inside withSession that calls connect() after commit rejects" failed once on CI (run 44925366365, promise resolved where a rejection was expected) and passed on the re-run of the same commit and on every run since. Timing-dependent; find the race or widen the test's wait.
From POLY-137: the db suite is about 30 s slower (148 s against 138, 116 and 114 s on a same-day control, which carried 33 fast environmental failures); accepted by the architect at 0.14 s per added test. The 33 `ops-status` and `ops-hardening` failures on a tree without `svelte-kit sync` are worth a clearer error.
