# POLY-99 test plan (qa-99)

Authority: `ruling.md` @ 09aeeeb2 incl. Addendum 1 and 2 (R1–R13, T1–T18, N1, C7′) and `ruling-review.md` @ 7bef84f6 (C1–C12, A5). House shape: POLY-98's test-plan. Harness: `tests/infra/backup/` (container suite, joins the `image` job through `tests/infra/vitest.image.config.ts`).

## Contract pins for slice 0 (mine; the ruling leaves these open; the builder builds to them, architect says if one is wrong)

1. **Run shape.** The scratch stack renders `infra/compose/prod.yml` with `--profile backup --profile uploader`, redirects only image refs, host paths and the spool (below), starts the `backup` service as `sleep 3600` (same user 10004, mounts, tmpfs, networks, environment) and runs the script with `docker exec <container> /usr/local/bin/backup.sh <mode>`. So `prod.yml`'s `backup` service must mount `../backup/backup.sh:/usr/local/bin/backup.sh:ro` (R1), and the script must not depend on compose's entrypoint or command.
2. **Passfile** is `/tmp/pgpass` (R1: tmpfs, `umask 077`, two lines: `postgres:5432:polycarpic:poly_backup:<pw>` and `postgres:5432:replication:poly_backup:<pw>`), exported as `PGPASSFILE`. The watcher on the container's `/tmp` accepts that one name and nothing else. Env `PGHOST=postgres PGUSER=poly_backup PGDATABASE=polycarpic`. The password is read from `$DB_PASSWORD_FILE` (compose already sets it to `/run/secrets/db_password_backup`; tests override it to reach the empty-file precondition).
3. **Recipients** are read from `/etc/backup/age-recipients.txt` (as `prod.yml` mounts it today). Tests rewrite the host file between runs.
4. **Spool inside the container** is `/spool/dump` and `/spool/premigration`. The `published` line carries the bare directory name (N1; architect, corrected from my first pin): `published dump <TS> <sys> <base> <dump> <globals>` (names in that order, space separated, last stdout line, nothing else on stdout). Premigration: `published premigration <TS> <sys> <dump> <globals>`. Spool-dir modes are asserted by owner bits plus `getfacl`, not octal (the mask shows in the group bits).
5. **Temporaries** are `<spool dir>/.inflight/<R2 name>.<pid>` (digits). `.inflight/` exists already (provision creates it, C3); the script never creates, chmods or chowns a directory.
6. **ACLs the stack provisions** (the post-POLY-99 target, R10 + Addendum 1 C3): `dump/` and `premigration/` owner 10004 mode 0700, access and default `u:10005:r-x`; `.inflight/` in each owner 10004 0700, default `u:10005:r--`, **no** 10005 access entry. A published file's effective 10005 permission is read with `getfacl` and must be exactly `r--`. The builder's `provision.sh` must produce the same (the host-stage cases check it).
7. **Messages and exit codes** (stderr, one line each, prefix `backup.sh: `; the test asserts the exact line and the code, and that `.inflight/` and the spool dir are empty after):
   - no or bad mode: `usage: backup.sh nightly|premigration`, exit 2
   - recipients file not exactly one `age1…` line: `backup.sh: recipients file must hold exactly one age1 recipient`, exit 3
   - password file empty: `backup.sh: db password file is empty`, exit 3
   - server major ≠ `$PG_MAJOR`: `backup.sh: server major <n> does not match image major <m>`, exit 3 (tests set `PG_MAJOR` with `docker exec -e`)
   - a step failed: `backup.sh: <step> failed` with step in `base|dump|globals`, exit 1
8. **Stack facts the builder can rely on:** `poly_backup` has the password in the secret file, `roles.sql` is applied, a FORCE-RLS table `public.canary_t` holds the canary string, the postgres service runs `postgresql.prod.conf` and `pg_hba.prod.conf` unchanged. The harness self-test (`slice0.test.ts`, "the stack itself") proves a pg_basebackup | gzip | age pipeline works from the rendered service before any script exists.

## Slice 0 (this commit)

| Test | Proves |
|---|---|
| the watcher fails on what it exists to catch | a plaintext file, a canary inside an age-looking file, and an extra file in `/tmp` are each flagged (the watcher's own red-on-fault) |
| the stack itself | harness is sound: routes, auth, replication connection, ACL write, no script under test |
| backup.sh nightly: exit 0 and the `published` line | R1 stdout, exit codes |
| publishes exactly three R2 names, `.inflight/` empty | R1 all-or-nothing publish, R2 grammar |
| effective `r--` for 10005 | C3, T13 |
| watcher: no plaintext, no canary, only `/tmp/pgpass` in `/tmp`, only R2 or `.inflight` names | T1, R11 |

Rows for the remaining R12/R13 cases and every seceng condition follow once slice 0 is green.

## Contract pins for the uploader (R4, R11), tranche 2

9. **Image and script.** `infra/backup/tools.Dockerfile`, build context `infra/backup/` (the test runs `docker build -f infra/backup/tools.Dockerfile infra/backup`); no `ENTRYPOINT`. The script is `/usr/local/bin/upload.sh`, mounted by `prod.yml`, run with no arguments as 10005 on `upload-net`. `bash` is in the image (the tests also use `/dev/tcp`, `sh`, `stat`, `grep`, `tr` inside it).
10. **Inputs.** `ops.conf` at `/etc/uploader/ops.conf` (`B2_BUCKET=`, `B2_S3_ENDPOINT=`), `host.env` at `/etc/uploader/host.env` (`POLY_INSTANCE=`), the credential at `/run/secrets/backup_store_credential` (line 1 key id, line 2 application key). The test CA is bind-mounted over `/etc/ssl/certs/ca-certificates.crt`; the endpoint is `https://s3.eu-fake-001.backblazeb2.com` through a network alias, so R10's pattern stays strict and nothing in the script may carry an endpoint override. Path-style addressing (`/<bucket>/<object>`), which is rclone's default for `provider = Other`.
11. **Stderr messages** (prefix `upload.sh: `, the last stderr line is asserted for exit 1 and 3; for exit 2 each stray has its own line):
    - credential empty or absent: `backup_store_credential missing` (3)
    - `B2_BUCKET missing or malformed`, `B2_S3_ENDPOINT missing or malformed` (host not `s3.<region>.backblazeb2.com`, not https, or a path or suffix), `POLY_INSTANCE missing or malformed` (a slash or `..`) (3)
    - a stray: `stray file <dir>/<name>` (2, after the loop; the good files are still shipped and reported)
    - over 5 GiB: `<dir>/<name> exceeds 5 GiB` (1, before any upload)
    - a refused or mismatched upload: `upload of <dir>/<name> failed` (1, the run stops there; one PUT attempt)
12. **argv, observed from `/proc` during an upload:** exactly `rclone --config /tmp/rclone.conf copyto /spool/<dir>/<name> b2:<bucket>/<instance>/<M>/<dir>/<name> --no-check-dest --s3-no-head --s3-upload-cutoff 5G --retries 1 --low-level-retries 1`, and `/tmp/rclone.conf` is `0600` owned by 10005. The flags are literal tokens in the script (the mutants delete them by text).
13. **What the uploader does not do:** a symlink and anything in `.inflight/` is never uploaded; `.sha256` is admitted in `premigration/` only (skipped as already uploaded when it is the sibling of a file there; a stray elsewhere); the uploader writes nothing under `/spool`.
14. **fake-b2** is `tests/infra/backup/fake_b2.py`; its own behaviours are asserted in `fake-b2.test.ts`. Native API v3 shapes are pinned there for restore.sh and drill.sh: `GET <auth url>/b2api/v3/b2_authorize_account` (Basic, read key only) returns `apiInfo.storageApi.{apiUrl,downloadUrl,allowed.buckets[0].{id,name}}`; `b2_list_file_versions?bucketId=&prefix=` and `b2_download_file_by_id?fileId=` take the token in `Authorization`.

| Test (uploader.test.ts) | Proves |
|---|---|
| R4 the run | order, `verified` lines, object names, siblings, spool untouched, PUTs only (T6 positive) |
| premigration skip; `.sha256` in dump/ | R4 step 3, stray rule |
| R2 grammar through the uploader (4 good WAL forms, 10 bad names) | R2, T8 |
| T8 plaintext, `.inflight`, symlink, over 5 GiB | R4 steps 1-2 |
| T7 refuse, 5xx; T5 ETag mismatch (+ `--ignore-checksum` mutant) | R4 exit 1, file kept, S6(d) |
| T6 mutants without `--no-check-dest` / `--s3-no-head` | M-U2, M-U3 |
| R4 configuration (9 cases, one non-`source` case) | exit 3 messages |
| U4/C11 rclone config and argv | 0600, no key in argv/environ, the exact argv |
| T4, T3 | no DB credential or route; backup has no route out and no bucket key |
| T14 | read-only mount, then the ACL layer alone; rwx fault |

## Contract pins for the root runner (R5, R6, N1, C4, C10), tranche 3 (`tests/infra/ops/test_backup.py`, `test_upload.py`, fixtures in `backup_base.py`)

15. **Modules:** `infra/ops/commands/backup.py` (subcommands `nightly`, `premigration`, `list-premigration`, `fetch-premigration <name>`) and `commands/upload.py`, POLY-98 house style. `fetch-premigration` writes bytes through a new Ctx keyword `stdout_bytes` (binary file-like; the real default is `sys.stdout.buffer`); `base.py` passes it when `Ctx.__init__` accepts it.
16. **Child calls the fake answers:** `docker compose -p polycarpic-prod ps -a --format json` and `docker inspect` (running-detection and `Config.Image`, as POLY-98 pin 6); `docker rm -f polycarpic-prod-backup|uploader` before each run (the stale one) and again after a timeout; the run argv exactly as R5 writes it, with `--profile backup|uploader`, `--name polycarpic-prod-backup|uploader`, `/usr/local/bin/backup.sh <mode>` or `/usr/local/bin/upload.sh`; env = the fixed env plus `POLY_POSTGRES_IMAGE` (backup), `POLY_TOOLS_IMAGE` and `POLY_POSTGRES_IMAGE` (upload); `timeout` 10800 (nightly), 1800 (premigration); `systemctl start --no-block polycarpic-uploader.service`; the ping is `curl ... --config -` with stdin `url = "<URL>"` and the URL never in argv or env.
17. **Locks** are `fcntl.flock` on `/run/polycarpic/backup.lock` and `upload.lock` under the ctx root. Backup polls `LOCK_NB` with `ctx.sleep` and gives up when `ctx.now()` has advanced 30 minutes: exit 4 `backup: the backup lock was not got in 30 minutes`. Upload is non-blocking: busy means exit 0 at once.
18. **Messages:** `backup: prod postgres is not running` (3), `upload: /opt/polycarpic/images.env missing or malformed` (3), `backup: spool.sha256 is not root-owned 0644` (1), `backup: bad name` (2), `backup: <name> is not a regular file` (1), `backup: <name> does not match the spool record` (1), `backup: no spool record for <name>` (1). A root-side mismatch in `upload` prints a line naming `<dir>/<name>` (the exact wording is free).
19. **Records, all root-written under `/var/lib/polycarpic/state` at 0644 and trusted-uid-owned:** `jobs.log` lines `<t0> <t1> backup-<mode> ok|failed` with times as `YYYY-MM-DDTHH:MM:SSZ`, written after the container is gone (after the timeout's `docker rm -f`); `spool.sha256` lines `<sha256> <dir>/<name>`; `last-upload` = line 1 `ctx.now()` in that format, then `<POLY_INSTANCE>/<M>/dump/<name>` for base, dump, globals; the premigration sibling `<name>.sha256` = `<sha256>  <name>\n`. `POLY_INSTANCE` comes from `/etc/polycarpic/host.env`.
20. **R6 last line (Addendum 1 C4):** `premigration-set <TS> <dump name>=<sha256> <globals name>=<sha256>`. `list-premigration`: `<TS> <dump> <dump sha> <globals> <globals sha> uploaded|pending`, oldest first, sets with both files and both record lines only, plus `stray <n>` when the directory holds a name outside R2 (and not a `.sha256` sibling).
21. **N1:** the `published` and `verified` lines are accepted only when `<dir>` is in {`wal`, `dump`, `premigration`} (`wal` is never valid for `published`) and `<name>` matches R2 for it; the file is opened relative to that spool dir with `O_NOFOLLOW` and must be regular; the `verified` sha must be 64 lowercase hex. One bad line makes the whole run touch nothing: exit 1, `/fail`. A5: more than 1 MiB of stdout or a line over 4 KiB is a fault.
22. **T15's mutant:** the root-side comparison in `commands/upload.py` is ONE `if` line ending in the comment `# T15`. The test copies `infra/ops`, rewrites that condition to `False`, and shows a wrong sha and a swapped dump get deleted. (The one-line marker is my pin so the mutant is a text change, not a fake.)
23. **Set-complete:** root confirmed a `globals-<M>-<sys>-<TS>` in this run and no `base` or `dump` of the same `<sys>-<TS>` is left in `dump/`. Only then `last-upload` is rewritten and `<heartbeat_url>` pinged; a WAL-only or partial run does neither. A failed ping never changes the exit code.
24. **Prune:** a premigration file with a `.sha256` sibling and a `<TS>` more than 7 days before `ctx.now()` is deleted with its sibling by root; a file without a sibling is never pruned; `spool.sha256` is rewritten (tmp + rename) without lines for files that are gone.

## Contract pins for restore.sh (R7, C4-C9, C12, C7′), tranche 4 (`tests/infra/backup/restore.test.ts`, harness `laptop.ts`, `artifacts.ts`, `fake_box.py`, `shims/ssh`)

The scripts run on the host with shims first on PATH: `ssh` (logs argv and stdin, then runs the remote command string in a shell with a fake box first on PATH), `fdesetup` (exit code from a file), `uname` (prints Darwin, so C12's path runs on Linux CI too), `docker` and `age` (logging wrappers over the real ones). Host needs `age`, `pg_restore`, `python3`, Docker; the CI `image` job must install `age` and `postgresql-client`.

25. **Files:** `infra/restore.sh`, `infra/backup/restore-lib.sh`, `infra/backup/b2read.py`, `infra/drill.sh`. The scratch image is read from the `FROM` line of `infra/postgres/Dockerfile` found relative to the script (the tests run mutants from a copy of `infra/`). The restored database is named `polycarpic`, in a scratch cluster whose superuser is `postgres`.
26. **Output:** success ends stdout with `scratch container: <name>` and `connect: docker exec -it <name> psql -U postgres`. Stderr: `restore.sh: <reason>`, the last stderr line is the refusal. Scratch containers carry the label `polycarpic.restore=scratch`. `--keep` prints `keeping <dir>` (any text with `keep` and the path) on stderr. Files in the decrypt directory are named by `fileId` (or a name matching `^[A-Za-z0-9_-]+(\.\w+)?$`).
27. **Messages and codes** (exact): `usage: restore.sh …` (2); `restore.sh: choose one of --premigration, --base, --dump` (2); `restore.sh: unknown option <flag>` (2); `restore.sh: --before must be YYYY-MM-DDTHH:MM:SSZ`, `bad --instance`, `bad --from-box`, `bad --set`, `--premigration needs --from-box <user@host>` (2); `restore.sh: identity file must be mode 0600 or tighter` and `identity file not found` (2); `restore.sh: disk encryption is not active (fdesetup isactive)` (2); a bad `POLY_B2_AUTH_URL` line containing `POLY_B2_AUTH_URL` (2); `restore.sh: <name> does not match the spool record` (4). A bad apiUrl/downloadUrl, a refused object key, or a box line that fails validation is 5. A refused selection (two versions, two sets in a day, a future TS, an upload before or more than 4 h after its TS) is 3 and prints one line per version `version <fileId> <YYYY-MM-DDTHH:MM:SSZ> <object name> …` (`hide marker` appears in the text when one follows an unsiblinged version). A replayed archive is 4 with `archive time` or `replay` in the text. Warnings: `WARN B2 auth URL overridden: <url>`, `WARN late upload`, `WARN not cross-checked against the bucket`.
28. **ssh:** every call is `ssh -a -x -o ForwardAgent=no -o ClearAllForwardings=yes -o BatchMode=yes <user@host> sudo polycarpic-ops backup list-premigration|fetch-premigration <name>`; stdin is empty. The box's `list-premigration` is validated line by line before any name is used: R2 names, TS `^[0-9]{8}T[0-9]{6}Z$`, 64 lowercase hex, `uploaded|pending`; `stray <n>` lines are allowed and shown sanitized; control characters are replaced with `?` before anything is printed.
29. **Mutant markers (my pins, so a mutant is a text change and not a fake):** the box-name validation is ONE line ending `# T16` in `restore.sh`; the ssh invocation is ONE line ending `# T9` (the last word before the comment is the remote command's last argument); the two-version refusal is ONE line ending `# T10` in `backup/restore-lib.sh` and what follows it takes the newest version; the content-time check is ONE line ending `# T17` in `backup/restore-lib.sh`. Each mutant replaces that line (or appends to it) and the same check I assert in the real run is shown to flag it.
30. **T11 detector:** restore.sh and its library read no `PG*` variable and never run `psql`, `pg_restore` or `pg_dump` on the host against a network address: the scratch is reached only with `docker exec`/`docker cp`. A decoy Postgres with `PGHOST/PGPORT` pointing at it must see no connection; the same decoy is shown to see one from a mutant that runs a host `psql`.
31. **C6 flags** (docker's `run` argv, one `run` per restore): `--network none --cap-drop ALL --security-opt no-new-privileges --user 999:999 --pids-limit 512 --memory 2g --label polycarpic.restore=scratch`, the `FROM` ref with its digest, and none of `-v`, `--volume`, `--mount`, `-p`, `-e`, `--env`, `--env-file`.
32. **Time:** `--before`, `--set <TS>` and `--instance` as ruled. Sets are chosen by upload time (C7); one nightly set per UTC day (two in a day refuse); content time per C7′ (base `START TIME` in `[TS−1 min, TS+10 min]`, dump in `[TS−1 min, TS+3 h]` nightly, `[TS−1 min, TS+30 min]` premigration).
33. **Not pinned yet:** the `--from-box` bucket cross-check cases wait for the Principal's D1 (they are the last cases written); `--base` with WAL replay and the two round trips (criterion 3 and T18) are in `roundtrip.test.ts`; drill's DR cases are in `drill.test.ts`.

| Test (restore.test.ts) | Proves |
|---|---|
| usage and hygiene (10 refusal cases, identity mode, static ulimit/umask/pipefail/no PG*) | R7 exit 2, process hygiene |
| C12 fdesetup; C8 auth URL (5 bad values) and apiUrl | C12, C8 |
| from-box: ssh options, T9 (+ mutant), C4 (+ no scratch), WARN | R7, T9, C4 |
| T16 (5 hostile names, + mutant), control characters, tampered TS/sha, stray lines | T16, C5 |
| bucket dump restore; T10 (refusal list, `--before`, + mutant); C9; C5 key | R7, T10, C5, C9 |
| C7′ (future TS, two sets/day, late and early upload, `--set`); T17 (+ mutant) | C7′, T17 |
| C6 flags; T11 decoy (+ detector); globals first, whole dump | R7, C6, T11, F4 |

## More pins (tranche 5)

34. **drill output:** `PASS|FAIL|SKIP <id> <text>`, last line `DRILL PASSED` (0) / `DRILL PASSED WITH SKIPS: <ids>` (3) / `DRILL FAILED: <ids>` (1), usage 2 (`usage: drill.sh …`). Today the happy run is exit 3 with `DRILL PASSED WITH SKIPS: DR9`. DR8 is PASS when neither `public.session` nor `app.session_handle` exists. `--report <path>` writes markdown holding the date, every object name, every `fileId` (as the fake issues them, `4_zfake_<n>`), and each check id with its result. Scratch containers are gone on exit.
35. **DR10 (architect, POLY-99.md @ e585d393; replaces my first reading):** every action runs against a probe object `<instance>/drill/probe-<UTC TS>` the drill uploads with the box key, never a backup object. DELETE, `PUT ?retention` and `PUT ?object-lock` must be refused (403). A plain PUT over the probe's name passes only if the original version (by `fileId`) still downloads with its original sha256. fake-b2 `permissive` allows the verbs and overwrites the first version in place. The happy drill leaves every backup object with one version.
36. **C1 padding:** the scratch stack pads a table with 6 MiB of random hex so a dump exceeds the 1 MiB `/tmp` cap.
37. **Uploader suite fact found against the real image:** rclone adds `?x-id=PutObject` to every PUT; fake-b2 logs the plain path (the query only for the DR10 verbs). `--ignore-checksum` defeats the ETag compare only when it is on every rclone call (the object and its sibling), so the T5 mutant adds it to every `--no-check-dest`.
38. **C4 mutant marker:** the hash comparison in `fetch-premigration` (commands/backup.py) is ONE `if` line ending in `# C4`.
39. **N1 mutant marker:** the dir and name validation of a `verified` line (commands/upload.py) is ONE `if` line ending in `# N1`.
40. **Wiring pair for devops-99 (names are mine, tell me if you prefer others):** `changes.mjs`: the `provision` key gains `^infra\/backup\/`, `^infra\/restore\.sh$`, `^infra\/drill\.sh$`, `^infra\/postgres\/archive-wal\.sh$`; the `image` key gains `^packages\/db\/sql\/roles\.sql$`. `ci.yml`: the `provision` job's shellcheck step lists `infra/backup/backup.sh`, `upload.sh`, `restore-lib.sh`, `infra/restore.sh`, `infra/drill.sh`, `infra/postgres/archive-wal.sh`; the `image` job gains one step before its vitest step that runs `apt-get install` for `age` and `postgresql-client`. `tests/infra/backup-wiring.test.ts` holds these pins.
41. **set-secret wording (H-1):** after writing `heartbeat_url` the last stdout line is `set-secret: heartbeat_url written; root reads it on the next backup or upload run`.

## Where every condition and behaviour is tested

| Item | Test (file :: case) |
|---|---|
| R1 stdout, exit codes, preconditions, premigration, leftovers | backup.test.ts (preconditions table, premigration, leftovers); slice0.test.ts |
| R2 grammar | uploader.test.ts :: R2 grammar through the uploader (4 good WAL forms, 10 bad names); test_backup/test_upload N1 tables |
| R3 target name, exists, stale temp, age failure | tests/infra/image/postgres.test.ts (archive cases, R3 names, data-dir cwd, gunzip) |
| R4 run order, siblings, skip, strays, exit 1/2/3, config 0600, argv | uploader.test.ts (41 cases) |
| R5, R6 runner | tests/infra/ops/test_backup.py, test_upload.py |
| R7 restore | restore.test.ts; roundtrip.test.ts |
| R8 drill | drill.test.ts |
| R9 windows, status | test_status.py (T12 cases, premigration cap); test_set_secret, test_list_secrets (H-1) |
| R10 compose, lint | lint-poly99.test.ts; baseline.ts |
| R10 provision, provision-check (ACLs, units, records, endpoint, H6, H7, H8, H16, H-1) | tests/infra/provision/poly99.test.ts; ops/test_provision.py (`--b2-endpoint`) |
| R13 guards, CI wiring | backup-wiring.test.ts |
| C1 | backup.test.ts :: C1 (no space); lint-poly99 (`tmp-size`, `mount-allowlist`) |
| C2 | backup.test.ts and uploader.test.ts :: C2 (`ulimit -c` is 0); lint-poly99 (`core-dump`); restore/drill static checks |
| C3 | provision/poly99.test.ts (real filesystem, EACCES, rwx fault); lint-poly99 (`uploader-spool-ro`); uploader T14; backup T13 |
| C4 | test_backup.py (fetch refusals, `# C4` mutant); restore.test.ts :: C4 |
| C5 | restore.test.ts :: T16 (5 names), control characters, key with `..`, files by fileId; test_backup list `stray <n>` |
| C6 | restore.test.ts :: C6 flags; roundtrip (a real run under them) |
| C7′ | restore.test.ts :: C7′ (future TS, two sets a day, early/late upload, `--set`, nightly 2 h vs premigration, T17) |
| C8 | restore.test.ts :: C8 (five bad URLs, bad apiUrl) |
| C9 | restore.test.ts :: C9 |
| C10 | test_backup.py (list refuses), test_status T12, lint-poly99 (`state-mount`) |
| C11 | uploader.test.ts (argv/environ sweep); test_backup/test_upload (heartbeat hygiene); restore.test.ts (read key and identity sweep) |
| C12 | restore.test.ts :: C12 |
| N1, A5 | test_upload.py (N1 table, symlink/directory, one bad line, A5, `# N1` mutant); test_backup.py (published-line table) |
| H-1 | test_set_secret.py, test_list_secrets.py, provision/poly99.test.ts (H6, move), lint-poly99 (`host-secrets`), uploader.test.ts (no heartbeat secret) |
| T1 | backup.test.ts :: T1 (watcher + two mutants) |
| T2 | backup.test.ts :: T2 (pg_dump killed; no-pipefail mutant) |
| T3, T4 | uploader.test.ts :: T4, T3 (each with the connect-succeeds fault) |
| T5, T7 | uploader.test.ts :: T7, T5 (+ `--ignore-checksum` mutant) |
| T6 | uploader.test.ts :: T6 (two mutants) |
| T8 | uploader.test.ts :: T8 |
| T9, T16 | restore.test.ts :: T9 (+ mutant), T16 (+ mutant) |
| T10 | restore.test.ts :: T10 (+ mutant) |
| T11 | restore.test.ts :: T11 (decoy + detector) |
| T12 | test_status.py :: T12 |
| T13 | backup.test.ts :: T13 (+ chmod mutant); provision/poly99 |
| T14 | uploader.test.ts :: T14 (mount, ACL, rwx fault) |
| T15 | test_upload.py :: T15 (+ mutant) |
| T17 | restore.test.ts :: T17 (+ mutant) |
| T18, criterion 5 | roundtrip.test.ts (real backup.sh and archive via the box shim; the box side is fake_box.py, the real list/fetch are in test_backup.py) |
| Criterion 3 | roundtrip.test.ts (canary inserted after the base is present after recovery) |
| D1 cross-check cases | not written: the Principal has not chosen |

42. **Suite design (architect, ruling Guards @ 2bf5a6ba):** `tests/infra/vitest.backup.config.ts` runs `tests/infra/backup/*.test.ts` after one `global-setup.ts` (the stack, fake-b2, a real nightly set A, a later poisoned set B, a premigration set P and the WAL, written read-only to a fixture directory; the files attach through `POLY99_PROJECT`, `POLY99_INFO`, `POLY99_FAKE`, `POLY99_FIXTURES`). The image config no longer includes the backup directory. The CI step is `pnpm exec vitest run -c tests/infra/vitest.backup.config.ts` in the `image` job, gated by a new `backup` change key (paths in the ruling). The laptop `docker` shim refuses `docker run` when `POLY99_SCRATCH_FAIL=1`, after logging it: a refusal case asserts the code and that no `run` was logged; a mutant case asserts that `run` WAS logged. Real scratch restores: roundtrip 3 (`--base`, `--dump` with the T11 decoy, premigration), restore.test.ts 1 (T10 `--before`, which also proves the nightly 2 h window), drill 2 runs (the second carries every fault).

43. **T16 two guards, B-2 (seceng @ 69abc115; replaces my single-marker T16 pin):** restore.sh builds the remote command in ONE function; its quoting line is ONE assignment `<var>=<expr>` computing the single-quoted name from the function argument `$1`, ending `# T16q`. The ssh invocation is `ssh -a -x -o … -- <user@host> "<string>"` on the line ending `# T9`. The fake ssh runs the string with a real `sh -c`. Mutants: T16a (no `# T16` check) is red on a further ssh and the canary stays absent; T16b (no check and the quoting line rewritten to `<var>=$1`) is red on the canary file; T16c (no quoting only) is green. No production script reads a test variable: the `POLY99_SCRATCH_FAIL` shim lives under tests/ and is put on PATH by the harness; `lint-poly99.test.ts` `no-test-vars` holds the denylist and the POLY_* allowlist.

## Control run: the POLY-95 cases that fail on Docker Desktop (qa-99)

A clean checkout of `origin/main` (worktree, same Mac, Docker Desktop, `tests/infra/image/postgres.test.ts` through the image config) fails the same three cases: the two secret-mode cases (`web is refused a file in postgres's directory…`, `a 0440 file in a service directory is refused to an unrelated uid`) and the old permission-based `an age failure (unreadable recipients file)`. Cause, checked directly: a root-owned 0600 file on a Docker Desktop bind mount is readable by uid 999. So they predate POLY-99 and cannot fail on this Mac. This loop changed the age-failure case to use a garbage recipients file, which no longer depends on bind-mount modes; it passes here. The two secret-mode cases still need Linux CI.
