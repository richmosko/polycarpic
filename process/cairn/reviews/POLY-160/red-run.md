# POLY-160c red run

qa-160. Run on the build before any R1–R5 change (base `7613d4e9`), `python3 -W ignore -m unittest discover -s tests/infra/ops -t tests/infra/ops -p <file>`.
"Green by absence" = passes today because nothing happens today; it is a positive guard whose named mutant turns it red after the fix.

| File | Red | Green by absence |
|---|---|---|
| `test_deploy_contract.py` | 4 of 4 contract pins (names missing; `_handle_interrupted` still present) | |
| `packages/db/src/pool-errors.test.ts` | all (no `onConnectionLost`) | |
| `test_deploy_recover.py` | Compose mismatch with a mark: 0 `up`, `render-env` (M1) | |
| `test_deploy_recover_checks.py` | 8 of 8: previous/transient-since, junk mark, ENOSPC on every write, `mkdtemp` ENOSPC (M4: the exception escapes), mark == current (M10: quarantined), `current` quarantined, lifted line, Ctrl-C keeps the mark | |
| `test_deploy_standdown.py` | 6 of 8: failing restore stops nothing, `not-stopped`, ten polls (the second poll bans the digest), first deploy cut / unhealthy / SIGHUP+SIGTERM stop nothing | `current_s_own_containers_are_not_stopped` (mutant: `keep_ref` ignored), `a_record_that_is_not_on_disk…` (mutant: unlink regardless) |

The signal test installs its own raising handlers first, so a build with no handler fails the test instead of the signal killing the runner.

## Later files (same base `7613d4e9`, the R5 pool build `9537df46` present for the db rows)

| File | Red | Green by absence / notes |
|---|---|---|
| `test_deploy_commit.py` | 6 of 6 (link_current after commit; save of `current` raising before/after write; Refusal after commit; `previous == current`; `rollback-pointers`) | |
| `test_deploy_retry.py` | 3 of 3 (`held-` after `unjudged`; `rel.log` raising in a transient run; `check-config` timeout vs 124). The `unjudged` trigger (saved render bytes altered after the candidate's `up`) is unproven until R3 exists | |
| `test_deploy_recover_edge.py` | 6 of 7 | `old_edge_release_is_upped_first…` (3 tags) green today: edge already restores first; positive guard, mutant `recover` after the tag rules |
| `test_release_records.py` | 4 of 4 (fsync order, a raising write, idempotent quarantine, `held-` lift) | |
| `test_deploy_s36_env.py` | 1 of 2 (changed environment value, disk full: today the saved pair serves) | the positive case (non-environment difference) green today |
| `test_status.py` (R1.12) | 2 of 3 | `…a_current_and_no_alert_is_left_to_the_poller` green: positive guard |
| `tests/infra/provision-render-home.test.ts` | 5 of 5 (R6 `here=`/`CDPATH`; R7 compose calls) | text half only; the box half (relative paths with CDPATH, R7's four homes) is host.test.ts, needs Docker |
| `tests/db/wrappers.test.ts` (C20, C21) | green on the pool build; red by mutant: client `error` line removed → unhandled 57P01 fails the run (verified, mutation reverted) | the connection is lost at the client socket, not `pg_terminate_backend` (tests/ci forbids cluster-wide verbs outside SERIAL). "During COMMIT" is not timed |
| `tests/db/web-server.test.ts` (down/up) | green on the pool build; red with `survive()` a no-op (verified, reverted) | the file now starts web through the proxy |

**For seceng-160:** `test_deploy_unwind_more.py::test_a_restore_that_must_save_and_cannot_uses_the_saved_pair_when_its_hash_holds_and_its_bytes_pass_the_guard` changes an environment value and expects the saved pair to serve; under the S36 condition that becomes a refusal. Left untouched; `test_deploy_s36_env.py` carries the new ruling and its positive case. Needs your ruling before it is edited.
