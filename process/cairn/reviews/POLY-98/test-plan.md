# POLY-98 test plan (qa-98)

Authority: `ruling.md` incl. Addendum 1 (R1–R14, K1–K11, A1–A3) and `ruling-review.md` @ the tip `56a3b464`. House shape: POLY-97's test-plan. Harness: `tests/infra/ops/base.py`.
`U:` = `tests/infra/ops/` (unittest, in-process, fake ctx). `C:` = `tests/infra/provision/ops.test.ts` (the POLY-97 box, real root). `W:` = `tests/infra/ops-wiring.test.ts` + `tests/ci/changes.test.ts`. `B:` = `tests/infra/operator/test_b2_rclone_output.py`.

## Contract pins (mine, not in the ruling; devops builds to the tests, architect tells me if one is wrong)

The ruling fixes the Ctx field list but not signatures. Everything below is what the harness does; each is the narrowest reading of R1/R7/R11.

1. `infra/ops/polycarpic-ops` loads by path (`SourceFileLoader`, also through a symlink) and defines `main(argv, ctx) -> int`; nothing runs at import. It finds `commands/`, `status/`, `lib/` from `os.path.realpath(__file__)` and puts that `infra/ops` dir on `sys.path`. A `SystemExit` from argparse is accepted as the exit code.
2. `lib/ctx.py`: `class Ctx`, keyword-only `__init__(root, run, run_inherit, getpass, isatty, confirm, now, sleep, chown, geteuid, tls_probe, statvfs, stdout, stderr, trusted_uid=0)`; `ctx.p(path)` = root-prefixed path. Calls: `run(argv, stdin=None, timeout=None, env=None) -> (code, stdout_text, stderr_text)` (raises `TimeoutError` on timeout); `run_inherit(argv, env=None, timeout=None) -> code`; `getpass(prompt) -> str`; `isatty() -> bool` (stdin); `confirm(prompt) -> str` (the typed answer); `now() -> aware UTC datetime`; `sleep(seconds)`; `chown(fd_or_path, uid, gid)`; `geteuid()`; `tls_probe(host, port) -> {"ok": True, "not_after": datetime} | {"ok": False, "reason": str}` (raises `OSError` when nothing answers); `statvfs(path)` with the host path (`/`, `/srv/polycarpic`) -> object with `f_blocks`, `f_bfree` (raises `OSError` when not mounted). Used percent = `(f_blocks - f_bfree) * 100 // f_blocks`.
3. **`trusted_uid`** is mine: "root-owned" means `st_uid == ctx.trusted_uid` (0 in production), so unit tests, which cannot chown to root, can still exercise the integrity check and `list-secrets`' owner column (`root:<gid>` when the uid is trusted). Real root is proven in C:.
4. The integrity walk (K1) covers `ctx.p("/opt/polycarpic/ops/current")` resolved, every file and directory below it, every parent up to `ctx.root`, and the `/usr/local/sbin` directory. Message `polycarpic-ops: install is not root-owned: <real path>`, exit 4, on stderr. `--version` prints `polycarpic-ops <basename of the resolved current>`.
5. Messages not worded in the ruling, pinned exactly: `polycarpic-ops: unknown subcommand: <x>; available: <sorted, ", "-joined>` (exit 2); usage text starts `usage: polycarpic-ops `; `provision: --target home is not available`; `set-secret: <name> is written by <tool>, not set-secret` (tool = `provision`, `init-keyring`, `staging-auth`); `restart: unknown service <x>; available: <sorted, ", ">`; `b2-setup.py: --show-rclone-output is only valid with --probe`; a symlinked or non-regular target file is exit 4 with `<path> is not a regular file: run provision`. Service lists print `a, b`; restart hints print `a b`.
6. Child-process shapes the fakes answer (any other argv is a test failure): `docker compose -p polycarpic-<p> ps -a --format json` (project `polycarpic-edge` for caddy) printing one JSON object per line with `Service`, `Name`, `State`, `Health`; `docker inspect <Name>` printing a JSON array with `Config.Image`, `Created`, `State.StartedAt`, `Image`; `docker logs --timestamps --since 24h <Name>`; psql as ruled (R7a) with SQL on stdin, **separate calls for slots and revokes**. Running-detection for gate-check, cli and status is that `ps` output (State `running`). `run`/`run_inherit` argv is a list of `str`; env is exactly the fixed dict (plus `POLY_APP_IMAGE` and `POLY_POSTGRES_IMAGE` for cli).
7. `provision`, `provision-check`, `gate-check` and `cli` use `run_inherit` for the child that prints; every pre-flight read uses `run`. Order and spelling of forwarded flags follow the order given. `cli` argv: `docker compose -f <bundle>/infra/compose/<p>.yml -p polycarpic-<p> --profile operator run --rm -T --pull never --no-deps operator user invite <email> [--bootstrap]`. `<bundle>` is `ctx.p("/opt/polycarpic/ops/current")`.
8. psql output protocol for `revokes`: empty = all closed; lines `open:plpgsql`, `open:<sig>`, `missing:<sig>`. For `slots`: one slot name per line. Item details: `app` age prints `(<n> m)` under 60 min, `(<n> h)` under 48 h, else `(<n> d)`; `cert` prints `<host>, <n> days left`; `backupdb` prints `<n> poly_backup connections in 24 h, all accounted`, times as `HH:MMZ`, `jobs.log line <n>` for any bad or over-cap line, `postgres log covers only <n> h`. Screen order: header, `disk`, prod items, staging items. `RED` summary joins `item project` with `, `. **The `run: sudo polycarpic-ops provision --stage database --project <p>` line prints before the summary line** (R7 says both "under the summary" and "summary, last line"; summary stays last).
9. `lib/secrets.py` exposes `refused_by(name) -> "provision" | "init-keyring" | "staging-auth" | None`.
10. `set-secret`: all targets are checked before any is written (a bad second directory leaves the first untouched). Replace prompt goes through `confirm` with exactly `<name> exists for: <existing services>; type yes to replace:`. A `GetPassWarning` is caught as a warning-turned-error around `ctx.getpass`.
11. Fault injection for K4 replaces `os.rename` and `os.replace`; the code must use one of them. The temporary file must be 0440 at that moment.
12. **Wiring pair (agreed by message with devops-98 before either commits):** the `provision` job gains one step after the operator-tool step: name contains `polycarpic-ops`, run `python3 -m unittest discover -s tests/infra/ops -t tests/infra/ops`. The existing shellcheck step also lists `infra/ops/install.sh` (my pin, not ruled). `changes.mjs`: `provision` gains `^infra\/ops\/` and `^tests\/infra\/ops\/`; `image` excludes `ops\/` from both lookaheads. Nothing else changes (job set, 200 s budget).
13. `tests/infra/provision/Dockerfile` gains `git` (install.sh needs it in C:). That rebuilds the box image once; the base digest is unchanged.
14. `tests/infra/provision-wiring.test.ts` pins the operator test-file list; it gains `test_b2_rclone_output.py` (the only edit to an existing pin).

## Rows (one per R12 case and K condition)

| # | Ruled item | File :: case |
|--|--|--|
| 1 | R12 not root → 4 | U:test_dispatcher :: test_not_root_exits_4… |
| 2 | R12 group-writable file → 4 naming it | U:dispatcher :: test_group_writable_file…; C: install-ownership (real chown) |
| 3 | R12 unknown subcommand → 2 with list | U:dispatcher :: test_unknown_subcommand… |
| 4 | R12 help lists exactly the modules present | U:dispatcher :: test_help_lists_exactly…, test_the_eight_subcommands… |
| 5 | R12 planted `commands/evil-name.py` ignored | U:dispatcher :: test_planted_module_names… (six bad names, one good twin) |
| 6 | R12 child env exactly the fixed keys, poisoned parent | U:dispatcher :: test_children_get_an_environment…; C: children get exactly PATH, LC_ALL, HOME (real sudo) |
| 7 | R12 lint: shell=True, os.system, os.popen, string argv | U:test_lint :: test_no_shell_true… |
| 8 | K1 symlink loads the bundle's modules | U:dispatcher :: test_invoked_through_a_symlink… |
| 9 | K1 group-writable `<id>` reached via `current` → 4 | U:dispatcher :: test_group_writable_id_directory… |
| 10 | K1 no `__pycache__`, `dont_write_bytecode` | U:dispatcher :: test_bytecode…; U:lint :: dispatcher_shebang…; C: children… (find __pycache__) |
| 11 | K2 `allow_abbrev=False`; `--stag` → 2 | U:lint :: test_every_argument_parser…; U:dispatcher :: test_abbreviated_long_options… |
| 12 | A2 RLIMIT_CORE 0; R1 umask 077 | U:dispatcher :: test_umask_is_077_and_core_dumps… |
| 13 | R1 shebang `-IS`, root only via constructor | U:lint :: shebang…, test_no_test_hook… |
| 14 | R12 install: dirty bundle path → 2 | U:test_install :: modified tracked, untracked |
| 15 | R12 install: working-tree-only change not shipped | U:install :: test_a_working_tree_only_change…, test_the_archive_holds_only… |
| 16 | R12 install: root 0755/0644 + five executables | C: first install |
| 17 | R12 install: second install of same id changes nothing | C: a second install… |
| 18 | R12 install: third id deletes the oldest | C: a third id… |
| 19 | R12 install: `..` member → 1, current unchanged | C: a tar member with .., abs path, link (3 kinds) |
| 20 | R12 install: provision-check runs after reboot clears /tmp | C: provision-check runs from the bundle after a simulated reboot |
| 21 | A1 two ssh calls, fixed remote commands, install_box.py piped | U:install :: test_the_remote_commands…, test_a_clean_checkout_makes_exactly_two… |
| 22 | seceng note: one sha to git show and git archive | U:install :: test_head_is_resolved_once… |
| 23 | R12 provision: forwards exactly the flags given | U:test_provision :: test_forwards_exactly…, test_without_stage… |
| 24 | R12 `--target home` → 2 | U:provision :: test_target_home… |
| 25 | R12 domain starting with `-` → 2 (+ pattern, K3) | U:provision :: test_domains_that_break_the_pattern…, test_mail_from… |
| 26 | R12 `--b2-bucket` writes ops.conf once, `change:` first time only | U:provision :: test_b2_bucket_is_consumed… |
| 27 | R12 `--stage database` forwards `--project` | U:provision :: test_stage_database… |
| 28 | K2 unknown flag / abbreviation → 2, runner log empty | U:provision :: test_unknown_flags…; U:provision::ProvisionCheck :: test_unknown_flags… |
| 29 | R12 provision-check: bucket from ops.conf; none → 2 with hint; exit 3 passes | U:provision::ProvisionCheck (four cases) |
| 30 | R12 H6 passes ops.conf, fails with an extra line | C:H6 :: ops.conf is world-readable… |
| 31 | R12 D3 writes one jobs.log line (and `failed`) | C:D3 :: a passing run appends…, a failing probe… |
| 32 | R12 set-secret refused names with owners | U:test_set_secret :: test_every_refused_name…, test_the_provision_refused_set_equals… |
| 33 | R12 unmounted name → 2 with list; staging has no uploader | U:set_secret :: test_a_name_no_service_mounts…, test_staging_has_no_uploader… |
| 34 | R12 non-tty → 2; empty/space values → 2 | U:set_secret :: test_non_tty…, test_values_that_break_the_rules… |
| 35 | R12 resend_api_key lands in auth and worker 0440 `root:10007`/`root:10002`, H6 passes | U:set_secret :: test_resend_api_key_lands… (modes, output, chown calls); C:set-secret real root (440 0:10007 / 0:10002); C:H6 one value passes |
| 36 | R12 equal content under two names / staging = prod fails H6 | C:H6 (two cases) |
| 37 | R12 replace without `yes` leaves the old file | U:set_secret :: test_replacing_asks…, test_yes_replaces…; C: set-secret (no) |
| 38 | R12 symlinked target or service dir → 4, nothing written | U:set_secret (three cases: dir, file, mode); C: symlinked worker dir → rc 4 |
| 39 | R12 backup_store_credential two lines | U:set_secret :: test_backup_store_credential… |
| 40 | R12 R10-style sweep | U:set_secret :: test_the_value_appears_in_no_output…, test_no_fingerprint…, backup credential sweep; C: grep of every tree |
| 41 | K3 printable ASCII (email, mail-from, domain) | U:cli :: test_emails_that_break…; U:provision :: mail_from, domains |
| 42 | K4 umask 077 → still 0440; fault leaves no tmp; tmp is 0440 at rename | U:set_secret :: test_under_umask_077…, test_a_fault_between_write_and_rename… |
| 43 | K5 GetPassWarning → 2; 4097 bytes → 2 (4096 ok) | U:set_secret :: test_a_getpass_that_cannot…, test_values_that_break_the_rules… |
| 44 | K6 generated password as second name / generated name copied → H6 FAIL | C:H6 :: K6 test |
| 45 | R12 list-secrets exact table; no secret opened; 0644 → WRONG, 1 | U:test_list_secrets (five cases) |
| 46 | R12 gate-check exact argv; pass → 0; FAIL → 1; down → 1, no psql | U:test_gate_check |
| 47 | R12 status per-item OK/RED/WAIT exact lines | U:test_status (disk, app, cert, backup, backupdb, slots, revokes cases) |
| 48 | R12 status summaries and exits (green, waiting, red) | U:status :: test_all_green…, test_waiting…, test_a_red_item…, test_red_beats_waiting… |
| 49 | R12 30-line fixture ≤ 24 lines, ≤ 80 chars | U:status :: test_at_most_24_lines… (hostile long details; the item count cannot exceed 24, so the fixture stresses width and the fix lines) |
| 50 | R12 plpgsql open; one of 17 open; missing signature; 16 revokes → RED | U:status :: test_revokes_* |
| 51 | R12 connection outside windows RED with time; inside D3 window OK | U:status :: test_backupdb_* |
| 52 | R12 empty last-upload WAIT; 27 h RED | U:status :: test_backup_* |
| 53 | K8 hostile content never printed; future timestamps RED | U:status :: test_backup_hostile…, …future…; test_slots_names…; test_backupdb_a_future… |
| 54 | K9 short log RED unless young container; window caps | U:status :: test_backupdb_a_log_that_covers…, …window_caps… |
| 55 | K10 quoted signature → RED, no revokes psql; literals; read-only session | U:status :: test_revokes_ok_exact… (SET + literals), test_revokes_a_signature_with_a_quote… |
| 56 | R14 status ≤ 15 s; every status call bounded ≤ 10 s; read-only | U:status :: test_completes_within…, test_read_only… |
| 57 | R12 cli exact argv and image env; inherited stdout | U:test_cli :: test_exact_argv…, test_the_link_never_passes…; C: cli user invite |
| 58 | R12 refused verbs (five) and unknown → 2, nothing run; email `-` → 2 | U:cli :: test_refused_verbs…, test_unknown_verbs…, test_emails… |
| 59 | K7 `--pull never --no-deps`; tag-only image → 1, no run | U:cli :: test_exact_argv…, test_a_tag_only_image…, test_a_malformed_digest… |
| 60 | R12 restart: unknown → 2; healthy → 0; 120 s fake clock → 1 | U:test_restart (nine cases) |
| 61 | R12 b2-setup `--show-rclone-output` without `--probe` → 2; five values redacted; block after delete | B: (eight cases) |
| 62 | K11 value across byte 4096 leaves no bytes | B:: test_a_value_straddling_byte_4096… |
| 63 | R11 CI wiring: step, order, shellcheck, filter patterns | W: ops-wiring (5), changes.test.ts (6 rows) |
| 64 | A3 INFRA step 16 tells the operator to clear the screen | not a 98c case: a docs edit; checked at the verdict |

## Gaps, said plainly

- **A pre-build red is one reason.** Every U: case is red now because `infra/ops/` does not exist; the case-level assertions (exact lines, exit codes) are what discriminate once it does. I validated the harness shape (host tree, fakes, parsers) by running it against nothing but itself, not against a reference implementation.
- **Row 49:** R12 says "a 30-line fixture". The status screen has at most 11 item lines plus header, fix lines and summary, so 24 cannot be reached by count; the test pushes width and fix lines instead. If the ruling meant multi-line items, architect says so.
- **Row 44, K6's second test:** compose declares no refused name in two services, and H6's mounted-file list is hard-coded in `provision-check.sh`, so "a refused name present in two declared services" is tested as a generated name copied into a service that does not mount it.
- **C: tests need a Docker daemon and several minutes;** the set-secret case drives a pty with `script`, the one place a timing flake could appear.

## K12 (seceng, Addendum 2)

| # | Item | File :: case |
|--|--|--|
| 65 | (a) Ctx(...) never sets trusted_uid but literal 0; no SUDO_UID/SUDO_USER read | U:lint :: test_trusted_uid_is_never_set… |
| 66 | (b) production builder ignores SUDO_UID and `--trusted-uid` | U:dispatcher :: test_the_production_context… (pin 15: `lib.ctx.production()`; `main(argv)` with no ctx builds it) |
| 67 | (c) recorded chown uid is 0 whatever trusted_uid | U:set_secret :: test_the_recorded_chown_owner… |
| 68 | (d) sudo-user-owned file in the install → 4 under real sudo | C: an install file owned by anyone but root (file=4) |
| 69 | (e) fullmatch; newline-suffixed names ignored | U:dispatcher :: test_names_with_a_trailing_newline…; U:lint :: test_names_are_matched_with_fullmatch |

## Architect gaps (pins-review @ 00d40f8)

| # | Item | File :: case |
|--|--|--|
| 70 | G1 reserved-blocks fixture (100/24/19 → RED 80%); the earlier 100/30/20 case (78%) is a second df-vs-plain separator, G1 itself is test_reserved_blocks_fixture… | U:status :: test_reserved_blocks_fixture…, test_disk_percent_is_dfs… |
| 72 | K12 lint extras (seceng): no `trusted_uid` assignment outside `Ctx.__init__`, no `Ctx(**kw)`, no pattern string ending in `$` | U:lint :: test_trusted_uid_is_not_assigned…, test_no_pattern_string_ends_in_a_dollar_anchor |
| 71 | G2 revokes/slots SQL as built against real Postgres, (a)-(d) | C: "status revokes and slots SQL against a real Postgres" (pin 16: `status/<nn>_slots.py` `SQL`; `status/<nn>_revokes.py` `sql(signatures)`) |

## Build review B1-B3 (seceng @ e5a4f441)

| # | Item | File :: case |
|--|--|--|
| 73 | B1 echo-off is TCSAFLUSH, restore is TCSADRAIN (fake termios) | U:test_ctx_getpass :: both cases |
| 74 | B1 type-ahead before the prompt is not the secret (real pty, real sudo) | C: "B1: input sent before the prompt is dropped…" (driver waits for the prompt; `earlyvalue` written first) |
| 75 | B2 union of widened windows > 8 h → `jobs.log windows cover <n> h of 24`; 8 h exactly OK; overlap counted once | U:status :: test_backupdb_windows_covering_* , …overlapping… |
| 76 | B3 `--mail-from -x@example.com` → 2, `provision: bad --mail-from`, nothing run | U:provision :: test_mail_from_starting_with_a_dash… |
| 77 | R4 order (architect @ 0c279807): checks, yes question, then hidden value prompt; refused replace shows no value prompt; bad directory shows neither | U:set_secret :: test_replacing_asks…, test_yes_replaces…, test_a_bad_directory_is_refused_before…; C: set-secret on a real root (DRIVER-GIVEN) |
| 78 | B4 (seceng): production confirm reads with echo off (TCSAFLUSH), restores, never echoes the answer | U:test_ctx_getpass :: test_b4_* |
| 79 | B4 second test: a secret pasted at the replace question → exit 1 `not replaced`, nowhere in output/argv/env/files, not echoed on a real pty | U:set_secret :: test_b4_a_secret_pasted…; C: "B4: a secret pasted at the replace question…" (driver reports `DRIVER-ECHOED []`) |
| 80 | B2' nested window: 00:00-05:59, 00:10-00:15, 07:00-09:59 → `jobs.log windows cover 9 h of 24` | U:status :: test_backupdb_a_window_nested_inside_another… |
| 81 | B5 ECHO still set after echo-off → GetPassWarning, nothing read (getpass and confirm); set-secret exit 2 `set-secret: the terminal cannot hide input; nothing written`, nothing written | U:test_ctx_getpass :: test_b5_* (fake termios now returns the attrs last set; `stuck_echo` keeps ECHO) |
