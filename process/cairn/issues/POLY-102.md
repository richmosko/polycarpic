---
id: POLY-102
title: CI: generated-output freshness
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-96]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-102.md, process/cairn/reviews/POLY-102/**, scripts/cairn/check_dist_freshness.py, scripts/cairn/tests/**, .github/workflows/ci.yml, infra/ci/**, tests/ci/**, tests/db/**, package.json, eslint.config.js]
labels: [ci, tooling]
priority: P1
pr: null
created: 2026-11-08
updated: 2026-11-10
---

Generalise the PT-58 freshness pattern (ancestry-based, exclude-list) to the committed generated outputs the infra pipeline adds, such as the ops-bundle manifest, so a stale generated file cannot reach the attested ops bundle.

## Acceptance criteria

- [ ] Touching a source without regenerating fails; regenerating passes.
- [ ] A doc-only PR never flips fresh to stale.
- [ ] Same-second and cross-timezone commits behave (fixtures from the PT-58 tests).
- [ ] The `db` CI job has headroom again before POLY-86 adds to the battery: a full-battery run finishes at least 30 s under its budget in `infra/ci/budgets.json`, by cutting the measured cost (the four CLI-spawning test files) or by a re-set budget with the measurement recorded. The 30 s figure is the lead's proposal; the ruling confirms or replaces it.

## Comments

### @team-lead — 2026-11-10

Follow-up from POLY-96 (ruling `process/cairn/reviews/POLY-96/ruling.md` §7, O4; seceng condition S96-13): add CodeQL scanning to CI. It was routed out of POLY-96 because it is outside that issue's criteria and its cost per PR is unmeasured. SECURITY v1.9 C-82 lists CodeQL as a target, not a control in force, until this lands. Measure the added minutes per PR before making it part of the required `app` check.

### @team-lead — 2026-11-10

CI follow-ups from the POLY-96 gate-4 verdict (architect advisories, non-blocking; `process/cairn/issues/POLY-96.md` @ 2ee8192):
- A-1: the `db` job ran 146 s of its 180 s budget on its first day (99 s locally at 149 tests). The gap is likely the pgTAP image built on every run (unmeasured). Measure it, and decide between a prebuilt image and a larger budget, before POLY-62 adds tenant tables to the battery.
- A-2: `infra/ci/aggregate.mjs` cross-checks one job per filter output. A mis-wired `lint` `if:` for `node`/`image` is caught only by the static ci-workflow test, not at run time.
- A-3: `image-<commit>` artifacts are kept 90 days. A tag cut more than 90 days after a commit's last `main` build finds no digest and publishes nothing (fails closed). Document it in the release runbook or look the digest up from the attestation instead.

### @team-lead — 2026-11-10

Filter gap found on POLY-132 (PR #107): a change to `infra/ci/image.sh` did not run the `image` job on its own PR, because `infra/ci/**` sets only the `ci` output (POLY-96 ruling §2). The scripts a job runs should trigger that job: `infra/ci/image.sh` and `infra/ci/install-trivy.sh` → `image`. PR #107 needed a manual full dispatch (42957388903) to exercise its own change. Needs a line in `infra/ci/changes.mjs` and its test; a ruling §2 table change, so the architect rules it.

### @team-lead — 2026-11-10

Correction to A-1 above, and why this issue moves to `todo` at P1 (Principal's instruction, 2026-11-11).

A-1's suspect was wrong. The architect measured it in the POLY-62 ruling (`process/cairn/reviews/POLY-62/ruling.md` R8, db job of run 42953687382, via `gh run view --log`): "The global setup (image build plus container start) is therefore ≤ 14.5 s. POLY-102 A-1's suspect is not the cost; the CLI-spawning files are." The file lines: `runner` 42.9 s, `ops-status` 34.1 s, `checks` 17.0 s, `ops-hardening` 11.1 s, together 105.1 s of 114.0 s. `battery`, `matrix`, `pgtap` and `wrappers` are 1.8–2.9 s each. A prebuilt pgTAP image would save at most about 14 s.

Where the job stands after POLY-62 (qa-engineer, PR #109 run 42967381790, one run): `db` job 160 s of its 180 s budget (was 146 s); battery step 139 s (was 130 s); vitest file lines 117.4 s (was 114.0 s). The new files cost `tenancy` 9.7 s, `matrix` 3.3 s, `pgtap` 2.5 s; `runner` came in at 39.1 s, which reads as run-to-run noise and flatters the delta.

The budget warns and never fails (`infra/ci/job-report.mjs` always exits 0), so nothing blocks a merge when it is exceeded. POLY-86 is the next feature that grows the battery; this issue's `db` criterion lands before it.

### @team-lead — 2026-11-10

Feature started. Branch: `feature/poly-102-ci-generated-output-freshness`.

### @team-lead — 2026-11-10

Scope confirmed by the Principal at feature start (2026-11-11):
- In: the four acceptance criteria, plus the filter gap (`infra/ci/image.sh` and `infra/ci/install-trivy.sh` → `image` job; one line in `infra/ci/changes.mjs` and its test). The architect rules the filter-table change (POLY-96 ruling §2).
- Out: CodeQL (S96-13) — splits to its own issue, filed in the post-merge follow-ups PR. Its per-PR cost is unmeasured.
- Out: A-2 (aggregate blind spot) and A-3 (90-day digest artifacts) — stay as comments for a later CI batch; A-3 may become a runbook line on POLY-100.
- The 30 s `db` headroom figure stands as the lead's proposal; the ruling confirms or replaces it.

### @team-lead — 2026-11-10

Scope widened by the Principal (2026-11-11), on seceng-102's pre-ruling finding (verified against `infra/ci/changes.mjs` @ d2f8c0c: `db: [/^packages\/db\//, /^tests\/db\//]`):
- Decided, in scope: the `db` filter gap. A PR touching only `packages/tenancy`, `apps/migrate`, `apps/web/src/ops`, `tests/log/canary.ts` or the lockfile skips the database battery. The rule: every path a job imports or executes triggers that job. The `db` list is derived from the battery's imports, with a static test that fails when a `tests/db` file imports from an unmatched path.
- Decided, in scope: `.trivyignore` and `tests/layers/tsc/package.json` → `image`, with the `image.sh` / `install-trivy.sh` lines already scoped.
- The architect rules the §2 table and the exact patterns. The `db` job now runs on more PRs; the headroom criterion accounts for that.
