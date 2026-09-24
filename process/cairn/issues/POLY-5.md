---
id: POLY-5
title: Fail closed when a teammate cannot isolate in its own worktree
status: in-review
milestone: POLY-A
parent: null
blocked_by: [POLY-1]
assignee: null
labels: [workflow, git]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/8
created: 2026-09-23
updated: 2026-09-23
---


Found during POLY-1 (architect ruling on POLY-1 @ 752c1b4). Both teammates
worked inside team-lead's own worktree instead of creating their own: the lead
was worktree-isolated this session (background-job mode), the teammates were
spawned with that directory as cwd, and each treated "already in a worktree" as
satisfying the protocol's `EnterWorktree` first step, so it was never called.
Consequences seen: a per-worktree identity set by one agent leaked onto the
lead's commit 1ff7489, and the lead's uncommitted files blocked a teammate's
`pull --rebase`. The design assumption in `process/WORKFLOW.md` (lead in the
main checkout, one worktree per teammate) was silently violated and nothing
failed loudly.

## Acceptance criteria

- [ ] Shared worktree-protocol block: `EnterWorktree` is called unconditionally, even when cwd is already under `.claude/worktrees/`; if it fails or is refused, the teammate sets no identity, makes no commit, and reports the failure to team-lead instead of working in place
- [ ] Lead-side guard: a check (SessionStart hook or `/start-feature` pre-flight) that warns loudly, or refuses to spawn teammates, while the lead's cwd is inside a worktree; the message names the fix
- [ ] The byte-identical drift test and `test_agent_git_identity.py` are extended to cover the new block wording
- [ ] `process/WORKFLOW.md` worktree section states the fail-closed rule in one sentence

## Comments

### @team-lead — 2026-09-23

Related finding (POLY-4 loop, iterm2 split-pane mode): every teammate's first `EnterWorktree` raised an interactive permission prompt ("permission-root relocation … a model-supplied worktree") because agent files run `permissionMode: default` and no allow rule existed. In in-process mode this stalls silently — the prompt is only visible in a split pane. Mitigation landed on `feature/poly-4-test-suite-health`: `EnterWorktree` / `ExitWorktree` added to `permissions.allow` in `.claude/settings.json`. POLY-5's fail-closed AC #1 should also cover "prompt denied" → report to team-lead, not work in place.

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-5-fail-closed-worktree-isolation`.

### @team-lead — 2026-09-23

Lead estimate at start, recorded for calibration at done (POLY-3 input): loop size ≈ POLY-1, roughly 1–2 h of team wall-clock from spawn to merge. The closing comment records the actual (spawn timestamp → merge timestamp) and the delta.
Spawn: 2026-09-23, branch tip 3a7bdc6.

### @architect — 2026-09-23

**Gate-1 ruling (POLY-5).** Seam: shared block + one new guard script + `/start-feature` step 0 + one WORKFLOW bullet. No settings.json edit this loop.

(a) **Block wording.** Replace the block's first sentence with the text below, verbatim, in all ten files; the rest of the block is unchanged. The fail-closed clause comes before the identity step, because identity only happens on success.
> Your first action after being spawned is `EnterWorktree`: call it unconditionally, even when your cwd is already under `.claude/worktrees/` (that is someone else's worktree, not yours). It creates `.claude/worktrees/<name>/` on branch `worktree-<name>`, pinned to the feature branch tip via `worktree.baseRef: "head"`. **Fail closed (POLY-5):** if `EnterWorktree` errors, is refused, or its permission prompt is denied, stop — set no identity, write no file, make no commit, and report the verbatim failure to team-lead with `SendMessage`; never work in place.

(b) **Lead guard.** New stdlib script `scripts/cairn/check_lead_not_in_worktree.py [--cwd PATH]` (default: the process cwd). Exit codes: 0 = main checkout, or not a git repo, with no output. 1 = linked worktree. On exit 1 it prints to **stdout**, because SessionStart injects stdout and teammates see the hook too. The message must contain `team-lead`, the resolved worktree path, the main-checkout path, and a `Fix:` line saying to restart Claude Code from the main checkout (or run `ExitWorktree` if the worktree was entered that way) before spawning teammates. Two callers:
- `/start-feature` gets a new `### 0. Pre-flight` (step 0, so no renumbering). It runs the script; a non-zero exit stops the skill. Add one Failure-modes line.
- A SessionStart hook line, handed to the user as text, **not AC-gating** (AC2 is met by the pre-flight alone): `[ -f scripts/cairn/check_lead_not_in_worktree.py ] || exit 0; python3 scripts/cairn/check_lead_not_in_worktree.py; exit 0`

(c) **Detection.** A linked worktree is detected by `realpath(--git-dir) != realpath(--git-common-dir)`, resolved against the cwd. This is the discriminator `run_tests.py` and `ensure_metrics_worktree.py` already use (PT-82 ruling, measured in four contexts). Re-measured here: this worktree reports `.git/worktrees/architect-poly5` vs `.git`. Path-under-`.claude/worktrees/` is rejected: it misses worktrees elsewhere (the `process/cairn/metrics` worktree, background-job isolation). The builder may import `ensure_metrics_worktree._is_linked_worktree` or reimplement it; the semantics must match.

(d) **Tests.**
- `test_agent_worktree_protocol_block.py` gets three new `REQUIRED_ELEMENT_PATTERNS`:
  - "EnterWorktree unconditional": `EnterWorktree[\s\S]*?unconditionally` and `already under \`?\.claude/worktrees/`
  - "fail closed on error/refusal/denied prompt": `fail closed` plus `errors`, `refused`, `permission prompt[\s\S]*?denied`
  - "report failure to team-lead": `report[\s\S]{0,60}failure[\s\S]{0,40}team-lead`
- `test_agent_git_identity.py` asserts:
  - the fail-closed clause contains `set no identity` and `make no commit`;
  - its start index is before `git config --worktree user.name` and before `commit by pathspec`;
  - it is present in every agent file.
- New `test_check_lead_not_in_worktree.py`, built on a temp repo (`git init`, one commit, `git worktree add`):
  - main checkout → exit 0, empty stdout;
  - linked worktree → exit 1, stdout carries `team-lead`, both paths, and `Fix:`;
  - a subdirectory of the linked worktree → exit 1;
  - a non-git dir → exit 0;
  - `start-feature/SKILL.md` step 0 names the script.
- Mutation check: drop `unconditionally` from all ten files → the element test goes red.

(e) **WORKFLOW.md.** Add a new bullet after "The lead never enters a worktree", one sentence:
> **Fail closed (POLY-5).** A teammate calls `EnterWorktree` unconditionally, even from inside `.claude/worktrees/`, and if the call errors, is refused, or its permission prompt is denied it sets no identity, writes and commits nothing, and reports to team-lead instead of working in place — while `scripts/cairn/check_lead_not_in_worktree.py` (`/start-feature` step 0) exits non-zero when the lead's own cwd is a linked worktree.

Unmeasured: whether `EnterWorktree` succeeds when called from inside another session's worktree. Either outcome is safe under (a): success isolates the teammate, failure fails closed.

### @qa-engineer — 2026-09-23

RED @ eb54d5a. 7 new REQUIRED_ELEMENT_PATTERNS in test_agent_worktree_protocol_block.py (unconditional EnterWorktree, fail-closed on error/refusal/denied prompt, report to team-lead); FailClosedClauseTests added to test_agent_git_identity.py (set no identity / make no commit, ordering, all-files); new test_check_lead_not_in_worktree.py against the not-yet-written script CLI contract (main=0/silent, linked worktree=1 w/ team-lead+both paths+Fix:, subdir=1, non-git=0) plus start-feature step-0 naming check. `python3 run_tests.py -p 'test_agent_worktree_protocol_block*' -p 'test_agent_git_identity*' -p 'test_check_lead_not_in_worktree*'`: 11 failures across 3 files, all missing-text/missing-file, not collection errors.

### @implementation-lead — 2026-09-23

GREEN @ 7b0adad. Ruling be1d195 sections (a)/(b)/(c)/(e) implemented:
- (a) new fail-closed first-sentence wording, byte-identical across all ten `.claude/agents/*.md`
- (b)/(c) `scripts/cairn/check_lead_not_in_worktree.py` (imports `ensure_metrics_worktree._is_linked_worktree`), wired into `/start-feature` step 0 Pre-flight + a Failure-modes line
- (e) one-sentence fail-closed bullet in WORKFLOW.md's worktree section

`test_agent_worktree_protocol_block.py`, `test_agent_git_identity.py`, `test_check_lead_not_in_worktree.py`: 24/24 green. Full `run_tests.py --gate green`: 1717 tests green.

Not this loop's scope (per ruling): the SessionStart hook line in (b) — settings.json is not mine to touch; team-lead has that text.

### @architect — 2026-09-23

**Verdict: APPROVE @ 7b0adad** (reviewed diff be1d195..6225a17 against ruling @ be1d195).

| Axis | Result | Evidence |
|---|---|---|
| AC1 block wording (a) | pass: ruling text verbatim, byte-identical ×10, fail-closed clause before identity step | 7b0adad `.claude/agents/*.md` |
| AC2 lead guard (b) | pass: `/start-feature` step 0 + failure-mode line; exit codes and stdout message per ruling | 7b0adad SKILL.md, check_lead_not_in_worktree.py |
| Detection (c) | pass: reuses `_is_linked_worktree` (git-dir ≠ common-dir). Measured on a scratch repo: main 0, main/sub 0, wt 1, wt/sub 1, non-git 0, both via `--cwd` and default cwd. Import has no side effects (module-level constants only). | 7b0adad |
| AC3 tests (d) | pass. Mutation: drop `unconditionally` ×10 → red on "EnterWorktree called unconditionally"; drop "set no identity, write no file" ×10 → 2 red in FailClosedClauseTests; restored → the 3 modules OK | 7b0adad |
| AC4 WORKFLOW (e) | pass: ruling sentence verbatim, placed after "The lead never enters a worktree" | 7b0adad WORKFLOW.md |

Non-blocking:
- No unit test covers a subdirectory of the MAIN checkout (the false-positive direction). Measured correct above; worth adding if the module is touched again.
- The SessionStart hook line from ruling (b) still waits on the user (settings.json). Not AC-gating.

### @qa-engineer — 2026-09-23

VERDICT: PASS @ 88a4d5b.
`python3 run_tests.py --gate verdict` (scripts/cairn, worktree): 1717 tests, OK (skipped=4).
`node --test "scripts/cairn/tests/js/**/*.test.js"`: 479 tests, 477 pass, 2 fail -- both the layerchart ENOENT in token-chart-logic.test.js (POLY-8, node_modules not installed in this worktree, identical on main).
Acceptance criteria (POLY-5): fail-closed block, lead guard script, extended identity/drift tests, WORKFLOW.md sentence -- all present and green. Sign-off for merge.

### @team-lead — 2026-09-23

PR opened: https://github.com/richmosko/polycarpic/pull/8. Awaiting Validate.
