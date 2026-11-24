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

## Build-review faults F1-F15 (ruling.md table), tests written from the ruling BEFORE the fixes

Each test below was run against the build at `3bbc6626`/`28811f74` (product code unchanged) and is red on it for the reason the finding names. The mutant column of the ruling is run
once devops-100's fix makes the test green (a test that never went green has no mutant to show); until then "red on today's code" is the proof it can fail.

| Fault | Tests | Red today because |
|---|---|---|
| F1 | `release-bundle-poly100.test.ts` (static), `tests/infra/image/release-bundle.test.ts` (built image; container, not yet run), `test_deploy_bundle.F1Harness` | the Dockerfile has no `/release/infra` assembly (`COPY . .`) |
| F2 | `test_deploy_hang.py` | a hanging or raising health read escapes `deploy`; `_real_run` raises on non-UTF-8; no `in-progress`, no `interrupted` |
| F3 | `test_deploy_shared_release.py` | staging's live release directory is deleted by prod's refusal and by a failed sibling pull; a tampered tree is rewritten; leftover `.incoming-*` stays; prune with an unreadable pointer removes everything |
| F4 | `test_deploy_render.py` | renders run unwrapped (a remote include is fetched: 2 network attempts); no saved render, no second render on stdin; compose calls name the bundle's files |
| F5 | `test_deploy_state.py` (F5) | an unreadable `current`/`previous`/`quarantine`/`first-attempt` reads as absent; a malformed quarantine line is skipped |
| F6 | `test_deploy_state.py` (F6) | only digest and commit are validated: bad tag, tree or time pass |
| F7 | `test_deploy_state.py` (F7) | `edge-deploy` and `first-deploy` exit 0 and print nothing on a transient |
| F8 | `test_deploy_faults.py` (F8) | rollback does not check owner or modes of `releases/<d>` |
| F10 | `test_deploy_faults.py` (F10) | `edge.env` missing a key or unreadable is not refused `edge-env` |
| F11 | `test_deploy_state.py` (F11) | a guard refusal of `current` is `guard-<rule>` and quarantines the candidate |
| F12 | `test_deploy_faults.py` (F12) | no `transient-since`, no `transient-stale` |
| F13 | `test_deploy_state.py` (F13) | no `ctx.ismount`: an unmounted `/srv/polycarpic` is not refused |
| F14 | `test_deploy_guard.py` (8 new cases; fixtures now render every profile) | `logging`, `ulimits`, `mem_limit`, `tmpfs` values pass the guard |
| F15 | `test_deploy_oneoff.py` | no `--name`, migrate timeout 600 s, a hang is `migrate-124`, no `oneoff-stuck` |
| F9 | not written: the ruling gives no signature for `_edge_up(judged=…)`; asked of architect-100 |

## F4 (form decided: corrected JSON, f08d4948), F9, F16, S33, S35 — written from the ruling, red on the build before the fixes

| Tests | Red today because |
|---|---|
| `test_deploy_render.py` (isolation, remote include, saved render, second render on stdin, only the saved file with -f) and `RenderFiles` (the fixed point: the second render is fed exactly the saved bytes; the zero correction; S35 owner and mode 0600 under umask 0; no fixture secret value in any saved render, log or alert: green today only because nothing is saved yet) | renders unwrapped (a remote include is fetched twice); nothing saved; compose calls name the bundle's files |
| `test_deploy_render_users.py` (S33): `backup`, `upload`, `cli` with a `current` and no render refuse and never name a bundle compose file | `upload` falls back to `releases/prod-current/infra/compose/prod.yml` |
| `test_deploy_judged.py` (F9) | no `Judged` type; `_edge_up` takes a constant |
| `test_deploy_flags.py`, `tests/infra/flags-real.test.ts` (F16/T14) | `compose run --no-build` (refused by every fake; the lint test reads the real `--help`) |
| `test_deploy_hang.py` `S33` (the `interrupted` file) | no `interrupted` file |

## A18 and A17 (ruling 13e43e26), red first

`test_deploy_render.py`: the argv prefix is now `setpriv --reuid 10020 --regid 10020` (red: renders are unwrapped); `RenderUser`: a missing render user, one with a shell, another uid, another gid or a home refuses `render-user` exit 4 and a good one passes (red: no check); `Tamper`: a saved render changed between the judging and the `up` is refused (red: nothing is saved, nothing re-read). `test_deploy_render_prune.py` (A17): a pruned release's render goes with it, a stray one is removed, a kept one stays (red: no renders are saved or pruned). `test_deploy_guard.py`: a bind with `propagation: rshared` is refused (red: the guard accepts it). The harness plants `/etc/passwd` with the render user as `provision.sh --stage host` makes it.

## F1 built image (tests/infra/image/release-bundle.test.ts), run on the Mac with devops-100's F1 fix

Harness fixes first (test-side): the build needs `--build-arg GIT_COMMIT` (a 40-hex value) and the build artifact `infra/release/images.env` (written by `infra/ci/images-env.sh` with all-zero digests, removed after). Then green, 3 of 3. Mutant: `infra/postgres/gate-check.sh` added to the Dockerfile's `cp` list: green on the first test as written (it let any `infra/postgres/*` through), so the assertion was tightened to the four `.conf` files plus `archive-wal.sh`; with the mutant it is now red, restored it is green.

## S31 on the real tools (tests/infra/render-isolation.test.ts): written, NOT run (macOS has no `unshare`/`setpriv`); CI's lint job (Linux) is its first run

(1) a root-only file through a local `include` fails the render as uid 10020, works as root (control); (2) a 0400 root canary is in no render or error, and is in a root render (control); (3) a remote `oci://127.0.0.1:<port>` include reaches a host listener without `unshare --net` (control) and not within it. In CI a missing tool fails the file; on a developer machine it skips with the reason. Mutants: render as root reds (1) and (2); no `unshare` reds (3). The swapped-between-two-renders case is a unit case (`test_a_second_render_that_differs_from_the_judged_one_is_guard_render`, red until F4); the code-level `-f -` re-render as the render user runs in provision when F4 lands.

## Mutants on devops-100's F4/F9 build (01326835), one at a time with the Edit tool, restored by `git checkout`, tree clean after each

| Mutant (infra/ops/lib/compose_guard.py) | Test file | Result |
|---|---|---|
| F9: `verify` accepts any truthy value | test_deploy_judged.py | red (4 fail, 2 error: another project's, another digest's, changed/linked file, wrong hash; `True` crashes instead of `unjudged`) |
| F9: no digest compare | test_deploy_judged.py | red: `test_another_digests_judged_is_unjudged` |
| F9 / F4: no hash re-read | test_deploy_judged.py; test_deploy_render.py | red: changed/missing/linked file, wrong hash; and `test_the_saved_file_changed_between_the_judging_and_the_up_is_refused` |
| F4: saved 0644 | test_deploy_render.py | red: saved render root 0600; S35 owner and mode under umask 0 |
| F4: fixed point skipped | test_deploy_render.py | red: `test_a_second_render_that_differs_from_the_judged_one_is_guard_render` |
| F4: no `unshare` in the render prefix | test_deploy_render.py | red (9: the isolation prefix, a remote include fetched, the second render on stdin, the fixed point…): the argv shape check is the discriminator |
| F4: render uid 65534 | test_deploy_render.py | red, but LAYERED: `render_user_ok` reads the same constant, so every render refuses `render-user` first; the prefix test also names 10020 |
| F13: `require_data_mount` never refuses (deployer.py) | test_deploy_state.py | red: `test_an_unmounted_data_volume_refuses_every_command_…` |
| F11: a refusal of `current` keeps its plain `guard-<rule>` name | test_deploy_state.py | red: `test_a_guard_refusal_of_current_is_current_guard_rule_…` |
| F8: `owned_safely` always true (release.py) | test_deploy_faults.py | red: `test_each_unsafe_previous_is_refused_and_nothing_is_upped` |
| F3: `named_by_a_pointer` always false | test_deploy_shared_release.py | GREEN, EQUIVALENT alone: `remove_created` runs only when this run created the directory (`created`) |
| F3: remove regardless of `created` | test_deploy_shared_release.py | GREEN, layered: the pointer check still saves it |
| F3: both together (the original bug) | test_deploy_shared_release.py | red: `test_a_guard_refusal_of_prods_run_leaves_stagings_release_directory_alone` |

Still to mutate (not yet done): F2, F5, F6, F7, F10, F12, F14, F15, F16 (covered by the flags lint), S33's fallback to a bundle compose file, S35's saved-secret check (needs a mutant that saves an unredacted env value: none exists in the build), A17 prune of renders, A18's `render-user`.
| A18 H23: the row comparison in provision-check.sh never fails | tests/infra/provision/host.test.ts (H23 case) | red on "a shell" (the case with a shell, a home, another group, another uid, missing); a complete host box also passes H23 |
| F2/S32: quarantine at the first interruption | test_deploy_hang.py | red: `test_a_leftover_in_progress_is_interrupted_the_first_time_and_quarantines_the_second` |
| F12: `transient-stale` never fires | test_deploy_faults.py | red: `test_a_persistent_transient_alerts_after_an_hour_and_success_clears_it` |
| F10: `edge.env` keys never checked | test_deploy_faults.py | red: `test_edge_env_missing_a_key_or_unreadable_is_edge_env_…` |
| A17: prune removes no render / removes every render (kept ones too) | test_deploy_render_prune.py | red both ways (2 tests each) |
| F15: no inspect after the timeout's `rm -f` | test_deploy_oneoff.py | GREEN at first: the fake showed the stuck container before the run, so the pre-run check refused and the timeout path was never reached. Fake changed (a stuck one-off exists only once a run of it has hung); then red: `test_a_one_off_that_is_still_there_after_rm_is_oneoff_stuck_…` |
| F6: the pointer's tag, tree and time unvalidated | test_deploy_state.py | red ×3 (bad field per project, damaged tag, unhashable tree) |
| F5: any read error is "absent" | test_deploy_state.py | red ×3 (unreadable current/previous, first-attempt, quarantine) |
| F14: logging, ulimits, mem_limit, tmpfs pins removed | test_deploy_guard.py | red: all 8 F14 cases |
| S33: a missing render falls back to the bundle's compose file | test_deploy_render_users.py | red: backup/upload/cli |
| A18: shell check removed from `render_user_ok` | test_deploy_render.py RenderUser | red |
| F7: a transient `first-deploy`/`edge-deploy` exits 0 without the cause | test_deploy_state.py | red |
| F16: `compose run --no-build` (the original) | test_deploy_flags.py, flow tests | red on the build before the fix; `bad_options` refuses it in every fake |
Mutants not made: S35's secret-in-render check (the build never saves a secret value, no natural mutant; the test is green today and the fixture secrets are random per run); F1's static form (red-run F1 row above).
| S35: the corrected render printed to stderr on a refusal / written to `deploy.log` on a refusal (seceng's mutants) | test_deploy_render.py `baked(refused)` (the plain render carries a run-time marker standing in for an env_file value; it may be in the saved 0600 `render-*.json` alone, accepted or refused; stdout, stderr and every file under the root are searched) | red both: `test_s35_a_refused_runs_baked_value_is_in_no_file_log_alert_or_output`. The earlier S35 test could not see this (fixture secrets never enter a render: only paths do), so it stays as the secret-file check. |
| S35 ruled mutant (rendering as root with a root-only env file) | tests/infra/render-isolation.test.ts cases 1 and 2 | Linux only; CI's lint job is the first run |
| lint-poly99: allowlist is now ten names (POLY_STAGING_ALLOW, POLY_TLS are edge.env keys in F10's check; seceng-100 approved) | lint-poly99.test.ts | 31 pass |
| R13: F1 built-image test must not build a second image in CI | tests/infra/image/release-bundle.test.ts | red on the fault: `CI=true` with `POLY_APP_TEST_IMAGE` unset fails at once with the R13 message and starts no build (3 skipped); ci.yml sets `polycarpic:ci` (devops-100, 42a9cb3f); locally the test still builds its own |

## Section G (ruling 822a05a9; seceng re-review c02f16ee), red on the 2825b6f7 build, before devops-100's fixes (tests at 92479469 and the H23 split after)

| Row | Tests | Red today because | Passes today, no mutant yet (UNTESTED until its mutant is red) |
|---|---|---|---|
| G1/S37 unit | `test_deploy_paths.py` (5) | dirs 0700 under umask 077 (`makedirs(mode=)`); no repair; link/file in the way gives `postgres-major`, not `render-path`; a 0600 env file and a non-`o+x` parent are not checked | — |
| G2/G6 | `test_deploy_unwind.py`, `test_deploy_unwind_more.py` | quarantine first: ENOSPC at the quarantine leaves the bad release up; a Refusal after `up` goes to `refuse`; alert, log, quarantine order is log, quarantine, alert; the alert/log failures raise out; manual edge rollback writes the quarantine before the restore and a failed record gives exit 0 | every-write ENOSPC for the project and edge; `in-progress` cleared after the quarantine; `in-progress` unwritable before `up` |
| S36 | `RestoreNeedsNoWrite` (3) | the broken-hash saved pair gives `internal`, not `rollback-unhealthy` | the restore with an unchanged render and the saved-pair fallback |
| G3 | `test_deploy_ps_once.py` (4) | a second failing `ps` starts the candidate's Postgres; a first failing `ps` exits 0; two `ps` before step 5 | down-Postgres from current's render |
| G4 | `test_deploy_gone.py` (7) | a daemon error, an exit-1 with no message and a timed-out inspect all read as gone (`migrate-timeout`/`internal`); no 5 s re-check | the real message forms read as gone; a container that goes away during the re-check |
| G5 | `test_deploy_sidecar.py` (5) | no `.sha256` sidecar; a failed fixed point leaves a saved file; `upload` uses a render whose bytes are not its hash | failed re-judge of `current` leaves the old pair |
| G7 | `test_deploy_budget.py` (2) | 29 s children: the rollback starts 145 s after the `up` (child budget computed once per poll) | the slow healthy child |
| G8 | `host.test.ts` H23 ×3 | today's check filters on the string `docker compose`: a real render shape FAILs and a script named with the words PASSes | the right executable with other arguments (FAILs today by the same string match) |
| G1 Linux, G2 prod-with-edge | not written: wait for devops-100's helper name | | |

## Section G mutants on devops-100's build (e4d80fa9), Edit tool, restored by `git checkout`, tree clean after each

| Mutant | Test | Result |
|---|---|---|
| G2: quarantine before the restore | test_deploy_unwind*.py | red ×4 (ENOSPC at the quarantine, log failing…, edge) |
| G2: one `try` around log and alert | test_deploy_unwind.py | GREEN at first: my cases only failed the quarantine; added `test_a_log_that_cannot_be_written_never_stops_the_alert_…`; then red |
| G2: `in-progress` cleared before the quarantine | test_deploy_unwind.py | red ×2 |
| G2: a Refusal after `up` goes to `refuse` | test_deploy_unwind.py | red: `test_a_refusal_raised_after_up_restores_first` |
| G3: `_start_postgres` asks `ps` again | test_deploy_ps_once.py | red: one ps before step 5 |
| G3: a failed `ps` read as "not running" | test_deploy_ps_once.py | red: the first-ps-fails case |
| G3: the candidate's render passed to Postgres with a `current` | — | EQUIVALENT: `pj` is used only when Postgres is down, and then it is reassigned from current's own judgement |
| G4: gone on the exit code alone | test_deploy_gone.py | red ×3 |
| G5: save before the in-memory fixed point | test_deploy_sidecar.py | red: a failed fixed point leaves a file |
| G5: readers check existence, not the hash | test_deploy_sidecar.py | red ×2 |
| G7: one 30 s child budget per poll | test_deploy_budget.py | red: 145 s > 125 s |
| G1: no `chmod` repair | test_deploy_paths.py | red ×2 |
| G1: repair through a link (no `O_NOFOLLOW`) | test_deploy_paths.py | red: link in the way |
| G1: file checked, parents not | test_deploy_paths.py | red: non-`o+x` parent |
| G1: `render-path` quarantines | test_deploy_paths.py | red ×2 |
Still to do: G8 (one container run), G6's `_handle_interrupted` ignoring the restore's answer (the test is red on devops-100's build: `_Stop` is caught as `internal`, reported to devops-100), G6 `mark_transient`, S36's three cases, G2 for prod-with-edge, G1's Linux case.

## G1 (8635f525), G8, T-real, H24: mutants on devops-100's build (3b67f7de, fcafa305)

| Mutant | Test | Result |
|---|---|---|
| G1: the tool repairs 0775 (`mode & ~0o775`) | test_deploy_paths.py | red: `test_a_mode_beyond_0755_is_refused_left_as_found_…` |
| G1: provision.sh repairs 0775 (`~8#775`) | host.test.ts G1 provision case | red: "0775: left as found" |
| G8: H23 judges the command line alone | host.test.ts G8 ×3 | GREEN at first: my "script" case also had adjacent `compose config`, which the glob rejects by itself; given realistic arguments (`compose -p … config`) it is red |
| Fixture faults found (mine): the snapshot tar did not keep /opt/polycarpic (H24 failed on every box test); root in the container cannot read another user's /proc/<pid>/exe (added CAP_SYS_PTRACE: a real box's root can) | tests/infra/provision/box.ts | provision config 194/194 |
| Product edge, told to devops-100: H23's glob ` compose `…` config ` cannot match `compose config` written adjacent (no flag between); a real render has `-p` and the files between, so nothing breaks today |
T-real (tests/infra/deploy-real, tests/ci/deploy-key.test.ts): written, not run here; first CI run is its red/green record, and it must be red on 2825b6f7 (G1).
| G5 (seceng-100): `pair_ok` checks existence only | test_deploy_sidecar.py: sidecar changed alone: each reader refuses `state` | red ×3 |
| G5 (seceng-100): the same mutant | test_deploy_unwind_more.py: a restore with a saved pair whose sidecar differs is `rollback-unhealthy` | GREEN, LAYERED: `_saved_pair` also compares the stored hash itself; the case still pins the behaviour |
| G5 (seceng-100): a changed sidecar alone does not stop `up` | test_deploy_render.py `SidecarTamper` | passes on the build as ruled (`up` re-hashes the .json against the Judged record) |

## G9 / S39 (ruling 69f538ae), red on a66b0cf9-era build: `test_deploy_render_error.py` (9)

Red today: no `render-error` line (reason, stage, exit code or `timeout`, the cleaned and cut text), the control render of the installed bundle is never made, so a box fault is `guard-render` with a quarantine instead of `render-env` without one; a timeout is not `render-env`. Green today with no mutant yet (UNTESTED until it is red on: printing stdout, the help text, an install command): `test_stdout_is_never_printed`, `test_no_install_command_and_no_help_text…`. The fake gained `config_rules` (fail one file and pass another, exit with stderr/stdout, or time out).

## G9 mutants on devops-100's build (compose_guard.render_refusal / _control_passes)

| Mutant | Result |
|---|---|
| cut to 300 bytes before cleaning | red: `…cleaned_before_it_is_cut_to_300_bytes` |
| stdout quoted (`_last_line(out + err)`) | GREEN: my stdout case had a non-empty stderr whose last line won; added a case with empty stderr |
| stdout quoted when stderr is empty (`err or out`) | red: `test_stdout_is_never_printed` |
| quarantine on a timeout | red: `…timeout_is_render_env…` |
| an install command printed after the reason | red ×2 |
| help text printed | red |
| the control rendered without the isolation | red: `…control_renders_the_installed_bundle_the_same_way…` |
Not made: the control using the candidate's images.env (the build passes fixed placeholders and takes nothing of the release; my test asserts the candidate's digest is absent from the control's argv).
