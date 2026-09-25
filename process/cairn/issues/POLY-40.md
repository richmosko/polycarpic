---
id: POLY-40
title: Test hygiene: frontmatter round-trip fixtures derive optional fields from the schema instead of hardcoding them
status: backlog
milestone: POLY-A
parent: POLY-48
blocked_by: []
assignee: null
labels: [cairn, tests]
priority: P3
pr: null
created: 2026-09-25
updated: 2026-09-25
---


## Comments

### @team-lead — 2026-09-25

Three loops in a row (POLY-3 seven keys, POLY-16 none but POLY-6 the R2 floor, POLY-34 two cost keys) a schema change to ISSUE_FIELD_ORDER broke the same three tests in scripts/cairn/tests/test_frontmatter_rewrite.py (the `_OPTIONAL_UNDECLARED_FIELDS` tuple and one hardcoded dict), each costing a qa fixture round after the builder's green. AC: the fixtures compute the optional/undeclared set from `cairn.ISSUE_FIELD_ORDER` minus the fields the fixture declares, so adding a schema key needs no test edit; keep one explicit assertion that pins the canonical order string so a reordering is still caught.
