# POLY-147 — gate 4 verdict (architect)

Frozen build `71ba981376958a0a6fe66b5380dc92a748f4a5dd`, judged against ruling `5ded4562`. I read `git diff main..71ba9813` myself
for `0011_identity_marker.sql`, `roles.sql`, `definers.json`, `layers.json`, `context.ts`, `extended-client.ts`, `pool.ts`,
`packages/auth/src/session.ts`, `02_rls_catalog.sql`, and the test names in `identity-marker.test.ts` and `07_identity_marker.sql`.
Other results are cited at their evidence sha.

**Verdict: APPROVED for code.** The docs criterion is the one item still open; it closes with the ARCH and SECURITY commits that follow.

| Axis | Result | Evidence |
|---|---|---|
| K1 marker table: DDL, ACL, four policies, FORCE RLS, TRUNCATE guard | pass. The migration matches R1 line for line, including `tx_identity_no_truncate`; `07` asserts the exact ACL | `71ba9813` `0011:6-33`; `07` |
| K1 read side never assigns an xid | pass. Both readers key on `pg_current_xact_id_if_assigned()` only; a `BEGIN READ ONLY` test exists | `0011:37-43`; `identity-marker` |
| K2 `current_user_id()` reads the marker only; a forged setting grants nothing | pass. Body pinned in `01_roles`; the K2 counts include the seeded `K2 Club` type, with a with-marker control | `01_roles.sql`, `07` @ `71ba9813` |
| K3 `enter_new_user` writes the marker; POLY-87 properties hold | pass. Same checks as before, plus the exact-call and marker checks; POLY-87 tests rewritten to the marker form (OQ-1) | `0011:115-137`; db 511/511 @ `b46ddb5e` |
| K4 purge: fixed age, status `IS DISTINCT FROM 'in progress'`, no argument, poly_worker alone | pass | `0011:139-158`; `definers.json` |
| J1 `enter_job`: principal resolved inside the definer, kind `system:<job>`; `job_targets` EXECUTE to nobody | pass | `0011:78-112`; `definers.json:2` |
| J2 worker reach stated precisely | open, in the docs criterion (SECURITY R-2, seceng) | — |
| J3 each definer writes its own kind; no kind argument | pass | `0011`; `identity-marker` (`system:qa_job`) |
| I1 EXECUTE per `enter_*` exact; PUBLIC absent | pass | `0011` REVOKE/GRANT; `07`; `definers.json` |
| Exact-call check: `IS DISTINCT FROM`, byte-exact callers | pass. All three bodies use `IS DISTINCT FROM`. The callers in `context.ts` and `new-user.ts` send the canonical texts, and the check-removed mutation turns 6 rows red | `0011:58,86,120`; `context.ts`; qa red-if @ `b46ddb5e` |
| Guard (i) extended mode on all three paths; bypass refused | pass. `ExtendedClient` is `Client` on all three pools; the Submittable refusal and the seam scan exist | `extended-client.ts`, `pool.ts`, `pg-seam-scan.test.ts` |
| Guard (ii) marker first after BEGIN; survives savepoints, nested included | pass. Nothing is sent between BEGIN and setup; the `NodePgTransaction` handle is built from the session's dialect and schema; the revert-mutation turns red | `context.ts`; qa red-if @ `b46ddb5e` |
| Guard (ii, sign-up) after a rollback no marker can be written for any existing user | pass | `identity-marker` |
| Guard (iii) second marker refused; xid-assigned refusal | pass | `0011` checks 3–4; `identity-marker` |
| S6 pre-COMMIT xid check, with `markedOf` (seceng N1) | pass | `context.ts`; `marked-of.test.ts` |
| R10 plpgsql revoked from PUBLIC; eight roles keep USAGE | pass | `roles.sql:48-49`; `07`, `identity-marker` (`qa_lang`) |
| R11 the 17 SQL-string built-ins revoked from PUBLIC | pass | `roles.sql:54-70`; `07` |
| Catalog net: 7-table list plus the per-reason exemption `app.tx_identity:pk_not_uuid`, with canaries | pass | `02_rls_catalog.sql` @ `71ba9813` |
| No `app.session_id` reader | pass. `session.ts` reads `current_session_id()`; reserved literals for `app.session_id` and `app.user_id`; prosrc check in `07` | `session.ts`, `layers.json` |
| Measurement (R7) | pass. Δp95 +0.24 ms (S) and −0.69 ms (L); ΔWAL +231 B per transaction; no fallback needed | `marker-measure.md` @ `ee8cc6df` |
| Security | pass, no blocking findings; N1 and N2 closed | `security-review.md` §6–§7 @ `6a9457e3` |
| Build-green (lint, typecheck, units, layers, ci, infra, db) | pass, every exit 0; db 511/511; db suite time unchanged against same-day main | issue comment @ `b46ddb5e` |
| CI on the tip | pass, all 8 jobs | dispatch run 43761973176 (lead) |
| Web e2e | pass, 52/52 | lead's report |
| Docs: ARCH §3.1/§3.3, SECURITY R-2/T-18/C-84 | open; R9's phrases are the check | to follow |

## Non-blocking notes (no change required in this loop)

1. `packages/auth/src/routing-pool.ts:3` still says the plain pool "holds no GUC" (R5 asked for a re-word). It is still literally
   true, but it now reads as if a GUC were the identity mechanism. Fold the re-word into the next change that touches the file.
2. `context.ts` imports `PgDialect` as a value but uses it only as a type. Typecheck and lint pass; `import type` would be cleaner.
3. The measurement is one host (M1 Max, Docker Desktop). The cost the marker adds is a commit that now flushes WAL, and on the VPS
   that cost depends on fsync. Re-read p95 at the first staging deploy (POLY-97) before calling it settled.
4. `permission-matrix.json` exempts `app.tx_identity` as not role-scoped. That is correct for the matrix, which tests per-role tenant
   reach. The table's own guards live in `02` (inside the net) and `07`.
