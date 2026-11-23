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
