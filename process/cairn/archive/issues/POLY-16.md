---
id: POLY-16
title: cairn close: same-assignee siblings closed back-to-back collapse into the first window (close at stage end or stage-aware windows)
status: done
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, workflow]
priority: P2
pr: https://github.com/richmosko/polycarpic/pull/10
created: 2026-09-24
updated: 2026-09-24
---
Found on POLY-3's first reference class: same-assignee sub-issues closed back-to-back at finish-feature collapse into the first one's window (POLY-11 took 4 gate cycles incl. both review rounds, POLY-14 got 0). See the team-lead comment for the mechanism and the options.

## Acceptance criteria

- [ ] Architect ruling (design note `scripts/cairn/docs/estimation.md` §2 revised) picks the fix: close-at-stage-end as a workflow rule, stage-aware windows in `cairn close`, or both — with the window definition stated per stage
- [ ] `cairn close` implements the ruled windowing; a plan and a review sub-issue for the same assignee, closed back-to-back, each get their own commits; unit tests in `scripts/cairn/tests/test_estimation.py` cover the pair and the same-stage sibling case
- [ ] `process/WORKFLOW.md` → Estimation states when each stage's close runs (plan at design-gate clear, execute at verdict, review after each verdict) and who runs it
- [ ] POLY-3's reference class is re-closed under the fix on this branch: POLY-11 ≈ 2 gate cycles, POLY-14 ≈ 2, calibration records appended (readers take the last line per id)
## Comments

### @team-lead — 2026-09-24

Found on POLY-3's own first reference class (closes @ 07d31c8). The architect held POLY-11 (plan) and POLY-14 (review). Both were closed at finish-feature, in order. POLY-11's window floor was the branch's first commit and its end the architect's last commit in W — which was the review re-verdict (de60cde), so the plan sub-issue absorbed every architect commit (gate_cycles=4, incl. both review rounds) and POLY-14 got the leftover window: gate_cycles=0, wall_clock null, with the zero-commit warning.
Root cause: note §2's sibling floor assumes a sub-issue is closed when its stage ends, but WORKFLOW's Estimation section runs every close at finish-feature.
Options for the architect: (a) WORKFLOW rule — the lead closes a plan sub-issue when the design gate clears and a review sub-issue after each verdict, so the floor is real; (b) stage-aware windows — a plan window ends at the first same-parent execute commit, a review window starts at the first review commit; (c) both. AC: the POLY-3 reference class, re-closed under the fix, gives POLY-11 ≈ 2 cycles (note + addendum) and POLY-14 ≈ 2 (changes-requested + approve).

### @team-lead — 2026-09-24

Feature started. Branch: `feature/poly-16-stage-aware-close-windows`.
Lead estimate at start (calibration input; prior points: POLY-5 est 1–2 h / actual 21 min, POLY-3 est 60 min & 8 commits / actual 95 min & 32 commits): 14 commits, 2 gate cycles, ~45 min spawn→merge. Reference: `cairn estimate` on the sub-issues below.

### @architect — 2026-09-24

Gate-1 ruling: read scripts/cairn/docs/estimation.md §2 → Stage windows @ d9dd5f8.
Fix is both: (a) the lead closes each stage at its gate (plan at design-gate clear + each addendum; review after each verdict; execute at the approving verdict); (b) `cairn close --at <sha>` sets the window ceiling to a gate commit, so a late close measures as if run at the gate. The sibling floor now excludes self and later stages. Re-close is allowed: status stays done, `bloat` is re-evaluated, last line per id wins.
A purely log-derived plan/review boundary was rejected: on POLY-3's log it puts addendum 1 in review, so POLY-11 comes out at 1, not 2 (measured).
AC4 expected: POLY-11 --at b6caa8a → 2; POLY-14 --at de60cde → 2. Close POLY-11 first. qa's seven tests are listed in the note.

### @team-lead — 2026-09-24

Gate-1 ruling accepted @ d9dd5f8 (both: close-at-stage-end rule + `--at <sha>` ceiling; sibling floor excludes self and later stages; re-close allowed with bloat re-evaluated). First application of rule (a): POLY-17 (architect/plan) closed now, at design-gate clear, from the main checkout.

### @qa-engineer — 2026-09-24

RED @ 3c811b3 (test_estimation.py, 9 new tests per ruling d9dd5f8's Tests list 1-7).

7/9 fail right-reason: `close --at <sha>` is not a recognized flag yet
(argparse "unrecognized arguments"), covering items 1 (back-to-back pair),
4 (two review rounds), 5 (re-close idempotence + bloat removal), 6 (plan
re-close ignores later-stage sibling), 7 (--at off-history / at-flip exits 1).

2/9 pass unchanged (pinned regressions, not new behavior): item 2 (no --at
still defaults to `now`, reproduces POLY-3's collapse) and item 3 (same-stage
siblings unaffected).

Full `test_estimation*` run: 49 tests, 7 failures (all the above), rest green.
`_sibling_floor` still needs the self-exclusion + stage-order fix once --at
lands (idempotence/plan-reclose cases will stay red on --at's own logic
otherwise). Over to backend-lead for POLY-19.

### @implementation-lead — 2026-09-24

GREEN @ d95e7e3 (POLY-19): `close --at <sha>` implemented (ceiling on ref's first-parent history after the parent flip, `window.at` calibration key); `_sibling_floor` excludes self-id and later-stage siblings; re-close now removes `bloat` on a no-longer-overrunning re-evaluation, not just adds it. WORKFLOW.md → Estimation states per-stage close timing (rule a). Full `--gate green`: 1765/1766 pass. The one failure (`ReCloseIdempotenceTests.test_re_close_that_no_longer_overruns_removes_bloat`) asserts `bloat: False` where design note §3's unmodified contract (threshold unset + gate cycles within estimate = "not evaluated") gives `null` — flagged to team-lead; qa owns the assertion fix. POLY-11–14 re-closes left to the lead from the main checkout per this issue's plan.

### @architect — 2026-09-24

Verdict on 630da5c: **approve**.
- AC1: ruling d9dd5f8 is implemented as written (floor excludes self and later stages, last line per id; `--at` ceiling validated after the flip; `window.at` recorded; re-close adds or removes `bloat`).
- AC2: all seven ruled tests are present. `test_estimation` 49/49 OK, run via unittest discover in the architect worktree @ 630da5c.
- AC3: WORKFLOW → Estimation states who closes (the lead) and when each stage closes, matching the note.
- AC4: POLY-11 → 2 cycles, wall 46; POLY-14 → 2 cycles, wall 33. Both match the (from, at] windows (22:38:53→23:24:34, 23:24:34→23:57:33 local). `bloat` on both is correct (2 > est 1).
- Call 1 — the default stays explicit; do not auto-detect a merged parent. Picking the merge whose ^2 holds `<sha>` would infer the window from the log, which is what the ruling rejected. Under rule (a), a post-merge re-close is the exception, and the documented `--base <merge-base> --ref <merge>^2` form keeps base/ref visible in the record.
- Call 2 — `bloat: null` confirmed (note §3: threshold unset and no gate overrun means not evaluated). The lead's ruling and b321ccf stand.

### @qa-engineer — 2026-09-24

PASS @ ef18f50 (architect-approved 630da5c, verdict 243884b, POLY-20 closed at ef18f50).

`python3 run_tests.py --gate verdict`: 1766 tests, OK (skipped=4).
`node --test "scripts/cairn/tests/js/**/*.test.js"`: 479 tests, 477 pass, 2 fail
— both the known layerchart ENOENT (`node_modules/layerchart` not installed
in this worktree, POLY-8), unrelated to POLY-16.

All 9 POLY-18 stage-window tests green, including the re-close idempotence
and bloat-removal (now `bloat: null` per design note §3) and plan-reclose-
ignores-later-stage-sibling cases. AC4's re-close of POLY-11/POLY-14 (from
c15ec6f) verified by the suite, not just by inspection.

Verdict: PASS. Anchor #8 marked completed.

### @team-lead — 2026-09-24

PR opened: https://github.com/richmosko/polycarpic/pull/10. Awaiting Validate.

### @team-lead — 2026-09-24

Validate passed (qa PASS @ 68cd94d at ef18f50; architect APPROVE @ 243884b on 630da5c); merging via PR #10. Closing.
Estimate calibration: estimated 14 commits / 2 gate cycles / ~45 min at spawn (17:06Z). Actual: 15 commits (3 code, 12 chore), 1 red→green cycle + 1 assertion fix, review approved first pass, spawn → merge 2026-09-24T17:40Z ≈ 37 min. Loop cost $24.18. Prior points: POLY-5 est 1–2 h / 21 min; POLY-3 est 60 min & 8 commits / 95 min & 32 commits.
Sub-issues closed at their gates under rule (a): POLY-17 plan 1/1, POLY-18 execute 3 vs 2 (bloat), POLY-19 execute 2/2, POLY-20 review 1/1. POLY-3's class re-closed: POLY-11 2, POLY-14 2.
