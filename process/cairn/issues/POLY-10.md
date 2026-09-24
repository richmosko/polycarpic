---
id: POLY-10
title: OTel receiver has never written token-usage.jsonl; watchdog thread crashed on a missing .sessions/.closing path
status: todo
milestone: POLY-A
parent: null
blocked_by: []
assignee: null
labels: [cairn, telemetry]
priority: P2
pr: null
created: 2026-09-23
updated: 2026-09-23
---


## Comments

### @team-lead — 2026-09-23

Found 2026-09-24 during the POLY-3 design review. The receiver (pid 61107, started 2026-09-22 22:45) listened on 4318 for a day with 13 registered sessions and never produced `process/cairn/metrics/token-usage.jsonl`. Its log holds one traceback: the `_watchdog_loop` thread died with `FileNotFoundError` on `process/cairn/metrics/.sessions/.closing` — consistent with `ensure_metrics_worktree.py` swapping the metrics dir aside under a running receiver. Also worth checking: the lead's Bash env shows only `CLAUDE_CODE_ENABLE_TELEMETRY=1`, none of the `OTEL_*` exporter vars from `.claude/settings.json` → `env`, so exports may never reach the receiver at all. Restarted bare at review time; POLY-3's reader treats a missing file as `actual.tokens: null` + warning, so POLY-3 does not block on this, but calibration data is empty until it is fixed.
Acceptance: (1) watchdog survives a swapped/absent `.sessions` dir (recreate or exit loudly, never a dead thread under a live listener); (2) `--status` reports the watchdog thread state and last flush time; (3) a smoke test proves one metrics export lands as an `otel` line; (4) root-cause the absent `OTEL_*` vars in tool subshells and document the finding in TRACKER.md's telemetry section.
