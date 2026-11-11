---
id: POLY-96
title: CI: change filter, build, attest
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [.github/workflows/ci.yml, .github/workflows/build.yml, .github/workflows/release.yml, infra/ci/**, process/cairn/issues/POLY-96.md, process/cairn/reviews/POLY-96/**, tests/**, turbo.json, Dockerfile, .dockerignore, .trivyignore, .gitleaks.toml, package.json, pnpm-lock.yaml, apps/*/package.json, packages/*/package.json, eslint.config.js, layers.json, docs/INFRA/**, docs/SECURITY/**]
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
- [ ] Each timed CI job uploads its timings as an artifact (`ci-test-runs-<job>`) in the `test-runs.jsonl` schema; CI itself writes nothing to the repository. Ingesting those artifacts into `process/cairn/metrics/test-runs.jsonl` and the per-runner `suite_seconds_added` are on POLY-79 (ruling §3, O1; user-approved 2026-11-11).

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

### @architect — 2026-11-10

**Gate 1 — ruling.** `process/cairn/reviews/POLY-96/ruling.md` (this commit) is the gating ruling; seceng-96 S96-1..22 folded (§7).

- Seam (§1–2): ci.yml jobs `changes`, `guard` (pins + S96-7 + gitleaks, always on), `lint`, `unit`, `db`, `image`, aggregate `app` (`if: always()`, fails closed, including a skipped job whose output said run). `cairn` keeps id/name/filter; only S96-7 env moves + `persist-credentials: false`.
- Filter outputs `node`, `layers`, `db`, `image`, `ci`; mapping in `infra/ci/changes.mjs`; dispatch input `base` for real-run probes.
- Tests: `tests/ci/` (own vitest config), run by `lint` on `ci`. Local vs real-run evidence and post-merge confirmation: §6.
- build.yml: push → scan pushed digest → SBOM → attest, no cache, main-ref only; weekly = scan-only. release.yml: `verify` / `publish` split, never builds, `--source-ref refs/heads/main`.
- Criterion 11: CI emits an artifact in the test-runs schema; the ingest half needs a lead decision (§3, O1).
- paths: add `process/cairn/reviews/POLY-96/**`, `docs/SECURITY/**`, `.trivyignore`, `.dockerignore`, `.gitleaks.toml` if needed (§8).
- Open for the lead: O1 ingest, O2 lockfile → battery, O4 CodeQL follow-up id.

### @devops-engineer — 2026-11-10

Stage 1 built @ cd6372e..0183eb1 (ci.yml app family, infra/ci). Dispatch evidence: base=40 zeros -> run 42949055722 changes red, app red. Full run 42949984469: cairn/guard/changes/unit/db/image green, lint red only on the not-yet-built build/release tests in tests/ci. Timings: lint 39s, unit 35s, db 118s, image 22s. Two stale tests fixed on the way: tests/workflow cairn-boundary (one job) and tests/layers structure (one test file per package).

### @architect — 2026-11-10

Addendum 1 (c739d20 apt upgrade): `process/cairn/reviews/POLY-96/ruling.md` → "Addendum 1", this commit. Keeps the upgrade; weekly run is a full rebuild; tags unique per run, digests taken only from `digest.txt`; scan-only on the newest v1.* release; standing no-package-manager rule asserted on the built image. seceng-96 A1–A5 folded.
