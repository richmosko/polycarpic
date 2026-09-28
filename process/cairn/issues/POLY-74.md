---
id: POLY-74
title: CI change filter over-triggers
status: in-review
milestone: null
parent: null
blocked_by: []
assignee: devops-engineer
paths: [.github/workflows/ci.yml, tests/workflow/test_cairn_test_boundary.py]
labels: [ci, tooling]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/42
created: 2026-09-27
updated: 2026-09-27
---

The required `cairn` CI job runs the full test suite for any change under `process/` or `docs/DESIGN/`, including files no test reads (the decision log, the state ledger, review records). Narrow the filter to the files tests actually read, keep it fail-closed, and drop `docs/DESIGN/` once POLY-78 lands.

## Context

`.github/workflows/ci.yml` always starts the required `cairn` job, and its `Detect path changes` step skips the test suites unless the PR touched a relevant path. `PATTERN` includes `^process/` (the suites read `process/WORKFLOW.md`, `process/TRACKER.md`, `process/STATE.md`, `process/cairn/config.yml`); `EXCLUDE` carves out only tracker records. `process/DECISIONS.md` is matched by `PATTERN`, but no test under `scripts/cairn/tests/` or `tests/workflow/` reads it, so every doc-update PR that appends a decision entry runs the full ~1 min suite for nothing (PR #38, 2026-09-27).

## Acceptance criteria

- [ ] `EXCLUDE` in `.github/workflows/ci.yml` also matches `^process/DECISIONS\.md$`; comment cites this issue.
- [ ] Confirmed by grep that no test file references `DECISIONS.md` (record the command in a comment on this issue).
- [ ] A PR whose only non-record change is `process/DECISIONS.md` finishes the `cairn` job with `run=false` (link the run in a comment).
- [ ] A PR touching `process/STATE.md` or `process/WORKFLOW.md` still runs the suites (unchanged behaviour, link one run).

## Notes

Future CI-filter follow-ups go here as sub-issues rather than new top-level issues (see the team-lead memory on batching tooling fixes).


### @team-lead — 2026-09-28

**Re-scoped and raised to P1 (Principal: "process/* ... definitely triggers a full CI! That's not acceptable").** `PATTERN` is `^process/` with only the four tracker-record dirs excluded, so `process/reviews/**`, `process/DECISIONS.md`, `process/STATE.md` and every doc-only PR under them run the ~1 min suite. `docs/DESIGN/` is in `PATTERN` too, solely because of the cairn parity test that POLY-78 removes.

Acceptance criteria, superseding the original single-file one:
- [ ] A change confined to `process/reviews/**`, `process/DECISIONS.md`, or `process/STATE.md` does not run the test suites. Keep the trigger for the files a test actually reads (`process/WORKFLOW.md`, `process/TRACKER.md`, `process/cairn/config.yml`, and any `process/reviews/` ruling file a `tests/workflow` blob check pins — enumerate them from the tests rather than guessing).
- [ ] After POLY-78 lands, `docs/DESIGN/` leaves `PATTERN`.
- [ ] The skip decision is still fail-closed (POLY-39): any error in the filter runs the suite.
- [ ] Do this before POLY-78; it is a one-file change and unblocks every doc PR in the Plan phase.
