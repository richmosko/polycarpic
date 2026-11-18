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
