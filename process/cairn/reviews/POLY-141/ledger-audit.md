# POLY-141 C17(a): ledger-reader audit (qa-141)

Method: full cairn suite (`run_tests.py --gate red`, 118 files, 2013 tests, OK) at 8f3fa2d + qa tests, with a Python
`sitecustomize` audit hook on `PYTHONPATH` (inherited by every child). It logs `open`, `os.listdir` and `os.scandir` of any
real-repo path under `LEDGER`, and subprocess argv containing `ls-files` or `grep`. Each event is attributed to the test file
by the `-p <file>` of the unittest child, carried in an env var to grandchildren. Run twice; the second attributes every event.

**Result: the reader set is NOT `LEDGER_TESTS` (two files). It is larger. Back to the architect.**

| test file | what it reads in the real repo | kind |
|---|---|---|
| test_state_releases_bound.py | `process/STATE.md` | open |
| test_ruling_archive_records.py | `git grep` over the tree (STATE, DECISIONS, tracker records, pinned rulings) | subprocess |
| test_backfill_tokens.py | every `process/cairn/milestones/*.md` and `archive/milestones/*.md` (via `backfill_tokens.py`, run in-process and as a child) | open + scandir |
| test_agent_setting_role.py | the same milestones (child `backfill_tokens.py`) | open + scandir |
| test_check_budgets.py | every `process/cairn/issues/*.md` (75 opens) | open + scandir |
| test_dashboard_roster.py | every `process/cairn/issues/*.md` (75 opens) | open + scandir |
| test_milestone_overhead.py, test_run_tests.py, test_test_run_hooks.py, test_receiver_flush_drop.py, test_otel_receiver.py, test_otel_receiver_engine_staleness.py, test_otel_receiver_self_stop.py, test_otel_receiver_watchdog_attribution.py, test_otel_receiver_windows_root.py | `scandir` of `process/cairn/issues` and `archive/issues` only (listing, no file open) | scandir |

Not ledger readers: `test_dist_freshness.py` and `test_generated_freshness.py` run `git ls-files` on `scripts/cairn/dashboard/dist`
and `apkg/dist` only.

Consequence for the ruling: a ledger-only push (a new or edited issue/milestone record) changes what `test_check_budgets`,
`test_dashboard_roster`, `test_backfill_tokens` and `test_agent_setting_role` read, and they are not in `LEDGER_TESTS`. Today
EXCLUDE strips tracker records before PATTERN, so a change to one runs none of them either: the gap exists already and is not
widened by the anchor rule. Whether to add them to `LEDGER_TESTS` (test_backfill_tokens is the slowest), to name only those with
real-repo assertions, or to rule the scandir-only files out is the architect's call. The C17(b) guard in
`test_cairn_test_boundary.py` is held until that is ruled.
