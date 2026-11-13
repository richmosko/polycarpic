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
updated: 2026-11-12
---

An umbrella for small CI and test-time items found in the POLY-141 and POLY-87 loops. None blocks a feature; each is taken when the `db` job's same-day median on `main` nears its 100 s warning budget, or when a loop is already in the files concerned. The timing rule these serve: a loop's cost is the branch's battery-step median minus `main`'s at the merge base, same session, at least three runs each (POLY-87 ruling, "Timing guard").

## Acceptance criteria

- [ ] The sign-up test seeds run through the `sql.ts` worker, not one `docker exec psql` per statement, with one owner and entity shared per describe block; `tests/db/auth-signup-invite.test.ts` loses about 3 s of CI file time and no condition (qa-87's analysis, 26.0 s on run 43342512609).
- [ ] The `ci:db` timing record reads the job's wall time; today its clock starts after checkout and reads about 9 s short.
- [ ] A `workflow_dispatch` run with a `base` input runs the cairn filter, so a timing or area run does not pay the full cairn suite (about 110 s) each time.
- [ ] If the `db` job's same-day median on `main` passes 100 s: the serial group runs beside the parallel one on a second Postgres cluster (POLY-141 ruling, criterion-1 tuning), with `ops-hardening`'s timing test re-measured under contention.

## Comments

### @team-lead — 2026-11-12

From the POLY-142 loop (`process/cairn/reviews/POLY-142/build-gate-qa.md` @ 1e8868c; architect verdict @ b168176): `tests/db/operator-invite.test.ts` runs 12.4 s as a file against the ruling's 7 s estimate, and the db battery median moved +7 s locally (57 s against 50 s on main, n = 3). The architect's suggestion: one cloned database and one fewer child process. Candidate for this umbrella.
