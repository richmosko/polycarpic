---
id: POLY-26
title: backfill_tokens.py scans only the main project slug; backfilled teammate lines are unattributed
status: backlog
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P3
pr: null
created: 2026-09-24
updated: 2026-09-24
---


## Comments

### @team-lead — 2026-09-24

From the POLY-10 gate-1 ruling (architect, telemetry-attribution.md @ 3d83a20 §c): POLY-10 adds `_transcript_path_for` to otel_receiver.py so live lines resolve teammates via the `<slug>--claude-worktrees-*` sibling dirs, but `backfill_tokens.py` still scans only the main slug dir, so a backfill run leaves teammate lines as `subagent-unattributed`. Move the resolver into backfill_tokens (the shared module the receiver already imports from) and use it in the backfill scan, with a fixture test; then re-run the backfill on this repo.
