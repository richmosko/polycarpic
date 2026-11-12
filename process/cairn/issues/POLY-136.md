---
id: POLY-136
title: CI and migration-check follow-ups
status: done
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
paths: [process/cairn/issues/POLY-136.md, process/cairn/reviews/POLY-136/**, apps/migrate/src/**, docs/SECURITY/**, packages/db/**, packages/auth/**, infra/ci/**, .github/workflows/**, tests/**, README.md, docs/INFRA/**, layers.json, eslint.config.js, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, package.json, pnpm-workspace.yaml, .gitignore, scripts/layers/**]
labels: [ci, tooling]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/119
created: 2026-11-10
updated: 2026-11-11
---

A batch of small follow-ups from the POLY-96 and POLY-102 loops. None gates a feature.

## Acceptance criteria

Ruling: `process/cairn/reviews/POLY-136/ruling.md`. Item 4 lands and is proven first.

- [x] 1. Journal ↔ file check in `packages/db/src/migrations-check.ts`: `checkJournalFiles`, called from `checkFolder`, fails on any `.sql` or `meta/*_snapshot.json` without a journal entry and on any entry missing either file. Each problem prints `journal-files: <file>: <detail>`; the script exits 1. A stray migration outside the journal never runs, but it misleads review. — tests/db/checks.test.ts: "journal-to-file check (POLY-136 item 1)" (stray .sql, stray snapshot, entry missing its .sql, entry missing its snapshot, the real folder passes, the pnpm wiring case)
- [x] 2. `infra/ci/aggregate.mjs` checks every job each filter output gates (`REQUIRED`: node→lint+unit+image, layers→lint, ci→lint, image→lint+unit+image, db→db), and a test ties `REQUIRED` to the job-level `if:`s in ci.yml. — tests/ci/aggregate.test.ts: "every job an output gates (POLY-136 item 2)", including "REQUIRED equals, per output, the jobs whose if: in ci.yml names it"
- [x] 3. `image-<commit>` artifacts are kept 90 days (the public-repo ceiling). The INFRA release runbook states the window and what to do past it; a test ties the runbook's number to build.yml's `retention-days`. — tests/ci/build-workflow.test.ts: "the runbook names image-<commit> and the same day count build.yml sets"
- [x] 4. `db` CI job: median ≤ 130 s over five sequential full dispatch runs and the fastest three averaging ≤ 120 s, with no fewer `db` tests (≥ 335). Cuts C1 to C3 in the ruling. — five dispatch runs at 0e00993: 43122650465 (111 s), 43123163913 (125), 43123703873 (125), 43124168002 (107), 43124687609 (157); median 125 s, fastest three mean 114.3 s; final head run 43126411997: `db` 124 s, 352 tests (350 passed + 2 `it.fails`). Recorded in process/cairn/reviews/POLY-136/verdict.md and ruling.md addendum 3.
- [x] 5. `tests/ci/ci-e2e.test.ts` allows exactly one `exit 0` (the not-affected branch, before the browser install); any other zero, bare or variable exit in the e2e step is red. — tests/ci/ci-e2e.test.ts: "the real step passes the exit rule" and the ten "exit rule is red on: …" mutant cases
- [x] 6. The e2e step's fallback branch has run once in CI on a throwaway scratch branch with the first probe forced to fail; the result is recorded here and the scratch branch is deleted unmerged. — run 43125303397 on scratch/poly-136-e2e-fallback; result in the @devops-engineer comment above and in verdict.md; branch deleted.
- [x] 7. Local and CI installs agree: plain `pnpm install --frozen-lockfile` exits 0 locally (esbuild declined in pnpm-workspace.yaml, strict builds on in CI), or, if that fails a clean install, the README states the CI-equivalent command. — tests/ci/strict-builds.test.ts: "S1" (esbuild declined, every `allowBuilds` value `=== false`), "S2", "S3" (strict-dep-builds set nowhere), "the README states the plain install command"; S4 clean-install evidence in the @devops-engineer comment (image job green in run 43124687609)

## Comments

### @team-lead — 2026-11-11

From the POLY-86 and POLY-95 loops, add to this batch. **(1) db job headroom, before any new suite joins `db`** (POLY-86 verdict follow-up 15, owner qa-engineer): runs of 149, 128, 131, 144, 152 s against the 150 s guard; share one auth instance per file across the two TLS modes and look at `runner.test.ts` (about 30 s alone); target a 130 s median. (2) `tests/ci/ci-e2e.test.ts`: the `exit 0\s*$` guard catches only a trailing early exit in the e2e step (qa review @ 2bf29a3). (3) The e2e step's fallback branch (probe fails, `install-deps`, second probe) has never run in CI; one scratch run with the probe forced to fail would show it. (4) `pnpm install --frozen-lockfile` exits 1 locally with ERR_PNPM_IGNORED_BUILDS on esbuild while CI's install passes; state the local install command in the README or align the two.

### @team-lead — 2026-11-11

For item (1), the db-job cut: qa-engineer-102's profile of the `db` battery (2026-11-10, one local run; CI ≈ 1.29 × local) listed five cuts. POLY-102 took the template database per file, the leaner `freshDb()` and the runner lock test's `pg_stat_activity` poll. Two are unused: the crash-preload timer in ops-hardening, 2500 ms → 500 ms (about 2.5 s on CI); and calling the check script with `node` directly in `checks`, keeping one case through `pnpm --filter` for the script wiring (about 5 s on CI). Measured unit costs then: one docker-exec psql 60 ms, a migrate CLI spawn about 385 ms, `pnpm --filter … check-migrations` 200 ms. Not safe, per the same profile: file parallelism or concurrency in `runner` and `ops-status` (cluster-global role GRANT/REVOKE, global `pg_locks`, `vi.resetModules` with `process.env`); the 4.8 s ops-hardening case is the production hard timeout.

### @team-lead — 2026-11-11

Feature started. Branch: `feature/poly-136-ci-migration-followups`.

### @architect — 2026-11-11

Gate 1 ruling: process/cairn/reviews/POLY-136/ruling.md. The acceptance criteria are amended in place to seven items, and apps/migrate/src/** is added to paths for cut C1. Item 4 lands first: C1 (runner in-process via apps/migrate/src/run.ts), then C2 and C3; five dispatch runs, db median ≤ 130 s. Item 7 is ruled as align (allowBuilds esbuild:false, strict CI), with the README as fallback.

### @devops-engineer — 2026-11-11

Item 6 (scratch run 43125303397 on scratch/poly-136-e2e-fallback, first probe forced to fail): the fallback ran. install-deps ran for about 3 s and did not time out; no ::warning appeared; the second probe passed (no 'Chromium cannot launch'); e2e 48 passed (42.6 s); step total 59 s, success. lint failed on that branch as expected (the static workflow test sees the edited probe); db, image and unit were green. Scratch branch deleted from origin and locally; nothing merged.

Item 7 / S4: clean install with --reporter=append-only (node_modules removed, store warm) exits 0 with no lifecycle-script line, and the image job was green on the same head in run 43124687609 at 0e00993 (all eight jobs green).

### @architect — 2026-11-11

Gate 4 verdict at 66ed997: PASS, one delta before the PR (regenerate INFRA.pdf). Table: process/cairn/reviews/POLY-136/verdict.md. db tests: 352 executed in run 43126411997 (350 passed + 2 it.fails for POLY-100) against 335 at baseline; db job 124 s on the final head.

### @team-lead — 2026-11-11

PR opened: https://github.com/richmosko/polycarpic/pull/119. Awaiting Validate.

### @team-lead — 2026-11-11

Validate passed; merging via PR #119. Closing.
