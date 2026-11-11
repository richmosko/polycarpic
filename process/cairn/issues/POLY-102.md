---
id: POLY-102
title: CI: generated-output freshness
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-96]
assignee: devops-engineer
paths: [scripts/cairn/check_dist_freshness.py, .github/workflows/ci.yml, infra/ci/**]
labels: [ci, tooling]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-10
---

Generalise the PT-58 freshness pattern (ancestry-based, exclude-list) to the committed generated outputs the infra pipeline adds, such as the ops-bundle manifest, so a stale generated file cannot reach the attested ops bundle.

## Acceptance criteria

- [ ] Touching a source without regenerating fails; regenerating passes.
- [ ] A doc-only PR never flips fresh to stale.
- [ ] Same-second and cross-timezone commits behave (fixtures from the PT-58 tests).

## Comments

### @team-lead — 2026-11-10

Follow-up from POLY-96 (ruling `process/cairn/reviews/POLY-96/ruling.md` §7, O4; seceng condition S96-13): add CodeQL scanning to CI. It was routed out of POLY-96 because it is outside that issue's criteria and its cost per PR is unmeasured. SECURITY v1.9 C-82 lists CodeQL as a target, not a control in force, until this lands. Measure the added minutes per PR before making it part of the required `app` check.
