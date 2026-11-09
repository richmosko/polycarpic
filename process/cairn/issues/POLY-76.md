---
id: POLY-76
title: Spike: Drizzle Kit migration chain (RLS, triggers, BetterAuth, Neon)
status: done
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [spikes/poly-76/**, process/cairn/reviews/POLY-76/**]
labels: [spike, db]
priority: P1
pr: https://github.com/richmosko/polycarpic/pull/98
created: 2026-09-28
updated: 2026-11-09
---

ARCH §6.2 / OQ-10. Confirms or flips the migration-tool decision (fallback: dbmate + Kysely codegen, confined to packages/db).

## Acceptance criteria

- [x] (a) A pgPolicy round-trips through drizzle-kit generate twice with no spurious diff.
- [x] (b) BetterAuth's generated Drizzle schema migrates cleanly in the same chain.
- [x] (c) A custom SQL migration with a trigger + SECURITY DEFINER function applies through the real runner as poly_migrator; the objects are owned by poly_owner (NOLOGIN) and the tracking row is written.
- [x] (d) Deferred to POLY-121 (Principal, 2026-11-09): the same runner applies against Neon from a Vercel-style build step, tested if and when the Vercel target is scheduled. Not a flip condition for the spike.
- [x] (e) FORCE RLS, a role-targeted pgPolicy (`to:`), and a SECURITY DEFINER function owned by a non-owner NOLOGIN role (poly_authz / poly_purge) round-trip through generate and apply as poly_migrator (SECURITY A-13). Failure of (e) also triggers the fallback.
- [x] Outcome recorded as a comment; the architect updates ARCH §6.2 and the decision entry.
- [x] (b′) BetterAuth's Kysely path reads and writes the Drizzle-declared tables with no column mismatch, and the ARCH §3.1c grants hold when it runs as poly_app.
- [x] (f) OQ-16: whether user.create.after shares the user insert's transaction, and whether a context-free transaction of ours around invitation sign-up makes provisionPerson atomic.
- [x] The record (versions, commands, pass or fail per item) is committed at process/cairn/reviews/POLY-76/spike.md. Spike code stays under spikes/poly-76/ and nothing in packages/* or apps/* imports it.

## Comments

### @architect — 2026-11-08

Decomposition 2026-11-08: (b′) and (f) added to match ARCH §6.2 and OQ-16 in v1.9.

### @team-lead — 2026-11-08

Principal ruling (2026-11-09): check (d) is deferred to POLY-121 (Vercel + Neon target); the spike runs (a), (b), (c), (e), (f) against the local and CI Postgres. (f) returns to the Principal and the architect on failure rather than flipping the tool.

### @team-lead — 2026-11-08

Feature started. Branch: `feature/poly-76-migration-spike`.

### @backend-lead — 2026-11-08

Spike built (POLY-76b). (a) PASS, (b) PASS, (c) PASS, (e) PASS; (b') behaviour PASS but check-b-prime.mjs fails two raw-SQL assertions that assume camelCase columns (CLI schema is snake_case; BetterAuth needs a `fields` map to match, a workaround). (f): user.create.after does NOT share the user insert's transaction; our context-free tx makes sign-up + provisioning atomic. FORCE RLS is custom SQL only. Detail: process/cairn/reviews/POLY-76/spike.md

### @architect — 2026-11-08

Outcome (architect, POLY-76c): CONFIRM Drizzle Kit; ruling at process/cairn/reviews/POLY-76/ruling.md, ARCH v1.13 §6.2 updated to final. The decision-log half of 'Outcome recorded' is the lead's, so that item stays unticked until the ledger entry lands.

### @team-lead — 2026-11-08

PR opened: https://github.com/richmosko/polycarpic/pull/98. Awaiting Validate. Outcome: Drizzle Kit confirmed (ruling.md, ARCH v1.13 §6.2, DECISIONS 2026-11-09). Lead's correction: the 76a and 76b `paths:` omitted each agent's own issue file, which the dispatch told them to update, so guard-push failed on those files only; the lists are corrected and guard-push passes for all three.

### @team-lead — 2026-11-09

Validate passed (qa-engineer: "validate green", PR #98 at 24b631b); merging via PR #98. Closing.

The Principal answered the ruling's one question (§3) on 2026-11-09: yes, every user-creating sign-up route runs inside our own transaction, with the session-loader re-run as a backstop only. Logged in `process/DECISIONS.md`; ARCH §3.1 and POLY-87 follow in a doc update.
