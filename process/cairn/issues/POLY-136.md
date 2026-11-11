---
id: POLY-136
title: CI and migration-check follow-ups
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-136.md, process/cairn/reviews/POLY-136/**, packages/db/**, packages/auth/**, infra/ci/**, .github/workflows/**, tests/**, README.md, docs/INFRA/**, layers.json, eslint.config.js, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, package.json, pnpm-workspace.yaml, .gitignore, scripts/layers/**]
labels: [ci, tooling]
priority: null
pr: null
created: 2026-11-10
updated: 2026-11-11
---

A batch of small follow-ups from the POLY-96 and POLY-102 loops. None gates a feature.

## Acceptance criteria

- [ ] Journal ↔ file check in `packages/db/src/migrations-check.ts` (`checkFolder`): every `.sql` and `meta/*_snapshot.json` has its journal entry and the reverse. Today a stray migration file outside the journal is caught by nothing; it never runs, but it misleads review (POLY-102 ruling, Addendum 1).
- [ ] `infra/ci/aggregate.mjs` cross-checks one job per filter output; a mis-wired `lint` `if:` for `node`/`image` is caught only by the static ci-workflow test, not at run time (POLY-96 verdict, A-2).
- [ ] `image-<commit>` artifacts are kept 90 days; a tag cut later finds no digest and publishes nothing. Document it in the release runbook or look the digest up from the attestation (POLY-96 verdict, A-3; may land as one line on POLY-100).

## Comments

### @team-lead — 2026-11-11

From the POLY-86 and POLY-95 loops, add to this batch. **(1) db job headroom, before any new suite joins `db`** (POLY-86 verdict follow-up 15, owner qa-engineer): runs of 149, 128, 131, 144, 152 s against the 150 s guard; share one auth instance per file across the two TLS modes and look at `runner.test.ts` (about 30 s alone); target a 130 s median. (2) `tests/ci/ci-e2e.test.ts`: the `exit 0\s*$` guard catches only a trailing early exit in the e2e step (qa review @ 2bf29a3). (3) The e2e step's fallback branch (probe fails, `install-deps`, second probe) has never run in CI; one scratch run with the probe forced to fail would show it. (4) `pnpm install --frozen-lockfile` exits 1 locally with ERR_PNPM_IGNORED_BUILDS on esbuild while CI's install passes; state the local install command in the README or align the two.

### @team-lead — 2026-11-11

For item (1), the db-job cut: qa-engineer-102's profile of the `db` battery (2026-11-10, one local run; CI ≈ 1.29 × local) listed five cuts. POLY-102 took the template database per file, the leaner `freshDb()` and the runner lock test's `pg_stat_activity` poll. Two are unused: the crash-preload timer in ops-hardening, 2500 ms → 500 ms (about 2.5 s on CI); and calling the check script with `node` directly in `checks`, keeping one case through `pnpm --filter` for the script wiring (about 5 s on CI). Measured unit costs then: one docker-exec psql 60 ms, a migrate CLI spawn about 385 ms, `pnpm --filter … check-migrations` 200 ms. Not safe, per the same profile: file parallelism or concurrency in `runner` and `ops-status` (cluster-global role GRANT/REVOKE, global `pg_locks`, `vi.resetModules` with `process.env`); the 4.8 s ops-hardening case is the production hard timeout.

### @team-lead — 2026-11-11

Feature started. Branch: `feature/poly-136-ci-migration-followups`.
