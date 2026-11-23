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

## G2 refusal → mutant map (lead's request @ 243aca78; every case below is reached by at least one mutant)

| Refusal case (`test_deploy_bundle.py`) | Mutant that turns it red |
|---|---|
| setuid, setgid file | drop `m.mode & 0o7000` |
| symlink, hardlink, char/block device, fifo, sparse, pax-global in a manifest directory slot (one test, 7 types) | `release.py` accept every member type (drop the type tuple **and** the sym/lnk/dev/fifo clause); each clause alone is covered by the other, so neither alone is red (C1a red on the type tuple alone via the slot test; C1b equivalent: the tuple still refuses) |
| symlink or hardlink elsewhere in the tree; device/fifo off-manifest | masked by the manifest check by design (layers); reached by `allowed_member` → True together with C1 only, not separately |
| `..` path, absolute path | drop the path-shape check **and** `allowed_member` → True (either alone is covered by the other) |
| off-manifest member (ops script) | `allowed_member` → True |
| missing manifest file, absurd declared size | drop the `for need in FILES` check |
| tar > 64 MiB (padding after valid members) | `if len(data) > MAX_TAR` → `if False` |
| a single file > 64 MiB | not reached alone: `MAX_TAR`, `MAX_TREE` and `MAX_FILE` all refuse it (layers); reached when all three are removed (not run: the unbounded read) |
| `images.env` extra key / wrong repo / tag form / missing key | `parse_images_env` key-shape check off; `sorted(got) != sorted(IMAGE_KEYS)` off |
| garbage, truncated tar | `tarfile` open error path: not mutated; one case each, reached by any change that stops refusing on `TarError` |
| `run_bytes` cap and kill | `ctx.py` `MAX_BYTES` 64 MiB → 200 MiB |

## env_file lint (named: this loosens a POLY-95 security lint)

`tests/infra/lint.test.ts` used to refuse any `env_file`. It now refuses everything but the project's own host env on the five app services (R11), with:
17 refusals (unrelated file, prefix, contains, longer name, directory prefix, traversal, relative, staging naming prod's, prod naming staging's,
host env plus a second file, `required: false`, extra key, another path in object form, postgres/backup/uploader/staging postgres), 12 positives (5 services × 2 projects in
plain form, two object forms), and one test that the CI lint and the box guard read the same list (`compose-allow.json` `env_files`). The "host env twice"
case was dropped: compose de-duplicates the list before either reader sees it.

| Mutant | Red |
|---|---|
| lint `path === hostEnv` → `startsWith(hostEnv)` | prefix, longer name, traversal cases |
| lint service allowlist → `true` | the four "service outside the five" cases |

## Real-render guard (`tests/infra/compose-real.test.ts`, lint job; answers the G3 gap)

The committed fixtures are compared with real `docker compose config` output for the shipped files, and 16 S10/S14 edits of the shipped `staging.yml`
are rendered by real compose and judged by the installed guard (`fixtures/guard_real.py`). It found a generator defect of mine on the way: the prod and staging
host env paths were mapped to one temp file, so a staging service naming prod's env file looked legitimate; fixed (one temp file per path).

## T-env and the build.yml pins

`env-wiring.test.ts`: detectors proven live inside the file (renamed `DATABASE_PASSWORD_FILE`, `env_file` removed, `PLAID_ENV` absent, the two projects' values swapped).
`build-pins-poly100.test.ts`: 17 mutants of build.yml, one per B2 item and R11 (a third writer job, `pnpm install` in `build`, an unlisted action or run, a workflow-level
write, a fifth permission, scan after attest, a sibling attesting another digest, a scan on another digest, swapped arguments, `release-lint` dropped from `needs`, `release-lint`
with write scopes, `release-scan` renamed, scanning the app only, stopping at the first failure, passing an unchecked line); each returns violations, the real file none.

## S26 (edge network name `polycarpic-edge-prod`)

`test_deploy_guard.py` and `compose-real.test.ts` now use the real name. Red on the key-only mutant (`compose_guard._networks`: `entry != pol["networks"][key]` dropped):
unit `test_t8_each_unsafe_render…` (the S14 subtests) and real-render cases "external polycarpic-prod_default behind key default" and "the staging edge key pointing at polycarpic-edge-prod".
