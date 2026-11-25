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

## Auth and worker outage lines; C21 "during COMMIT"

| File | Red | Notes |
|---|---|---|
| `tests/db/auth-service-main.test.ts` (new describe) | green on the pool build; red with `survive()` a no-op (verified, reverted): unhandled client error fails the run | database down via the proxy: the request is a 5xx with `auth.request_failed`, then the same request is a client error again after `up()`. The logger's lines are collected by mocking `createLogger`'s stream (pino writes to the descriptor, not `process.stdout.write`) |
| `tests/db/worker-mail-jobs.test.ts` (new describe) | green on the pool build; red with `survive()` a no-op (verified, reverted). Removing only the per-client `connect` line stays green here: the schedule's clients are idle between runs, the web and wrappers cases cover the checked-out path | `job.run` outcome `error` while down, `ok` again after `up()`, schedule not stopped |

**C21 "during COMMIT": tried, cannot be timed.** `withSession` sends COMMIT in the same tick as the callback's return; there is no hook between the callback and the COMMIT write, so a loss cannot be placed inside it from a test. Tried: dropping the client's socket from the callback just before it returns (that is the "before COMMIT" case written), and a deferred constraint trigger with `pg_sleep` to widen the COMMIT (a loss during it needs a second connection killing the backend: `pg_terminate_backend`, which tests/ci forbids outside the serial project, and the client-socket drop lands before or after the COMMIT bytes, never reliably within). The two cases that stand: no query in flight (before COMMIT) and mid-query. seceng-160 rules at the build review whether they stand for it.

## The two exemptions (seceng-160, ruling-review.md "Exemptions ruled" @ 8ab61533)

| Edit | State on `7613d4e9` | Mutants (must turn it red once the build exists) |
|---|---|---|
| `test_deploy_unwind_more.py`: (a) `…with_a_changed_environment_is_refused_and_the_old_release_is_not_upped` (a key added, then an existing value changed; all eight assertions of the ruling) | red: today the old release is upped from the saved pair (`rolled-back`, not `rollback-unhealthy`) | environment comparison dropped from the failed-save path; comparison on keys only |
| (b) `…uses_the_saved_pair…` now with a key outside `environment` (`restart`: the guard passes it, the correction keeps it) and the assertion that a save was attempted and failed | green today (positive guard) | the saved-pair fallback removed |
| hash and sidecar tests, hook moved to (b)'s | green today, assertions unchanged | `pair_ok` dropped (red only after the hook moved) |
| `test_deploy_hang.py` leftover mark: first half plus `current == x2` and the mark gone; second half on `x3`, no candidate offered, then offered; the tool writes `interrupted`, exactly one quarantine line `interrupted` for `x3`, no `up` names `x3`, `current` x2, mark gone | green today (the rule is unchanged; the fixture no longer plants a mark on the running digest) | the record never quarantines; the first time quarantines; `interrupted` not written; the mark unlinked before the record |

Key for (b): `restart` on `web` (candidate and old release both pass the guard; `labels` and `healthcheck` do not: `guard-key`, `guard-pinned`). `test_deploy_s36_env.py` uses it too.

## R6 and R7 box half (`tests/infra/provision/host.test.ts`, describes "POLY-160 R6" and "POLY-160 R7")

Run in the dry-run box twice: with `provision.sh` and `provision-check.sh` as they were at `7613d4e9` (restored after), and with devops-160's build in the tree.

| Case | `7613d4e9` scripts | build in the tree |
|---|---|---|
| R6, five invocations (`bash provision.sh`, `./provision.sh`, `infra/provision.sh`, each also with `CDPATH` set; `/deploy/compose-version` planted with a wrong version) | 5 of 5 red | 5 of 5 green |
| R7 no render home: every compose call names `/` and `--env-file /dev/null` | red | green |
| R7 a good home is used as it is | green (positive guard; mutant: the fallback or the home dropped) | green |
| R7 a link; a home holding `.env`: never handed to compose, H24 FAIL names it, D1 FAIL (not WAIT) | red, red | green, green |

The R6 test reaches the first file read through `install_units` as well as `install_compose`: the box already has Docker, so `install_compose` is not reached by the host stage on its own; the script dies on a resolved-to-`/` read either way. `provision.sh --stage database` stopping on `render-path` is not tested here (it needs the Postgres derivative: `tests/infra/provision/pg.ts`); it is left for the database-stage run at the gate.

## On devops-160's build (ddf0cc61 + tests at 8f07d932), `tests/infra/ops`

Counts (three discover patterns because the host hook blocks one un-tiered run): `test_deploy*.py` 358 tests, 3 red; `test_[a-ce-z]*.py` 229 OK; `test_dispatcher.py` 19 OK. The 3 red are build faults, tests right (ruling.md @ 26945e68, R1.4's last alert):
- `test_deploy_recover_checks…current_listed_in_the_quarantine…` and `test_deploy_standdown.FinalAlert…stuck_run_does_not_overwrite_current_quarantined`: `stuck_end` writes `rollback-unhealthy` over `current-quarantined`.
- `test_deploy_recover_edge…edge_run_that_started_stuck…not_stopped`: edge's form of the same: `rollback-unhealthy` over `not-stopped`. The staging form (`FinalAlert…started_stuck…not_stopped`) is green.

Test faults fixed (mine): the first-deploy cuts hung from `len(up_marks)`, which lands at Postgres's own `up` (now `+1`, and the SIGHUP hook waits for the app `up`); two quarantine fixtures had time and reason swapped (now `<digest> <time> <reason> [bundle]`); the lifted-line test now uses a stored bundle id that is not the installed one, shown red on its mutant (`_held` as a plain search of the file, reverted).

## T-real's two cases (`tests/infra/deploy-real/`)

Written, **not run here**: T-real needs Linux, root and Docker (`deploy-real` job), and takes about 8 minutes; the Mac cannot run it. They are checked by reading against the harness (`ops`, `stateFile`, `containerImages`) and `tsc` (only the old harness line 242 errors). Red-on-today and wall time come from the first `deploy-real` run in CI; the gate records them.

| Case | What it asserts | Red on today's build because |
|---|---|---|
| `2-rollback.test.ts` "C28" | release 2 offered; `deploy staging` SIGKILLed after its `up` line (pkill of the tool, the mark is there); the installed bundle's `compose-version` set to a wrong value; `deploy staging` again: exit 1, last line `deploy: refused render-env`, alert `render-env`, no mark, `current` and every web/auth/worker container on release 1 and healthy, release 2 not quarantined; file and `interrupted`/`alert` put back in `finally` | today refuses before it recovers: release 2's containers stay up and the mark is kept |
| `1-web-served.test.ts` "T-real 1c" | `poly_app`, `poly_auth`, `poly_worker` all connected (90 s, never skipped); `docker restart` of the Postgres container; health 200 within 60 s; `StartedAt` and `RestartCount` of web/auth/worker unchanged 15 s later; no `process.crash`; the worker's next `job.run` is ok; no password in the logs | without `survive()` the client's unhandled error ends the process and Docker restarts it |

**Deviation from the ruling (S):** the `db.connection_lost.*` lines of the three services are not asserted. A client idle at the restart is dropped by the pool without a line (R5's `survive`); only a checked-out one reports, and an outside test cannot decide which it was. The unit and database cases cover the reported path.

## T-real, local (privileged Ubuntu container with its own Docker, `POLY-100/treal-local-container.md`), tip `88482c31`

| Run | Result |
|---|---|
| unmutated tree | 4 files, 26 tests green, 412 s (6 min 52 s; CI's 7 min 38 s at M17 is the CI figure to compare) |
| mutant: `check_compose_version` moved back above `recover` in `deployer._deploy_checked` | C28 red: "no mark is left: expected 'sha256:…' to be null"; 18 passed, 1 failed (bail 1) |
| mutant: `survive()` returns at once, web image rebuilt from the mutated `pool.ts` | the restart case red: "StartedAt and RestartCount of the three are unchanged"; 16 passed, 1 failed |

Both mutations were made on a scratch copy (container tree, and a temporary edit of `pool.ts` reverted before any commit).

## B5 mutant table: the built deploy code, tests at `53a601d3` on devops-160's build through `5dbbfaf1` (B1)

Each mutant is one text edit of `infra/ops/**`, made on a scratch copy in this worktree and reverted (the tree was clean after each); the named test files are run; RED = at least one test fails. Two surviving rows are explained below the table.

| Mutant | Result | Failing tests (first three) |
|---|---|---|
| stand_down skipped after a failed recovery restore | RED | standdown:a_restore_that_fails_stops_the_candidates_thr; standdown:a_stop_that_fails_is_not_stopped_red_and_the_ |
| keep_ref ignored (current's own containers stopped) | RED | standdown:current_s_own_containers_are_not_stopped |
| docker stop given --time | RED | build_review:docker_stop_is_given_the_short_t_30_and_no_ot |
| interrupt after the commit stops the release (B2) | RED | build_review:an_interrupt_inside_settle_of_a_first_edge_de; build_review:an_interrupt_inside_settle_of_a_first_deploy_ |
| rel.write: file fsync removed | RED | test_release_records:write_fsyncs_the_file_then_replaces_then_fsyn |
| rel.write: directory fsync removed | RED | test_release_records:write_fsyncs_the_file_then_replaces_then_fsyn |
| quarantine not idempotent | RED | test_release_records:quarantine_twice_for_the_same_digest_and_reas |
| held- does not lift (LIFTING guard only) | RED | test_release_records:a_held_line_lifts_with_another_bundle_and_nev; recover_checks:a_lifted_line_on_current_does_not_stop_the_re |
| saved pair: hash check dropped | RED | recover_rows:an_allowlist_changed_since_under_the_pinned_c |
| saved pair: environment comparison dropped | RED | recover_rows:a_mismatched_compose_whose_environment_differ; recover_rows:an_allowlist_changed_since_under_the_pinned_c; s36_env:a_changed_environment_value_since_is_not_uppe …+1 |
| restore: tree hash of current skipped (deployer) | RED | recover_rows:a_tampered_tree_of_current_is_not_upped_and_t; recover_rows:an_allowlist_changed_since_under_the_pinned_c |
| mark names current: no settle (3e deleted) | RED | recover_checks:a_mark_that_names_current_is_settled_never_qu; recover_rows:an_allowlist_changed_since_under_the_pinned_c |
| recovery always uses an ordinary restore (keep dropped) | RED | recover_rows:a_mismatched_compose_whose_environment_differ; recover_rows:a_mismatched_compose_whose_render_differs_ups; recover_rows:a_tampered_saved_pair_under_a_mismatched_comp …+1 |
| commit: re-read of current removed | RED | commit:a_save_of_current_that_raises_after_writing_i |
| commit: previous not put back | RED | commit:a_save_of_current_that_raises_before_writing_; recover_rows:an_allowlist_changed_since_under_the_pinned_c |
| recover: no stand-down with no current | GREEN (survived) |  |
| on_interrupt: no stand-down | RED | standdown:ctrl_c_in_a_first_deploy_stops_the_candidate_; standdown:sighup_and_sigterm_take_ctrl_cs_path_and_the_ |
| SIGHUP and SIGTERM handlers not installed | RED | standdown:sighup_and_sigterm_take_ctrl_cs_path_and_the_ |
| rollback: recovered_first dropped (project) | RED | recover_edge:a_rollback_with_a_mark_recovers_first_and_rol |
| rollback: recovered_first dropped (edge) | RED | recover_edge:an_edge_rollback_with_a_mark_recovers_first |
| recover not called in _deploy_checked | RED | recover:a_mark_with_a_different_compose_restores_the_; recover_checks:a_ctrl_c_in_the_health_wait_keeps_the_mark_an; recover_checks:a_full_disk_at_every_write_still_restores_bef …+18 |
| exemption (a): environment comparison dropped | RED | unwind_more:a_restore_that_must_save_and_cannot_with_a_ch |
| exemption (a): comparison on keys only | RED | unwind_more:a_restore_that_must_save_and_cannot_with_a_ch |
| exemption (b): saved-pair fallback removed | RED | unwind_more:a_restore_that_must_save_and_cannot_uses_the_; unwind_more:a_restore_whose_render_equals_the_saved_file_ |
| exemption: pair_ok dropped (hash and sidecar tests, after the hook moved) | GREEN (survived) |  |
| exemption 2: the record never quarantines | RED | hang:a_leftover_in_progress_is_interrupted_the_fir |
| exemption 2: the first time quarantines | RED | hang:a_leftover_in_progress_is_interrupted_the_fir |
| exemption 2: `interrupted` not written | RED | hang:a_leftover_in_progress_is_interrupted_the_fir |

**Survivors.** "recover: no stand-down with no current" survived the first list (no test of a planted mark with no `current`) and is red once `a_planted_mark_with_no_current_is_stood_down…` was added (last row of the second list, not repeated here). "pair_ok dropped" survives the hash and sidecar tests: **equivalent at the outcome**, because two later checks refuse the same inputs: `canonical(corrected) != data` refuses tampered bytes, and `verify` re-hashes the file against the sidecar value carried in `Judged`. Both tests still end `rollback-unhealthy` with `pair_ok` gone; they cannot tell which check refused, and a test that removes both checks is not worth building.

**Red on the build and not a mutant row:** `EdgeRows…allowlist_changed_since_under_the_pinned_compose…` (devops-160 has it: edge's restore under a pinned Compose with a changed environment value does not come up; staging's twin is green).

**Not mutated** (named, per B5): `settle`'s step list (R2.2), `clear_transient` raising, the position of `check_edge_env`, of `rel.token` and of the unmounted-volume check relative to `recover`, edge's tree check, status 08's conditions, `provision*.sh` (the box tests were run on the old scripts instead), R4.1 per service, `rel.log` after `up`. Their tests exist and were red on the base; the mutant run of each is owed.

## B7 and B6's T-real lines, local container, tip `db8cf1c5`

| Run | Result |
|---|---|
| unmutated | 27 / 27 green, 502 s (8 min 22 s): the three services' own `db.connection_lost.<pool>` lines, B7's stop on real Docker and the recovery after it |
| mutant: `stand_down` replaced by `stopped = True` after a failed recovery restore | B7 red: "web is stopped: expected 'Up Less than a second (health: starting)' to match /^Exited/"; 19 passed, 1 failed (bail 1) |

`tests/infra/ops` at `6bc343e9`: 633 tests, 0 failed.
