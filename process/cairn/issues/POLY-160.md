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
updated: 2026-11-23
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

GATE, by the Principal's decision of 2026-11-24 (`process/DECISIONS.md`): seceng's third-review finding H1 (`process/cairn/reviews/POLY-100/build-review.md` @ 8a873388) was accepted into this issue although it is in the class that held POLY-100's PR ("leaves a bad release running"). After an interrupted deploy (power cut, kill), a Compose-version mismatch or a missing token makes the next run refuse before it restores, so the unjudged release keeps running with a red alert; and Ctrl-C in a hand run clears the `interrupted` mark, which `edge-deploy`, having no poll, never recovers from. Fix: recovery runs before the Compose and token checks, and the mark is kept. Red-first test and mutant. This is a gate, not an option: nothing is deployed until it is fixed. Also here from that review: H2–H10, with H3 (a failed save on a first deploy can leave prod's backup timers off) to be fixed before the first prod deploy; and the architect's finding that `bash provision.sh` by a relative path resolves under `/` after its `cd /`.
