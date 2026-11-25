---
id: POLY-135
title: CI: CodeQL scanning
status: backlog
milestone: POLY-M6
parent: null
blocked_by: []
assignee: devops-engineer
labels: [ci, security]
priority: null
pr: null
created: 2026-11-10
updated: 2026-11-25
---

Add CodeQL scanning to CI. SECURITY C-82 lists it as a target, not a control in force, until this lands. Split out of POLY-102 by the Principal (2026-11-11) because its cost per PR is unmeasured. Source: POLY-96 ruling §7 O4, seceng condition S96-13.

## Acceptance criteria

- [ ] CodeQL runs on PRs and on `main` for the JavaScript/TypeScript and Python code, with pinned actions (C-81).
- [ ] The added minutes per PR are measured on at least two runs and recorded on this issue before the scan joins the required `app` check.
- [ ] SECURITY C-82 states CodeQL as a control in force.

## Comments

### @team-lead — 2026-11-25

From POLY-101 (ruling condition 11, build follow-up F4), for the Principal before prod: a pull request runs its own `ci.yml`, `infra/ci` scripts and tests, so one commit can change code and disarm the gate that checks it; no review is required on `main`. Reach: anyone who can push a branch and merge (the Principal; any session holding his token). Stronger option: required code-owner review on `.github/`, `infra/ci/`, `tests/ci/`, `tests/db/auth-route-policy.test.ts`, `tests/db/auth-routing-pool.test.ts` and `packages/auth/src/boundaries.test.ts`. Cost: a second GitHub identity, since an author cannot approve their own pull request. Not accepted as closed; recorded in `process/DECISIONS.md` (2026-11-25, POLY-101).
