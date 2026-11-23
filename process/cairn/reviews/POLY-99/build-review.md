# POLY-99 — seceng build review

Built sha: `5501a740a9952070946a8018553ff1a241d9af0b`. Read-only: I read the code at that sha, ran no suite, and diffed it
against the ruling @ `09aeeeb2` with the R10 correction @ `dea63614`. Spec: C1–C12, C7′, N1, A5, H-1, B-1, B-2
(`ruling-review.md`).

**Verdict: FAIL, two fixes (F1, F2).** Both are availability faults in the restore path. Each lets a box-side attacker
holding the put-only key, or a single transient checksum mismatch, block the restore it exists for. Everything else
named below holds. The fixes are small and local to `b2read.py` and `restore-lib.sh`. After the fix I re-check only
those two files and their tests.

## Fixes (each with its proving test)

**F1. One bad object name in the bucket stops every restore.**
- *Where:* `b2read.py` `cmd_list`, at "refused object key in the bucket listing": `die(5)`.
- *Mechanism:* the put-only key can write **any** name under the instance prefix. That is in its reach by design (C-73).
  A single object such as `<instance>/17/dump/junk`, or a key with `..`, makes `list` exit 5. `restore.sh --base` and
  `--dump` and the drill then refuse outright, for the 35 days that object is locked. That is a box-side attacker
  disabling every bucket restore, exactly when one is needed.
- *Required:* refuse the **key**, not the listing. A record that fails `FILE_ID` or `valid_key`:
  - is left out of the output;
  - is counted, and `list` prints one `stray <n>` line on stderr (a count, no names);
  - is never used as a path or a key.
  `restore.sh` prints `WARN <n> stray objects in the bucket` and carries on. `drill.sh` reports **FAIL DR1** ("<n>
  stray objects"), so the monthly drill makes it loud. This is what C5 meant by "refuses an object key".
- *Test:*
  - fake-b2 holds the A set plus `<instance>/17/dump/junk` and `<instance>/17/dump/../../x`;
  - `restore.sh --dump` then restores (exit 0, under `POLY99_SCRATCH_FAIL` it reaches the scratch start), prints the
    WARN, and writes nothing outside the temp dir;
  - `drill.sh` prints `FAIL DR1` naming the count.
  - Red: today's code, which exits 5.

**F2. A two-version name cannot be passed, so C9 is not met.**
- *Where:* `restore-lib.sh` `one_version`; also `bucket_select` for the sets.
- *Mechanism:* a checksum-mismatch retry (S3) leaves the name with version 1 (unsiblinged, perhaps hidden) and then
  version 2 (good). With `--before`, every record up to the cutoff still counts, so a cutoff after version 2 refuses
  again (n ≥ 2). A cutoff between the two gives only the bad version.
  - For a **WAL** segment this blocks every point-in-time restore through that segment for 35 days. The drill is red
    for 35 days too.
  - The C9 test checks the listing only, never the passage.
  - The listing also lacks what C9 required: whether each version's bytes match the sibling.
- *Required:*
  - The refusal listing prints, per upload version: `version <fileId> <upload time> <key> sibling yes|no` (plus `hide
    marker` as now). The `sibling` value comes from downloading that version and comparing it with the name's sibling.
    This is only on the refused path, so the cost is rare.
  - A new repeatable `--accept-version <fileId>` makes `one_version` take that fileId for the key whose versions hold
    it, and prints `WARN accepting version <fileId> of <name>`.
  - A fileId that belongs to none of the chosen keys is exit 2.
  - `drill.sh` keeps its NONFATAL path and stays FAIL DR1 (the anomaly is real).
- *Test:*
  - The C9 fixture: dump version 1 hidden and unsiblinged, version 2 siblinged.
  - The refusal prints `sibling no` for v1 and `sibling yes` for v2.
  - `--accept-version <v2>` restores v2, and the restored canary is the original.
  - `--accept-version <v1>` exits 4 at the sibling check.
  - An unknown fileId exits 2.
  - The same rules for a WAL key under `--base`, in `roundtrip.test.ts`.
  - Red: today's code, where `--before` after v2 still exits 3.

## The five items named

**(1) `51ef485d`, the box-line parse, B-1, and what reaches a path, argv or shell elsewhere: holds.**
- The new parse anchors the six fields from both ends (`^([^ ]*) (.*) ([^ ]*) ([^ ]*) ([^ ]*) ([^ ]*)$`). Every field
  is then checked: TS, R2 twice, sha twice, state (`# T16`). A name with a space or a newline cannot shift a field: it
  fails R2, and the line exits 5. `stray <n>` lines are matched as digits only.
- B-1:
  - `box_cmd` is the one builder, for the two fixed verbs only. Any other verb returns 1.
  - The name is single-quoted with `'` escaped (`# T16q`).
  - `ssh … -o BatchMode=yes -- "$BOX" "<string>"`, with stdin `/dev/null` (`# T9`).
  - `--from-box` must match a pattern that cannot start with `-`.
- Fetched files land under fixed local names (`fetched-dump`, `fetched-globals`). A box name is never a path.
- Bucket strings:
  - `b2read.py list` validates every fileId and key before printing.
  - `get` revalidates the fileId and opens `--out` with `O_EXCL|O_NOFOLLOW`.
  - Local files are named by fileId.
  - `restore_base` re-checks each WAL segment name before it uses it inside `sh -c` in the scratch container.
  - Everything printed from the box or the bucket passes `clean`.
  - `drill.sh` interpolates only validated keys and fileIds. Its table names come from the restored database and are
    quoted by `format('%I.%I')`. They only ever run inside the scratch, so there is no reach beyond it (A-b covers
    correctness).

**(2) `infra/lint/policy.json` against `09aeeeb2`: holds.**
- `uploader`'s secret list drops `heartbeat_url` (H-1).
- `prod.backup` gains only `../backup/backup.sh`.
- `prod.uploader`:
  - gains only `upload.sh`, `ops.conf` and `host.env`;
  - loses `uploader-state`;
  - its spool mount loses `"rw": true`, so the allowlist now refuses a writable spool, in line with `prod.yml`'s `:ro`
    and the `uploader-spool-ro` rule.

  `ops.conf` holds only the bucket and endpoint lines (H6), and `host.env` is world-readable already, so neither
  carries a secret. No widening.

**(3) N1 in the runner: holds, before any hash, delete or sibling write.**
- `upload.py`:
  - `_parse` refuses the whole report on any line that fails `VERIFIED` (dir set) or `spool.parse_name` (R2 for that
    dir), on output over 1 MiB, or on a line over 4 KiB. Nothing is touched, and it pings `/fail` (`# N1`).
  - `_act` opens each file with `open_regular` (relative to a directory fd, `O_NOFOLLOW`, `S_ISREG`) before
    `sha_fd`.
  - The `unlink` and the `.sha256` marker both go through the same directory fd.
- `backup.py` `_parse_published`:
  - requires exactly one line, of exactly `4 + kinds` fields, with the mode's directory;
  - requires each name to match R2 and carry the line's kind, sys and TS;
  - then hashes through `open_regular`.
- `fetch-premigration`:
  - checks R2 and `record_trusted`, then `open_regular`;
  - compares root's hash with the record (`# C4`) before writing any byte.
- *A5 is partly met* (advisory A-c): the size is checked after the whole output has been captured, not while reading.

**(4) H-1 as built: holds.**
- `HOST_ONLY = {"heartbeat_url": "host"}`, mirrored in provision-check (`heartbeat_url=host`).
- `provision.sh` `host_secrets`:
  - makes `secrets/host/` at `root:root` 0700;
  - moves the old file with `mv`, which prints no value (only a `change:` line naming the paths);
  - then sets `root:root` 0400.

  The moved file is briefly at its old mode, but inside a 0700 root directory, so no window opens.
- H6:
  - expects 700 and 400 at `0:0` for `host`;
  - refuses a leftover `uploader/heartbeat_url` as "not a file compose mounts from uploader".
- H13, `spool.ping` and `set-secret` all use `secrets/host/heartbeat_url`. `set-secret` writes it `root:root` 0400
  and keeps the https check. `ping` gives the URL to curl on stdin and accepts only `https://`.
- The lint's `host-secrets` rule refuses a volume or secret sourced under `secrets/host/`. The compose file holds no
  `heartbeat_url` secret, so no container can read the URL.

**(5) Marker comments change nothing at run time: holds.** Every marker is a trailing comment preceded by whitespace:
`# T16q`, `# T9`, `# T16`, `# T17` in `restore.sh`; `# T10`, `# T17` in `restore-lib.sh`; `# C4` in `backup.py`; `# N1`
and `# T15` in `upload.py`. Bash and Python treat each as a comment, and none sits inside a string, a heredoc or a
`case` pattern. B-2: no file under `infra/` names `POLY99_`, `POLY_TEST` or `FAKE` (checked over the tree at the sha).

## The rest of the spec

| # | Built | Note |
|---|---|---|
| C1 | `backup` and `uploader` `/tmp:size=1m`; lint `tmp-size` | |
| C2 | `ulimits: {core: 0}` in `x-hardened` (prod and staging); lint `core-dump`; `ulimit -c 0` in backup.sh, upload.sh, restore.sh, drill.sh | edge is excluded from the lint (A-d) |
| C3 | spool `:ro` plus lint `uploader-spool-ro`; allowlist without rw | the ACL shape is H7's; tested in provision/poly99 |
| C4 | root's post-exit hash into `spool.sha256`; fetch compares; restore compares with the listed hash | |
| C5 | box side as (1); bucket side with **F1** | |
| C6 | `--network none --cap-drop ALL --security-opt no-new-privileges --user 999:999 --pids-limit 512 --memory 2g`, image from the digest-pinned `FROM` | Postgres listens on no TCP address (`listen_addresses=`) |
| C7′ | `choose`: newest by upload time, future TS, uploaded before TS, late over 4 h unless `--set`, two sets a day; `check-time` windows 600 / 10800 / 1800 s | `dump_time` reads the archive's local-time fields as UTC (A-e) |
| C8 | `POLY_B2_AUTH_URL` exact (restore.sh and b2read.py); `apiUrl` and `downloadUrl` pinned; WARN on override | |
| C9 | **not met**: F2 | |
| C10 | `record_trusted` on list and fetch; `05_backupdb` and `04_backup` RED on a non-root file; lint `state-mount` | |
| C11 | rclone config in a 0600 tmpfs file; keys through `printf` builtins, never argv or environment; URL on curl stdin; the read key read inside b2read.py only | |
| C12 | `fdesetup isactive` on macOS, the explicit flag elsewhere; trap on EXIT/INT/TERM/HUP | |
| D1 | built as **(a)**: cross-check only with `--read-credential`, WARN otherwise | With the key given and the set still `pending`, it exits 4 ("not in the bucket"), which is stricter than ruled (A-a) |

## Advisory (not gating)

- **A-a.** From-box with `--read-credential` on a `pending` set: print "the set has not reached the bucket yet; retry
  in a minute or omit --read-credential" rather than a bare "not in the bucket". If the Principal chooses D1 (b), this
  becomes the wait.
- **A-b.** `drill.sh` DR7 word-splits `$(… format('%I.%I') …)`. An identifier with a space breaks both counts the same
  way, so they could compare equal. Read the names with `-z`/NUL or use `count(*)` from a single query. Correctness
  only: it runs inside the scratch.
- **A-c.** A5: cap the capture itself (read at most 1 MiB + 1 from the pipe, then kill the container), so a flood
  cannot grow the root runner's memory.
- **A-d.** Add `edge` (Caddy, which holds TLS private keys in memory) to the `core-dump` rule.
- **A-e.** `pg_dump` writes its creation time in the dumping process's local time. The backup container has no `TZ`
  and runs UTC today. Pin `TZ=UTC` in its compose environment, so a future image default cannot turn every dump into a
  false replay refusal. That would fail closed, so it is safe, but it would block restores.
- **A-f.** On success `restore.sh` leaves the scratch container running for the comparison, holding decrypted data.
  `scratch_report` should also print the removal line (`docker rm -f -v <name>`), and say it must be run when the work
  is done.
- **A-g.** The `--report` markdown lists the bucket name, the object names (instance, system id, timestamps) and the
  fileIds, and the lead files it under `process/`. If the repository is public, drop the bucket name and the fileIds
  from the filed copy.

## Tests reviewed against my spec

The test names are taken from `test-plan.md` and `restore.test.ts` at the sha. I ran none: qa has the machine.
- `restore.test.ts` :: T16 (five names, + mutant; T16a/b/c and the `--` static case from `cd3763aa`), T9, C4, C5 (key
  with `..`), C6 flags, C7′, C8, C9 (listing only, hence F2), C12, T10, T11, T17.
- `test_upload.py` :: N1 table, symlink and directory, one bad line, A5, the `# N1` mutant; T15.
- `test_backup.py` :: the published-line table, fetch refusals, the `# C4` mutant, C10.
- `lint-poly99.test.ts` :: `no-test-vars` (B-2), `uploader-spool-ro`, `state-mount`, `core-dump`, `tmp-size`,
  `host-secrets`.
- **Gap:** C5's `..` key case is expected to assert today's exit 5, which F1 changes into "skipped, counted, restore
  goes on". No test passes a two-version name (F2's test).
