---
id: POLY-46
title: backfill_tokens: a write must not double-count against existing otel lines on /api/tokens
status: backlog
milestone: POLY-A
parent: POLY-50
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @architect — 2026-09-25

From the POLY-26 ruling (process/reviews/POLY-26/ruling.md, M6/M7): cairn.build_tokens_payload (/api/tokens) sums every source per (issue, role), so a transcript-backfill write whose window overlaps existing otel lines double-counts on the dashboard; token_actuals is safe (otel-only). On this repo otel came first (112 lines, 2026-09-24..), so any backfill write today overlaps fully. The PT-89 generated-stamp guard protects only future otel flushes. Fix candidates: a --until cutoff at the earliest otel record, or source precedence per window in the reader. Prerequisite for any backfill write on this repo.
