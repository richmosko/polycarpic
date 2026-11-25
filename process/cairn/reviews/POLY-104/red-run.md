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

## F4, F6 and the drill (DR3)

- **F4** (`test_provision.py`, 24 run): `polycarpic-ops provision` refuses `--bind-addr`, `--staging-allow`, `--acme-email`. Red: the forwarding test (1) and the bad-value test (22 subtests), which wants exit 2 with `provision: bad --<flag>` and nothing run. The signal test (4) is still red.
- **F6** (`host.test.ts`): nothing creates `/srv/polycarpic/caddy` or `caddy-config`. Two tests: created 10010:10010 0700 and writable by 10010; root-owned 0755 ones repaired by a rerun with contents kept and a `change:` line.
- **DR3** (`tests/infra/drill-dr3.test.ts`, no container; `vitest run -c tests/infra/vitest.config.ts tests/infra/drill-dr3.test.ts`): 9 run, 5 failed, each `PASS DR3` where `FAIL DR3` is due: a password early in a large file (gzip and plain), a missing file, a corrupt gzip, a truncated gzip. The last three need no particular size.

F3 hides F6 and H25, so both were also run with a one-line local `awk` fix in `provision.sh`, then reverted and not committed: `host.test.ts` 91 run, 84 passed, 7 failed: the two F6 tests, `F3 same shape`, and four existing provision-check tests on the same false H25. `F3` itself passed with that fix.
