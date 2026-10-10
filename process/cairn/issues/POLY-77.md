---
id: POLY-77
title: Real-data import adapter for GA (SimpleFIN and/or CSV/OFX file import)
status: backlog
milestone: POLY-1.0
parent: null
blocked_by: [POLY-64]
assignee: null
labels: [import]
priority: null
pr: null
created: 2026-09-28
updated: 2026-09-28
---

ARCH OQ-7. PRD goal 1 (100% of one entity's transactions through import → draft → confirm) needs a real data path; no backlog story covered one. Scope pending the Principal's answer: SimpleFIN Bridge adapter (sealed access URL, provider-side revocation), a credential-free CSV/OFX file adapter (SecEng's preferred default for self-hosters), or both. Either one implements the ImportAdapter interface from POLY-64 (ARCH §2.3).

## Acceptance criteria

- [ ] Scope confirmed with the Principal (OQ-7) and recorded here.
- [ ] The adapter implements ImportAdapter and passes the same import-layer test suite as the fake source.
- [ ] Credentials (if any) are sealed via packages/secrets and never logged; unlink revokes at the provider.