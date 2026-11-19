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
updated: 2026-11-18
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
