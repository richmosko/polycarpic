---
id: POLY-160
title: Deploy follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: devops-engineer
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-24
---

The lesser findings from POLY-100's third build review, and other deploy items POLY-100 deferred. By the Principal's decision of 2026-11-24 (`process/DECISIONS.md`), POLY-100's third review holds the PR only for a fault that lets an unverified release run, bypasses the compose guard, loses or exposes data, or leaves a bad release running; every other finding lands here. This issue must be done before the first staging deploy (POLY-104). seceng reviews the ruling and the build. Add later deploy nits here rather than filing one issue each.

## Acceptance criteria

- [ ] Every finding seceng's third build review of POLY-100 marks "follow-up" (`process/cairn/reviews/POLY-100/build-review.md`) is fixed, each with a test shown red on the fault.
- [ ] The end-to-end deploy test (T-real) still passes, and its measured CI time is recorded against the image job's 20-minute limit.
- [ ] `self-update` installs the ops bundle from the attested release (POLY-98 R-b; POLY-100 ruling §L2), or is given its own issue with the reason.

## Comments

### @team-lead — 2026-11-23

Items placed here from the POLY-100 loop, 2026-11-24, beyond seceng's third-review list:
- **Docker's repository and automatic security updates** (seceng, architect; unmeasured): check on the first real box whether unattended-upgrades covers Docker's own apt repository. If it does not, fixes to the Docker engine and runc do not arrive by themselves, and the containment of staging from prod on the shared box (SECURITY R-4) leans on them. Measure it; if uncovered, fix it before any real household data.
- **A Renovate rule for the pinned Compose version file** (ruling G10, S40), so a Compose security fix is proposed as a PR; the monthly window checks for one meanwhile.
- **One-off containers "gone" by listing, not by message text** (devops-100): replace the case-insensitive match on `docker inspect`'s error with `docker ps -a --filter name=…` returning nothing, so a future rewording by Docker cannot stall deploys.
- **A wrong `current` after a failed state save** (architect finding 1; seceng: FOLLOW-UP, shown on the harness): a later rollback can bring up a quarantined release; and on a first deploy the release runs with its timers, prod's backup timers included, not enabled and a rerun refused `already-deployed`. Fix before the first prod deploy.
- **A post-`up` refusal that does not quarantine is retried every poll** (seceng), so `up` and rollback repeat every five minutes.
- **T-real's undo script is not in T-real's trigger list** (architect's omission).

### @team-lead — 2026-11-23

Principal's decision of 2026-11-24 (`process/DECISIONS.md`): two of the items above are gates before any real household data, not optional follow-ups. (1) An automatic PR when a new Compose version is released (a Renovate rule on `infra/deploy/compose-version`), proven by T-real on that PR. (2) Measured on a real box: automatic security updates cover Docker's own apt repository for the engine and runc; if not, make them. seceng also owes a written assessment of the alternative the Principal did not have time to weigh: pin the minor version and let patch releases install automatically.

### @team-lead — 2026-11-23

GATE, by the Principal's decision of 2026-11-24 (`process/DECISIONS.md`): seceng's third-review finding H1 (`process/cairn/reviews/POLY-100/build-review.md` @ 8a873388) was accepted into this issue although it is in the class that held POLY-100's PR ("leaves a bad release running"). After an interrupted deploy (power cut, kill), a Compose-version mismatch or a missing token makes the next run refuse before it restores, so the new release, which passed verification and the compose guard but was never shown healthy, keeps running with a red alert; and Ctrl-C in a hand run clears the `interrupted` mark, which `edge-deploy`, having no poll, never recovers from. Fix: recovery runs before the Compose and token checks, and the mark is kept. Red-first test and mutant. This is a gate, not an option: nothing is deployed until it is fixed. Also here from that review: H2–H10, with H3 (a failed save on a first deploy can leave prod's backup timers off) to be fixed before the first prod deploy; and the architect's finding that `bash provision.sh` by a relative path resolves under `/` after its `cd /`.

### @team-lead — 2026-11-23

From the architect's verdict (`process/cairn/reviews/POLY-100/verdict.md` @ 82b8b1c2, "For POLY-160", items 1–8), so none is lost: (2) a crash between `_healthy`'s pointers and clearing `in-progress`, twice, quarantines the running digest; (3) a slow `check-config` is a quarantine; (4) `rel.log` in the `Transient` handlers can raise on a full disk, leaving no `transient-since` and no alert; (5) `infra/ci/deploy-real-undo.sh` is outside the `deploy` trigger; (7) INFRA §4.4, §4.5 and §4.6 do not match the code under H1, and the runbook should say that after Ctrl-C in `edge-deploy` the operator runs `edge-deploy` again, not `rollback` (by reading, not run); (8) re-measure the provision CI job against a same-day control: the budget is not established (qa read +91 s against the 60 s allowance on two runs). Items 1 (H2) and 6 (`provision.sh` by a relative path) are already above.

### @team-lead — 2026-11-24

Items placed here from the POLY-162 loop (2026-11-24). Sources: `process/cairn/reviews/POLY-162/build-review.md` (seceng, U1-U5), `verdict.md` (architect, follow-ups 1-4), `gate.md` (qa).
- **Done in POLY-162, strike from this issue:** T-real's undo script is in T-real's trigger list; `infra/ci/install-compose.sh` joined it too (seceng U4).
- **U1, before the first prod deploy and any `v1.*` tag:** pin every service's `healthcheck`, and refuse environment keys outside a per-service list (the `NODE_OPTIONS`, `LD_PRELOAD`, `PG*`, `RCLONE_*` class). Measured by seceng: `NODE_OPTIONS=--import=data:…` in `environment` passes the guard's service check for every app service, the worker included. The compose file comes from the same attested commit as the image.
- **U2:** the lint holds its own copy of the G14 and web-health values beside `compose-allow.json`; read them from the one file. With it: committed guard cases for prod's `backup` and `uploader` and for caddy (only staging's services have them; the lint covers every service), and the lint comparing web's whole healthcheck object, not `test` alone (architect D2).
- **U3:** no test runs the undo and looks at what is left.
- **A candidate whose `check-config` hangs** blocks the poll for the tool's full 600 s before `refused check-config` (qa, T-real part 2).
- **T-real's rollback lower bound** (poll ≥ 120 s) has no red of its own: shortening the tool's window fails on `rollback-unhealthy` first (`faulted-runs.md`).
- **In CI the sweep's "absent input fails" never fires**, because the workflow creates both logs first; the missing-secret-list refusal does (seceng, accepted).
- **For POLY-104:** T-real's fake `gh` attests; real attestation is first shown on staging (U5).
