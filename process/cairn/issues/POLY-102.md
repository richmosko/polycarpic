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

### @team-lead — 2026-11-10

CI follow-ups from the POLY-96 gate-4 verdict (architect advisories, non-blocking; `process/cairn/issues/POLY-96.md` @ 2ee8192):
- A-1: the `db` job ran 146 s of its 180 s budget on its first day (99 s locally at 149 tests). The gap is likely the pgTAP image built on every run (unmeasured). Measure it, and decide between a prebuilt image and a larger budget, before POLY-62 adds tenant tables to the battery.
- A-2: `infra/ci/aggregate.mjs` cross-checks one job per filter output. A mis-wired `lint` `if:` for `node`/`image` is caught only by the static ci-workflow test, not at run time.
- A-3: `image-<commit>` artifacts are kept 90 days. A tag cut more than 90 days after a commit's last `main` build finds no digest and publishes nothing (fails closed). Document it in the release runbook or look the digest up from the attestation instead.

### @team-lead — 2026-11-10

Filter gap found on POLY-132 (PR #107): a change to `infra/ci/image.sh` did not run the `image` job on its own PR, because `infra/ci/**` sets only the `ci` output (POLY-96 ruling §2). The scripts a job runs should trigger that job: `infra/ci/image.sh` and `infra/ci/install-trivy.sh` → `image`. PR #107 needed a manual full dispatch (42957388903) to exercise its own change. Needs a line in `infra/ci/changes.mjs` and its test; a ruling §2 table change, so the architect rules it.
