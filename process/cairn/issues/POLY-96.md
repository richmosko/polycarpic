---
id: POLY-96
title: CI: change filter, build, attest
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [.github/workflows/ci.yml, .github/workflows/build.yml, .github/workflows/release.yml, infra/ci/**, process/cairn/issues/POLY-96.md, tests/**, turbo.json, Dockerfile, package.json, pnpm-lock.yaml, apps/*/package.json, packages/*/package.json, eslint.config.js, layers.json, docs/INFRA/**, docs/SECURITY/**]
labels: [ci, supply-chain]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-10
---

INFRA §4.2–§4.4: a changes step inside the job (no workflow-level paths:), one app aggregate required check, build.yml on push to main (one adapter-node image plus Caddy and tools images, Trivy, CycloneDX SBOM, provenance attestation, GHCR by digest), release.yml on a signed v1.* tag that never rebuilds, the action-pin check (C-81) and a weekly rebuild. Runs the RLS battery on packages/db changes.

## Acceptance criteria

- [ ] A docs-only PR starts no app job, yet app is green; the filter failing fails app closed.
- [ ] packages/* and apps/* changes run lint, types and Vitest on the affected packages (Turborepo graph); packages/db/** adds the DB battery; compose, Dockerfile and infra/** changes run lint and the image build.
- [ ] The digest in the release equals the one built for that commit; release.yml never rebuilds.
- [ ] An unpinned uses: fails the check; Trivy fails on fixable critical or high findings and on embedded secrets.
- [ ] Each affected package's tests run from inside that package (`pnpm --filter <pkg> test`, via Turborepo), never from the root config, so a test relying on another package's setup or on root-only config fails.
- [ ] The lint job runs POLY-82's layer-map checks (`layers.json` vs each package.json, vs ARCH §2.2 `data-consumes`, completeness, acyclic and never-upward). A change to `layers.json` or `docs/ARCH/index.html` runs them even on an otherwise docs-only PR.
- [ ] Branch protection adds app (team-lead, user-approved).
- [ ] Each CI job prints its wall-clock and the per-package test time (Turborepo `--summarize` or equivalent) into the GitHub step summary.
- [ ] Soft budget per job (lint + types ≤ 2 min, per-package Vitest ≤ 2 min, DB battery ≤ 3 min): a job over budget posts a warning annotation, never a failure.
- [ ] The DB battery is one job keyed to `packages/db/**` + `tests/db/**` only, with one Postgres container per run; POLY-84's RLS battery runs inside it, not in a job of its own.
- [ ] CI timings land in `process/cairn/metrics/test-runs.jsonl` so `cairn loop-stats` shows `suite_seconds_added` from CI runs, not only local ones.

## Comments

### @team-lead — 2026-11-10

**Steer from the user at the POLY-83 merge (2026-11-10):** watch how the test suite grows for CI — it will be the longest item if it gets too large and not modular enough per component. Baseline today: the `cairn` check is the only required status and covers tooling alone (15 s path-gated, ~116 s full); the product suites (`tests/db` 93 tests ≈ 45 s on Docker Postgres 17 + pgTAP, `tests/layers`, `pnpm lint`, `pnpm -r typecheck`) run only on qa's machine — zero product coverage in CI until this issue lands.

Add to the acceptance criteria when this is scoped:
- Each CI job prints its wall-clock and the per-package test time (Turborepo `--summarize` or equivalent) into the GitHub step summary, so growth is visible per run without opening logs.
- A soft budget per job (proposed: lint+types ≤ 2 min, per-package Vitest ≤ 2 min, DB battery ≤ 3 min); a job over budget posts a warning annotation, never a failure — the point is to see the curve, not to block on it.
- The DB battery stays one job keyed to `packages/db/**` + `tests/db/**` only; POLY-84's RLS battery joins that job, not a new one — one Postgres container per run.
- `cairn loop-stats` already has a `suite_seconds_added` row; wire the CI timings into `process/cairn/metrics/test-runs.jsonl` so the per-loop scorecard shows suite growth from CI, not only from local runs.

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-96-ci-change-filter-build-attest`. First commit also carries the second-session promotion (POLY-62, 86, 95, 96, 97, 128 → todo; user-approved 2026-11-11).
