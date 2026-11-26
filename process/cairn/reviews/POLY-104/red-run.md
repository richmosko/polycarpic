# POLY-104 red runs

## F3: `provision --stage host` exits 141

### Red

`pnpm exec vitest run -c tests/infra/vitest.provision.config.ts` (JSON report): 210 run, 43 passed, 167 failed, 0 skipped.

- `F3: the host stage completes …` fails with `rc=141` after `change: added Docker's apt repository`: the box's symptom.
- `F3 harness: …` passes: the fake dies of SIGPIPE for `madison` and `policy` when its reader leaves early.
- The other failures are one cause: every suite that needs a provisioned fake box fails its setup with `rc 141`. `create.test.ts` (42) needs none and passes.
- `F3 same shape: … H25 …` cannot reach H25 while the host stage fails. In an earlier run of the same day, with a smaller fake output that broke `grep -q` but not `awk`, it failed on its own reason: a false `FAIL H25` on a complete box, as did the existing G10 provision-check test and the summary-line tests that expect a clean box.

`python3 -m unittest discover -s tests/infra/ops -t tests/infra/ops -p test_provision.py`: 22 run, the signal test fails in all four cases (141 and 137 print nothing; -13 and -9 print nothing and are returned as they are). The positive twin (0, 1, 2 add no line) passes.

### The fake

**The model now in use** copies what the lead measured on the box: `awk` is gawk 5.2.1 (`/usr/bin/gawk`), and `apt-cache madison docker-compose-plugin` prints 50 lines, 6130 bytes, with the wanted version third. So the test box installs `gawk`, and the fake prints the lines of interest, pauses 0.2 s, then writes 47 older versions one write per line (`policy`: 47 older entries). Size is not the cause; a write after the reader has left is. The pause makes that order certain in the test; on the box it is timing. With this model and the `infra/` scripts of `9027719c`, `F3` fails with `rc=141`, and with only the old `provision-check.sh`, `F3 same shape` fails on a false H25.

The first red model, in `9027719c`, was wrong: the test box had mawk 1.3.4, which fills a large buffer before it runs a line, so it took 2 MB of output to get a 141 (220 KB gave none). The counts under Red above are from that model.

### Build-green at `fb6dd1cb`

Run on `2034dff2` (that fix plus the F4, F6 and DR3 red tests) with the gawk model. Box suite: 212 run, 210 passed, 2 failed, both F6. `test_provision.py`: 24 run; the F4 tests fail (1 test and 22 subtests), the rest pass, the signal tests among them. CI's `shellcheck -x` in the test box on `provision.sh`, `provision-check.sh` and `drill.sh`: exit 0. The whole ops unit directory was not run: `test_run_guard` refused it as an un-tiered full run.

### Build-green for F4, F6 and DR3 at `ff62d0d0`

Run on `ff53d4f5`, which holds it. Box suite: 212 run, 212 passed. `test_provision.py`: 24 run, all passed; `test_dispatcher.py` and `test_lint.py` passed. `vitest run -c tests/infra/vitest.config.ts`: 680 run, 677 passed, 0 failed, 3 skipped, `drill-dr3.test.ts` 9 of 9. The DR3 block also gives the right result in the test box with GNU grep 3.11 (`FAIL` on a password in a large plain or gzipped file, a missing, corrupt or cut file; `PASS` on a clean one). CI's `shellcheck -x` command: exit 0. Not run here: the backup container suite (`vitest.backup.config.ts`, which runs the whole of `drill.sh`) and the rest of the ops unit directory.

### The same shape elsewhere

A pipe whose reader can leave before the writer is done, in a script with `pipefail`. Searched `infra/**` and `.github/**` for a pipe into `head`, `read`, `cmp`, `grep -q`/`-m`/`-l`, `sed …q` and `awk … exit`. No ops Python command runs a shell pipe (`shell=False` everywhere).

**Reachable: the writer prints more than one line, or can print more than a pipe holds, and the status is used.**

| Where | Writer → reader | Effect |
|---|---|---|
| `infra/provision.sh:173` | `apt-cache madison` → `awk exit` | F3. `set -e`: the stage dies silently. |
| `infra/provision-check.sh:400` | `apt-cache policy` → `grep -q` | The version table lists every version after the first match: a false `FAIL H25`. Expected on the real box at the provision-check step. |
| `infra/provision.sh:557` | `docker compose ps --services` → `grep -qx postgres` | With the whole stack up it prints several services: if `postgres` is not last, a re-run of `--stage database` can say Postgres is not running. Timing-dependent. |
| `infra/provision-check.sh:567` | the same, in `running()` | The project is taken as down and its D checks as waiting. Timing-dependent. |
| `infra/drill.sh:104` | `plain_stream` (gzip or cat) → `grep -aqE` in `if` | **Fails open.** If `grep` matches and the writer is still writing, the pipeline is 141, the `else` runs and DR3 says PASS on a globals file that carries a password. Needs a globals file larger than the pipe takes at once; today's is small (unmeasured). |

**Same shape, low or no exposure**

| Where | Why |
|---|---|
| `infra/provision.sh:143` (`gpg` → `awk exit`) | Status used under `set -e`, output a few lines, runs only before the keyring exists. It passed on the box. Same fix is cheap. |
| `infra/provision.sh:447` (`sed` file → `head -1` → `sed`) | Status used; a local file with one `MAIL_FROM` line. |
| `infra/provision-check.sh:401` (`apt-mark showhold` → `grep -qx`) | Status used; one line per held package, one expected. |
| `infra/provision-check.sh:127`, `:444`, `:461`, `:603`, `:624`, `:645`, `:691` | `pipefail` without `set -e`, and only the captured text is used, not the status. |
| `infra/backup/restore-lib.sh:40`, `:118`, `:182` | `head -c 200` writes once. |
| `infra/backup/restore-lib.sh:196` | `sed` on a short Dockerfile → `head -1`. |
| `.github/workflows/*.yml` (`echo`/`printf` → `grep -Eq`; `build.yml:332` → `head -n1`) | One short write. |

No standing lint added: a text rule would flag all of the low rows and need an allowlist about as long as the list. The fixes that remove the shape: capture the writer's output first and then match it (`out=$(cmd) …; grep -q x <<< "$out"`), or a reader that reads to the end (`awk` without `exit`; `grep -c … > /dev/null`). `grep … > /dev/null` alone is not one: GNU grep sees `/dev/null` and leaves at the first match, as with `-q` (devops-104).

## F2: `install.sh` run by path

Red at `ebceb70b` (`tests/infra/ops/test_install_path.py`, 8 of 9 new cases failed). Build-green at `c1aaa6e3`: `test_install*.py` 24 run, all passed; box `ops.test.ts` (the real `install.sh` to `install_box.py`) 23 of 23; `shellcheck -x` on `install.sh` exit 0.

## `install.sh`: a failed git is hidden, and a locale-dependent check

`test_install_path.py` / `test_install*.py`: 31 run, 6 failed.

- **Hidden failure** (5 cases): `git show` or `git archive` writes nothing, part, or everything and exits 42; `install.sh` exits 0. Pinned: the script exits 42, an `install.sh:` line names `git show` or `git archive`, and the ssh command that runs `install_box.py` never starts. The last is a design constraint: a stream cut on a tar record boundary can look whole to the box, so the laptop has to know git succeeded first. A positive twin (the archive sent is git's whole output) passes.
- **Upper-case `--commit`** (1 case, older than this loop): in `en_US.UTF-8`, macOS bash 3.2 matches `A` to `E` with `[a-f]`, so an upper-case commit with no `F` passes the check. `test_install_commit.py::test_bad_hosts_and_commits…` therefore failed or passed with the letters of each run's random sha (it failed once in this loop). Pinned: `ABCDE`×8 gets `install.sh: bad --commit`. `LC_ALL=C bash` refuses it. On the Linux CI runner the old case is not expected to fail (unmeasured).

### Build-green at `c8f9d5f9`

`test_install*.py` 31 run, all passed; box `ops.test.ts` 23 of 23; `shellcheck -x` on `install.sh` exit 0; `vitest.config.ts` 677 passed, 3 skipped. Both outputs are now written to a temporary directory (removed on exit) and git's status checked before the first ssh.

## F11: staging secrets in the prod gids

The expected gid of each secret directory and file is the `user:` of its service in that project's compose file, read by the tests (a control asserts staging differs from prod for web, worker, migrate, operator and auth).

Box suite: 222 run, 215 passed, 7 failed, all new `F11` tests; the `F11 control` passes.

| Test | Red today |
|---|---|
| layout after a host stage | 11 staging paths in prod gids |
| rerun over the old layout, set-secret files added | 15 paths left wrong; pinned too: values unchanged, a `change:` line, a second run changes nothing |
| H6 on the right layout | false FAIL |
| H6 on the old layout | PASS |
| H6, one staging file (and one prod directory) wrong | the line lists the right paths instead, not the planted one |
| H9: 999, 10001, 10010, 10101, 10107, 10110 as primary group or membership; 998, 10100, 10111 allowed | 101xx pass |
| provision's account check, same ranges | runs with a 10101 account |

`test_set_secret.py`: 32 run, 2 subtests failed: with a staging service directory missing, the message names 10001 and 10007 where staging.yml says 10101 and 10107. The prod subtests pass. `list-secrets` reads the group from the directory, so it calls the wrong layout `set`; not pinned.

**Added after:** `F11: set-secret --staging, on the box …` runs the real `set_secret` module and `Ctx` as root on the host box (only the hidden prompt is stood in). `set-secret` copies the directory's group, so today the 3 staging files get prod gids and the 3 prod files are right. `host.test.ts` alone with it: 102 run, 94 passed, 8 failed, all `F11`.

### Two defects in these tests, found at build-green

- **The H9 red at `db9a7809` was not shown for the right reason.** The test box already has a group at gid 999 (`systemd-journal`), so the member plant for 999 failed without a word and the loop stopped there, never reaching 101xx. The plant now joins whatever group holds the gid and exits 90 if it did not take. Re-run against the scripts before the fix, it fails at `10101 primary`; the provision account test fails there too.
- The older `secrets: both roots 0700…` test expected the prod gids for the staging generated files: it asserted the defect. Staging now takes the gids of `staging.yml`.

### F11 build-green at `936f833b`: not green yet

Box suite (with both test fixes): 223 run, 222 passed, 1 failed: `infra/provision.sh is shellcheck clean`, SC2015 (info) at line 377, `[ -f "$f" ] && [ ! -L "$f" ] || continue`. CI's `shellcheck -x` step exits 1 on it. All `F11` tests pass. `-p` runs of `test_set_secret` (32), `test_list_secrets` (7), `test_provision` (24), `test_staging_auth` (12), `test_lint` (9), `test_dispatcher` (19), `test_status` (53), `test_restart` (9): all pass. `vitest.config.ts`: 677 passed, 3 skipped.

### Can `deploy-real` use provision's layout?

CI never ran it: `harness.ts` makes the staging secrets itself from its own table (`SECRETS`, 101xx). **Yes, for the secrets; no, for the whole host stage** (it wants a block volume for LUKS and installs packages and host settings on the runner). The seam is `secrets_for` with `gid_of`, `ensure_dir`, `change` and the `STAGING_SERVICES` / `STAGING_GENERATED` lists. `provision.sh` cannot be sourced (it parses arguments and dispatches at top level), so one of:

- **A, no product change:** the harness cuts those definitions out of `provision.sh` by name and runs them as root, failing if one is not found. Tied to the script's text.
- **B, small product change:** a narrow stage or source guard in `provision.sh` that runs only the secrets layout. Cleaner to call; adds root-run surface (devops-104, seceng).

Either way the harness then writes the files provision does not generate (`plaid_secret`, `resend_api_key`, `credential_keyring`) with the group of the directory it finds, as `set-secret` does, drops its gid table, and adds the generated values to the leak sweep's list by reading them back. A wrong gid would then leave a real container unable to read its secret, which `first-deploy` should refuse (unmeasured). Recommend A. Not done.

## F9: H25 false FAIL, the render user cannot read its HOME

`provision-check.sh` makes the render user's HOME with `mktemp -d` as root (0700 root) and asks `docker compose version --short` as uid 10020. The fake `docker compose version` now does what the real CLI did on the box: if `$HOME/.docker/config.json` gives "permission denied" to the caller, it prints the warning and `unknown flag: --short` and exits 125; a HOME that is not there is no error.

Box suite: 214 run, 203 passed, 11 failed, all on the one false `FAIL H25`: the new `F9: provision-check H25 …` and ten existing tests that expect a clean H25 or its summary line. `F9 harness` passes (125 on a root 0700 HOME; the version on an owned or missing one).

**The deploy's own render HOME** (`state/deploy/render-home`, `compose_guard._render_env`): `dirs.ensure` keeps it root 0755 by `chmod`, so uid 10020 can read it. Covered by `test_deploy_paths.py` (modes under umask 077, with fakes) and, for real, by the CI `deploy-real` job: `first-deploy staging` runs the G10 version question as uid 10020 on real Docker, which would refuse `render-env` on an unreadable HOME, and G1 there asserts `755 root:root`. No unit test asks as uid 10020. `deploy-real` was not run here. No red test added.

### Build-green for F9 at `410a3e47`

Box suite: 214 run, 214 passed. `shellcheck -x` on `provision-check.sh`: exit 0. The fix keeps the HOME root-owned and makes it 0755.

## F4, F6 and the drill (DR3)

- **F4** (`test_provision.py`, 24 run): `polycarpic-ops provision` refuses `--bind-addr`, `--staging-allow`, `--acme-email`. Red: the forwarding test (1) and the bad-value test (22 subtests), which wants exit 2 with `provision: bad --<flag>` and nothing run. The signal test (4) is still red.
- **F6** (`host.test.ts`): nothing creates `/srv/polycarpic/caddy` or `caddy-config`. Two tests: created 10010:10010 0700 and writable by 10010; root-owned 0755 ones repaired by a rerun with contents kept and a `change:` line.
- **DR3** (`tests/infra/drill-dr3.test.ts`, no container; `vitest run -c tests/infra/vitest.config.ts tests/infra/drill-dr3.test.ts`): 9 run, 5 failed, each `PASS DR3` where `FAIL DR3` is due: a password early in a large file (gzip and plain), a missing file, a corrupt gzip, a truncated gzip. The last three need no particular size.

F3 hides F6 and H25, so both were also run with a one-line local `awk` fix in `provision.sh`, then reverted and not committed: `host.test.ts` 91 run, 84 passed, 7 failed: the two F6 tests, `F3 same shape`, and four existing provision-check tests on the same false H25. `F3` itself passed with that fix.
