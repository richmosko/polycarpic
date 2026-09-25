---
id: POLY-33
title: cairn check: 'closed via cairn set' warning keys on actual.tokens, which a legitimate close leaves null
status: backlog
milestone: POLY-A
parent: POLY-48
blocked_by: []
assignee: null
labels: [cairn]
priority: P3
pr: null
created: 2026-09-24
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-24

Found 2026-09-24 starting POLY-6: `cairn check` warns "status done with stage but no actual.* -- closed via cairn set" for POLY-11–14, 17–24, all of which were closed by `cairn close`. The check (cairn.py ~6774) tests `fm.get("actual.tokens") is None`, but addendum 1 of the estimation note makes null tokens the honest result when no receiver line matches, so every teammate close before POLY-10 (and any future miss) trips it. Fix: key on `actual.gate_cycles is None` (close always writes it, 0 included) and add a test with a null-token closed fixture that must not warn.
