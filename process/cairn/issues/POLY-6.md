---
id: POLY-6
title: Separate repo-convention tests from cairn's suite; path-filtered CI per component
status: backlog
milestone: null
parent: null
blocked_by: []
assignee: null
labels: [workflow, cairn, tests, ci]
priority: P3
pr: null
created: 2026-09-23
updated: 2026-09-23
---


## Comments

### @team-lead — 2026-09-23

Filed from a POLY-4 side conversation (2026-09-23). Not scheduled; no milestone.

**Observation.** cairn is isolated in practice, not by declaration: all tracker code and its 104 test files live under `scripts/cairn/`, `run_tests.py` discovers only `scripts/cairn/tests/`, and there is no CI or packaging file yet. Because cairn is the only code in the repo today, "the test suite" and "cairn's tests" coincide.

**The fuzzy edge.** Several files in `scripts/cairn/tests/` guard repo conventions rather than the tracker — e.g. `test_state_releases_bound.py` (STATE.md releases row), the agent-definition drift test, `test_agent_git_identity.py` (worktree protocol block). They sit there because that is where the runner looks, not because they belong to cairn. That couples a future `/spin-off-component` of cairn to project-specific checks.

**When it matters.** Once product code (SvelteKit + Postgres) arrives with its own runner, and once CI exists.

## Acceptance criteria

- [ ] Repo-convention tests move out of `scripts/cairn/tests/` into a workflow-tests location with their own discovery entry point (or a second `-s` root in `run_tests.py`); cairn's suite contains only tracker/tooling tests
- [ ] CI (when introduced) runs path-filtered jobs: one for `scripts/cairn/` + workflow tests, one per product package; a change in one does not run the other's suite
- [ ] `process/WORKFLOW.md` (Shared / reusable components) notes that cairn's test boundary is spin-off-clean
