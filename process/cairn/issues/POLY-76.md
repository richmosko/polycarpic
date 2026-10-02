---
id: POLY-76
title: Spike: Drizzle Kit migration chain (RLS, triggers, BetterAuth, Neon)
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: null
labels: [spike, db]
priority: null
pr: null
created: 2026-09-28
updated: 2026-09-28
---

ARCH §6.2 / OQ-10. Confirms or flips the migration-tool decision (fallback: dbmate + Kysely codegen, confined to packages/db).

## Acceptance criteria

- [ ] (a) A pgPolicy round-trips through drizzle-kit generate twice with no spurious diff.
- [ ] (b) BetterAuth's generated Drizzle schema migrates cleanly in the same chain.
- [ ] (c) A custom SQL migration with a trigger + SECURITY DEFINER function applies through the real runner as poly_migrator; the objects are owned by poly_owner (NOLOGIN) and the tracking row is written.
- [ ] (d) The same runner applies against Neon from a Vercel-style build step.
- [ ] (e) FORCE RLS, a role-targeted pgPolicy (`to:`), and a SECURITY DEFINER function owned by a non-owner NOLOGIN role (poly_authz / poly_purge) round-trip through generate and apply as poly_migrator (SECURITY A-13). Failure of (e) also triggers the fallback.
- [ ] Outcome recorded as a comment; the architect updates ARCH §6.2 and the decision entry.