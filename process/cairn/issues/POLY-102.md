---
id: POLY-102
title: CI: generated-output freshness
status: in-review
milestone: POLY-M1
parent: null
blocked_by: [POLY-96]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-102.md, process/cairn/reviews/POLY-102/**, scripts/cairn/check_dist_freshness.py, scripts/cairn/tests/**, .github/workflows/ci.yml, infra/ci/**, tests/ci/**, tests/db/**, package.json, eslint.config.js, docs/INFRA/index.html, docs/ARCH/index.html, docs/SECURITY/index.html]
labels: [ci, tooling]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/113
created: 2026-11-08
updated: 2026-11-10
---

Generalise the PT-58 freshness pattern (ancestry-based, exclude-list) to the committed generated outputs the infra pipeline adds, such as the ops-bundle manifest, so a stale generated file cannot reach the attested ops bundle.

## Acceptance criteria

Ruling: `process/cairn/reviews/POLY-102/ruling.md` (R1–R7).

- [x] Touching a source without regenerating fails; regenerating passes: for every registered pair in `infra/ci/generated.json`, and on the real drizzle-kit, including a custom migration committed after an ungenerated schema edit (R1, R2). — scripts/cairn/tests/test_generated_freshness.py: `test_touching_a_source_without_regenerating_fails`, `test_regenerating_passes`; tests/ci/generated-freshness.test.ts: the real drizzle-kit cases (schema edit, the `--custom` sequence, after `generate`).
- [x] A doc-only PR never flips fresh to stale. — test_generated_freshness.py: `test_a_doc_only_commit_never_flips_fresh_to_stale` (in both `RegenerateModeTests` and `AncestryModeTests`); tests/ci/generated-freshness.test.ts: the doc-only real-drizzle case.
- [x] Same-second and cross-timezone commits behave (fixtures from the PT-58 tests) for `ancestry` pairs; the existing `check_dist_freshness` contract and its tests are unchanged. — test_generated_freshness.py `AncestryModeTests`: `test_same_second_commits_resolve_toward_stale`, `test_cross_timezone_stamps_do_not_invert_the_order`; scripts/cairn/tests/test_dist_freshness.py passes unchanged.
- [x] The check fails closed (exit 2) on every R2 row and runs as a `lint` step feeding `app` (R3). — test_generated_freshness.py `FailClosedTests` (one test per exit-2 row, plus the prompting generator); tests/ci/ci-workflow.test.ts: the `Generated-output freshness` lint step case.
- [x] The `db` CI job has headroom again before POLY-86 adds to the battery: two full-battery CI runs each finish the `db` job in ≤ 150 s of its 180 s budget (`infra/ci/budgets.json` unchanged), by cutting the measured cost without dropping a case (R4). — CI runs 42975920810 (`db` 110 s) and 42976214364 (`db` 93 s) on 4a3800f; tests/db/template-clone.test.ts: clone equivalence and once-only role passwords.
- [x] The change filter follows "every path a job runs or imports triggers that job": the R5 rows for `image` and `db`, a transitive import-closure test, and a static pin on the `db-migrations` pair (R5). — tests/ci/changes.test.ts (the R5 rows); tests/ci/db-filter-imports.test.ts (transitive closure); tests/ci/generated-freshness.test.ts: the registry pin case.

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
### @architect — 2026-11-10

Gate 1 ruling: `process/cairn/reviews/POLY-102/ruling.md`. Freshness is a content check (regenerate in an isolated copy, byte compare) for the Drizzle migrations, the one generated output that reaches the image; ancestry is measured false-fresh there (R1). No ops-bundle manifest exists yet; the feature that adds one registers its pair. `db`: 30 s confirmed, budget unchanged, cost cut by template databases and a cheaper `freshDb` (R4). Filter: R5 widens `image` and `db` (closes POLY-96 O2). Criteria amended in place; verdict checklist R7.

### @architect — 2026-11-10

Gate 4 verdict against frozen `4a3800f` (ruling `process/cairn/reviews/POLY-102/ruling.md` @ 15f9ba2 + Addendum 1 @ f8feb8b): **PASS**.

| # | Axis | Result | Evidence |
|---|---|---|---|
| V1 | Stale fails, regenerate passes | pass | `test_generated_freshness.py` (touch/regenerate/hand-edit/extra-file); `tests/ci/generated-freshness.test.ts` on real drizzle-kit: schema edit → 1, R1 `--custom` sequence → 1, after `generate` → 0 |
| V2 | Doc-only never flips | pass | both modes, Python + `tests/ci` fixtures |
| V3 | Same-second, cross-timezone | pass | ancestry fixtures through the generic core; regenerate is history-free (tested) |
| V4 | Fail closed | pass | one case per R2 exit-2 row, a prompting generator among them; tree and linked `node_modules` unchanged |
| V5 | Old contract | pass | `test_dist_freshness.py` unchanged and green (local, unittest, 20.5 s with the new suite) |
| V6 | CI wiring | pass | `lint` step with the R3 `if:`, asserted in `ci-workflow.test.ts`; both runs log `db-migrations: fresh` |
| V7 | `db` headroom | pass | full dispatch runs 42975920810 / 42976214364: `db` 110 s / 93 s (≤ 150 s; was 160 s); 11 files green incl. `template-clone.test.ts`; `tests/db` cases removed 0, added 4 (`git diff 15f9ba2 4a3800f -- tests/db`) |
| V8 | Filter | pass | `changes.test.ts` rows; mutation: dropping `packages/config/**` turns `db-filter-imports.test.ts` red |
| V9 | Suites | pass | `tests/ci` 4 touched files 5.3 s local; `lint` 59/60 s of 120; `cairn` 111/83 s; no new top-level job |
| V10 | Registry pin | pass | mutation: `ci: false` turns both pin cases red |

Rulings on the builder's findings:
- `apps/web/src/startup.ts` in `db`: correct, found by the closure test, as R5 intends.
- The `svelte-kit sync` step in `db`: accepted. It repairs a break that has been on `main` since POLY-128 and was hidden by the old `db` filter. That is R5's rule doing its job.
- An ancestry pair whose rebuild cannot run stays `stale` (exit 1), not 2: accepted. The rebuild only rescues a verdict that is already stale, so failing to run it never maps to fresh, and V5 pins this. R2's exit-2 generator row applies to `regenerate` pairs.

Advisories (non-gating): R4's before/after case counts were not written into the build-green commit (measured above instead). Addendum 1's journal ↔ file bijection check is the lead's follow-up.

### @team-lead — 2026-11-10

PR opened: https://github.com/richmosko/polycarpic/pull/113. Awaiting Validate.
