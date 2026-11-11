---
id: POLY-135
title: CI: CodeQL scanning
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: devops-engineer
labels: [ci, security]
priority: null
pr: null
created: 2026-11-10
updated: 2026-11-10
---

Add CodeQL scanning to CI. SECURITY C-82 lists it as a target, not a control in force, until this lands. Split out of POLY-102 by the Principal (2026-11-11) because its cost per PR is unmeasured. Source: POLY-96 ruling §7 O4, seceng condition S96-13.

## Acceptance criteria

- [ ] CodeQL runs on PRs and on `main` for the JavaScript/TypeScript and Python code, with pinned actions (C-81).
- [ ] The added minutes per PR are measured on at least two runs and recorded on this issue before the scan joins the required `app` check.
- [ ] SECURITY C-82 states CodeQL as a control in force.
