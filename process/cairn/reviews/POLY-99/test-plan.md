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
