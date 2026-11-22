# POLY-98 contract pins review (architect)

architect-98, 2026-11-22. Reviewed: `test-plan.md` (contract pins 1–14, rows 1–64, "Gaps") and `red-run.md` at
`1c9b09ec`. I sampled `tests/infra/ops/test_cli.py`, `test_set_secret.py` (refusals, reading, writing), `test_status.py`
(screen, disk, revokes, backupdb), `test_dispatcher.py`, `test_lint.py` and the case list of
`tests/infra/provision/ops.test.ts`. Authority: `ruling.md` at `1af8ebd4` (Addenda 1–2). Addendum 2 already carries the
rulings below. This file is the review, and it adds two test gaps (G1, G2).

## Pins

| Pin | Result | Note |
|---|---|---|
| 1 dispatcher loaded by path, `main(argv, ctx)`, nothing at import, realpath | Confirmed | Matches R1 and K1. |
| 2 `Ctx` signatures | Confirmed, **except disk percent** | The percent is `df`'s, `ceil(used*100/(used+f_bavail))` with `used = f_blocks - f_bfree` (Addendum 2). See G1. |
| 3 `trusted_uid` | Confirmed, **pending seceng** | A constructor field like `root`. Production sets 0 and nothing else. The `no_test_hook` lint covers argv and the environment. Real root is proven by the container cases ("refuses without sudo", "an install file owned by anyone but root exits 4"). seceng-98 reviews this pin at this sha before it stands. |
| 4 integrity walk, `--version` | Confirmed | |
| 5 message wordings | Confirmed | They fill gaps the ruling left; none contradicts it. |
| 6 child-process shapes, separate psql calls | Confirmed | |
| 7 `run_inherit` for printers; the cli argv | Confirmed | Equals R8 plus K7. |
| 8 psql protocol, details, fix line before the summary | Confirmed | The summary is always last (Addendum 2). |
| 9 `refused_by` | Confirmed | |
| 10 every target checked before any write | Confirmed | Stricter than R4, and right. |
| 11 K4 fault injection on `rename`/`replace` | Confirmed | |
| 12 CI wiring, shellcheck of `install.sh` | Confirmed | Adding `install.sh` to shellcheck goes beyond R11 and is welcome. |
| 13 `git` in the box image | Confirmed | |
| 14 `provision-wiring` pin gains `test_b2_rclone_output.py` | Confirmed | |
| Row 44 (K6 second test) | Confirmed as qa reads it | Compose declares no refused name twice. A generated name copied into a service that does not mount it is the case that can happen. |
| Row 49 (30-line fixture) | Replaced | Every item RED plus hostile widths; at most 24 lines, none over 80 characters (Addendum 2). The existing case already does this. Keep it. |

## Would the assertions tell a wrong build from a right one?

Yes, for nearly everything I sampled. The cases assert exact lines, exact argv lists, exact environments, exit codes and
the calls that must *not* happen (`runner.calls == []` on every refusal). A build that prints a near-miss message,
forwards one extra flag, inherits the parent environment, pulls an image, opens a secret file, or prints a byte of a
fixture secret fails a named case. The positive twins (4096-byte value, `a+tag@…`, 79 % disk, a 4-minute-future
timestamp) stop an over-strict build from passing. Two places would not catch a wrong build:

- **G1. The disk percent.** The `vfs()` fixture sets `f_bfree == f_bavail`, so `df`'s formula and the plain
  used-over-blocks formula give the same answer, and the wrong one passes. **Add** a fixture with reserved blocks:
  `f_blocks=100, f_bfree=24, f_bavail=19` must print `/ 80%` RED (`df`: 76/95). The plain formula prints 76 % OK.
- **G2. The `revokes` and `slots` SQL never meets a real Postgres.** The fake answers pin 8's protocol (`open:…`,
  `missing:…`), so any SQL that prints those words passes. Examples that would pass: treating a NULL `lanacl` as closed
  (the default grants PUBLIC USAGE, so a database where `roles.sql` never ran shows green), or `has_function_privilege`
  on a role in place of the PUBLIC `aclexplode` row. Criterion 5 is exactly this check, so it needs a real case. **Add**
  one case in an existing real-Postgres harness (`tests/infra/image/provision-db.test.ts`'s derivative, or the
  provision box's `pg.ts`, whichever is cheaper). It runs `status`'s two queries, as built (read from the module,
  not copied), against:
  - (a) a database after `roles.sql`: empty output, `revokes` OK;
  - (b) a fresh database before `roles.sql` (NULL `lanacl`): `open:plpgsql` and all 17 `open:<sig>`;
  - (c) after `roles.sql`, then `GRANT EXECUTE ON FUNCTION pg_catalog.query_to_xml(text,boolean,boolean,text) TO PUBLIC`:
    exactly `open:query_to_xml(text,boolean,boolean,text)`;
  - (d) a non-temporary physical slot created with `pg_create_physical_replication_slot`: `slots` prints its name, and
    the slot is dropped afterwards.

  The case runs in whichever job owns that harness, inside its time limit.

Not a gap, but unmeasured and accepted: production `tls_probe` and `statvfs` run only on a real box (POLY-104). The
container cases exercise production `run` and `run_inherit` under real sudo.

## For devops-98 now

The pins stand as built against, except pin 2's disk formula. G1 and G2 are qa's to add. G2 needs the two queries
reachable from a test (one module constant or function per query), so devops should expose them that way.
