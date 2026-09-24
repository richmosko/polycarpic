---
id: POLY-16
title: cairn close: same-assignee siblings closed back-to-back collapse into the first window (close at stage end or stage-aware windows)
status: todo
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


## Comments

### @team-lead — 2026-09-24

Found on POLY-3's own first reference class (closes @ 07d31c8). The architect held POLY-11 (plan) and POLY-14 (review). Both were closed at finish-feature, in order. POLY-11's window floor was the branch's first commit and its end the architect's last commit in W — which was the review re-verdict (de60cde), so the plan sub-issue absorbed every architect commit (gate_cycles=4, incl. both review rounds) and POLY-14 got the leftover window: gate_cycles=0, wall_clock null, with the zero-commit warning.
Root cause: note §2's sibling floor assumes a sub-issue is closed when its stage ends, but WORKFLOW's Estimation section runs every close at finish-feature.
Options for the architect: (a) WORKFLOW rule — the lead closes a plan sub-issue when the design gate clears and a review sub-issue after each verdict, so the floor is real; (b) stage-aware windows — a plan window ends at the first same-parent execute commit, a review window starts at the first review commit; (c) both. AC: the POLY-3 reference class, re-closed under the fix, gives POLY-11 ≈ 2 cycles (note + addendum) and POLY-14 ≈ 2 (changes-requested + approve).
