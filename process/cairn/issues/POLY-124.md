---
id: POLY-124
title: GL build-vs-adopt decision
status: todo
milestone: POLY-C
parent: null
blocked_by: []
assignee: architect
paths: [docs/ARCH/**, process/DECISIONS.md]
labels: [plan, ledger, decision]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

ARCH §6.1 recommends building the general ledger in our own Postgres schema over adopting pgledger or a TS library, with a borrow list from pgledger and mosko-fintech. The research is done; what the gate lacks is the Principal's approval and a ledger entry. This issue closes the "GL build-vs-adopt research concluded" clause of POLY-C.

## Acceptance criteria

- [ ] The Principal approves or overturns the ARCH §6.1 recommendation (build); the ruling is recorded as a comment here.
- [ ] `process/DECISIONS.md` carries the entry: decision, why, alternatives considered (pgledger, Medici and other TS libraries, the external services ruled out in kickoff §2.5), approver and date. The architect drafts it; the team-lead lands it.
- [x] ARCH §6.1 reads "Decision" instead of "Recommendation" and cites the entry; the §5 stack row and the §10 trade-off row agree with it.
- [x] The borrow and leave-behind lists in §6.1 are traced to the M1 or M2 issues that build them (the immutability fence, the lot-match junction, the RLS inversion self-test, the migration ownership pattern), or a gap is filed.

## Comments

### @team-lead — 2026-11-08

Principal ruling (2026-11-09): build the general ledger in our own schema, with the borrow list from pgledger and mosko-fintech (ARCH §6.1). pgledger-and-fork was the alternative considered. The architect drafts the DECISIONS entry and flips §6.1 to "Decision".
