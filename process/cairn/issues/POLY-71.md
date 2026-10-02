---
id: POLY-71
title: Transfer matching + Cash-in-Transit clearing
status: backlog
milestone: POLY-M3
parent: null
blocked_by: [POLY-64]
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-09-28
---

PRD §5 FR (reworded). Date-window matching lives at the import layer, never at posting. Same-date legs post as one multi-leg entry; different-date legs post through Cash in Transit (source-date: Dr CIT/Cr source; destination-date: Dr destination/Cr CIT). Unmatched legs stay open; items older than a configurable threshold (default 3 business days) surface on an exceptions report. Source: docs/PRD/index.html