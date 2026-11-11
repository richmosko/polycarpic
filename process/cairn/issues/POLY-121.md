---
id: POLY-121
title: Vercel + Neon target
status: backlog
milestone: POLY-1.2
parent: null
blocked_by: [POLY-96, POLY-99]
assignee: devops-engineer
paths: [infra/vercel/**, infra/ops/neon-*]
labels: [ops, vercel, post-ga-candidate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-11
---

Post-GA, in POLY-1.2 (Principal, 2026-11-09); timing not yet set. INFRA §4.7, §6.6, §7.4, D-11/D-12: signature-verified tag deploy from the laptop, the per-project env-name check, the weekly encrypted Neon export with the put-only key, and restore. Needs the ARCH §7.6 two-project split built first (not yet filed). Records OQ-INFRA-6 at first stand-up.

## Acceptance criteria

- [ ] deploy.sh refuses an unsigned tag; check.sh prints keyring: jobs only.
- [ ] A cron route without the secret returns 401, and 404 on the web project.
- [ ] An export restores into a fresh Neon project.
- [ ] The migration runner applies against Neon from a Vercel build step (spike check (d), deferred here from POLY-76 by the Principal, 2026-11-09).
- [ ] OQ-INFRA-6 (Neon restore window, Vercel Hobby limits) is recorded.

## Comments

### @team-lead — 2026-11-09

From the POLY-83 architect ruling, Addendum 1 (`process/cairn/reviews/POLY-83/ruling.md`): `packages/db/sql/roles.sql` must run as the Postgres superuser (poly_backup needs REPLICATION + BYPASSRLS; ALTER DEFAULT PRIVILEGES for the definer-owner roles). Neon exposes no superuser, so the file cannot run there as written. Decide here: a Neon-specific variant without poly_backup and with neon_superuser's grantable subset, or Neon is out of scope for self-hosters' parity. Not a POLY-83 blocker.

### @team-lead — 2026-11-11

From the POLY-86 loop (seceng S19): the Vercel target needs its own client-IP ruling and rate-limit storage. POLY-86 trusts a single-entry `X-Forwarded-For` written by Caddy and keeps counters in process memory; neither holds on Vercel.
