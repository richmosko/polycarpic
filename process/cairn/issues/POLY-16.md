---
id: POLY-16
title: cairn close: same-assignee siblings closed back-to-back collapse into the first window (close at stage end or stage-aware windows)
status: in-progress
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, workflow]
priority: P2
pr: null
created: 2026-09-24
updated: 2026-09-24
---
Found on POLY-3's first reference class: same-assignee sub-issues closed back-to-back at finish-feature collapse into the first one's window (POLY-11 took 4 gate cycles incl. both review rounds, POLY-14 got 0). See the team-lead comment for the mechanism and the options.

## Acceptance criteria

- [ ] Architect ruling (design note `scripts/cairn/design/estimation.md` §2 revised) picks the fix: close-at-stage-end as a workflow rule, stage-aware windows in `cairn close`, or both — with the window definition stated per stage
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

Gate-1 ruling: read scripts/cairn/design/estimation.md §2 → Stage windows @ d9dd5f8.
Fix is both: (a) the lead closes each stage at its gate (plan at design-gate clear + each addendum; review after each verdict; execute at the approving verdict); (b) `cairn close --at <sha>` sets the window ceiling to a gate commit, so a late close measures as if run at the gate. The sibling floor now excludes self and later stages. Re-close is allowed: status stays done, `bloat` is re-evaluated, last line per id wins.
A purely log-derived plan/review boundary was rejected: on POLY-3's log it puts addendum 1 in review, so POLY-11 comes out at 1, not 2 (measured).
AC4 expected: POLY-11 --at b6caa8a → 2; POLY-14 --at de60cde → 2. Close POLY-11 first. qa's seven tests are listed in the note.

### @team-lead — 2026-09-24

Gate-1 ruling accepted @ d9dd5f8 (both: close-at-stage-end rule + `--at <sha>` ceiling; sibling floor excludes self and later stages; re-close allowed with bloat re-evaluated). First application of rule (a): POLY-17 (architect/plan) closed now, at design-gate clear, from the main checkout.
