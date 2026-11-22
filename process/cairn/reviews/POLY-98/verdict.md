# POLY-98 verdict (architect, gate 4)

architect-98, 2026-11-22. **Ruled on the code at `a3e97748953ade71ae311f911c7bf76b991f2b70`.** seceng-98's build review
passes that sha (`build-review.md` §Re-review at `a3e97748`, commit `cf36b2f1`). qa-98's final gate passes the same sha (`gate.md` at `ba0f41b5`). The commits after `a3e97748` change review and gate text only: `git diff a3e97748..ba0f41b5 -- infra tests docs .github` is empty.
Authority: `ruling.md` (Addenda 1–2, plus the three in-place corrections below), `ruling-review.md` (K1–K12),
`build-review.md` (B1–B5, B2′), `pins-review.md`. I read the code, the INFRA, README and SECURITY diffs from
`1c9b09ec`, and qa's test files. I ran nothing: qa had the machine.

**Verdict: PASS, on condition C1** (two doc phrasings; no code, no test).

## Acceptance criteria

| Criterion | Result | Proving tests |
|---|---|---|
| Each subcommand has a test against a fake host root | PASS | `tests/infra/ops/test_{dispatcher,lint,install,provision,set_secret,list_secrets,gate_check,restart,cli,status,ctx_getpass}.py` (166 cases, temp root, strict fake runner), plus `tests/infra/provision/ops.test.ts` (23 cases on the real box image, real sudo and ownership) |
| `list-secrets` never prints a value | PASS | `test_list_secrets`: `open` and `os.open` raise for any secret path, and the fixture values are swept from the output. `list_secrets.py` uses `lstat` and `stat` only. |
| `status` fits one screen and exits non-zero on any red | PASS | `test_status`: all items RED with hostile widths prints ≤ 24 lines, none over 80 characters; red → exit 1, waiting → 3, green → 0, with the exact summaries |
| INFRA §7.5 and §8 match the output verbatim | PASS, except C1 | Checked against the format strings: `list_secrets.ROW`, `out.fmt_line` (state 4, item 9, project 8), the `set_secret`, `cli`, `restart`, `provision`, `provision_check` and `gate_check` messages, and the status summaries. The §7.1 step 12 table, the step 16, 18 and §8.10 status lines, and the §7.5 rows reproduce them character for character. |
| `status` checks the bootstrap revokes on the live database; the §8.10 restore step is a named command | PASS | `status/07_revokes.py` (aclexplode with acldefault, signatures from the installed `roles.sql` as literals, read-only session); unit `test_revokes_*`; **G2**, the four real-Postgres cases in `ops.test.ts` (gate.md table: a NULL `lanacl` reads open, one granted built-in is named alone, a slot is named). §8.10 step 4 is `sudo polycarpic-ops provision --stage database --project prod`. |

## R12 98d lines

| Line | Result | Evidence |
|---|---|---|
| Every 98c case green, no test loosened | PASS | `gate.md` change table. My own read of the two cases the lead named follows the table. |
| `provision` job green on CI within R14's guard (≤ 200 s) | PASS on the last run; the PR run re-measures | Run 45071811039 at `5a6ed6ca`: provision 110 s, success. Since then only fixes under `infra/ops/` and tests have changed; local provision config is 67.9 s against 64.5 s on main (+3.4 s for +23 cases, gate.md). |
| R13 INFRA edits and `infra/README.md` in the same PR, quoting built output | PASS, except C1 | Below |
| The builder's unmeasured list in the build-green commit | **Not met by the builder**; compiled here | No devops commit or review file carries it. The list under "Unmeasured" below takes its place. |
| Suite-time delta reported | PASS | gate.md: provision config +3.4 s for +23 cases; ops unit 5.6 s (R14: ≤ 20 s); `tests/infra` and `tests/ci` flat |

## Test changes since the red run (`1c9b09ec`): did any loosen a test?

No. I read every row of `gate.md`'s table against the diff, and I agree with each verdict. The two the lead named:

- **The `Runner` basename match (50d2bb3c).** A rule token without `/` now also matches a path element by its basename.
  That widens which fake answers a call. It does not widen what passes: the Runner still raises on any call no rule
  matches, and every case that relies on the widening asserts the full argv exactly. `test_gate_check.argv()` lists
  `/bin/sh <bundle>/infra/postgres/gate-check.sh docker compose -p … psql -U postgres -d polycarpic`, and
  `test_provision` does the same for its argv. A build that called the wrong script, or passed one more flag, still fails.
- **The `.incoming` exclusion (14b8dd70).** Sound. Addendum 1's A1 makes every install, a no-op one included, rewrite
  `/opt/polycarpic/.incoming/install_box.py` before the installer can see the id. R12's "changes nothing" protects the
  installed tree, and that is still compared in full: `ops/<id>/**`, `current`, the `/usr/local/sbin` link, the previous
  `<id>`, and the `already installed` line. **I take qa's offered closure as an advisory (A-1):** compare the staged
  installer's content hash rather than leaving it out, so a stray file in `.incoming` is caught. It is not gating, because
  `.incoming` is root 0700 and holds only the installer.

The other corrections were tests that could never pass: the 13-against-14 slice, `wc -l` on the first line, the
template-literal backslashes, `__pycache__` from the harness. Each was fixed without weakening its assertion. The pty
rewrite (4a6acc75) is stricter: qa showed it red on `TCSADRAIN` and green on `TCSAFLUSH`.

## Would the assertions tell a wrong build from a right one?

Yes. The unit cases assert exact lines, the exact argv list, the exact child environment and exit codes. They also
assert the calls that must not happen: an empty runner log on every refusal, and no value prompt on a refused replace.
The positive twins (4096 bytes, `a+tag@`, 79 %, a timestamp 4 minutes ahead) stop an over-strict build from passing.
My two pins-review gaps are closed. **G1** is the reserved-blocks fixture (df's formula gives 80 % RED; used over blocks
would give 76 % OK). **G2** is the real-Postgres SQL. Cases that would still pass a wrong build:

- **The `revokes` and `slots` parsers ignore rows they do not recognise.** G2 proves the SQL emits only the protocol,
  so this is safe today. It would not stay safe if someone changed the query to print a notice row.
- **Production `tls_probe`, `statvfs` and `_real_run` timeouts** are exercised only on a real box. A build that never
  verified the certificate chain would pass every case. This is unmeasured; POLY-104.
- **`compose run` of `operator` with the bundle's compose file.** `prod.yml` bind-mounts `../postgres/*.conf`, which the
  bundle does not ship. The fakes cannot show whether `run --no-deps operator` minds that. This is unmeasured; POLY-104
  (and seceng's residual R-b).

None of these is a defect in qa's tests. All three need a real box or a live compose.

## R13 docs

- **INFRA** (1.3.22): every R13 passage is present. That covers the §7 hint; §2's ops, `ops.conf` and state-format
  rows; §3.2; step 4 `--show-rclone-output`; step 11 install, provision and check, with the `/tmp` lines and the reboot
  sentence gone; step 12's two prompts, the table, prod-only names and refused names; step 16's `gate-check`, the `-p`
  fallback, the printed link with no email, and A3's clear-the-scrollback; step 17 "Open the link"; step 18 with no
  heartbeat claim; §7.5's header with `run --rm -T --pull never --no-deps` and one row per subcommand; §8.1; §8.10 step
  4; §6.5; and §7.4's `list-secrets` SERVICE column. `logs web` and `show-mounts` are gone. There is no changelog, no
  "Changes in" and no dated attribution.
- **`infra/README.md`**: install, the subcommand table, "Adding a subcommand" (R1), and the scripts without the tool.
- **SECURITY** (seceng, 1.17.1): C-79 and C-87 detection quote the built `backupdb` and `revokes` lines.
- **ARCH** (1.27.0, at the ruling): the provisioning bullet names the operator CLI. It is still accurate.

### C1 (devops, INFRA only; no re-test)

Two phrasings describe development status, which the docs must not carry. Restate each as what is true:

- §7 section hint: "…is specified for a later deploy or recovery change and is not available yet" becomes, for example,
  "A subcommand this document names that `help` does not list is not installed on this box: stop and ask; do not
  improvise it."
- §7.1 step 12: "(`oauth_google_secret` is not mounted today)" becomes "(for example `oauth_google_secret`, which no
  service mounts)".

## Ruling corrections made in place (not addenda)

- `7782a979`: R1's `status/` module pattern is `^[0-9]{2}_[a-z][a-z0-9_]*\.py$`. The one pattern given before rejected R1's own layout.
- `7799a577`: R7's sample WAIT line has 7 spaces after `app`, as R7's column rule gives.
- `0c279807`: R4's order is checks, then the replace question, then the hidden value prompt.

## Unmeasured: what POLY-104 inherits (and POLY-100 where named)

1. Ubuntu's sudo `secure_path` reaching `/usr/local/sbin` on the real box. It is measured on `ubuntu:24.04` in the container case.
2. `install.sh` over real ssh to a real box, a reboot, then `provision-check` from the bundle.
3. `status`'s `cert` item: the TLS probe to the public name from the box itself (the hairpin to Caddy bound on
   `POLY_BIND_ADDR`), real chain verification, and the days left.
4. `status`'s `disk`, `app`, `backupdb` (real `docker logs --timestamps` lines from Postgres 17, rotation across 24 h) and
   `revokes`/`slots` through the live `exec -T postgres psql`; total time ≤ 15 s (R14).
5. `cli user invite` live: needs POLY-100 to wire `operator`'s environment (`DATABASE_*`, `PUBLIC_ORIGIN`, M4); `compose
   run --no-deps operator` from the bundle's compose file with the missing `../postgres/*.conf` (R-b); the link reaching
   the terminal through sudo and ssh; `logging: none`.
6. `restart` against real health checks, and a Linux host's view of a renamed secret file before the restart (M1 was Docker Desktop).
7. `gate-check` against the deployed prod schema (INFRA step 16's own "unmeasured" tag stands).
8. `b2-setup.py --probe --show-rclone-output` against Backblaze (with E9).
9. The `jobs.log` contract under POLY-99's real backup and uploader, and seceng's R-a: windows taken from the journal.
10. The CI `provision` job time at the PR head (the last measurement was 110 s at `5a6ed6ca`).

## Advisory

- **A-1.** Compare `.incoming/install_box.py` by content hash in the second-install case (qa's offer above).
