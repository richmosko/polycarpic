---
id: POLY-15
title: prices.json lacks claude-opus-5-5; one unpriced model nulls an issue's whole cost
status: backlog
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-23
updated: 2026-09-23
---


## Comments

### @team-lead — 2026-09-23

Found in the POLY-3 loop (architect ruling @ de60cde: not a POLY-3 defect — a null total when any model is unpriced is `build_tokens_payload`'s existing posture, chosen over understated totals). Evidence: `token_actuals(POLY-3)` → 83.3M tokens over 6 otel lines, cost null; the team-lead role alone (claude-fable-5-1) costs out at $6.23, the teammate lines (claude-opus-5-5, claude-sonnet-5) null the total because `claude-opus-5-5` has no row.
AC: (1) add the `claude-opus-5-5` rate to `scripts/cairn/prices.json` (dated, same shape as the other rows); (2) decide and test whether an unpriced model should yield a partial cost plus a named warning instead of null — either way, the behaviour is stated in TRACKER.md's telemetry section.
Two non-blocking loop-stats notes from the same review, file with this or drop: (a) loop-stats cost is now otel-only, so an issue with only backfill lines shows "—"; (b) a role with two transcripts shows the full role token total on each key.
