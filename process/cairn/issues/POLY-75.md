---
id: POLY-75
title: CPI-U inflation series + real-vs-nominal chart toggle
status: backlog
milestone: POLY-M4
parent: null
blocked_by: []
assignee: null
labels: []
priority: null
pr: null
created: 2026-09-27
updated: 2026-09-28
---

PRD §4 Story 9, §5 FRs. Ingest BLS series CUUR0000SA0 (monthly) via BLS API v2, same pattern as security price series; render any time-series chart nominal or inflation-adjusted with a selectable base period (default: latest available month); operate without a key on the v1 endpoint or accept manual CSV import as a fallback. Prerequisite: register a free BLS API v2 key (bls.gov/developers, 500 queries/day) before implementation starts; key is a low-tier secret, never logged, never in the repo. Source: docs/PRD/index.html