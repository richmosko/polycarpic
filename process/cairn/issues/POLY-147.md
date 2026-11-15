---
id: POLY-147
title: Identity marker (stage 1)
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-146]
assignee: backend-lead
paths: [process/cairn/issues/POLY-147.md, process/cairn/reviews/POLY-147/**, packages/db/**, packages/auth/**, packages/tenancy/**, apps/worker/**, tests/**, scripts/layers/**, infra/ci/**, layers.json, eslint.config.js, package.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**]
labels: [security, auth]
priority: P1
pr: null
created: 2026-11-13
updated: 2026-11-15
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

## Comments

### @team-lead — 2026-11-13

Feature started. Branch: `feature/poly-147-identity-marker`.

### @architect — 2026-11-14

Gate 1 — ruling: `process/cairn/reviews/POLY-147/ruling.md`. The design itself is (e1) staged, as decided; the ruling only makes it buildable.
- R1: migration `0011_identity_marker.sql`. It creates `app.tx_identity` with RLS forced. INSERT goes to poly_authz alone and DELETE to poly_purge alone. Readers see their own row under `xid = pg_current_xact_id_if_assigned()`. The new `current_user_id()` and `current_session_id()` read the marker only, and `audit_membership` reads the actor from the marker.
- R2: four definers, `enter_asserted_user`, `enter_job`, the revised `enter_new_user` and `purge_tx_identity`. Each one's refusals and error codes are exact.
- R3: in each wrapper the marker is the first statement after the real BEGIN. The sign-up savepoint case is handled.
- R4: `ExtendedClient` is passed as `Client` to all three pools, which covers both BetterAuth paths. A source-scan unit test refuses any bypass.
- R5–R6: readers of `app.session_id` move to the marker, and `app.session_id` and `app.user_id` become reserved literals. Test impersonation moves to the marker.
- R7: the bench harness lives under `tests/db/bench/` and runs against a same-server, same-day control on `main`.
- R8: the test map.
Open questions OQ-1 to OQ-4 go to the lead. The build proceeds on each recommendation unless this file says otherwise.

### @team-lead — 2026-11-14

Gate 1, Principal's decisions (2026-11-14 local; `process/DECISIONS.md`, 2026-11-15 UTC):
- The exact-call check on the `enter_*` definers is dropped (adopted in ruling 60bfbb6e, withdrawn by seceng, architect concurs).
- seceng S4 is in this loop's scope: revoke plpgsql `USAGE` from PUBLIC; `poly_app`, `poly_worker` and `poly_operator` are each refused a `DO` block and a plpgsql `CREATE FUNCTION`, with a test.
- Lead adopts seceng S6 (the wrapper checks before COMMIT that the transaction is still the marked one) and S1, S2 as test-map additions.
- The architect's four open questions (ruling §OQ) proceed on their recommendations; seceng accepted each with its mechanism (security-review.md @ cef43a16).
- qa-147, not the builder, runs the R7 measurement.

### @team-lead — 2026-11-15

Gate 1 correction (Principal, 2026-11-14 local): the exact-call check is KEPT. This reverses the line above. Basis: seceng's delta review (security-review.md §2 D1 @ b5769439): injected SQL cannot bind parameters, so no injection can name a user to Postgres directly, and the `track_activities` dependency cited against the check does not exist. S4 (plpgsql revoke) stays in scope. S6 stays in the ruling. `process/DECISIONS.md` entry replaced, not stacked.

### @qa-engineer — 2026-11-15

Gate 2, tests-red @ ee1ff9eb (ruling 2027afdb). New failing: 44 db (tests/db/identity-marker.test.ts) + 3 unit (pg-seam-scan) + extended-client.test.ts (module absent, 5 tests) + 7 lint fixtures (31-reserved-literal) + pgTAP 07 (script errors, table absent). Rewritten onto the marker per R6/OQ-1 and red until built: db suite 94 failed / 509 total (415 pass) = 44 new + 45 rewritten (auth-new-user-step 6, auth-signup-invite 27 via the owner/invite fixtures, auth-routing-pool 3, wrappers 6, matrix 2, operator-invite 1) + 5 pgTAP files (01, 02, 05, 06, 07). Every other db test passes (ops-* need svelte-kit sync in a fresh worktree). Observed codes: DO COMMIT today 2D000 (R10 makes it 42501). PREPARE TRANSACTION expected 55000 (asserted, unmeasured until built). Finding: 02_rls_catalog battery flags app.tx_identity (xid8 key, no TRUNCATE trigger): exemption added, count 7 to 8, needs seceng sign-off. Harness: tests/db/bench/.

### @team-lead — 2026-11-15

Gate 1 cleared: seceng cleared ruling 4d50ce17 for tests-red (security-review.md §3 @ 50f334b1); the lead read the 14-line addendum to 2027afdb, which adds the test seceng called optional. qa-147 released against ruling @ 2027afdb.
Principal (2026-11-15): the bootstrap also revokes PUBLIC's EXECUTE on the built-ins that run a SQL string (`*_to_xml*`, `ts_stat`, `ts_rewrite(tsquery, text)`), on seceng's recommendation over the architect's objection. The architect adds it as R11.

### @team-lead — 2026-11-15

CI dispatch run 43760544343 on built @ 04726635: `db` (preflight) and `lint` both fail on one cause. `tests/db/identity-marker.test.ts` is in no area of `infra/ci/changes.mjs` DB_AREAS, so `tests/ci/db-areas.test.ts` fails (C7, C10; the "19 mapped files" control). `guard`, `changes`, `cairn`, `unit` pass. Local runs missed it: nobody ran `tests/ci`. devops-147 is spawned for the area-map fix and, later, the INFRA runbook line (R11). `paths` widened with `infra/ci/**` and `docs/INFRA/**`.

### @qa-engineer — 2026-11-15

Gate 3, build-green run on 04726635 (clean worktree, svelte-kit sync): lint 0, typecheck 0, turbo units 0, layers 528/528, db 511/511 (pgTAP included), tests/ci 525 pass 9 FAIL: infra/ci/changes.mjs DB_AREAS lacks tests/db/identity-marker.test.ts (add to tenancy; pinned in 4358eb43). Red-ifs proven in a scratch worktree: handle reverted to drizzle(client) -> nested-savepoint case red (plus 2 other savepoint tests); enter_asserted_user check removed -> 6 exact-call rows red. db suite wall, alternating, same container: main 65, 66, 55, 58 s; branch 60, 58, 56 s (median main 61.5, branch 58): no measurable growth.

### @qa-engineer — 2026-11-15

Gate 3, build-green @ 71ba9813 (devops ci-fixed 67015f00, builder N1 2fbdb724, my N1/N2 tests e08237e8 and a lint fix), clean worktree, svelte-kit sync, every exit code read: lint 0, typecheck 0, turbo units 0, layers 528/528, tests/ci 534/534, tests/infra 163/163, dist-freshness 0, db 511/511 (pgTAP included). New N1 test (marked-of.test.ts) is red on the pre-N1 code (8 failures); N2 scan patterns each proven against samples. Earlier proofs and timings (main 55-66 s vs branch 56-60 s db suite) are in the gate 3 comment above. R7 bench waits for dispatch.

### @architect — 2026-11-15

Gate 4, verdict @ 71ba9813 against ruling 5ded4562: APPROVED for code; `process/cairn/reviews/POLY-147/verdict.md`.
I read the diff myself: 0011 matches R1/R2; all three exact-call checks use IS DISTINCT FROM; ExtendedClient is on all three pools; the NodePgTransaction handle is built from the session; R10 and R11 are in roles.sql.
Measurement holds: p95 +0.24 ms (S) and -0.69 ms (L), WAL +231 B per tx (ee8cc6df). seceng: no blockers (6a9457e3). Build-green @ b46ddb5e. CI 8/8. e2e 52/52.
Open: the docs criterion (ARCH 3.1/3.3, SECURITY R-2/T-18/C-84). Four non-blocking notes are in verdict.md.

### @qa-engineer — 2026-11-15

Gate 4, docs-checked @ 67419c74. R9 phrases (tag-stripped, case-sensitive): every must present, every must-not absent in ARCH 1.16.0 and SECURITY 1.9.20; R-2, T-18, C-84 and ARCH §3.3 also pass scoped to their sections. One note: 'the marker is the first statement after the real BEGIN' is in ARCH §3.3, not §3.1 (queryMode is in §3.1c); passes on R8's whole-document grep, fails a strict §3.1 reading. INFRA 1.3.12 says roles.sql is re-run after restore and at each major upgrade. Code re-run from a clean checkout on 67419c74, exit codes read: lint 0, typecheck 0, units 0, dist-freshness 0, layers 528/528, tests/ci 534/534, tests/infra 163/163, db 511/511. Web e2e 52/52 on 71ba9813. Per-criterion evidence list sent to the lead.
