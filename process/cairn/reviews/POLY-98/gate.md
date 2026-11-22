# POLY-98 build-green gate (qa-98)

Sha under test: `5a6ed6cab150bdc242db6ffa7f093ff111996157` (devops-98's build on my tests at `49eb5c59`). Run 2026-11-22 from a clean worktree at that sha, machine quiet, container suites one at a time. **Superseded by seceng's build review (CHANGES, B1–B3): this gate re-runs on the fix sha.** What carries over: the control and timing figures, the change table.

## Suites: counts and what each is over

| Suite | Cases | Over | Result |
|---|---|---|---|
| ops unit | 152 | dispatcher 19, lint 8, install 9, provision 16, set_secret 27, list_secrets 6, gate_check 5, restart 9, cli 11, status 42 (all 98c U: cases incl. K1–K12, G1) | green, 5.3 s (R14 ≤ 20 s) |
| operator unit | 93 | the 85 POLY-97 cases plus 8 `test_b2_rclone_output` (R10, K11, S9) | green, 0.3 s |
| provision container config | 151 | create, host, checks-db (130, unchanged from main) plus `ops.test.ts` 21: install 5, real sudo 5, H6 5, D3 `jobs.log` 2, G2 real-Postgres 4 | green, 68.7 s |
| `tests/ci` | 579 | the 573 on main plus 6 new `changes.test.ts` filter rows | green, 10.3 s |
| `tests/infra` | 332 | the 327 on main plus 5 `ops-wiring.test.ts` | green, 13.1 s |
| `tests/layers` | 556 | untouched by this loop | green, 12.4 s |

## G2: the four real-Postgres cases, each against the status modules as built

Run once more at this sha with the printed text captured (a throwaway copy of the describe that logged `psql -XAtq`'s output; deleted, not committed). Instances: the pinned base image, one after `roles.sql` (the database stage) and one fresh.

| Case | Printed |
|---|---|
| (a) after roles.sql: revokes, slots | revokes: nothing; slots: nothing |
| (b) fresh database, roles.sql never ran (NULL `lanacl`) | `open:plpgsql` then the 17 signatures, each as `open:<sig>` (`query_to_xml(text,boolean,boolean,text)` … `ts_rewrite(tsquery,text)`), 18 lines, nothing else |
| (c) `GRANT EXECUTE … query_to_xml(text,boolean,boolean,text) TO PUBLIC` | `open:query_to_xml(text,boolean,boolean,text)` only; after the revoke: nothing |
| (d) `pg_create_physical_replication_slot('leftover_slot')` | slots: `leftover_slot`; after `pg_drop_replication_slot`: nothing |

(b) is the check that a NULL `lanacl` counts as open; (a) is guarded against passing vacuously by an assertion that both query files are non-empty.

## Test changes since the red run @ 1c9b09ec

`git diff 49eb5c59..5a6ed6ca -- tests` is empty: devops-98 changed no test. Every change below is mine, from the architect, seceng or a defect report.

| Commit | Change | Verdict, and why |
|---|---|---|
| 656b0384 | disk percent case (df formula) added; row 49 replaced by an all-RED hostile-width case | stricter: architect Addendum 2 |
| 5dbcb211 | K12 (a)–(e): production-ctx, chown-uid, newline-name, lint, real-sudo file-owner assertion | stricter: seceng K12 |
| 13c8f6ad | G1 reserved-blocks disk case; G2 four real-Postgres cases | stricter: architect pins-review |
| 78a9a44c | lint: no `trusted_uid` assignment or `Ctx(**kw)`; no `$`-ended pattern | stricter: seceng |
| 50d2bb3c | `Runner` rule tokens without a `/` also match a path element's basename (`gate-check.sh` vs `<bundle>/infra/postgres/gate-check.sh`) | corrected: the ruled argv holds the full path, so no build could match; the full argv is still asserted exactly by `test_gate_check` and `test_provision` |
| 6d6a747c | two `WAIT app … not deployed` literals: 6 spaces → 7 (built with `line()`) | corrected: the column rule (item padded to 9, one space) gives 7; the ruling's sample was the typo, fixed by the architect at `7799a577` |
| 6d6a747c | revokes psql argv slice `[:13]`/`[13:]` → `[:14]`/`[14:]` | corrected: the old slice compared 13 elements with a 14-element list, so it could never pass |
| 14b8dd70 | `.incoming` pruned from the second-install snapshot | corrected, reason below |
| 14b8dd70 | cli container regex: `ARGV docker compose …` → `ARGV compose …` | corrected: my fake `docker` logs `"$@"`, which has no argv[0]; the compose argv is still matched in full |
| 14b8dd70 | D3 second-run count: `/\n2/` → `/^\s*2\s*$/m` | corrected: `wc -l` is the first output line, so the old pattern could not match; still asserts exactly 2 lines |
| 14b8dd70 + base.py | `sys.dont_write_bytecode`, and the laptop-checkout copy strips `__pycache__` | corrected: my harness left `__pycache__` in the checkout the container test copies and `git add -A` shipped it, failing the "no `__pycache__` in the install" case for the harness's own litter |
| 49eb5c59 | `\.`/`\S` in the G2 Python snippet → `\\.`/`\\S` | corrected: inside a JS template literal the single backslash vanished, the signature list came back empty and every G2 case printed `NOSQL` |

**Loosened: none.** No assertion was removed or widened. The Runner change widens how a rule token matches, but every case that depends on it also asserts the full argv.

### The `.incoming` exclusion, in full

The second-install case ("a second install of the same `<id>` changes nothing", R12) snapshots `find /opt/polycarpic /usr/local/sbin` (inode, mtime, path) before and after a second install and diffs them. It failed on `/opt/polycarpic/.incoming/install_box.py`, whose mtime moved. That is not a build bug: Addendum 1's A1 makes `install.sh` always make two ssh calls, and the first is `sudo install -d -m 0700 /opt/polycarpic/.incoming && sudo tee /opt/polycarpic/.incoming/install_box.py`. That call runs before `install_box.py` can look at `<id>`, so every install, including a no-op one, rewrites the staged copy of the installer. No build can avoid it without breaking A1's two-call flow. What R12's sentence protects is the installed tree: `/opt/polycarpic/ops/<id>/**`, the `current` link, the `/usr/local/sbin` link, and the retained previous `<id>`. All of that is still compared, along with the output line `polycarpic-ops <id> already installed`. **Residual:** the staging directory itself is no longer compared at all, so a second install that left something else in `.incoming` would not be caught; it is root 0700, outside the installed tree, and holds only the installer. If you want it closed, the cheap fix is to compare `.incoming/install_box.py`'s content hash instead of its mtime; say so and I add it.

## Suite-time delta, against a same-day control on `main` (`2062ecf9`, same machine, run straight after)

| Suite | main | this sha | delta |
|---|---|---|---|
| provision container config | 64.5 s, 130 tests | 68.7 s, 151 tests | +4.2 s (+6 %): +21 cases and `git` in the box image; CI limit 200 s |
| `tests/infra` | 13.4 s, 327 | 13.1 s, 332 | −0.3 s, flat |
| `tests/ci` | 10.4 s, 573 | 10.3 s, 579 | flat |
| ops unit (new step) | — | 5.3 s, 152 | R14 limit 20 s |

One run each: a control, not a trend.

## Not covered here

- The CI `provision` job and the full workflow_dispatch run (45071811039); devops-98 and the lead own those.
- Production `tls_probe`/`statvfs` need a real box (POLY-104).
- R13's INFRA/README edits and A3's step-16 text: docs, for the architect's verdict.
