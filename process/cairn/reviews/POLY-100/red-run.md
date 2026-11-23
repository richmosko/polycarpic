# POLY-100 red-run (qa-100)

Each security test is shown red on a textual mutant of the code under test (`temp/mutate.py`-style: one replacement, run the module, restore).
Mutant = file `old` → `new`; "red" lists the tests that failed.

## G2 bundle (`test_deploy_bundle.py`) against builder code at the sha in the commit

| Test | Mutant | Red |
|---|---|---|
| T6 off-manifest member | `release.py` `allowed_member` returns True | `test_t6_an_off_manifest_member_such_as_an_ops_script` |
| T6 setuid / setgid | `release.py` drop `m.mode & 0o7000 or` | `test_t6_a_setuid_file`, `test_t6_a_setgid_file` |
| 64 MiB tar cap (whole stream) | `release.py` `if len(data) > MAX_TAR:` → `if False:` | `test_t6_a_bundle_over_64_mib_is_refused` |
| `run_bytes` stops reading at the cap and kills the child | `ctx.py` `MAX_BYTES` 64 MiB → 200 MiB | `test_an_endless_child_is_cut_off_at_the_cap_and_killed` |

Not yet shown red (pending): symlink/hardlink/device/fifo/sparse/pax members are caught by one shared type check; its mutant is added with the rest at the gate.

## T-pre / T-lock (`tests/db/runner.test.ts`)

Red on `main` before R12: 36 T-pre cases (18 faults × apply / `--plan`) fail; the two positives and T-lock pass.
T-lock's mutant (no advisory lock) is run at the gate.

## G5 secrets (`test_deploy_secrets.py`)

| Test | Mutant | Red |
|---|---|---|
| T18 token shape | `lib/secrets.py` `GITHUB_TOKEN` pattern → `\w+` | `test_t18_a_classic_token_is_refused_with_exit_2_and_nothing_written` |

T17 (`allowed-signers install`) is red on the missing command and the missing `ctx.stdin` seam (pinned: Ctx kwarg `stdin`, a text stream, no child process).

## G5 lock (`test_deploy_token_lock.py`)

| Test | Mutant | Red |
|---|---|---|
| T16 busy / one lock for both projects | `commands/deploy.py` `LOCK_EX \| LOCK_NB` → `LOCK_EX` (a 20 s alarm turns the hang into a failure) | `test_t16_a_busy_timer_run_exits_0_logs_busy_and_touches_nothing`, `…_one_for_both_projects`, `…_wait_ten_minutes_then_exit_4` |

## G1–G4 against the build (mutants by one textual replacement; module run after each; file restored)

| Test | Mutant (file: replaced → with) | Red |
|---|---|---|
| T1 | `release.py` drop `--source-ref refs/heads/main` | `test_t1_v1_argv_…` |
| T1 | drop `--source-digest, commit` | T1, T2, label mismatch, T3 positive, T4 positives |
| T1 | drop `--deny-self-hosted-runners` | `test_t1_v1_argv_…` |
| T2 | (same `--source-digest` mutant) | `test_t2_a_label_alone_does_not_bind_the_image` |
| T3 | drop `-c gpg.ssh.allowedSignersFile=…` | 6 T3/T4 tests |
| T3 | `GIT_ENV` without `GIT_CONFIG_GLOBAL=/dev/null` | `test_t3_a_good_signed_tag_passes_v4_with_the_pinned_git_invocation` |
| T3 | drop the tag-name compare | `test_t3_a_correctly_signed_older_tag_object_served_under_a_newer_name` |
| T4 | prod pick `v > best` → first in list (newest) | `test_t4_prod_takes_the_highest_semver_not_the_newest` |
| T4 | `deployer.py` prod not-newer check → `if False` | `test_t4_a_release_below_current_is_refused_as_not_newer` |
| T4 | `descends` → `return True` | `test_t4_a_candidate_not_descending…`, `test_t4_a_rerun_of_an_old_run…` |
| T8 | `compose_guard.py` `build` check off / image check off / user pin off | `test_t8_each_unsafe_render…` (subtests for build, image, user) |
| T8 | `_env` call removed (raw render unchecked) | `test_t8_each_unsafe_render…` (env case) |
| T8 | `_networks` call removed | `test_t8_each_unsafe_render…` (3 network cases) |
| T12 | premigration exit-code check off / line-shape check off | `test_t12_a_failed_or_malformed_premigration…` |
| T10 | tree-hash re-check off | `test_t10_a_previous_release_edited_on_disk_is_not_upped`, `test_t10_unhealthy_rolls_back…` |
| T10 | quarantine on unhealthy removed | `test_t10_unhealthy_rolls_back…`, `test_t10_a_previous_release…` |
| T14 | `stack.py` run_argv without `--pull never` | `test_t14_every_up_and_run_carries…` |
| T7 | host runs `bash <release>/infra/backup/backup.sh` | `test_t7_a_deploy_never_rewrites_the_box…` |

No red (equivalent or redundant code, not a test gap):
- `_service`'s `for k in svc: if k not in sp["keys"]` off: `check()` repeats the key test over the raw render, which carries the same keys.
- `deployer.py` `cdir = rdir`: Postgres still comes up on `current`'s directory through another path in this build; the S12 tests assert the argv, so a real change of that path is caught.
- `-----BEGIN SSH SIGNATURE-----` text check off: `verify-tag` refuses a PGP block anyway; two checks, one outcome.

Open: mutants for T5 (siblings skipped), T9 edge, T11 (`up` after a failed migrate), T-lock (no advisory lock) run once R9 and POLY-100f land.
