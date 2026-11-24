---
id: POLY-160
title: Deploy follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-100]
assignee: devops-engineer
labels: [ops, deploy, security]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-23
---

The lesser findings from POLY-100's third build review, and other deploy items POLY-100 deferred. By the Principal's decision of 2026-11-24 (`process/DECISIONS.md`), POLY-100's third review holds the PR only for a fault that lets an unverified release run, bypasses the compose guard, loses or exposes data, or leaves a bad release running; every other finding lands here. This issue must be done before the first staging deploy (POLY-104). seceng reviews the ruling and the build. Add later deploy nits here rather than filing one issue each.

## Acceptance criteria

- [ ] Every finding seceng's third build review of POLY-100 marks "follow-up" (`process/cairn/reviews/POLY-100/build-review.md`) is fixed, each with a test shown red on the fault.
- [ ] The end-to-end deploy test (T-real) still passes, and its measured CI time is recorded against the image job's 20-minute limit.
- [ ] `self-update` installs the ops bundle from the attested release (POLY-98 R-b; POLY-100 ruling §L2), or is given its own issue with the reason.
