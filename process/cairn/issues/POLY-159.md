---
id: POLY-159
title: Daily off-box bucket check
status: backlog
milestone: POLY-M6
parent: null
blocked_by: [POLY-104]
assignee: devops-engineer
labels: [infra, security, backup]
priority: null
pr: null
created: 2026-11-23
updated: 2026-11-24
---

A scheduled job outside the box lists the backup bucket once a day and pings the alert service, so an uploader that reports `verified` without uploading is seen within a day rather than at the monthly drill (POLY-99 ruling §D3; seceng's ruling on TB-12 in `process/cairn/reviews/POLY-99/ruling-review.md`). Filed by the Principal's decision of 2026-11-23 (`process/DECISIONS.md`, D3). It gates the first real household data, as the Healthchecks alarm does, and does not wait on POLY-103. It needs a real bucket, so it follows POLY-104.

## Acceptance criteria

- [ ] `b2-setup.py` creates a key holding exactly `listFiles` (plus `listBuckets` only if measured necessary), restricted to the one bucket, and asserts that set.
- [ ] The key is a GitHub environment secret used by one scheduled workflow with `permissions: contents: read`; the job runs a stdlib script only, no third-party action, on a pinned runner image.
- [ ] The job fails when last night's set is missing, late, hidden or has a second version, and passes otherwise; each failure case is shown red against the fake bucket.
- [ ] The job prints counts and pass or fail, never object names, file IDs or the bucket name (the repository is public).
- [ ] The job pings its own Healthchecks check, and its failure address on failure.
- [ ] SECURITY records TB-12's exception and what a stolen list-only key reveals; INFRA's pre-real-data gate lists this check.
