---
id: POLY-84
title: RLS battery harness
status: todo
milestone: POLY-M1
parent: null
blocked_by: [POLY-83]
assignee: qa-engineer
paths: [packages/db/test/**]
labels: [qa, db, security]
priority: P2
pr: null
created: 2026-11-08
updated: 2026-11-08
---

The pgTAP battery's cross-cutting probes (SECURITY §12.3 qa-engineer block; ARCH §3.3 Proof), run on every migration change against a fresh Postgres through the real runner. This issue owns the harness and the catalog-derived checks; each feature issue adds its own assertions. POLY-96 runs it on packages/db changes.

## Acceptance criteria

- [ ] Inversion self-test: an unprotected canary table leaks, proving the probe has teeth.
- [ ] A per-table cross-tenant probe generated from pg_catalog (never a hand list); a table with RLS disabled or not FORCEd fails. Scope is every table outside `pg_catalog` and `information_schema`, partitions and partitioned parents included (`pg_class` relkind `r` and `p`), checked on `relrowsecurity` and `relforcerowsecurity`.
- [ ] The FORCE probe's exemptions are one short list named in the test file itself: BetterAuth's tables (`user`, `session`, `account`, `verification`, plus the `twoFactor` and `passkey` tables when they land; no entity RLS, ARCH §3.1c) and `drizzle.__drizzle_migrations` (ruling `process/cairn/reviews/POLY-76/ruling.md` §4.1). Adding an entry is a reviewed diff; nothing is exempted by name pattern or schema.
- [ ] Each exemption is asserted to still exist in the catalog, so a stale or misspelled entry fails the run instead of silently exempting nothing.
- [ ] Canary for the FORCE probe: a table with RLS enabled but not FORCEd fails the probe (and, separately, a table with RLS disabled fails it); a canary on the exemption list passes it. Both canaries are created and dropped inside the test.
- [ ] Pool reuse on a dirty backend (C-12): tenant A, then tenant B on the same physical connection sees zero A rows; a context-free query there sees zero rows.
- [ ] WITH CHECK forgery probe; FOR ALL policies refused.
- [ ] Definer allowlist (C-15): every SECURITY DEFINER function is listed, has search_path = '', and is owned by an allowed role; trigger functions fail when called directly.
- [ ] Role hygiene (C-10); security_invoker on every view; no materialized view over tenant data; TRUNCATE triggers present and no login role holds TRUNCATE.
- [ ] The SECURITY §4.2.1 permission matrix is a data-driven pgTAP test; rows activate as their tables land.
