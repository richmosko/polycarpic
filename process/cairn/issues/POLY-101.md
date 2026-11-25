---
id: POLY-101
title: CI: auth route-policy row
status: done
milestone: POLY-M1
parent: null
blocked_by: [POLY-96, POLY-86]
assignee: devops-engineer
paths: [.github/workflows/ci.yml, infra/ci/**, tests/ci/**, packages/auth/src/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, process/cairn/issues/POLY-101.md, process/cairn/reviews/POLY-101/**, tests/db/auth-route-policy.test.ts, scripts/layers/**, tests/layers/**, eslint.config.js]
labels: [ci, security]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/158
created: 2026-11-08
updated: 2026-11-25
---

ARCH §8 / SECURITY A-34: the CI row that runs on packages/auth/**, packages/tenancy/** and any better-auth or @better-auth/passkey version change. It runs the route-policy test, the routing-pool test and the drizzleAdapter lint that POLY-86 writes, so a dependency-bot bump cannot merge without them.

## Acceptance criteria

- [x] A PR that bumps better-auth and adds an unclassified route fails; the same PR with the route classified passes. Proof: `tests/db/auth-route-policy.test.ts`, control "the predicate names both synthetic routes against AUTH_ROUTES, and nothing once both are listed"; no newer version was installed (reviews/POLY-101/gate.md).
- [x] The job is part of the app aggregate check. Proof: `tests/ci/aggregate.test.ts`, "the auth row cannot be skipped" (`lint` or `db` skipped with its key true is red); the PR's own `app` run is still to come.

## Comments

### @team-lead — 2026-11-25

Feature started. Branch: `feature/poly-101-ci-auth-route-policy-row`. Sub-issues a to e (ruling, security review, tests, build, verdict), estimate $16. The lead decides and merges under the Principal's delegation of 2026-11-25 (same grant as POLY-160, given for this loop).

### @team-lead — 2026-11-25

PR opened: https://github.com/richmosko/polycarpic/pull/158. Awaiting the PR's own CI run and the final verdict lines.

### @team-lead — 2026-11-25

Validate passed (seceng PASS at ae693858, architect PASS at ecee6edc, PR run 45664122857 green on rerun); merging via PR #158. Closing.
