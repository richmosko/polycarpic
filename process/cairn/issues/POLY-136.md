---
id: POLY-136
title: CI and migration-check follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
labels: [ci, tooling]
priority: null
pr: null
created: 2026-11-10
updated: 2026-11-10
---

A batch of small follow-ups from the POLY-96 and POLY-102 loops. None gates a feature.

## Acceptance criteria

- [ ] Journal ↔ file check in `packages/db/src/migrations-check.ts` (`checkFolder`): every `.sql` and `meta/*_snapshot.json` has its journal entry and the reverse. Today a stray migration file outside the journal is caught by nothing; it never runs, but it misleads review (POLY-102 ruling, Addendum 1).
- [ ] `infra/ci/aggregate.mjs` cross-checks one job per filter output; a mis-wired `lint` `if:` for `node`/`image` is caught only by the static ci-workflow test, not at run time (POLY-96 verdict, A-2).
- [ ] `image-<commit>` artifacts are kept 90 days; a tag cut later finds no digest and publishes nothing. Document it in the release runbook or look the digest up from the attestation (POLY-96 verdict, A-3; may land as one line on POLY-100).
