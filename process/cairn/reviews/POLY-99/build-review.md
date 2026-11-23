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

## Re-ruled with the repository public (`gh repo view` → PUBLIC): A-g becomes F3, A-f becomes F4

**F3. The filed drill report must carry no bucket name, fileId or system id.**
- *What a reader gains without a key:*
  - **Bucket name.** It identifies our store across Backblaze. With the bucket private, a download by name or by
    fileId needs an authorization token, so nothing downloads. If the bucket were ever made public by mistake, a
    name plus the object names gives a direct download URL. Even then that yields ciphertext only.
  - **fileIds.** Every B2 call that takes one needs a token, so a reader can do nothing with them. They identify
    versions exactly, which is useful to us and to nobody else.
  - **System id, instance, timestamps.** They show the backup schedule, the Postgres major and the cluster identity.
    That is reconnaissance, not access.
- So the reach is small. It becomes a fix for two reasons. A public commit cannot be withdrawn: git history and forks
  keep it. And the redaction costs a few lines.
- *Required:*
  - `drill.sh --report` writes only the filed form: the date; per object its kind, `<TS>`, upload time and the sha256
    from its sibling (a ciphertext hash, which reveals nothing); and every check line.
  - It writes no bucket name, no fileId, no system id and no object key. The fileIds the operator needs to act on stay
    in the terminal output, which is local.
  - DR1, DR2 and DR11 FAIL lines that name objects use kind and `<TS>` in the report.
- *Test:*
  - In the `drill.test.ts` happy run with `--report`, the file holds no `4_zfake_` id, no bucket name, no
    `SET_SYS`-shaped id and no `/` object key.
  - It still holds every DR id with its result, and each object's kind and TS.
  - Red: today's report, which lists `fileId=` and the keys.

**F4. A successful restore's scratch must not outlive the session by default.** Printing the removal command is not
enough.
- *Mechanism:* the scratch runs `sleep 86400` with no `--rm`. When the sleep ends, the container stops but is not
  removed. Its writable layer, holding the decrypted ledger including BetterAuth's password hashes and session
  tokens, then stays on the laptop's Docker disk **indefinitely**, and any process that can reach the Docker socket
  can read it. A forgotten restore becomes a permanent plaintext copy.
- Removing it at exit by default would make `restore.sh` useless, because the running scratch is what the operator
  compares against. So the scratch gets a bounded life, and a way to end it.
- *Required:*
  - The scratch runs with `docker run -d --rm`, its main process `sleep <seconds>` from `--hours <n>`. The default is
    8 and the maximum 24; outside 1–24 is exit 2. When the time ends, Docker removes the container and its layer.
  - `scratch_report` prints the end time and `restore.sh --cleanup`.
  - `restore.sh --cleanup` removes every container labelled `polycarpic.restore=scratch` (`docker rm -f -v`) and
    prints how many.
  - Every `restore.sh` run first lists any existing labelled scratch on stderr as a `WARN`, so a forgotten one is
    seen.
  - `--keep` stays what it is: it keeps the decrypt directory, and says so.
- *Test:*
  - The fake docker log shows the scratch `run` with `--rm` and `sleep 28800`. `--hours 2` gives `sleep 7200`, and
    `--hours 0` or `--hours 25` gives exit 2.
  - `--cleanup` with two labelled containers present issues `rm -f -v` for both, and none for an unlabelled one.
  - A run with a labelled container present prints the `WARN`.
  - Red: today's argv, which has no `--rm`.
- `drill.sh` already removes its scratches on exit. It also gains `--rm`, so an interrupted drill cannot leave one
  behind.

## Re-check of F1 and F2 @ `a15b80cf80b535c38fdd4458cce05053e7f73e36` (code read; tests pending)

**F1: met in code.**
- `b2read.py list` leaves out a record that fails `FILE_ID` or `valid_key`, and prints `stray <n>` on stderr.
- `list_bucket` (restore-lib) passes only that count on, as `WARN <n> stray objects in the bucket`. It is used by
  both `bucket_select` and the from-box `cross_check`.
- `drill.sh` reports FAIL DR1 with the count, ahead of the version check.
- No stray name is printed or used.

**F2: met in code.**
- The refusal lists `version <fileId> <time> <key> sibling yes|no`, through `clean`. The two downloads happen only on
  the refused path and are deleted after the comparison.
- `--accept-version` takes only `^[A-Za-z0-9_-]+$`.
- `one_version` takes an accepted fileId only for an **upload** version of the very key it is checking, and with a
  WARN.
- The accepted version still has to pass the sibling check in `fetch_object` and `prepare_base`, so accepting a bad
  version still exits 4.
- `check_accepted` exits 2 for an unused fileId, **before** any restore starts, in `--dump` and `--base`.
- *Note:* in `--premigration`, an unused `--accept-version` is ignored rather than refused. That is harmless: the
  from-box path also requires root's record hash. Calling `check_accepted` there too would be tidier, and does not
  gate.

**Gate:** F1 and F2 pass on the code at `a15b80cf`. They close when qa's tests for each are green and shown red on
today's behaviour, as listed under each fix. F3 and F4 are still open. I re-check them, and only them, when they land.

## Re-check of F3 and F4 @ `147d35d96ab7dd27185ccc8043f52087100b11f9` (code read; tests pending)

**F4: met in code, one residual stated.**
- *Start.* `scratch_start` runs `docker run -d --rm --label polycarpic.restore=scratch` with C6's flags. The main process
  is `sleep $((HOURS*3600))`. `--hours` takes 1–24, and anything else is exit 2. Postgres runs as a secondary
  `docker exec -d` process, against `/tmp/pgdata` in the container's writable layer, with no TCP listener.
- *Shutdown.* When the sleep ends, PID 1 exits. Docker kills the exec'd Postgres (unclean, which does not matter for a
  throwaway) and, because of `--rm`, removes the container.
- *What `--rm` removes.* The writable layer, which holds `/tmp/pgdata`. The official image also declares
  `VOLUME /var/lib/postgresql/data`, so every scratch gets an **anonymous** volume. It stays empty, because the data
  is in `/tmp/pgdata`. `--rm` removes anonymous volumes with the container. `scratch_rm` and `--cleanup` both use
  `docker rm -f -v`, which does the same. No named volume and no bind mount exist.
- *The drill* starts its scratches through the same `scratch_start` (restore-lib), so it gets `--rm` and the 8 h
  default, and it still removes them on exit.
- `--cleanup` removes every labelled container, stopped ones included (`ps -a`). Every run warns when one exists.
- *Residual (unmeasured):* if Docker Desktop is stopped or the laptop restarts while a scratch runs, whether the
  daemon removes that `--rm` container on its next start is unmeasured. A survivor is still caught by the start-of-run
  `WARN` and removed by `--cleanup`. That is acceptable.

**F3: the report file is met; another output path bypasses it, so this is F5.** The `--report` block writes:
- the date and the set's `<TS>`;
- `report-objects` (kind, TS, upload time, sibling sha256);
- the check lines.

No bucket, fileId, system id or object key is in that block. **But `drill.sh`'s stdout still carries fileIds and keys
whenever there is an anomaly:**
- `list_versions` prints `version <fileId> <time> <key> …` to stdout;
- `bucket_select` prints `b2 choose`'s refusal listing (fileIds and keys) to stdout;
- the DR1 FAIL line then says "the versions are listed above".

INFRA §6.7 has the lead file the result. A drill run as `drill.sh … > drill.txt`, or captured by the lead's tool,
therefore puts exactly what F3 removed into a public commit, on precisely the runs worth filing.

**F5. Identifiers go to stderr, never stdout, in the drill and the restore.**
- `list_versions` and the `b2 choose` refusal listing write to **stderr** in `restore-lib.sh`. That serves
  `restore.sh` too, where the operator still sees them on the terminal.
- `drill.sh`'s stdout then carries only the `PASS|FAIL|SKIP` lines, the scratch's name and end time, and the final
  verdict line. Its DR1 text says "listed on stderr".
- *Test:* in `drill.test.ts`, the C9 fixture (two versions plus a hide marker) and the F1 stray fixture, with stdout
  and stderr captured apart:
  - stdout holds no `4_zfake_` id, no bucket name and no `<instance>/` key;
  - stderr holds the version lines;
  - `restore.sh`'s refusal (exit 3) still prints them on stderr.
  - Red: today's stdout, which holds the version lines.

**`147d35d9`, `--premigration` refuses an unused `--accept-version`:** met (`check_accepted` in that branch).

### Which of F1–F5 close on code and which wait on tests

None of them closes on code alone. Each needs qa's case, shown red on today's behaviour, because each is a behaviour
that a reading can miss. qa-99's cases are not on the branch yet.

| Fix | Code | Waits on |
|---|---|---|
| F1 stray keys | met @ `a15b80cf` | qa's F1 case (restore goes on with a WARN; drill FAIL DR1) |
| F2 two-version passage | met @ `a15b80cf` (+ `147d35d9`) | qa's F2 cases (sibling yes/no, `--accept-version` v2 / v1 / unknown; the WAL key under `--base`) |
| F3 redacted `--report` | met @ `314b2dcf` | qa's F3 case on the report file |
| F4 bounded scratch | met @ `314b2dcf` | qa's F4 cases (argv `--rm` and `sleep 28800`, the `--hours` bounds, `--cleanup` by label, the WARN). **Plus one real-Docker case**, since a fake cannot show the removal: `docker kill` the scratch's PID 1 (standing in for the end of the sleep), then assert the container is gone (`docker ps -a --filter label=…` empty) and no volume is left (the `docker volume ls -q` set equals the one taken before the start) |
| F5 identifiers to stderr | **open** | the code change, and qa's F5 case |

When F5 lands I re-check it and the five fix tests, and nothing else.

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
