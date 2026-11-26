# POLY-104 red runs

## PR 1 gate, `dbdfa571a5`

Run on a Mac on 2026-11-25. The commits after it up to `5ca11b67` change `process/cairn/reviews/POLY-104/` only. `changes.mjs` on `origin/main...HEAD`: `image`, `provision`, `backup`, `deploy` true; `node`, `layers`, `db`, `ci`, `e2e` false.

| CI job and step | Result |
|---|---|
| guard: action pins, run-body expressions, gitleaks 8.30.1 over the PR range | pass (gitleaks: 55 commits to `5ca11b67`, no leaks) |
| cairn (ledger lane): `cairn check`, the 4 ledger test files | ok; 70 passed |
| lint: auth row, ESLint, migrations, freshness, types, audit, audit guards, compose policy, `vitest.config.ts` | pass; boundaries 11; audit 2 moderate (gate is high); guards 10; infra static 687 passed, 3 skipped |
| unit: per-package (affected), web e2e, cross-package | no package affected; e2e not affected; cross-package 100 passed, 15 skipped |
| provision: `shellcheck -x`; box suite | exit 0; **252 of 252** (189 s) |
| provision: ops tests, by groups (lead's OK) | **667 passed** |
| provision: operator tool tests, by groups | **93 passed** |
| image: build, built-image check, derivatives | pass |
| image: Trivy on app, Postgres, Caddy | pass on `--no-cache` derivative builds (with stale cached layers Postgres showed 58 HIGH) |
| image: container tests (`vitest.image.config.ts`) | 109 run, **107 passed, 2 failed** (below) |
| image: backup, uploader, restore, drill (`vitest.backup.config.ts`) | **112 of 112** (359 s; `drill.test.ts` 11) |

**Ops groups.** CI's `unittest discover` is refused by `test_run_guard` and has no gate form (`--gate` belongs to `run_tests.py`, which runs the cairn suite only). 64 files, each matched by exactly one of: `test_[abc]*.py` 3 files / 43 tests, `test_deploy*.py` 47 / 398, `test_di*.py` 1 / 19, `test_[e-k]*.py` 4 / 36, `test_[l-r]*.py` 5 / 53, `test_[s-z]*.py` 4 / 118. Sum 667, the number `TestLoader.discover` loads from the directory. Operator: 6 files, `test_b*` 39, `test_d*` 47, `test_l*` 7; sum 93, as loaded. **CI's exact `discover` commands are the final proof and run on the PR.**

**The 2 failures** (`postgres.test.ts`: an unrelated uid, and web or postgres across directories, must be refused a `0440` file) come from this Mac: on a bind mount a `0:10001` 0440 file is readable by uid 12345, and on a named volume the same file is refused. Neither the tests nor what they test differs from `main`. Not verified on Linux here.

**Not run:** the `deploy-real` job (needs the CI runner; its fake `gh` changed in this branch, read and compiled only); `install-trivy.sh` (Trivy 0.76.2, the same version, run from its container on saved images) and `install-compose.sh` (local Compose 5.7.0, CI pins 5.7.1). Not triggered by this diff: `db`, layer checks, `tests/ci` suite, actionlint.

**CI time (estimate, unmeasured).** `image` job: 772 s on run 45661985841, backup step included (439 s; container tests 154 s). `caddy-compose-edge.test.ts` adds about 90 to 120 s, mostly fixed waits (the 60 s healthcheck interval, two 10 s upstream retries): about **860 to 890 s of 1200**. `provision` job: 219 to 296 s in the last three runs read, already over its 200 s warning budget; the box suite grew from 210 to 252 tests since this loop's first run (189 s here) and the ops tests by the new files, so expect about 330 to 380 s of its 900 s limit (weaker estimate: no same-machine baseline from `main`).

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

### Seceng's S1 and S4

**S1** (a link at a secrets root or service directory is followed and the target re-owned). Box suite on `7d6d38c7` plus these tests: 228 run, 222 passed, 6 failed: the shellcheck one above and 5 new `S1`. In each, the host stage exits 0 and the target's groups change.

- Four tests, pinned as `deploy_dirs` behaves (exit 1, a message with the link's path and `is a link`, target untouched, link left): staging service dir to prod's; staging root to prod root; prod service dir outside the tree; prod root outside the tree.
- **One more than the review lists:** the review says a file symlink is skipped. That holds for the new loop only. The `generated` loop after it runs `chown` and `chmod` on `$root/$pair` through a link: with `staging-secrets/web/db_password_app` linked to prod's, prod's file moves to `0:10101`. Pinned: the target keeps owner, mode and content (how it is refused is left open).

**S4** (`tests/infra/provision-gid.test.ts`, no container, `vitest.config.ts`): 10 run, 4 failed: both scripts give the prod gids for `…/staging-secrets/` and `…//`.

S2 (hardlinks) has no test.

### Build-green at `f674a6d3` (F11 with S1 and S4)

Box suite: 228 run, 228 passed. CI's `shellcheck -x` command: exit 0. `vitest.config.ts`: 687 passed, 3 skipped (`provision-gid.test.ts` among them). `-p` runs of `test_provision*` (24), `test_set_secret*` (32), `test_list_secrets*` (7), `test_lint*` (9): all pass. The refusal reads `<path> is a link; not changing it`. A linked host-only secret and `secrets/host` are refused too (read from the diff; no test plants one).

### Can `deploy-real` use provision's layout?

CI never ran it: `harness.ts` makes the staging secrets itself from its own table (`SECRETS`, 101xx). **Yes, for the secrets; no, for the whole host stage** (it wants a block volume for LUKS and installs packages and host settings on the runner). The seam is `secrets_for` with `gid_of`, `ensure_dir`, `change` and the `STAGING_SERVICES` / `STAGING_GENERATED` lists. `provision.sh` cannot be sourced (it parses arguments and dispatches at top level), so one of:

- **A, no product change:** the harness cuts those definitions out of `provision.sh` by name and runs them as root, failing if one is not found. Tied to the script's text.
- **B, small product change:** a narrow stage or source guard in `provision.sh` that runs only the secrets layout. Cleaner to call; adds root-run surface (devops-104, seceng).

Either way the harness then writes the files provision does not generate (`plaid_secret`, `resend_api_key`, `credential_keyring`) with the group of the directory it finds, as `set-secret` does, drops its gid table, and adds the generated values to the leak sweep's list by reading them back. A wrong gid would then leave a real container unable to read its secret, which `first-deploy` should refuse (unmeasured). Recommend A. Not done.

## F15: no `gh` on the box (form ruled by seceng-104: pinned release tarball)

**Red.** Box suite: 248 run, 228 passed, 20 failed, all in `tests/infra/provision/gh.test.ts`. `test_deploy_gh.py`: 13 tests, 28 failures and 2 errors counting subtests; one passes, `no failed gh call puts its stderr anywhere` (today nothing of gh's stderr is logged; it guards the fix). `-p` runs of `test_deploy_compose_version` (9), `test_deploy_recover*` (38), `test_deploy_token*` (8), `test_deploy_flow` (11), `test_deploy_candidate` (21), `test_deploy_faults` (8), `test_deploy_edge*` (22), `test_install*` (31): all pass with the shared fixture changes.

**Seam.** Pins `infra/deploy/gh-version` and `gh-sha256` (two `sha256sum` lines: `gh_<v>_linux_amd64.tar.gz`, then `gh_<v>_linux_amd64/bin/gh`), read from `$here/deploy/`, both in `install.sh` PATHS. The box serves a stand-in release at the real URL through the fake `curl` and mounts the stand-in's `gh-sha256` over the repository's (only once that file exists); the real hashes are never exercised, and no test checks them against GitHub's. A fake `dpkg` answers `amd64`. A case that needs other pins runs from a copy of `infra/`.

**Pinned beyond the ruling:** `H26` never runs a `gh` whose hash is wrong (the check is root). At deploy: `gh --version` is the first `gh` call and gets no token; `rollback` asks nothing of gh; refusal `gh`, exit 4. A failed call prints `gh: exit <n> (<label>)`; the eight labels are devops-104's allowlist (`http-401`, `http-403`, `http-404`, `rate-limit`, `no-attestations`, `verify-failed`, `network`, `other`), one sample stderr each. Not tested: a refused tarball with extra or hostile members beyond the one extracted.

Four older helpers that count network calls now leave `gh --version` out.

### Build-green at `00b5d14a`

Box suite: 248 run, 248 passed. CI's `shellcheck -x` command: exit 0. `vitest.config.ts`: 687 passed, 3 skipped. `-p` runs: `test_deploy*` 398, `test_install*` 31, `test_provision*` 24, `test_dispatcher` 19, `test_status` 53, `test_lint` 9: all pass.

Two defects on the test side, found here:

- The box snapshot did not keep `/usr/local/bin`, so the installed `gh` was gone in every later test: 14 failed on the first run at `00b5d14a`, and three of the F15 reds at `d3923393` (rerun, replaced bytes, good gh kept) could not have gone green. The snapshot now keeps it.
- **The CI `deploy-real` job would have failed:** its fake `gh` did not answer `--version` and rejects any call without the token, so every `first-deploy` would be refused `gh`. The fake now answers `--version` from the installed bundle's `gh-version`, before its token check. Read and compiled only: `deploy-real` needs the CI runner.

## F17: D1 wants archiving on staging

**It slipped because** `checks-db.test.ts` ran its "staging" Postgres on the prod `postgresql.conf`. `startPg` now takes the project and mounts that project's `postgresql.<project>.conf` (also in `ops.test.ts`; the `image` suite's calls keep the prod default). The `pg_hba` stays the test one for both: the real files admit only the box's compose subnets.

**Red.** Box suite: 252 run, 244 passed, 8 failed, all in `checks-db.test.ts` and all on `staging: archive_mode is off (want on); archive_timeout is 0 (want 300)`: three new `F17` tests and five older all-pass and summary cases. The new `F17` prod guard (prod on the staging conf FAILs) and the D1 fault case pass today.

### Build-green at `4940b3fc`

Box suite: 252 run, 252 passed. CI's `shellcheck -x` command: exit 0. `vitest.config.ts`: 687 passed, 3 skipped.

## F18: Caddy cannot exec under `edge.yml`'s settings (ruling: seceng-104, fix A)

`tests/infra/image/caddy-compose-edge.test.ts` (+ `file-caps.py`): a real `docker compose up` of `infra/compose/edge.yml`. The override changes only the two data directories (named volumes, `10010:10010` 0700, `nocopy`), the secret file's host path (`0:10010` 0440), the two network names and the host side of the ports. A test reads the running container's user, read-only root, `CapDrop`, `SecurityOpt` and tmpfs back against the file. The capability check reads `docker export` (merged filesystem) of the Caddy, Postgres and app images; its control finds `usr/bin/caddy` in the official Caddy base image.

**Red on today's images:** 9 run, 5 passed, 4 failed. The container loops on `exec /usr/bin/caddy: operation not permitted`, the box's error: `starts and stays up`, `answers on 8443`, `keeps its certificate authority in /data`, and `caddy: none` fail. Passing today: both controls, the settings read-back, and the `postgres` and app scans (regression guards). The tools image, not named by the ruling, was scanned once by hand: none; no test.

**With fix A applied locally** (`XCADDY_SETCAP=0` on the `xcaddy build` line, then reverted, not committed): 9 of 9 pass. So `XCADDY_SETCAP=0` removes the attribute in the pinned builder, and no further edge defect showed behind F18 in this setup.

**Seceng's further assertions**, added after: still running at 30 s or later with no restart and `healthy` by the file's own healthcheck (not shortened: its first run is 60 s after the start); `/proc/1/status` is `caddy` with `CapPrm`, `CapEff` and `CapBnd` all zero. With them: 10 tests, 5 failed and 5 passed on today's image; 10 of 10 with fix A applied locally (reverted). The file now takes 62 s red and 103 s green here, so the CI estimate below becomes about 80 to 120 s (unmeasured). On the released image `sha256:36dff3bb…` the scan finds `usr/bin/caddy`; it is amd64 and would not exec on this arm64 Mac (`exec format error`), so the run-time red is from the local build of the same Dockerfile.

**Build-green at `0fa08737`** (run on `b13622de`): the six `tests/infra/image/caddy*` files, 60 run, 60 passed; `caddy-compose-edge.test.ts` 10 of 10 in 87 s. The rest of the `image` suite was not run.

**Not exercised:** ports 80 and 443 on a real address (`POLY_BIND_ADDR`, `userland-proxy: false`), certificates from a real CA (`POLY_TLS` as an e-mail; here `internal`), the box's real `POLY_STAGING_ALLOW`, live upstreams (502 stands in), the compose healthcheck's own schedule (its command is run by hand), and an `edge-deploy` through the ops tool. Run on a Mac only (Compose 5.7.0, CI pins 5.7.1): the volumes carry real Linux ownership there, the secret file's does not.

**CI:** the existing `image` job (`vitest.image.config.ts` already takes `tests/infra/image/*.test.ts`; changes to `infra/caddy` or `infra/compose` turn it on). Locally the file takes 57 s with the Caddy, Postgres and app image layers cached (a Caddy compile from cold adds about 40 s). The job builds all three before its container tests, so I estimate 30 to 60 s added (unmeasured on the runner).

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
