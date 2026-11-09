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
updated: 2026-11-08
---

ARCH OQ-7. PRD goal 1 (100% of one entity's transactions through import → draft → confirm) needs a real data path; no backlog story covered one. Scope settled by the data-source ruling (2026-11-06): GA needs the credential-free CSV/OFX file import working end to end; a direct free API and Plaid follow, SimpleFIN only if a custodial needs it. Each adapter implements the ImportAdapter interface from POLY-64 (ARCH §2.3).

## Acceptance criteria

- [ ] File import (CSV/OFX) runs end to end into drafts for a real custodial; direct and Plaid adapters follow in that order.
- [ ] The adapter implements ImportAdapter and passes the same import-layer test suite as the fake source.
- [ ] Credentials (if any) are sealed via packages/secrets and never logged; unlink revokes at the provider.
- [ ] The log canary (SECURITY C-33) is in CI before this adapter merges: a seeded credential and account number never appear in any log line.

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: scope settled by the data-source ruling (2026-11-06, OQ-7). GA needs the file import path (CSV/OFX) working end to end; a direct free API and Plaid for the Principal's custodials are additional, SimpleFIN only if a custodial needs it. Before GA the Plaid Sandbox runs on staging, and a backup restore drill (POLY-116) is the GA gate. C-33 log canary added (lead ruling).
