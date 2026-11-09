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
updated: 2026-11-08
---

Generalise the PT-58 freshness pattern (ancestry-based, exclude-list) to the committed generated outputs the infra pipeline adds, such as the ops-bundle manifest, so a stale generated file cannot reach the attested ops bundle.

## Acceptance criteria

- [ ] Touching a source without regenerating fails; regenerating passes.
- [ ] A doc-only PR never flips fresh to stale.
- [ ] Same-second and cross-timezone commits behave (fixtures from the PT-58 tests).
