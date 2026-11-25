---
id: POLY-160
title: Deploy follow-ups
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-160.md, process/cairn/issues/POLY-165.md, process/cairn/issues/POLY-104.md, process/cairn/reviews/POLY-160/**, infra/**, .github/workflows/**, Dockerfile, packages/db/**, packages/*/package.json, apps/*/package.json, tests/**, docs/INFRA/**, docs/ARCH/**, docs/SECURITY/**, package.json, pnpm-lock.yaml, pnpm-workspace.yaml, layers.json, eslint.config.js, scripts/layers/**, .gitleaksignore, .gitignore, process/STATE.md, process/DECISIONS.md]
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-24
---

The lesser findings from POLY-100's third build review, and other deploy items POLY-100 deferred. By the Principal's decision of 2026-11-24 (`process/DECISIONS.md`), POLY-100's third review holds the PR only for a fault that lets an unverified release run, bypasses the compose guard, loses or exposes data, or leaves a bad release running; every other finding lands here. This issue must be done before the first staging deploy (POLY-104). seceng reviews the ruling and the build. Add later deploy nits here rather than filing one issue each.

## Acceptance criteria

- [ ] Every item of the Principal's scope cut (last scope comment) is fixed as `process/cairn/reviews/POLY-160/ruling.md` rules, each with a test shown red on the fault.
- [ ] The end-to-end deploy test (T-real) passes, and the `deploy-real` job's measured CI time is recorded against its 15-minute limit.
- [ ] Postgres restarted under the running services: web, auth and the worker stay up, and health recovers.

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

### @team-lead — 2026-11-24

Items placed here from the POLY-161 loop (2026-11-25). Sources: `process/cairn/reviews/POLY-161/ruling-review.md`, `build-review.md`, `gate.md`.
- **Before the first staging deploy (backend-lead builds): no pool in `packages/db` has an `error` listener.** An idle pool client's 'error' is unhandled, so `web` exits 1 (`process.crash`) when Postgres drops its connections; by seceng's reading `auth` and the worker have the same fault. A database restart takes each service down until compose restarts it, and each restart of web runs the zone check again, so a Postgres restart during a zone outage keeps web down. Fix it in the pool, once, for a checked-out client's error as well as an idle one's. A test: restart Postgres under a running service; the process stays up and health recovers. Found by qa-161 on the built server. seceng found no request by which a stranger makes Postgres drop a `poly_app` connection.
- **With U1:** unpinned environment keys now reach the whole web app, not a health path (`NODE_OPTIONS` in `environment`; it can also choose the `types` condition of web's `#web-build` import). Same attested commit; not new reach.
- **The weekly re-scan of the published image cannot see bundled packages;** make it read the bundle's package list kept in the image (`build/packages.json`, POLY-161 R14). Until then the check after release is the lockfile audit, which runs on PRs only.
- **Make bits-ui a dev dependency,** so `svelte` and `@sveltejs/acorn-typescript` leave the runtime install and the image check's `@sveltejs` allow-list becomes empty (seceng's S9 ruling).

### @team-lead — 2026-11-24

**Scope cut by the Principal, 2026-11-25** (`process/DECISIONS.md`; it amends the 2026-11-24 decision that every item here precedes POLY-104). This issue now holds only what must be true before the first staging deploy; the prod and real-data gates moved to their own umbrella in POLY-M6 (see the issue blocked by this one), which blocks POLY-164. What stays here, from the architect's reading (`architect-m1r`, 2026-11-25):
- **H1** (the Principal's gate): recovery runs before the Compose and token checks, the `interrupted` mark is kept, `edge-deploy` included.
- **The pool `error` listener** in `packages/db` (backend-lead builds): a Postgres restart must not take web, auth and the worker down.
- **H2:** a wrong `current` after a failed state save, where a later rollback brings up a quarantined release. **H4 and H5:** a post-`up` refusal retried every poll, a double crash, a slow or hung `check-config`, `rel.log` raising; each can stop staging's poll silently. H2, H4 and H5 are the architect's additions with no gate text of their own; they share H1's functions.
- `provision.sh`'s relative path and H6's `--project-directory`, both exercised by POLY-104.
- INFRA §4.4 to §4.6 and the Ctrl-C runbook line; the end-to-end deploy test green with its time recorded.
Read the acceptance criteria above against this list: the third (`self-update`) and every "follow-up" finding that gates prod are no longer this issue's.

### @team-lead — 2026-11-24

Feature started. Branch: `feature/poly-160-deploy-follow-ups`. Scope is the Principal's cut of 2026-11-25 (the comment above): H1, the pool `error` listener, H2, H4, H5, `provision.sh`'s relative path, H6's `--project-directory`, INFRA §4.4 to §4.6 with the Ctrl-C runbook line, and T-real green with its time recorded. The Principal delegated this loop's decisions and the merge to the lead (2026-11-25); each decision is recorded in `process/DECISIONS.md` as taken.
