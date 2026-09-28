---
id: POLY-74
title: CI: exclude process/DECISIONS.md from the cairn job's change filter
status: todo
milestone: null
parent: null
blocked_by: []
assignee: null
paths: [.github/workflows/ci.yml]
labels: [ci, tooling]
priority: null
pr: null
created: 2026-09-27
updated: 2026-09-27
---

## Context

`.github/workflows/ci.yml` always starts the required `cairn` job, and its `Detect path changes` step skips the test suites unless the PR touched a relevant path. `PATTERN` includes `^process/` (the suites read `process/WORKFLOW.md`, `process/TRACKER.md`, `process/STATE.md`, `process/cairn/config.yml`); `EXCLUDE` carves out only tracker records. `process/DECISIONS.md` is matched by `PATTERN`, but no test under `scripts/cairn/tests/` or `tests/workflow/` reads it, so every doc-update PR that appends a decision entry runs the full ~1 min suite for nothing (PR #38, 2026-09-27).

## Acceptance criteria

- [ ] `EXCLUDE` in `.github/workflows/ci.yml` also matches `^process/DECISIONS\.md$`; comment cites this issue.
- [ ] Confirmed by grep that no test file references `DECISIONS.md` (record the command in a comment on this issue).
- [ ] A PR whose only non-record change is `process/DECISIONS.md` finishes the `cairn` job with `run=false` (link the run in a comment).
- [ ] A PR touching `process/STATE.md` or `process/WORKFLOW.md` still runs the suites (unchanged behaviour, link one run).

## Notes

Future CI-filter follow-ups go here as sub-issues rather than new top-level issues (see the team-lead memory on batching tooling fixes).
