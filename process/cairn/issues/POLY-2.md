---
id: POLY-2
title: Path-ownership push check for concurrent writers
status: in-progress
milestone: POLY-A
parent: null
blocked_by: [POLY-1]
assignee: null
labels: [workflow, cairn]
priority: P1
pr: null
created: 2026-09-23
updated: 2026-09-23
---


Worktree isolation guarantees one writer per checkout, but several agents push
to the same feature branch. Kickoff decision: `docs/project_kickoff.md` § 2.1
→ *One writer per file*: each cairn sub-issue declares the paths its agent may
touch, and a push-time check compares the agent's commits against the declared
paths and fails loudly on a stray file. Depends on POLY-1: the check attributes
commits by git author identity.

## Acceptance criteria

- [ ] `process/TRACKER.md` frontmatter schema gains an optional `paths:` list (glob patterns, repo-relative) on issues; `cairn check` validates it and `cairn new --paths` / `cairn set <ID> paths=…` write it
- [ ] `cairn guard-push <ID>` lists the files changed by commits authored by the sub-issue's assignee between the branch base and HEAD, and exits non-zero naming every file outside the declared globs
- [ ] A sub-issue with no `paths:` field passes with a warning, not a failure (opt-in, not a hard gate for existing flows)
- [ ] The shared worktree-protocol block runs `cairn guard-push` before `git push` and the push is skipped on failure
- [ ] Unit tests in `scripts/cairn/tests/` cover: in-bounds commit, stray file, no `paths:` declared, glob semantics (`src/auth/**`)
- [ ] The board's issue drawer shows the declared paths on a sub-issue

## Comments

### @team-lead — 2026-09-23

Feature started. Branch: `feature/poly-2-path-ownership-push-check`. Roster: implementation-lead + qa-engineer; architect reviews at gate 3.

### @architect — 2026-09-23

**Gate-1 ruling — POLY-2.** Seams and thresholds are fixed here. Nothing is left to propose by message.

1. **Branch base.** `base = git merge-base <main-ref> HEAD`, where `<main-ref>` is `origin/main` if it resolves and local `main` otherwise. If neither resolves: exit 2. Range = `base..HEAD`, run with `--no-merges`, so files that arrive when main is merged in never count. Why: the fork point is the only anchor that stays correct after `main` is merged into the feature branch, and local `main` goes stale in worktrees. Rejected: diffing against `origin/<feature-branch>`. It checks only this push, so a stray file already pushed passes on the next run.
2. **Glob matcher.** Use a hand-rolled glob→regex translator in cairn.py, stdlib only. Do not use `fnmatch` or `PurePath.full_match`: `full_match` needs Python 3.13+, and cairn has no stated version floor. Semantics: patterns are repo-relative and use `/` separators. `**` as a whole segment matches zero or more segments. `*` matches within one segment and never crosses `/`. `?` matches one non-`/` char. Every other char is literal (no `[...]` classes). Dotfiles are not special. `src/auth/**` matches `src/auth/a.py` and `src/auth/x/y.py`. It does not match `src/authz/a.py`. A pattern with no wildcards matches exactly one path.
3. **Attribution.** File list = `git log --no-merges --no-renames --format=%an --name-only base..HEAD`. Keep the commits whose author name equals the issue's `assignee` exactly (per-agent `user.name`, POLY-1). `--no-renames` lists both sides of a rename. Deletions count as touches. Cases:
   - no `paths:` → warn on stderr, exit 0;
   - `paths:` set and `assignee: null` → exit 2 ("cannot attribute");
   - `@handle` (human) assignee → warn, exit 0 (humans are not under the protocol);
   - assignee has zero commits in range → exit 0.
   The guard keys on the *issue's* assignee, not on the invoking identity. So running it from the lead's main checkout is a valid audit of that agent's commits. The lead's own commits are never checked. Exit codes: 0 pass, 1 stray files (every offending path listed, sorted, one per line), 2 usage/config error (unknown ID, unresolvable base, null assignee).
4. **`paths:` field.** Optional `list[string]`. Add it as a row in TRACKER.md → issue frontmatter table, directly after `assignee`. An absent key means undeclared, which is not the same as `[]`: an explicit `[]` means "may touch nothing". Add it to `LIST_FIELDS` so `--paths a,b` and `paths=a,b` share `_split_csv`. `cairn check` validates **shape only, never existence** (a feature creates its own files). Each entry must be a non-empty string with no leading `/`, no `..` segment, no `\`, and no `**` fused to other chars (`a**b`). Add `guard-push` to the CLI table.
5. **Protocol-block placement.** Replace the "On completion" sentence in the shared block, byte-identical across all ten files: "On completion: if your assignment names a cairn sub-issue, run `scripts/cairn/cairn guard-push <ID>` first — on a non-zero exit do not push; report the listed files to the lead — then `git push origin HEAD:<feature-branch>` (fast-forward only — never `--force`), then report the sha…". qa adds a sixth required element (`guard-push` precedes `git push`) to `test_agent_worktree_protocol_block.py`. The existing push/fast-forward regex still matches.

Board drawer: render `paths` as a monospace list under assignee, and hide it when absent. Ownership for this loop: implementation-lead owns `scripts/cairn/**` minus `tests/`, `process/TRACKER.md`, `.claude/agents/*.md`. qa-engineer owns `scripts/cairn/tests/**`.
