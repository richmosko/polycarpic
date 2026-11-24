---
id: POLY-162
title: Deploy test passing end to end
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-162.md, process/cairn/reviews/POLY-162/**, infra/**, .github/workflows/**, Dockerfile, apps/web/**, tests/**, docs/INFRA/**, docs/ARCH/**, docs/SECURITY/**, package.json, pnpm-lock.yaml, packages/*/package.json, layers.json, eslint.config.js, process/STATE.md, process/DECISIONS.md]
labels: [ops, deploy]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-24
---

POLY-100 merged the pull-based deploy without a completed real deploy: its end-to-end test (T-real, `tests/infra/deploy-real/`) is on `main` with its CI step switched off. This issue makes a real first deploy work and switches the step on. Cut out of POLY-100 by the Principal's decision of 2026-11-24 (`process/DECISIONS.md`): no more scope there. Rulings already written and security-reviewed are in `process/cairn/reviews/POLY-100/ruling.md` (G13, G14, G15, T-real, S38, S41, S42); devops-engineer's commits for G13/G14 and its half of G15 are kept on branch `feature/poly-162-deploy-test-passing`. Must be done before the first staging deploy (POLY-104).

## Acceptance criteria

- [ ] G13: `provision --stage database` creates the `polycarpic` database from `template0` when it is missing.
- [ ] G14: every service's command and entrypoint are pinned in the compose files, the guard and the lint; the worker runs `worker`.
- [ ] G15: the minimal health listener in `web` (`GET /api/v1/health` on 3000, a fixed 404 for all else, seceng's conditions S42), and web's compose healthcheck on the health path requiring 200. Builder: backend-lead for `apps/web`.
- [ ] T-real passes in CI on its narrow trigger, with its rollback case, started from an unreadable directory holding a hostile `.env`; its CI step is switched on.
- [ ] T-real's measured time is recorded; if the `image` job exceeds 17 of its 20 minutes, T-real moves to its own job.
- [ ] Every product fault T-real finds on the way is fixed here or filed, each with a test shown red on the fault.

## Comments

### @team-lead — 2026-11-23

Conditions from seceng on POLY-100's scope cut (2026-11-24, `process/cairn/reviews/POLY-100/build-review.md`): (1) no `v1.*` or `edge-*` tag is pushed until this issue is done; without G14 the worker container, which holds the credential keyring, runs the image's default `web` command. (2) T-real's CI step is off by a literal condition held by a tests/ci pin; switching it on is this issue's change, with the pin. (3) POLY-100's merge is `build.yml`'s first real run with the `siblings` and `release-lint` jobs: its result is read before anything else lands on `main`; a fault there is fixed here or in POLY-160. qa's findings from the local T-real runs: `.claude/worktrees/qa-100/temp/2026-11-24-qa-100-treal-findings.md` at the time of writing (qa copies the content into this issue before teardown).

### @qa-100 — 2026-11-23

From qa-100 (POLY-100 gate, a9d35481). What the real-Linux run of T-real found, with the container recipe and the G15 test file, in `process/cairn/reviews/POLY-100/`: `treal-findings.md`, `treal-local-container.md`, `public-health.test.ts.txt`.

Still open for this issue (each stops a first deploy from going healthy on a real box):
- G13: nothing creates the database `polycarpic`; `provision --stage database` fails on a fresh cluster.
- G14: `worker` has no `command: ["worker"]` in staging.yml and prod.yml; it runs the image's `web` and restart-loops on config.refused.
- G15: web serves nothing on :3000 (status listener only, 127.0.0.1:8081); the compose healthcheck and the tool's `/api/v1/health` probe cannot pass, so a first deploy ends rollback-unhealthy.

Already fixed on the POLY-100 branch: Docker 29's lowercase `no such object` (G4), a fresh Postgres giving plan-error instead of roles-missing (G12), Compose 2.40's `create_host_path` (one pinned Compose, G10), the caller's directory deciding the render (G11).

How to iterate: the privileged Ubuntu container recipe runs T-real in 2-3 minutes per loop on the Mac; CI is for confirming. T-real's files, the `deploy` key and its classifier pins are on the POLY-100 branch; its CI steps are on feature/poly-162-deploy-test-passing.

### @team-lead — 2026-11-24

Feature started. Branch: `feature/poly-162-deploy-test-passing` (the three kept devops commits, with `main` merged in at d54aedc6). No new ruling stage: G13, G14, G15, T-real and S38/S41/S42 are already ruled and security-reviewed in `process/cairn/reviews/POLY-100/ruling.md`. Sub-issues: a (qa, tests), b (devops, ops build), c (backend, health listener), d (seceng, build review), e (architect, verdict).
