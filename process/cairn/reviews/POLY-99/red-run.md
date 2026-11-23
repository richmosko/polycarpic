# POLY-99 red run (qa-99)

Tree: the branch tip that carries this file. Machine: this Mac, Docker 29.9.3 (Docker Desktop, arm64), Python 3.15, one suite at a time. Plan and pins: `test-plan.md`. A suite that is green here was green because the builder's code was already on the branch when I ran it; each security-bearing case still carries a **mutant or planted fault** that the same check flags (the RED ON THE FAULT cases), so green is not a pass that would also hold without the fix.

## Counts, each over what it says

| Suite (command) | Tests | Pass | Red | What the red ones are |
|---|---|---|---|---|
| `tests/infra/backup` (image config, containers), whole directory, one run | 134 | 80 | 54 | see the rows below; 358 s wall |
| · `slice0.test.ts` | 6 | 6 | 0 | watcher proof, stack self-test, slice 0 |
| · `backup.test.ts` | 22 | 22 | 0 | R1, T1, T2, T13, C1, C2 with mutants |
| · `fake-b2.test.ts` | 8 | 8 | 0 | harness self-test (S3 half, native half, DR10 verbs) |
| · `uploader.test.ts` | 42 | 42 | 0 | R4, T3-T8, T14, U4/C11, C2 (against the real tools image) |
| · `restore.test.ts` | 46 | 0 | 46 | `infra/restore.sh` does not exist (exit 127); setup (a real nightly set, a poisoned second set, a premigration set) works |
| · `roundtrip.test.ts` | 5 | 2 | 3 | the real uploader shipped the set and WAL (2 green); `restore.sh --base`, `--dump` and the from-box restore are red for the missing script |
| · `drill.test.ts` | 5 | 0 | 5 | `infra/drill.sh` does not exist (exit 127) |
| `tests/infra/ops/test_backup.py` (unittest, in-process) | 25 | 24 | 1 | the `# C4` marker is missing from `commands/backup.py` (mutant cannot be built) |
| `tests/infra/ops/test_upload.py` | 21 | 20 | 1 | the `# N1` marker is missing from `commands/upload.py` |
| `tests/infra/ops/test_status.py` | 50 | 46 | 4 | R9: `05_backupdb` and `04_backup` do not yet check root-written files (3 T12 cases), no `backup-premigration` cap |
| `tests/infra/ops/test_set_secret.py` | 31 | 30 | 1 | H-1 wording (pin 41); the builder wrote `written for host; the next uploader run reads it` |
| `tests/infra/ops/test_provision.py` | 20 | 17 | 3 | `--b2-endpoint` is not forwarded, not validated, and the bucket write does not keep the endpoint line |
| `tests/infra/ops/test_list_secrets.py`, `test_dispatcher.py` | 7, 19 | all | 0 | updated for H-1 and the ten subcommands |
| `tests/infra/lint-poly99.test.ts` | 28 | 12 | 16 | the rules `core-dump`, `tmp-size`, `state-mount`, `uploader-spool-ro` do not exist; 12 pass twins and existing rules are green |
| `tests/infra/provision/poly99.test.ts` (provision config, containers) | 18 | 5 | 13 | provision.sh keeps `rwx` ACLs, makes no `.inflight/` dirs, installs no units, writes no `spool.sha256`, no `--b2-endpoint`; H6/H7/H8 do not know the new shapes; H16 does not exist |
| `tests/infra/backup-wiring.test.ts` + part of the change filter | 15 | 4 | 11 | `infra/backup/`, `restore.sh`, `drill.sh`, `roles.sql` not in the filter; no `age`/`postgresql-client` install step; shellcheck list lacks the new scripts; `install.sh` PATHS |
| `tests/infra/image/postgres.test.ts` (R3 names, data-dir cwd, gunzip) | 31 | 28 | 3 | **environmental, not red for POLY-99:** on Docker Desktop a root 0600 bind-mounted file is readable by uid 999 (checked directly), so the two secret-mode cases and the age-failure case cannot fail here; they need Linux CI |

Not run in this red run: `tests/ci`, `tests/layers`, the rest of `tests/infra` (the gate runs them by name at build green).

## Red on the fault: every security-bearing behaviour

| # | Behaviour | Fault used (never a fake of the script under test) | Where | Shown |
|---|---|---|---|---|
| T1 | no plaintext in the spool | mutant writing `pg_dump` to `.inflight/` before encrypting; mutant writing to `/tmp`; the watcher itself on planted plaintext, canary and a `/tmp` file | backup.test.ts, slice0.test.ts | flagged |
| T2 | all or nothing | `pg_dump` backend killed mid-run (real); mutant without errexit/pipefail publishes a truncated dump and exits 0 | backup.test.ts | green on real, fault observed |
| T3 | backup has no route out | a container attached to a routable network connects | uploader.test.ts | fault observed |
| T4 | uploader has no DB route | the same container attached to the postgres network connects | uploader.test.ts | fault observed |
| T5 | mismatched checksum | mutant with `--ignore-checksum` on every rclone call reports `verified` | uploader.test.ts | fault observed |
| T6 | no HEAD, no list | mutants without `--no-check-dest` and without `--s3-no-head` send a HEAD | uploader.test.ts | fault observed |
| T7, T8 | refused upload, stray files | fake-b2 `refuse` and planted plaintext/symlink/oversize | uploader.test.ts | red-by-state |
| T9 | decrypt only on the laptop | mutant that appends `age -d` to the ssh command (needs the `# T9` marker) | restore.test.ts | not yet runnable (no script) |
| T10 | version choice | mutant without the refusal (`# T10`) restores the poisoned version | restore.test.ts | not yet runnable |
| T11 | throwaway Postgres only | a mutant that runs a host `psql` is seen by the same decoy | restore.test.ts | not yet runnable |
| T12 | windows are root-written | group/other-writable `jobs.log` and `last-upload` fixtures | test_status.py | red now (3) |
| T13 | no chmod | mutant with `chmod 0600` leaves 10005 without `r--`; real filesystem with the `rwx` default ACL lets 10005 write | backup.test.ts, provision/poly99.test.ts | fault observed |
| T14 | uploader cannot change the spool | mount `rw` with `r-x` ACL (denied); `rwx` ACL (succeeds) | uploader.test.ts | fault observed |
| T15 | root deletes only what it verified | mutant runner (`# T15` line) deletes on a wrong sha and a swapped dump | test_upload.py | fault observed |
| T16 | box names are data | mutant without the check (`# T16`) runs `touch` on the fake box | restore.test.ts | not yet runnable |
| T17 | replay detected | mutant without the content-time check (`# T17`) restores the replayed dump | restore.test.ts | not yet runnable |
| N1 | root validates container output | mutant (`# N1`) deletes a host file from a `../` path | test_upload.py | red (marker missing) |
| C4 | fetch compares to the record | mutant (`# C4`) serves a swapped file | test_backup.py | red (marker missing) |
| C1 | `/tmp` cap | mutant dumping to `/tmp` fails with no space (scratch dump is 6 MiB+) | backup.test.ts | green on real |

## Findings during the run (each reported when found)

- Docker Desktop cannot bind-mount `/srv/polycarpic/spool` (not a shared path): the harness replaces the uploader's mount list with `!override`.
- rclone v1.76.0 adds `?x-id=PutObject` to every PUT. `--ignore-checksum` stops the ETag compare only when it is on every rclone call.
- Two suites share fixed subnets (10.201.10.0/29, 10.201.20.0/29): two container suites on one Docker daemon collide; run one at a time.
- The container directory takes 358 s with restore and drill still red; green, restore and drill add two scratch restores each, so the ruling's 240 s guard will be exceeded. An addendum has to move cases or raise the guard.
- DR10's "uploading over an existing version" has no defined S3 verb in the ruling; pin 35 is my reading.
