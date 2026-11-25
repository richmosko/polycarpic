# POLY-160f verdict: deploy follow-ups (staging gates)

Architect. Judged on `655fb279` (product, tests, INFRA), against `ruling.md` @ `26945e68` and its section C, with `git diff 7613d4e9..655fb279`. ARCH §8.1 is in this commit.

**Verdict: PASS WITH FOLLOW-UPS.** No product file has moved since `655fb279`. One axis is not full: axis 2, whose missing rows seceng ruled by name to POLY-165. H1, the Principal's gate, is met on the harness and, for the restore and the stop, on real Docker (local container, qa's runs).

| # | Axis | Result | Evidence |
|---|---|---|---|
| 1 | M1–M12 reversed, red first | met | reds on `7613d4e9` in `red-run.md`; green in `gate.md` §1; I re-ran `test_deploy_re*.py` at `655fb279`: 70 of 70 |
| 2 | Every V mutant red, or equivalent with the reason | **partly**: qa's 28, of which one, "saved pair: hash check dropped", is not a red (seceng's correction: the same equivalent as `pair_ok`); seceng's 12 (11 red, that one green); mine below; the rows with no test are D3 | `red-run.md`; `build-review.md` @ `bb1d06ff`; "Mutants I ran" |
| 3 | Mark unlinked only in `unwind`, `settle`, `recover`, R1.9; nothing but the listed reads before the restore | met | grep at `655fb279`: `deployer.py` 267 (`recover`), 420, 1065; `rollback.py` 76, `edge.py` 279. Before the restore: lock, shared directories, mount, ownership (edge), `current`, the version question |
| 4 | No raw `rel.log` after the first `up` or in the transient and busy paths | met | grep: the only two after `up` are in `unwind`'s own `try` |
| 5 | `BASH_SOURCE` once; every project compose call names `rh` and `/dev/null` | met | grep; H25's two `docker compose version` calls name no project and are as before |
| 6 | Four `survive('<name>', new pg.Pool(`; no logger or `console` in `pool.ts`; no raw error to a callback | met | grep and reading; `pool-errors.test.ts` |
| 7 | T-real with the restart and SIGKILL cases; wall time; provision | met: green in CI with the restart, SIGKILL and stop cases; locally 27 of 27 with three reds. `deploy-real` **631 s of 900 (70 %)**; 558 s and 573 s before the stop case; control 458 s. Provision 196 s and 211 s, control 245 s | `red-run.md`, `gate.md` §2; CI 45565943755 |
| 8 | INFRA, ARCH, SECURITY match the code; no history | met: INFRA read whole as a word diff; ARCH §8.1; SECURITY C-83 reads as built, R-32 is gone, R-35 states the residue ARCH names | `docs/INFRA` 1.3.31, `docs/ARCH` 1.31.0, `docs/SECURITY` 1.21.3 |
| 9 | seceng at this sha, C1–C28 each answered | met: PASS WITH FOLLOW-UPS at this sha, B1 to B7 closed, D1 ruled a follow-up; void if a product file moves | `build-review.md` @ `bb1d06ff`, `26579880` |
| 10 | CI's exact commands green; `tests/ci` | met: all ten jobs green on this sha (I read the run); `tests/ci` 743 of 743 locally (qa) | CI 45565943755 |

**Read:** every product line of the diff, the recover-rows tests, gate.md, red-run.md, build-review.md, INFRA's delta. **Not read line by line:** the other test files; there I rely on qa's and seceng's records. **Ran:** only the harness (fakes), one file at a time; no container.

## Mutants I ran (tree restored after each, clean)

| Mutant | Result |
|---|---|
| `rel.token` above `recover` | RED, `a_missing_token_restores_first…` |
| `check_edge_env` above edge's `recover` | RED, `an_unreadable_edge_env_restores_first…` |
| `recover` above `require_data_mount` | RED, `an_unmounted_data_volume…` |
| status 08's condition dropped (mark alone is RED) | RED, `a_mark_with_a_current_and_no_alert…` |
| the second listing in `stand_down` dropped | RED, three in `test_deploy_standdown.py` |
| `rollback` that only recovered exits 0 | RED, project and edge |
| `previous == current` check dropped (project) | RED |
| the `Refusal` handler's `committed` check dropped | **survives; equivalent today:** `settle` catches every step, so no `Refusal` leaves the code after the commit. Kept as a second line |

These close `gate.md` §5 (c) and status 08's row in "Not mutated".

## Judged by name

- **No edge form of the `current-quarantined` stuck case: accepted.** `recover` sets `stuck_name` and `stuck_end` reads it, for both; edge differs only in calling `stuck_end("edge", …)`, which its `not-stopped` form shows.
- **`not_stopped` is sticky, where R1.4 says the run's last `stand_down` counts: accepted.** It can only over-report RED in one run, and the next run starts clean.
- **`version_ok` before the restore repairs the render home's mode: accepted.** No file is written, and any failure in it is a mismatch.
- **gate.md §5's rows:** none of them hides a fault in the gate's class by my reading. Each guards a path whose failure is RED, refused, or exit 1, with the mark kept. They are not waived: D3.

## Deltas (one batch; none holds this PR)

| # | Owner | Finding |
|---|---|---|
| D1 | devops | `on_interrupt` writes `interrupted` over `stand_down`'s `not-stopped`, as R1.8's own order says, against R1.4's rule that the worse name wins. The run is RED, the mark is kept and the line says to run it again, so it is a wrong name only. My ruling’s fault. **Follow-up, not a fix in this loop:** the fix is two lines and one test (keep `not-stopped` when the stop was not shown), but it moves the frozen sha, so CI (about 11 minutes), the gate rows and both reviews are read again. seceng ruled it a follow-up |
| D2 | devops | `stuck_end`'s docstring says `rollback-unhealthy` is the last alert; the code and R1.4 say three names |
| D3 | qa | Ruled, not built: C21 during COMMIT (seceng's proxy); a second signal inside the stop; stderr closed; R7's home not root-owned, and group- or other-writable; R2.4's edge forms; edge's tree check and its stderr line; an unreadable quarantine file; `edge-probe-baseline` and `clear_transient` raising; `settle`'s steps singly; the `sudo rm` help text; a second `rollback` after a recovered one; `rel.log` after `up` |

## Not proven here

- **Nothing has run on a box.** POLY-104: real attestation, the edge, the runbook's Ctrl-C line, `docker stop` holding over a reboot, systemd's kill.
- **Edge's stop and SIGINT** are on fakes only; T-real's stop case is staging's.
- **Accepted residue (R-35):** a hard kill or power cut of `first-deploy` or `edge-deploy` leaves the release running until the command is rerun.
- **Image job:** 624 s, 647 s and 723 s of 1200; not like for like with the control (the backup suite ran); no product change here touches it.
- **Suite budgets:** one or two runs each; only `deploy-real` (+173 s) and `db` (+53 s and +68 s) are real additions.

## For filing

- **POLY-165 (before the first prod deploy):** boot-time recovery for the two hand-run commands; the backup set per `check-config-timeout` retry; whether R3's lift is enough on prod; prod's Caddy when a prod restore fails; prod's settle steps and `edge-probe-baseline` (from D3); D1.
- The rest of D3, with D2, goes to POLY-165 too, as seceng ruled.
- **POLY-104 checklist:** the runbook's Ctrl-C line on a real `edge-deploy`; a reboot after a stand-down; `docker compose --project-directory` on 5.7.1 with no render home (M16).
