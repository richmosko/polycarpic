---
id: POLY-125
title: Migration-tool decision
status: todo
milestone: POLY-C
parent: null
blocked_by: []
assignee: architect
paths: [docs/ARCH/**, process/DECISIONS.md]
labels: [plan, db, decision]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

ARCH §6.2 recommends Drizzle Kit with a dbmate + Kysely fallback confined to `packages/db`, gated by the M1 spike POLY-76. The research half belongs to this Plan milestone and closes here; the spike stays in POLY-M1 as its first enabler, because it needs the monorepo, a real Postgres and Neon. The gate clause "migration-tool research concluded" is met by a provisional decision with explicit flip conditions, not by the spike's result.

## Acceptance criteria

- [ ] The Principal approves Drizzle Kit as the provisional tool and dbmate + Kysely as the fallback; the ruling is recorded as a comment here.
- [ ] `process/DECISIONS.md` carries the entry, marked provisional, naming POLY-76 as the confirming spike and its acceptance items (a) to (f) as the flip conditions. The architect drafts it; the team-lead lands it.
- [ ] ARCH §6.2 states the decision as provisional pending POLY-76 and cites the entry.
- [ ] POLY-76 stays first in POLY-M1's enabler order and keeps blocking POLY-83 (roles, migrate, withTenant), so no schema migration is written before the tool is confirmed; POLY-82 (monorepo) may run alongside it.
