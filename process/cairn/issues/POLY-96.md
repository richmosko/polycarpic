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

- [x] A docs-only PR starts no app job, yet app is green; the filter failing fails app closed. — tests/ci/aggregate.test.ts: docs-only green / changes failed -> red / output=true but job skipped -> red; tests/ci/changes.test.ts: docs paths -> all false, empty input fails closed; real runs 42954075715 (docs-only: only changes/guard/cairn/app, app green) and 42953489577 (zero base: changes red, app red)
- [x] packages/* and apps/* changes run lint, types and Vitest on the affected packages (Turborepo graph); packages/db/** adds the DB battery; compose, Dockerfile and infra/** changes run lint and the image build. — tests/ci/changes.test.ts: packages/apps/Dockerfile/compose/infra rows; tests/ci/ci-workflow.test.ts: lint, unit, db, image gated on their outputs, `turbo run test --affected`; real run 42953687382 (full, 8/8 green)
- [x] The digest in the release is an attested one built from that commit on `main` by build.yml (the newest successful run at tag time, read from `digest.txt`, never from a tag); release.yml never rebuilds. (Amended per ruling Addendum 1: a commit can carry several attested digests.) — tests/ci/release.test.ts: release-lookup.sh happy path / no build run / label mismatch / attestation failure, release.yml never rebuilds, publish unreachable on dispatch; tests/ci/build-workflow.test.ts: one build-step digest for scan, SBOM, attestations, digest.txt — real digest match confirmed post-merge (ruling §6)
- [x] An unpinned uses: fails the check; Trivy fails on fixable critical or high findings and on embedded secrets. — tests/ci/pins.test.ts: tag/branch/short-sha/no-comment/docker-without-digest rejected, real .github pinned; tests/ci/build-workflow.test.ts + infra/ci/image.sh: Trivy CRITICAL,HIGH, --ignore-unfixed, secret scanner; local negative scans (fake-secret image, alpine:3.12) both exit 1
- [x] Each affected package's tests run from inside that package (`pnpm --filter <pkg> test`, via Turborepo), never from the root config, so a test relying on another package's setup or on root-only config fails. — tests/ci/ci-workflow.test.ts: unit runs `turbo run test --affected --summarize`, then only the tests/config root suite; tests/layers/structure.test.ts: each package's vitest runs alone from its own directory
- [x] The lint job runs POLY-82's layer-map checks (`layers.json` vs each package.json, vs ARCH §2.2 `data-consumes`, completeness, acyclic and never-upward). A change to `layers.json` or `docs/ARCH/index.html` runs them even on an otherwise docs-only PR. — tests/ci/ci-workflow.test.ts: lint runs layers check, tests/layers and the layer-check step gated on `layers`; tests/ci/changes.test.ts: layers.json / docs/ARCH alone -> `layers` only
- [ ] Branch protection adds app (team-lead, user-approved). — lead action after merge, user-approved
- [x] Each CI job prints its wall-clock and the per-package test time (Turborepo `--summarize` or equivalent) into the GitHub step summary. — tests/ci/report.test.ts: step summary shows job wall-clock and per-package test time; tests/ci/guards.test.ts: record -> upload -> summary order; real run 42953687382
- [x] Soft budget per job (lint + types ≤ 2 min, per-package Vitest ≤ 2 min, DB battery ≤ 3 min): a job over budget posts a warning annotation, never a failure. — tests/ci/report.test.ts: over budget -> ::warning and exit 0, within budget silent, db 180 s, package test 120 s; budgets.json holds the ruled values
- [x] The DB battery is one job keyed to `packages/db/**` + `tests/db/**` only, with one Postgres container per run; POLY-84's RLS battery runs inside it, not in a job of its own. — tests/ci/changes.test.ts: db keyed to packages/db and tests/db only (lockfile does not set it); tests/ci/ci-workflow.test.ts: one db job, no service container, db gated on `db` alone
- [x] Each timed CI job uploads its timings as an artifact (`ci-test-runs-<job>`) in the `test-runs.jsonl` schema; CI itself writes nothing to the repository. Ingesting those artifacts into `process/cairn/metrics/test-runs.jsonl` and the per-runner `suite_seconds_added` are on POLY-79 (ruling §3, O1; user-approved 2026-11-11). — tests/ci/report.test.ts: JSONL line follows the test-runs schema (who=ci, runner=ci:<job>), full only on a full dispatch; tests/ci/ci-workflow.test.ts: ci-test-runs-<job> artifact, 30 days

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

### @devops-engineer — 2026-11-10

Build green, all three stages, final code head 5c5ffff (tests/ci 150/150). Real runs on 5c5ffff: fail-closed base=40 zeros 42953489577 (changes red; guard, cairn green; app red); full 42953687382 all 8 jobs green (changes 27s, guard 9s, unit 31s, image 32s, lint 59s, db 146s of 180, cairn 102s; no budget warning). Docs-only run follows on the next head. bash 3.2 fix for image.sh scan in 5c5ffff. Post-merge per ruling 6: build.yml run, sha-<commit>-<run_id> in GHCR, gh attestation verify, release.yml dry run; RELEASE_SIGNERS variable needed before a real v1.* tag.

### @architect — 2026-11-10

**Gate 4 — verdict: PASS (merge-ready), with post-merge confirmations per ruling §6.** Reviewed @ cbcb54e (code 5c5ffff) against ruling.md + Addendum 1. `tests/ci` 150/150 locally (`pnpm exec vitest run -c tests/ci/vitest.config.ts`).

| axis | result | evidence |
|---|---|---|
| C1 docs-only → app green, filter fail → app red | pass | dispatch base=5c5ffff on cbcb54e (issue-file-only diff): run 42954075715, lint/unit/db/image skipped, app green; base=40 zeros: 42953489577, changes red → app red |
| C2 path → job routing | pass | `infra/ci/changes.mjs` table = ruling §2; `if:` per §1; full run 42953687382 all 8 jobs green |
| C3 release digest from digest.txt, never rebuilds | pass pre-merge; real run post-merge | release.yml: no build/push/install, no `packages: write`, `publish` push-only; `release-lookup.sh` reads the newest successful main run, label check, verify with `--source-ref refs/heads/main --deny-self-hosted-runners`; tests/ci/release.test.ts |
| C4 pins + Trivy | pass | `guard` always on (pins, S96-7 run-expr, gitleaks sha256-pinned); Trivy pinned + sha256, `vuln,secret` CRITICAL/HIGH `--ignore-unfixed --exit-code 1`, `.trivyignore` expiry enforced; image job green on the real image after c739d20 |
| C5 per-package tests | pass | `turbo run test [--affected]` → each package `vitest run` in its own dir; cross-package suites only by their own `-c` config |
| C6 layer-map checks | pass | lint step on `layers \|\| node`; `layers` keyed to layers.json, docs/ARCH/index.html, scripts/layers, package.json files |
| C7 branch protection | open | lead + user (D3) |
| C8/C9 timings, soft budget | pass | `job-report.mjs` summary + `::warning title=budget::`, exit 0; budgets.json lint 120 / db 180 / per-package 120; report.test.ts |
| C10 one DB job | pass | `db` keyed to `db` only; one harness container; db 146 s of 180 |
| C11 (amended) artifact only, CI writes nothing | pass | `ci-test-runs-<job>` uploads; no `contents: write` in ci.yml; ingest → POLY-79 |
| Addendum 1 (A1–A5) | pass | build.yml: unique `sha-<commit>-<run_id>` tag, no shared tag, push → image check → Trivy → SBOM → both attests on one `steps.build.outputs.digest`; no cache; `release-scan` schedule-only; tests/image/apt-and-pm.test.ts |
| Seam / permissions (S96-3..6) | pass | per-job `contents: read`; `persist-credentials: false` on every checkout; build/release jobs scoped as ruled |

Post-merge (lead, ruling §6): build.yml green on the merge commit; `sha-<commit>-<run_id>` in GHCR; `gh attestation verify … --source-ref refs/heads/main --deny-self-hosted-runners`; `gh workflow run release.yml -f commit=<merge>` prints the same digest; the PR's own `pull_request` run green (no PR exists yet).

Advisory, non-blocking (follow-ups at the lead's discretion):
- A-1 `db` at 146 s is 81 % of its 180 s budget on day one (45 s locally); the gap is likely the pgTAP image build per run (unmeasured). Measure before the battery grows.
- A-2 `aggregate.mjs` cross-checks one job per output (node→unit, image→image, …); a mis-wired `lint` `if:` for node/image is caught only by the static ci-workflow test, not at run time.
- A-3 `image-<commit>` artifacts keep 90 days; a tag cut more than 90 days after a commit's last main build finds no digest and publishes nothing (fails closed). Weekly rebuilds refresh only the main tip.
