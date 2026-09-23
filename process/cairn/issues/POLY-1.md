---
id: POLY-1
title: Per-agent git author identity in worktrees
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: team-lead
labels: [workflow, git]
priority: P1
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Every teammate works in its own git worktree on the shared feature branch, but
today all commits carry the Principal's author identity, so the per-agent commit
log the estimation loop (POLY-3) and the path-ownership check (POLY-2) both
depend on does not exist. Kickoff decision: `docs/project_kickoff.md` § 2.1
→ *Git author identity*. Pushes keep using the Principal's credentials; PRs are
opened by the Principal's GitHub account; the model's `Co-Authored-By` trailer
stays. Accepted costs: blank avatars on GitHub, unsigned commits.

## Acceptance criteria

- [x] `extensions.worktreeConfig=true` is set in the repo config by the SessionStart hook, idempotently (same pattern as `core.hooksPath`), so a fresh clone gets it without a manual step
- [x] The shared worktree-protocol block in every `.claude/agents/*.md` sets `user.name=<agent-name>` and `user.email=<agent-name>@agents.polycarpic.local` with `git config --worktree` immediately after `EnterWorktree`, before any commit
- [x] The block stays byte-identical across all agent files (a test in `scripts/cairn/tests/` or a check script fails on drift)
- [x] The team-lead's main checkout is untouched: commits there keep the Principal's identity
- [x] Verified end to end: one spawned teammate commits in its worktree and `git log --format='%an <%ae>'` on the feature branch shows the agent's identity with the `Co-Authored-By` trailer intact
- [x] `process/WORKFLOW.md` → worktree section documents the identity convention in one paragraph; `docs/project_kickoff.md` § 2.1 is left as the decision record

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-1-agent-git-identity`. Started during the Research phase by Principal decision: POLY-A's definition of done includes the § 2.1 / § 2.12 workflow items, and they precede the PRD interview per kickoff § 4 step 1.

### @qa-engineer — 2026-09-23

red @ b67041c — scripts/cairn/tests/test_agent_git_identity.py added.

9 tests: 8 fail as expected (no import errors) —
- SessionStart hook missing `git config extensions.worktreeConfig true` (AC1, idempotent-shape check too)
- shared worktree-protocol block missing `git config --worktree user.name`/`user.email` @agents.polycarpic.local, ordered after EnterWorktree / before commit, referencing the agent's own `name:` (AC2)
- per-file presence check across all 10 agent files fails (none have it yet)

1 passes (marker-delimiters-unchanged sanity check). Existing test_agent_worktree_protocol_block.py left untouched, still green.

### @team-lead — 2026-09-23

Red confirmed @ e643be4 (QA test b67041c, 9 tests). Build to green against it.

**Shared-worktree ruling.** implementation-lead and qa-engineer both worked inside team-lead's worktree (`.claude/worktrees/poly-1-git-identity`); `git worktree list` shows no per-teammate worktree. The lead's uncommitted implementation (ten agent files, `.claude/settings.json`, `process/WORKFLOW.md`) is already in that checkout at HEAD e643be4. Finish in place; do not enter a new worktree or move files. Do the identity proof so it does not leak onto team-lead's commits:

1. `git config extensions.worktreeConfig true`
2. `git config --worktree user.name implementation-lead` and `git config --worktree user.email implementation-lead@agents.polycarpic.local`
3. Green gate (`python3 scripts/cairn/run_tests.py --gate green -p "test_agent_*.py"`, or the form run_tests.py accepts); commit the feature files by pathspec (include `process/cairn/metrics/test-runs.jsonl` if the hook recorded runs); pull `--rebase`; push fast-forward; post the green comment (author implementation-lead: green sha + the `git log -1 --format='%an <%ae>'` line); commit it by pathspec; push.
4. `git config --worktree --unset user.name` and `--unset user.email`, so later commits from the shared checkout revert to the Principal's identity.

Report to team-lead: `green @ <sha>`, files, author line, gate result, and one line on whether `EnterWorktree` was called and what it returned (needed to record why isolation did not happen).

### @implementation-lead — 2026-09-23

green @ 8cb9d89d47bf59c0faeeb6c75cfd2eb4c1df2a9d

Author: implementation-lead <implementation-lead@agents.polycarpic.local> (git log -1 --format='%an <%ae>')

Targeted files pass: test_agent_git_identity.py, test_agent_worktree_protocol_block.py (both green).

Full-suite --gate green run (98 files, 1671 tests): 5 pre-existing failures unrelated to POLY-1 -- test_test_run_hooks.py (missing process/reviews/PT-97 fixture, deleted by the template scrub per kickoff Section 2.2), test_backfill_tokens.py, test_otel_receiver.py (cwd/prefix resolution), test_state_releases_bound.py (STATE.md Releases row format). None touch git identity, the worktree-protocol block, or settings.json.

Infra note: run_tests.py's stderr summary regex does not tolerate ANSI-colorized unittest output; FORCE_COLOR=3 leaking from this tmux shell made every file appear to error until the run was forced with FORCE_COLOR=0 NO_COLOR=1. Not fixed here (out of POLY-1 scope) -- flagging for whoever owns run_tests.py.

### @architect — 2026-09-23

reviewed @ 8cb9d89 (diff origin/main...8cb9d89) — **APPROVE**, with one follow-up issue.

| AC | Verdict | Evidence |
|---|---|---|
| 1 hook sets `extensions.worktreeConfig` | met | settings.json SessionStart entry; `git config --get extensions.worktreeConfig` = true |
| 2 identity step in block | met | block: after `EnterWorktree`, before pull/commit; `<agent-name>` bound to own `name:` field |
| 3 byte-identical + drift test | met | 10/10 files hash to one block; test_agent_git_identity + test_agent_worktree_protocol_block: 14 tests OK |
| 4 lead's main checkout untouched | met | common `.git/config` has no `user.*`; no `config.worktree` in main gitdir |
| 5 end to end | met, with caveat | 8cb9d89/b02ca11 are `implementation-lead <…@agents.polycarpic.local>` with `Co-Authored-By` intact, but committed from the lead's worktree, not the teammate's own (see finding 1) |
| 6 WORKFLOW paragraph | met | one paragraph, scope stated (attribution only), points to kickoff § 2.1; no repeated rationale |

**Hook (3).** Idempotent, same `…2>/dev/null; exit 0` shape as the hooksPath line; outside a repo it no-ops. No `[ -d … ]` guard is needed. Fresh clone: fine (repositoryformatversion 0, git 2.55). Fail-closed check: without the extension, `git config --worktree` exits 128 once a second worktree exists (tested in /tmp), so a skipped hook blocks the step. It does not write to the shared config.

**Findings.**
1. **Identity leaked onto a lead commit.** 1ff7489, the team-lead's ruling, is authored `implementation-lead`: the lead committed from the shared worktree while the teammate's `--worktree` identity was set. Worktree-scoped identity assumes one agent per worktree. A shared checkout breaks that silently. History is pushed and main blocks force-push, so leave it and let this comment stand as the record.
2. Nothing else would surprise a senior engineer. Block label `(PT-82)` is a template-era id (pre-existing, out of scope).

**Process finding / follow-up (file as POLY-A issue).** The teammates did not isolate because the lead was itself inside a worktree, contrary to WORKFLOW "The lead never enters a worktree". Teammates spawned there inherit its cwd. `EnterWorktree` refuses to create a new worktree from inside a worktree session, and nobody recorded what it returned. The protocol block has no branch for that case. A teammate that follows it cold sets its identity on the lead's worktree, which is how finding 1 happened. Proposed issue: "Fail closed when a teammate cannot isolate". (a) Block text: if `EnterWorktree` fails, or `git rev-parse --show-toplevel` is not a worktree you created this session, do not set identity or commit; report to team-lead with the tool's verbatim result. (b) Add a lead-side session-start check that refuses teammate spawn while the lead's cwd is under `.claude/worktrees/`. (c) Add a test asserting the block carries the fail-closed clause. Keep it separate from POLY-2. Path-ownership would not catch a misattributed author.

### @qa-engineer — 2026-09-23

verdict @ 400c100 — PASS.

Full-suite gate (`FORCE_COLOR=0 NO_COLOR=1 python3 scripts/cairn/run_tests.py --gate verdict`, 98 files, 1671 tests): 23 failures / 5 errors, all confined to the 5 pre-existing files POLY-4 already tracks (test_test_run_hooks.py, test_backfill_tokens.py, test_otel_receiver.py, test_state_releases_bound.py, test_agent_setting_role.py) — none touch git identity, the worktree-protocol block, or settings.json. `--gate` and `-p` are mutually exclusive by run_tests.py's own argparse (PT-94 C9), so I ran the full suite for the gate and separately confirmed POLY-1's own two files narrowed: test_agent_git_identity.py (9/9) and test_agent_worktree_protocol_block.py (5/5), both OK.

All 6 ACs verified from the tree:
1. `git config --get extensions.worktreeConfig` = true; hook line `git config extensions.worktreeConfig true 2>/dev/null; exit 0` matches the hooksPath idempotent shape.
2/3. Covered by the two green test files above (identity step present, ordered, byte-identical across all 10 agent files).
4. Common `.git/config` (`git rev-parse --git-common-dir`) carries no `user.*`; this worktree's own `--worktree` scope is unset (confirms cleanup step ran) — subsequent commits (752c1b4, 400c100, 7e4410d) are back to `richmosko <richmosko@gmail.com>`.
5. `8cb9d89` is `implementation-lead <implementation-lead@agents.polycarpic.local>` with `Co-Authored-By: Claude Sonnet 5` intact. Caveat already recorded by architect and tracked as POLY-5: committed from the shared lead worktree, not an isolated teammate worktree — doesn't block this verdict.
6. `process/WORKFLOW.md` line 230 documents the convention in one paragraph, points to kickoff § 2.1.

Broken: none blocking. POLY-4 (pre-existing suite health) and POLY-5 (fail-closed isolation) are filed and out of scope here.
