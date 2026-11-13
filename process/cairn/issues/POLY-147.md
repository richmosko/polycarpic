---
id: POLY-147
title: Identity marker (stage 1)
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-146]
assignee: backend-lead
paths: [process/cairn/issues/POLY-147.md, packages/db/**, packages/auth/**, packages/tenancy/**, apps/worker/**, tests/db/**, tests/layers/**, layers.json, eslint.config.js, package.json, docs/ARCH/**, docs/SECURITY/**]
labels: [security, auth]
priority: P1
pr: null
created: 2026-11-13
updated: 2026-11-13
---

Stage 1 of POLY-145's decision, (e1), staged (`process/cairn/reviews/POLY-145/pricing.md` §1 and §2; `comparison.md` §7). Postgres stops believing a setting that any role can write. Identity is written only by definers into a transaction marker, `app.tx_identity`, keyed by `pg_current_xact_id()`, and `app.current_user_id()` reads only that marker. There are three ways in:
- The worker enters only through a scoped job definer, so it can no longer name a user.
- Sign-up enters through `app.enter_new_user`, which now writes the marker.
- Web enters through one interim definer that only poly_app may call. Web still chooses the id until stage 2.

With the three guards from `comparison.md` §7 in place, a single injected statement inside a marked web transaction reaches only the requesting user. An injection on an unmarked path, a stolen poly_app password and code execution in web still reach any user until stage 2. No policy body changes: all 18 policies already read identity through `app.current_user_id()` (`current-state.md` §4).

## Acceptance criteria

**The marker (K)**
- [ ] `app.tx_identity(xid xid8 PRIMARY KEY, user_id uuid, session_id uuid null, kind text, created_at)`. Only the definer owner (poly_authz) holds INSERT. No role holds UPDATE, DELETE or TRUNCATE except the purge definer's DELETE. Readers see only their own transaction's row, under a policy `xid = pg_current_xact_id_if_assigned()`. The read side never calls `pg_current_xact_id()`, which would assign an id. A transaction that has written no marker therefore has no id and resolves to null, which fails closed. Tested in a `BEGIN READ ONLY` transaction (seceng #4; unmeasured).
- [ ] The body of `app.current_user_id()` reads the marker only, keyed on `pg_current_xact_id_if_assigned()`. pgTAP: for each of poly_app, poly_worker and poly_operator, `set_config('app.user_id', <uuid>, true)` on its own yields a null `current_user_id()` and zero tenant rows. The pinned-body test (`tests/db/pgtap/01_roles.sql:86`) is updated.
- [ ] `app.enter_new_user` writes the marker instead of `set_config`. Every POLY-87 test (`auth-new-user-step`, `auth-signup-invite`, pgTAP 05) still passes.
- [ ] A purge definer deletes marker rows older than a fixed age whose transaction is not in progress (`pg_xact_status(xid) <> 'in progress'`); age alone is never enough. Test: a transaction left open past the cut-off keeps its marker through a purge, and a second marker stays impossible (seceng #8). Its schedule lands with the worker's first job loop; until then it is called by the test alone.

**Worker entry (J)**
- [ ] `app.enter_job(job, entity_id, connection_id)` resolves the principal inside the definer (it folds in `app.job_targets`) and writes the marker with `kind = 'system:<job>'`. `withSystem` calls it and nothing else. poly_worker holds EXECUTE on no other `enter_*`.
- [ ] The worker's reach is stated precisely (seceng #10). The worker still chooses `(job, entity, connection)`, so until POLY-64's scoped policies and grants land, it can act as the linking user of any existing connection, with that user's full read reach. Today `job_targets` returns no rows, so the reach is nil. That is narrower than "any user" but not "scoped", and the R-2 re-word says exactly this.
- [ ] Each definer writes `kind` itself and never takes it from the caller: `enter_asserted_user` writes `web`, `enter_job` writes `system:<job>`, `enter_new_user` writes `signup`. A test calls each definer and checks the kind it wrote (seceng #11).

**Interim web entry (I)**
- [ ] `app.enter_asserted_user(uuid, session uuid)`: EXECUTE for poly_app alone. `withTenant` calls it. A catalog test lists exactly which role may execute each `enter_*` function.

**The three guards (`comparison.md` §7 point 2), each with its own red-gate test**
- [ ] (i) Every poly_app and poly_worker query is sent with `queryMode: 'extended'`. That means both `packages/db`'s wrappers and BetterAuth's two paths: the routing-pool handle inside marked transactions, and the plain BetterAuth pool, which is the main unmarked path (seceng #7). A test sends a two-statement string through each of the three and sees it refused, and a lint or wrapper check refuses a query that bypasses the mode.
- [ ] (ii) In `withTenant` and `withSystem`, the marker is the first statement after the real BEGIN, before any savepoint. A test shows that a routing-pool savepoint rolled back after the marker leaves the marker in place.
- [ ] (ii, sign-up) On the sign-up path, `enter_new_user` necessarily runs after BetterAuth's user insert, inside a routing-pool savepoint, so (ii) cannot hold as worded (seceng #5). Test: after `enter_new_user`, roll back to BetterAuth's savepoint. Then neither `enter_new_user` nor the interim definer can write a marker for any user in that transaction.
- [ ] (iii) Every `enter_*` definer refuses when a marker already exists for the transaction.
- [ ] The interim definer refuses when `pg_current_xact_id_if_assigned()` is not null, meaning the transaction has already written something, for example sign-up's user insert (seceng #6). This catches earlier writes, not earlier reads. It is tested against a transaction that inserted a row first, and ARCH says what it does not catch.

**Measurement of the marker (gate before verdict)**
- [ ] The harness runs the same `withTenant` read-only transaction 1,000 times on this branch and against a same-day control on `main`, with the same Postgres container. It reports p50 and p95 latency, and the WAL bytes per transaction (`pg_current_wal_lsn()` delta divided by 1,000). Results go to `process/cairn/reviews/POLY-147/marker-measure.md`.
- [ ] Threshold: the marker adds no more than **5 ms at p95** and no more than **1 KB of WAL per transaction** over the control. If either is exceeded, the verdict fails and the fallback below is ruled on before merge. The threshold is (unmeasured) until this run.
- [ ] Fallback, if the threshold fails (an HMAC key lives in a table only poly_authz can read, and pgTAP shows poly_app cannot read it; seceng #12): a protected setting. That is an extension-defined superuser-only variable plus `GRANT SET ON PARAMETER` to the definer owner, which needs its own doc check, or failing that an HMAC tag, with the 18 policies rewritten to evaluate `(SELECT app.current_user_id())` once per query. Either way the design stays (e1); only the marker changes.

**No `app.session_id` reader (seceng #9)**
- [ ] After stage 1, no SQL in the tree reads `app.session_id`. Every reader, starting with `packages/auth/src/session.ts:106,114,118`, uses the marker's `session_id`. This is enforced by the catalog test plus a lint or grep fixture.

**Docs**
- [ ] ARCH §3.3 and §3.1 describe the marker as the current state, and fold in `current-state.md` §8.2–8.5. SECURITY R-2 is re-worded to the §7 ruling ("narrowed", not "closed" and not "unchanged"), with the worker's reach in the precise form above (seceng #10), and T-18 and C-84 are updated.

## Estimate

4.5–5 loop-days, 1 loop (M; pricing.md blocks K, I, J + comparison.md §7 guards; +0.5 for seceng's check #4–#11)
