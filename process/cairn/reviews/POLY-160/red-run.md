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
