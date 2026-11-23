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

## Rulings after D2 (qa-100; mutants by one textual replacement, module run after each)

| Test | Mutant | Red |
|---|---|---|
| T10q / S18 (`test_deploy_quarantine.py`) | `release.quarantined`: lift every reason / never lift / lift without the id check / last line wins instead of any | 4, 3, 1 and 1 tests (the both-orders case needed the last one) |
| T-help (`test_deploy_help.py`) | `guardhelp._target` accepts any text; `_base` takes `sha256-` ids as commits | the placeholder cases; `test_a_sha256_bundle_id_is_not_a_commit…` |
| T-help | `clean()` removed | none: every value is checked before it reaches the text, so `clean` is a second layer (equivalent) |
| T-sauth (`test_staging_auth.py`) | input check off; any cost accepted; `re.search(… $)` for the full match; the file's group not compared | input, cost, grammar and group cases (4 mutants, each red) |
| T-sauth | `len(data) > MAX` off | none: a 129-byte file cannot full-match (layers). `owner_of` returning constants is only caught by the box case (provision job) |
| T-edge (`test_deploy_edge.py`) | failed `ps` read as no container; damaged prod `current` read as absent; whole bundle upped (`up_argv` with no service); rising `n` dropped; unhealthy not quarantined | `test_a_failing_ps…`, `test_a_damaged_prod_current…`, 10 tests, `test_a_lower_or_equal_n…`, `test_an_unhealthy_caddy…` |
| T-edge | `number(tag) == number(cur["tag"])` branch dropped | none (equivalent: the earlier `cur["tag"] == tag` branch catches the only way to equal `n`: no leading zeros) |
| S19 (`FirstAttempt`) | backup not required on a table; `first-attempt` written when the directory is non-empty | the table, failing-read and failed-backup cases; `test_existing_data_on_a_non_empty_directory…` |
| S19 | `rerun` without `not cur` | none: `first-deploy` with a `current` is refused earlier (equivalent here) |
| T-relyml (`release-pins-poly100.test.ts`) | 10 mutants of release.yml inside the file | all red; the real workflow is red until the first step holds both full regexes (build gap) |

## Findings against the build at 2bb43871

- `_prune` keeps edge's `current` and `previous` forever; R4 and R9 keep them only until prod has a `current` (T-take prune cases red).
- `release.yml`'s first step does not hold the full `v1` and `edge` regexes or refuse other tags (T-relyml red).
- The lint judges only `edge.yml` for external edge networks; `prod.yml` / `staging.yml` declaring one with an ipam or without `external: true` passes (two lint.test.ts rows red).

## Mutants owed earlier, now run

| Test | Mutant | Red |
|---|---|---|
| T5 siblings | `verify_image`: V1 skipped for siblings / its result ignored | `test_t5_a_sibling_attested_at_another_commit…`, `…_failing_v1_stops…`, (first mutant also) `…_each_sibling_is_verified_with_the_same_flags_and_c` |
| T11 | migrate failure quarantines instead of refusing (the run goes on to `up`) | `test_t11_a_failing_migrate_never_touches_the_running_containers`, `test_t11_migrate_exit_2…` |
| T-lock (db) | `LOCK_SQL` → `SELECT 1` | `T-lock: both exit 0 … Lock/advisory` (fails with `CREATE SCHEMA IF NOT EXISTS "drizzle"` racing) |
| T-sauth gate (`test_deploy_sauth_gate.py`) | `check_staging_auth` removed from `edge.deploy`; from the prod run; `sauth.check` removed from edge restore, from the prod rollback path, from `restart.py` | one test red each (`…refuses_a_bad_file_and_ups_nothing`, `test_restart_caddy_refuses_a_bad_file`) |
| T-sauth input and file check (`test_staging_auth.py`) | input check off; any cost; `re.search(… $)`; the file's own group not compared | each red (see the section above) |
| T13 (`test_deploy_t13.py`) | the logged set cut to its first field; the shape check off | `test_the_logged_set_is_what_list_premigration…`, `test_a_line_restore_would_refuse…` |

Not run: mutants for the provision-job T-net cases ("names only", "no overlap check") and the box half of T-sauth (`owner_of` returning constants): the container slot is spent; both need a mutated copy of `provision.sh` / `ctx.py` inside the box.

## Provision-job mutants (container runs; one edit, one test file, file restored, tree clean before the next)

| Test file | Mutant | Red |
|---|---|---|
| `edge-net.test.ts` (T-net) | `provision.sh` `edge_networks`: the subnet/driver compare dropped (names only) | the three "a different existing network … never replaced" cases |
| same | on a mismatch: `network rm` then `create` (replaces) | the same three |
| same | `provision-check.sh` H21 without the overlap check | the pg_hba-range and 10.200.0.0/16 cases |
| same | `provision-check.sh` H21 without the subnet/driver compare | "fails on another subnet", "fails on another driver" |
| `sauth-box.test.ts` (T-sauth, real root) | `ctx._real_owner_of` returns `(0, 10010)` | four of the five refused cases (file/directory in another group, file/directory owned by another user); the accepted case and group-writable stay as they were |

## T13 (b) (`test_deploy_t13.py`, ruling 90876ede)

| Mutant | Red |
|---|---|
| `tests/infra/backup/fake_box.py` prints the dump and globals hashes swapped | `test_the_fake_box_and_the_real_list_print_the_same_bytes` |
| `backup.py` `_list` swaps the two hashes | the same test, and the T13 chain test |

## Mutants seceng's build review (3bbc6626) listed as not recorded (qa-100; Edit, run, `git checkout --`, tree clean before the next)

| Test | Mutant | Red |
|---|---|---|
| T9 after strict (`test_deploy_prod.py`) | `deployer.py` `owner = True` (staging owns edge) | `test_t9_staging_never_touches_edge_once_prod_exists` (and the flow tests) |
| T15 | `gh` also gets `--token <value>`; `docker pull` gets `GH_TOKEN` in its env; a gh outage becomes a quarantining refusal | `test_t15_the_token_is_in_gh_s_env_only` (twice); `test_a_gh_outage_is_transient…`, `test_t15_a_gh_outage…` |
| T17 | `allowed_signers.LINE` accepts any options and key type | `test_t17_only_the_plain_form_is_accepted…` |
| T-take | the `edge-older` ancestry check off; edge's releases pruned while prod is not healthy; no restore of Caddy when the take-over fails | the edge-older case (error); `test_edges_release_is_not_pruned…` + 2 edge cases; `test_edges_release_is_not_pruned…` |
| T-caddy | the ordered compare replaced by set membership; replaced by a denylist (`forward_auth`, `php_fastcgi`) | 4 and 7 cases |
| T-probe | no probe (`_probe_baseline` returns `None`); the baseline ignored (always required) | 5 and 2 cases |
| T8 | policy read from the release directory when one is there (new `test_deploy_policy.py`: a wider policy planted in `current`'s release directory, whose own render is unsafe); plain render only (`raw_services = {}`) | the new current-directory case; the T8 subtests (env, include) |
| T8 | (note) the same mutant is NOT caught by the candidate-directory variant: the policy is loaded before the render that plants the file, so that test is weak alone; the current-directory test is the one that proves it | |
| T18 | a third name in `HOST_ONLY` | `test_t18_host_only_is_exactly_two_names…`, `test_HOST_ONLY_is_pinned…`, `test_a_name_no_service_mounts…` |
| T-help | install lines before the review lines; `install.sh --commit` runs `git checkout`; the ancestor check dropped (new `test_install_commit.py`: C ships while HEAD is elsewhere, off-main exit 2 with no ssh, a planted post-checkout hook leaves no canary and no checkout/switch is run, bad host or commit refused before anything is read, a dirty tree does not matter for `--commit`) | the template tests; the post-checkout case; the off-main case |

The `owner_of` fake now answers only the two staging-auth paths (anything else raises) and the dead `resolve` fake and its docstring are gone.
