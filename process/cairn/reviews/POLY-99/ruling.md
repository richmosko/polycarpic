# POLY-99 ruling: backup, uploader, restore, drill

Architect, 2026-11-22. Tree read at `d1dae3438f982f3b01cd8393cc84f0c10c05de2b`. Scope: the description, five
acceptance criteria and four comments on `POLY-99.md`; INFRA §2.2, §2.3, §6.1–§6.7, §8.10, D-13–D-15; SECURITY C-73,
C-79; POLY-97 ruling, seceng positions 1a/1b, build review F-probe2; POLY-98 ruling R7 and review R-a; POLY-100's
description. A claim is measured unless tagged `(unmeasured)`; §M lists the measurements (this Mac, Docker 29.9.3,
arm64). Seceng positions are §S; the Principal's choices §D; questions for the lead §L. The ruling proceeds on each
recommendation unless the issue file says otherwise.

## M — Measurements

| # | Question | Command (abridged) | Result |
|---|---|---|---|
| M-U1 | Can rclone upload with no HEAD and no list? | `rclone/rclone` v1.76.0, `copyto <file> b:bkt/<obj>` with `--no-check-dest --s3-no-head --s3-upload-cutoff 5G --low-level-retries 1`, S3 env config as `b2-setup.py --probe`, against `rclone serve s3` behind a Python proxy that logs every request and answers 403 to anything but PUT | exit 0; the proxy saw **exactly one PUT**, carrying `Content-Md5`. |
| M-U2 | Does `--no-check-dest` matter? | the same without it | rclone sends **HEAD before the PUT**, the 403 fails the run (exit 1). `--s3-no-head` alone does not stop it. |
| M-U3 | Without `--s3-no-head`? | `--no-check-dest` only | PUT, then HEAD, 403, exit 1. |
| M-U4 | Is the upload response's checksum compared? | proxy rewrites the PUT response `ETag` to 32 zeros | exit 1, `corrupted on transfer: md5 hashes differ`; rclone then sends one **DELETE** of the object (the proxy refused it). |
| M-U5 | Refused upload | proxy answers 403 to the PUT | exit 1. |
| M-U6 | Above the cutoff | `--s3-upload-cutoff 1M` | a multipart POST (`CreateMultipartUpload`), not a PUT. |
| M-P1 | Base to stdout through age, WAL replay | `polycarpic-postgres:ci`: archive_command `age` into `/spool/wal`; `pg_basebackup -h … -U rb -Ft -X none -D - \| age -R`; insert a row; `pg_switch_wal()`; decrypt the base into a new data dir; `restore_command` = `age -d`; `recovery.signal` | both pipe stages exit 0; the tar holds `backup_manifest` and `global/pg_control`; recovery replays 2–4 and the row inserted **after** the base is present; promoted (`pg_is_in_recovery` = f). A canary grep over the spool finds 0 files. |
| M-P2 | System id without a grant | `psql "… user=rb dbname=replication replication=true" -c IDENTIFY_SYSTEM` (rb: LOGIN REPLICATION only) | returns `systemid|timeline|xlogpos`. |
| M-P3 | What archive_command sees | the same run | cwd is the data directory; `pg_controldata .` prints the system identifier; Postgres archives a `<seg>.<off>.backup` history file after `pg_basebackup -X none`. |
| M-W | WAL size | five forced switches (`pg_switch_wal()`) after light writes; `gzip -1 -c <seg> \| wc -c` | every segment is 16 777 216 bytes; lightly used ones gzip to **≈ 81 KB**, a 400 000-row one to 6.7 MB. |

Consequence of M-W: uncompressed, `archive_timeout = 300` on a database touched every few minutes ships up to
288 × 16 MiB = 4.6 GiB a day, which fills the 10 GB bucket cap in about two days. Once the cap is hit, uploads are
refused (SECURITY C-73, the 1b availability threat). The data is compressed before encryption (R1, R3).

Unmeasured, and measured on the real bucket in POLY-105: B2's S3 PUT returns the content MD5 as `ETag` for a
single-part upload; B2 refuses the box key's DELETE (no `deleteFiles`); `{writeFiles}` alone is enough (E9).

## Scope

IN: R1–R13. OUT, with where each item goes:

| Item | Goes to | Why |
|---|---|---|
| Any call to the real bucket; the E9 probe with the uploader's flags | POLY-105 | The Principal's scope (2026-11-22). |
| The full timed restore drill against real objects (GA gate) | POLY-116 | Same. |
| Enabling the timers; writing `/opt/polycarpic/images.env`; calling R6's premigration contract; publishing the tools image in `build.yml` | POLY-100 | The deploy owns the images on the box. |
| Alerts: spool older than 2 h, the 45-day drill alert, WAL kept by a slot | POLY-103 | Monitoring. |
| Sending decrypted data back to the box and `restore-apply` (INFRA §6.4, §8.10) | **§L1** | Not in the confirmed scope; the lead places it. |

## R1 — The backup container: `infra/backup/backup.sh`

- Bash, `set -euo pipefail`, shellcheck clean. It runs in the Postgres derivative image (`POLY_POSTGRES_IMAGE`, the
  same image as the server, INFRA §6.1a) as `10004:10004` on `backup-net`. Compose mounts it
  `../backup/backup.sh:/usr/local/bin/backup.sh:ro`. It holds `db_password_backup` and the age recipient only.
- Connection: `PGHOST=postgres PGUSER=poly_backup PGDATABASE=polycarpic`; a `PGPASSFILE` in `/tmp` (tmpfs) carrying
  two lines (`postgres:5432:polycarpic:…` and `postgres:5432:replication:…`), opened with `umask 077`.
- Preconditions (exit 3, nothing written): the recipients file holds exactly one `age1…` line; the password file is
  non-empty; `SHOW server_version_num` / 10000 equals the image's `$PG_MAJOR`. The system id `<sys>` comes from
  `IDENTIFY_SYSTEM` over a replication connection (M-P2), so no grant is needed.
- `TS=$(date -u +%Y%m%dT%H%M%SZ)`. `M=$PG_MAJOR`. Names: `<kind>-<M>-<sys>-<TS>.age`.
- **`backup.sh nightly`** writes to `/spool/dump/.inflight/<name>.<pid>`, in this order:
  1. `base`: `pg_basebackup -Ft -X none -c fast -D - | gzip -1 | age -R <rcpt> -o <tmp>`
  2. `dump`: `pg_dump -Fc | age -R <rcpt> -o <tmp>` (custom format is already compressed)
  3. `globals`: `pg_dumpall --globals-only --no-role-passwords -l polycarpic | gzip -1 | age -R <rcpt> -o <tmp>`
     (`-l`: pg_hba admits poly_backup to `polycarpic` only).
- **All or nothing.** Only after all three succeed does it `sync` each, `ln <tmp> /spool/dump/<name>` in the order
  base, dump, globals (`ln` refuses an existing target), `sync` the directory and remove the temporaries. On any
  failure it removes its own temporaries and exits 1, having published nothing.
- **`backup.sh premigration`**: the same for `dump` and `globals` only, into `/spool/premigration/`.
- At start, each mode removes leftovers in its own `.inflight/` (the runner's lock, R5, makes it the only writer).
- Never `chmod`, never `umask` other than for the passfile, never `chown` (POLY-97 M1).
- Stdout: the last line on exit 0 is `published <dir> <TS> <sys> <name>…`. Nothing else goes to stdout. Exit codes:
  0 published; 1 a step failed; 2 usage; 3 precondition.

## R2 — Spool name grammar (shared by backup, archive, uploader, restore)

```
^(base|dump|globals)-([0-9]{2})-([0-9]{1,20})-([0-9]{8}T[0-9]{6}Z)\.age$                 dump/, premigration/
^wal-([0-9]{2})-([0-9]{1,20})-([0-9A-F]{24}(\.[0-9A-F]{8}\.backup|\.partial)?|[0-9A-F]{8}\.history)\.age$   wal/
```

`premigration/` admits `dump` and `globals` only; `dump/` admits all three. Why the system id: a cluster made by a
fresh `initdb` (a replaced box before restore, a logical restore) starts again at timeline 1. Without the id its
segment names would collide inside 35 days with the old cluster's names, and a restore by upload time could pick the
wrong cluster's segment. The `.backup`, `.history` and `.partial` forms are what Postgres hands archive_command (M-P3).

## R3 — WAL: `infra/postgres/archive-wal.sh`

- `#!/bin/bash`, `set -euo pipefail` (dash's pipefail is not relied on). On the first call per segment it reads `<sys>`
  with `pg_controldata .` (M-P3) and the major from `$PG_MAJOR`, and names the target `wal-<M>-<sys>-<%f>.age`.
- `gzip -1 -c "$p" | age -R "$rcpt" -o "$tmp"`, with everything else as built: the temporary in `.inflight/`, `sync`,
  `ln` (fails if the target exists), `sync` the directory, remove the temporary.
- **Who moves a segment out of `.inflight/`: archive-wal.sh itself**, by `ln` and then `rm`. No one else reads or moves
  `.inflight/`. A crash between `ln` and `rm` leaves a temporary that the next call for the same `%f` removes.
- A crash after `ln` but before Postgres records the segment as archived makes the retry fail on the existing target
  until the uploader has shipped and removed it (one minute at most). The retry then uploads a second version of that
  name. That is the one benign source of a two-version name, and restore treats it as an alert (R8), not as silence.

## R4 — The uploader: `infra/backup/upload.sh` and the tools image

- **Image:** `infra/backup/tools.Dockerfile`: `debian:bookworm-slim@sha256:…`, `ca-certificates`, `curl`, and rclone
  **v1.76.0** (the measured version) from the official release zip, checked against a SHA-256 pinned in the file. It is
  built in the tests here; `build.yml` publishes and attests it in POLY-100 (POLY-95 F3).
- Bash, `set -euo pipefail`, shellcheck clean, as `10005:10005` on `upload-net`. It holds `backup_store_credential` (two
  lines, POLY-97 R6) and `heartbeat_url` only, plus read-only mounts of `ops.conf` and `host.env` (both world-readable
  already). It parses `B2_BUCKET`, `B2_S3_ENDPOINT` (R10's pattern) and `POLY_INSTANCE` by exact pattern, never by
  `source`. rclone is configured from the environment (`RCLONE_CONFIG_B2_TYPE=s3`, `PROVIDER=Other`, `ENDPOINT`,
  `NO_CHECK_BUCKET=true`, the two keys read from the file). No script carries an endpoint override.
- **The exact upload argv**, one object per call, and the same for the `.sha256` sibling:
  `rclone copyto <file> b2:<bucket>/<object> --no-check-dest --s3-no-head --s3-upload-cutoff 5G --retries 1
  --low-level-retries 1`. Never `--ignore-checksum`, never `--s3-disable-checksum`. `b2-setup.py --probe` adopts this
  argv (F-probe2): its `rcat` becomes `copyto` of a 1-byte file with these flags.
- **Object name:** `<POLY_INSTANCE>/<M>/<dir>/<spool name>`, where `<dir>` is the spool subdirectory, and the major
  in the path is the one in the name. The sibling `<object>.sha256` holds `<sha256 hex>  <spool name>\n`.
- **Per run**, under the runner's lock (R5): for `wal/`, then `dump/`, then `premigration/`, every regular file
  (never `.inflight/`, never a symlink, sorted by name):
  1. Not matching R2 for its directory: **stray**. Exit 2 after the loop, file kept, nothing uploaded for it.
  2. Its first 22 bytes are not `age-encryption.org/v1\n`: **refused** as stray. Over 5 GiB: refused (exit 1).
  3. In `premigration/` with a `.sha256` sibling present: already uploaded; deleted with its sibling when its `<TS>`
     is more than 7 days old, else skipped.
  4. Upload the file; on success upload the sibling (from `/tmp`).
  5. `wal/`, `dump/`: delete the spool file. `premigration/`: write the sibling into the spool beside it (its
     uploaded marker; never chmod).
  The first failed upload stops the run: the file stays, exit 1.
- **Nightly set complete** = in this run a `globals-<M>-<sys>-<TS>` object was verified and no `base` or `dump` file of
  the same `<sys>-<TS>` is left in `dump/`. Only then does it rewrite `last-upload` and ping success. WAL uploads do
  neither: otherwise WAL alone would keep the 26-hour alert and the heartbeat green while the nightly set failed.
- **`last-upload`** (format unchanged from POLY-98 R7): line 1 the completion time `YYYY-MM-DDTHH:MM:SSZ`, then the
  three object names. It is a single-file bind mount, so it is written in place, without truncating first:
  `printf … 1<> /state/last-upload`, then `truncate -s <len>`. A reader sees the old or the new line 1.
- **Pings:** success → `<heartbeat_url>`; any exit 1 or 2 → `<heartbeat_url>/fail`. `curl -fsS -m 10 --retry 2
  --config -`, URL on stdin, never in argv. `heartbeat_url` is the backup check's full ping URL. No file → no ping
  (H13 already warns). A failed ping does not change the exit code.
- **Exit:** 0 done (including nothing to do); 1 an upload refused or mismatched (S6(d)); 2 stray file; 3 config
  missing (credential, endpoint, bucket, instance). It writes nothing to `jobs.log`.

## R5 — The host job runner: `polycarpic-ops backup …` and `polycarpic-ops upload`

New module `infra/ops/commands/backup.py` (with `upload` as its own `commands/upload.py`), in the POLY-98 house style:
root, injected `ctx`, argv lists, fixed env, every K-condition.

- `backup nightly|premigration`: `flock /run/polycarpic/backup.lock`, waiting at most 30 min (exit 4 if not got).
  Image = the running prod postgres container's `Config.Image` (as D3 takes it); none running → exit 3.
  `t0`; `docker rm -f polycarpic-prod-backup` (a stale one); then
  `docker compose -p polycarpic-prod -f /opt/polycarpic/ops/current/compose/prod.yml --profile backup run --rm
  --no-deps -T --name polycarpic-prod-backup backup /usr/local/bin/backup.sh <mode>` with `POLY_POSTGRES_IMAGE` set.
  Timeout 3 h (nightly) or 30 min (premigration); on timeout `docker rm -f` the named container. **After** the
  container is gone (always, failures included), `t1`, and root appends `<t0> <t1> backup-<mode> ok|failed` to
  `/var/lib/polycarpic/state/jobs.log`. On failure it pings `/fail` itself (root reads the uploader's `heartbeat_url`
  file, curl `--config -`). On success it runs `systemctl start --no-block polycarpic-uploader.service`.
- `upload`: non-blocking `flock /run/polycarpic/upload.lock` (busy → exit 0, the minute timer overlaps). Reads
  `POLY_TOOLS_IMAGE` and `POLY_POSTGRES_IMAGE` (needed to render) from `/opt/polycarpic/images.env`, root 0644, lines
  `NAME=<ref>@sha256:<64 hex>`; missing → exit 3. Runs the `uploader` service the same way and returns its exit code.
- `backup list-premigration` and `backup fetch-premigration <name>`: R6.
- **Units** in `infra/backup/systemd/`: `polycarpic-backup.service` (oneshot, `ExecStart=/usr/local/sbin/polycarpic-ops
  backup nightly`, `TimeoutStartSec=4h`) with `.timer` (`OnCalendar=*-*-* 02:15:00 UTC`, `Persistent=true`), and
  `polycarpic-uploader.service` (oneshot, `ExecStart=… upload`) with `.timer` (`OnCalendar=minutely`).
  `provision.sh --stage host` installs the four files into `/etc/systemd/system/` and runs `daemon-reload`, **not
  enabled**. POLY-100's first-deploy enables both timers once `images.env` exists. POLY-103 adds none of these.
- `install.sh`'s bundle `PATHS` gains `infra/backup` and `infra/postgres/archive-wal.sh`.

## R6 — The premigration contract (POLY-100 builds against this)

- **Call:** as root on the box, `polycarpic-ops backup premigration`. Precondition: prod postgres running.
- **Success:** exit 0, and the last stdout line is exactly
  `premigration-set <TS> dump-<M>-<sys>-<TS>.age globals-<M>-<sys>-<TS>.age`. Both files are in
  `/srv/polycarpic/spool/premigration/`; `jobs.log` has `<t0> <t1> backup-premigration ok`; the uploader has been
  started. The deploy writes that line to `deploy.log` and migrates **only** on exit 0.
- **Failure:** 1 the backup failed (nothing published); 3 not ready; 4 the lock was not got in 30 min (a nightly run
  holds it). The deploy does not migrate on any of them and alerts.
- **Kept:** on the spool until 7 days after its `<TS>`, and never before its upload (R4 step 3); in the bucket for 35 days at
  `<instance>/<M>/premigration/<name>`.
- **Found by restore:** `ssh <user@host> sudo polycarpic-ops backup list-premigration` prints one line per complete
  set, oldest first: `<TS> <dump name> <globals name> uploaded|pending`. `… fetch-premigration <name>` checks the name
  against R2, opens `spool/premigration/<name>` with `O_NOFOLLOW`, requires a regular file, and writes its bytes to
  stdout. Nothing else on the box takes part, and neither command reads a secret.

## R7 — `infra/restore.sh` (runs on the laptop, decrypts there only)

```
restore.sh --identity <age key file> --premigration --from-box <user@host> [--set <TS>] [--read-credential <file> --bucket <name>]
restore.sh --identity <age key file> --read-credential <file> --bucket <name> (--base | --dump) [--instance <i>] [--before <UTC>]
```

- Decryption is `age -d -i <identity>` in a local process. The identity file is read only by that process, is never
  given to `ssh`, `scp` or `docker`, and must be mode 0600 or tighter, or the script exits 2. Only `list-premigration`
  and `fetch-premigration` are ever sent over ssh.
- **From the box:** the newest set, or `--set`. With `--read-credential`, each fetched file's sha256 must equal the
  bucket sibling of the **first** version of its object, and that object must have exactly one version; otherwise
  exit 4. Without it, or while the set is `pending`, it prints `WARN not cross-checked against the bucket` (§D1).
- **From the bucket:** B2's native API with the read key (`b2_list_file_versions`, `b2_download_file_by_id`), Python
  stdlib in `infra/backup/b2read.py`, no rclone. It picks a **version** (`fileId`), never a name. A name with more than
  one upload version, or any `hide` action, refuses the selection (exit 3) and prints each one with its upload time,
  unless `--before <UTC>` is given. Then it takes the newest version uploaded before that time and prints `WARN`. The
  sha256 sibling (same rule) must match the download, or exit 4.
- `--base`: the newest complete nightly set, then every `wal-<M>-<sys>-…` version from the base's start to the
  newest, chosen by the same rule. `--dump`: the dump and globals of the newest set.
- **Only into a throwaway Postgres:** it always starts its own container from the image in
  `infra/postgres/Dockerfile`'s `FROM` line, `--network none`, no bind mount, input by `docker cp` and
  `docker exec -i`. It reads no `PG*` variable and takes no host or port flag. Globals first, then `pg_restore` of the
  whole dump (never `--data-only`, so INFRA's F4 holds: `app.session_handle` comes with `session`), or the base with a
  `restore_command` reading the decrypted WAL inside the container. It prints the container name and the `docker exec`
  line to reach it. The decrypted files sit in a `mktemp -d` directory removed on exit, unless `--keep`.
- **Exit:** 0 restored; 1 restore failed; 2 usage; 3 selection refused; 4 integrity; 5 the box or bucket refused.

## R8 — `infra/drill.sh` (the §6.7 assertions)

`drill.sh --identity <file> --read-credential <file> --bucket <name> --box-credential <file> [--before <UTC>]
[--report <path>]`. It runs restore.sh's selection and restore code (one library, `infra/backup/restore-lib.sh`), both
`--base` and `--dump`, into two throwaway containers. Each check prints `PASS|FAIL|SKIP <id> <text>`:

| Id | Check |
|---|---|
| DR1 | Every chosen object has one version and no hide marker (else FAIL, listing them) |
| DR2 | Every download matches its sha256 sibling |
| DR3 | The globals file contains no `PASSWORD` and no `SCRAM-SHA-256$` |
| DR4 | The base recovers through the WAL and promotes; the newest WAL chosen is the newest listed |
| DR5 | After `roles.sql` is re-run on each instance: `DO $$BEGIN END$$` as poly_app fails with `permission denied for language plpgsql`; `query_to_xml('SELECT 1', true, false, '')` fails with `permission denied for function` (SQLSTATE 42501, the message asserted) |
| DR6 | Each role in `roles.sql` exists in both instances |
| DR7 | The row count of every FORCE-RLS table equals between the dump and the base restores |
| DR8 | No `public.session` row lacks an `app.session_handle` row (F4) |
| DR9 | Trial balance sums to zero per entity; the hash-chain verifier passes; the newest journal entry is within 20 min of the drill's start. SKIP while the schema has no ledger (today) |
| DR10 | With the box credential: deleting an object, uploading over an existing version, shortening a retention, changing the bucket default retention are each refused |

Last line `DRILL PASSED` (exit 0), `DRILL PASSED WITH SKIPS: <ids>` (exit 3) or `DRILL FAILED: <ids>` (exit 1); usage
2. `--report` writes the date, object names and fileIds, timings and results as markdown for the lead to file. The
GA gate (POLY-116) accepts exit 0 only. Scratch containers are removed on exit.

## R9 — `jobs.log` windows: root-written, and the status reader

- seceng's R-a is closed in this loop, not by the journal but by the same trust: **the windows are written by root.**
  The runner (R5) writes `backup-nightly` and `backup-premigration` lines; provision-check writes `provision-check-d3`
  as built. No container mounts `jobs.log` (it is not mounted today). Why not journal parsing: the runner's window
  covers the whole container lifetime by construction (written after `docker rm -f`), keeps the R7 line format and
  reader, and is testable without systemd as PID 1. The journal gives the same root trust and adds parsing of
  systemd message ids.
- `provision.sh`: `jobs.log` becomes `0:0` 0644 (an existing 10004-owned file is chowned). `last-dump` has no reader
  and is no longer created; an empty one is removed (`change:` line).
- **`infra/ops/status/05_backupdb.py`** changes: RED `jobs.log is not root-written` when the file's uid is not 0 or
  its mode has group or other write. `CAPS` gains `backup-premigration: 3600`; `backup-nightly` keeps the 6 h default.
  **`04_backup.py` does not change**: same path, same line 1; it now means "last complete nightly set" (R4).

## R10 — Compose, lint, provisioning

- `prod.yml` `backup`: add the `backup.sh` mount. `uploader`: replace `/srv/polycarpic/uploader-state:/state` with
  `/var/lib/polycarpic/state/last-upload:/state/last-upload`; add `../backup/upload.sh:/usr/local/bin/upload.sh:ro`,
  `/etc/polycarpic/ops.conf:/etc/uploader/ops.conf:ro` and `/etc/polycarpic/host.env:/etc/uploader/host.env:ro`. No
  new interpolated variable: compose interpolates every service whatever its profile, so a `${…:?}` here would fail
  every prod render and every deploy `up`. `postgres`: no change (archive-wal.sh is mounted already).
- `infra/lint/policy.json` mount allowlists follow; new lint rule: no service but `uploader` mounts anything under
  `/var/lib/polycarpic/state`, and that only as the one file.
- `provision.sh --stage host`: creates `.inflight/` in `wal/`, `dump/` and `premigration/` with the parent's owner and
  the same access and default ACLs; installs the units (R5); `--b2-endpoint <url>` writes `B2_S3_ENDPOINT=<url>`
  (pattern `^https://s3\.[a-z0-9-]+\.backblazeb2\.com$`) into `ops.conf`; `polycarpic-ops provision` forwards it (K2).
- `provision-check.sh`: H6 admits exactly `B2_BUCKET=` and `B2_S3_ENDPOINT=` lines; H7 covers the `.inflight/` dirs;
  H8's 10-minute rule covers all three `.inflight/` dirs and admits `.sha256` in `premigration/` only; new **H16**: the
  four unit files equal the bundle's copies (enabled-ness is POLY-100's line).

## R11 — Test seams (qa builds these; the builder builds to them)

- **`fake-b2`** (`tests/infra/backup/fake_b2.py`, stdlib, one process, two listeners). The uploader reaches it as
  `https://s3.eu-fake-001.backblazeb2.com` through a Docker network alias, with a test CA mounted over the tools
  image's CA bundle, so R10's endpoint pattern stays strict. restore and drill reach the native half through
  `POLY_B2_AUTH_URL`, the one override (laptop side, read key only): accepted only if it is `https://…` or
  `http://127.0.0.1:<port>`. (a) S3 single-part `PUT` checked against
  `Content-MD5` (400 `BadDigest`), answering `ETag: "<md5 hex>"` and storing a new **version**; every other S3 verb
  is 403 `AccessDenied`, the way a `writeFiles` key is answered. (b) B2 native `b2_authorize_account`,
  `b2_list_file_versions`, `b2_download_file_by_id`, served for the read key only. (c) `/_fake/…` control: mode
  `pass|etag|refuse|5xx|permissive` (permissive lets DR10's delete succeed), plant a version or a hide marker, and read
  the request log (`method key-id path`). One store holds both halves, so a round trip needs no copying.
- **`fake-hc`**: records each ping path. **Fake ssh** for restore: argv and stdin logged, the remote command run in
  the POLY-97 box fixture with the real ops bundle installed (POLY-98's pattern).
- **Scratch stack:** the derivative image built from `infra/postgres/Dockerfile`, the prod `postgresql.prod.conf` and
  `pg_hba.prod.conf`, `roles.sql` applied, poly_backup's password set; `backup` and `uploader` started from the
  **rendered `prod.yml` service definitions**, with only image refs and host paths overridden.
- **Spool watcher:** `inotifywait -m -r` on the spool (`CREATE`, `CLOSE_WRITE`, `MOVED_TO`) in a side container. Each
  created name must match R2 or the `.inflight` temporary form. Each closed file must start with the age header and
  must not contain the canary (a unique string the stack inserts into a FORCE-RLS table).

## R12 — The thin slice, then the rest

**Slice 0 (green before qa writes the rest):** `backup.sh nightly` against the scratch stack. It must publish exactly
three R2 names in `spool/dump/`, each giving 10005 an effective `r` (`getfacl`). The watcher must see no plaintext,
and the R1 stdout line must be printed. qa commits the stack, the watcher and this one test first; the builder makes
it green; qa's contract pins (anything here the builder needs pinned further) go in that same first commit.

**Security-bearing behaviours, each red on the fault, green on the fix. The fault is a mutant copy of the script
under test or a planted file; never a fake of the script under test:**

| # | Behaviour | Red on |
|---|---|---|
| T1 | No plaintext ever in the spool | a mutant that writes `pg_dump` output to `.inflight/` before encrypting; the watcher fails |
| T2 | All or nothing | `postgres` stopped during `pg_dump`: nothing published, `.inflight/` empty; a mutant without `pipefail` publishes a truncated file |
| T3 | Backup has no route out, no bucket key | from the rendered backup service: TCP to fake-b2 fails; the lint SC cases already cover the mounts. Red: the same network with `internal: false` connects |
| T4 | Uploader has no DB credential or route | TCP to `postgres:5432` from the rendered uploader fails; no `db_password_*` in its mounts |
| T5 | Mismatched checksum keeps the file and pings `/fail` | fake-b2 `etag`: exit 1, file still in the spool, `/fail` in fake-hc, no success ping, `last-upload` unchanged. Red: a mutant with `--ignore-checksum` |
| T6 | No HEAD, no list | fake-b2's log over a full run holds PUTs only, plus at most one refused DELETE after a T5 mismatch (M-U4). Red: a mutant without `--no-check-dest`, and one without `--s3-no-head` (M-U2, M-U3) |
| T7 | Refused upload fails loudly | fake-b2 `refuse`: exit 1, `/fail`, file kept |
| T8 | Uploader never ships a non-age or stray file | a planted plaintext file with a valid name, and a `wal-…` name in `dump/`: exit 2, no PUT for it, `/fail` |
| T9 | Decrypts only on the machine running it | restore `--premigration --from-box`: the fake ssh's argv and stdin logs hold no byte of the identity file and no `age -d`. Red: a mutant that runs `age -d` over ssh |
| T10 | Restore picks a version | fake-b2 holds two versions of the dump (the newer one poisoned: a different canary) and a hide marker: exit 3 listing them; with `--before` the older fileId is downloaded and the restored canary is the original. Red: a mutant that takes the newest |
| T11 | Restore only into a throwaway Postgres | with `PGHOST` pointing at a decoy Postgres: the decoy receives no connection. Red: a mutant honouring `PGHOST` |
| T12 | Windows are root-written | status RED when `jobs.log` is owned by 10004 or group-writable (fixture), OK when root 0644 |
| T13 | No chmod on spool files | after T1's run every published file gives 10005 `r`. Red: a mutant adding `chmod 0600` (H7 flags it too) |

## R13 — Acceptance text per stage

**99c (tests red).** Slice 0 first, as R12. Then each case red for its own missing behaviour, asserting the message and
exit code: R1's exit 3 per precondition, and the stdout line; R2's grammar over a table of good and bad names (each
`.backup`, `.history`, `.partial` form; a name with `/`; an 8-digit major); R3's target name and the `exists` failure;
R4's run order, sibling content, premigration skip and 7-day prune, the set-complete rule (WAL-only run: no
`last-upload` write, no ping), the in-place `last-upload` write, exit 3 per missing config; R5's argv to docker
(fake docker) per mode, the `jobs.log` line on ok, failed and timeout, lock busy → 4, no postgres → 3, the R6 line;
R6's list format and `fetch` refusing a symlink, a bad name and a non-regular file; R7's exit 2 on a 0644 identity,
the from-box cross-check (match, mismatch → 4, absent → WARN); R8's final line and exit for each outcome, DR3 failing
on a planted hash, DR10 failing under fake-b2 `permissive`; R9's status cases; R10's lint and provision cases; T1–T13.
**Criterion 3:** one round trip (backup → spool → uploader → fake-b2 → `restore.sh --base` and `--dump` → scratch)
with the canary row inserted **after** the base present after recovery.

**99d (build green).** Every 99c case green, none loosened; shellcheck clean over `infra/backup/*.sh`, `restore.sh`,
`drill.sh`, `archive-wal.sh`; the image and provision jobs green on CI; the INFRA and SECURITY edits (§E) in the same
PR quoting built output; the builder's unmeasured list in the build-green commit.

**Guards.** The new container suite ≤ 240 s locally and the ops unit tests ≤ 20 s `(unmeasured)`. Over either, an
addendum moves cases. The suites join existing jobs: `tests/infra/backup/**` in `image` (add it to
`vitest.image.config.ts`'s include); the ops tests in `provision`. No new job. The suite-time delta is reported at
build green.

## E — Doc passages (owners)

**INFRA (devops-engineer), each to say what R1–R10 say:** §2.2 the backup row (image: the Postgres derivative, not
"the app image or a tools image") and the uploader row (the tools image file, its mounts and environment); "How the
two halves hand over" (`.inflight/` publish, all or nothing, siblings in `premigration/` only); §2.3 the spool row,
the state row (`jobs.log` root-written by the runner and provision-check; `last-dump` gone; `last-upload` a single-file
mount meaning the last complete nightly set), `ops.conf` (two lines) and `/opt/polycarpic/` (`images.env`); §6.1
Nightly (names, gzip, the runner, the uploader start), Continuous (gzip, the system id, the history forms), the upload
step (R4's argv and what it checks, the refused DELETE, the 5 GiB limit); §6.2 rewritten to R2 and R4's object name;
§6.4 the bad-migration path to R6 and R7, with the box-side step as §L1 places it; §6.5 heartbeat sent only after a
complete nightly set, `heartbeat_url` is the full check URL, `backupdb` windows root-written; §6.7 to R8 (ids, SKIP,
exit codes); §8.10 step 2 to R7's CLI plus the F4 sentence; D-15's meaning of `last-upload`; OQ-INFRA-11 answered by
M-P1 and criterion 3.

**SECURITY (seceng):** C-79's detection text (root-written windows); C-73's restore text (the from-box cross-check,
`--network none` scratch, the DELETE rclone sends after a mismatch).

**ARCH (architect):** §7.2 edited in this commit: the uploader is the container, WAL is compressed then encrypted, the
windows are root-written.

## S — Positions for seceng (POLY-99b)

- **S1. Root-written windows instead of the journal (R9).** Same trust as the journal. The window spans the container's
  life because it is written after `docker rm -f`. Accept, or require journal timestamps.
- **S2. Compress before encrypt (R3, M-W).** Object sizes leak how compressible the data is, to read-key holders and
  B2 only. The alternative is a full bucket in about two days. Accept.
- **S3. rclone's DELETE after a mismatch (M-U4).** It cannot be turned off without `--ignore-checksum`. The key lacks
  `deleteFiles`, and Object Lock holds the version (POLY-105 measures the refusal). Accept.
- **S4. The from-box premigration path (R7, §D1)** trusts the spool unless the bucket cross-check runs.
- **S5. The scratch container is `--network none`, with no bind mount (R7).** A poisoned dump runs SQL as superuser
  inside the scratch. `COPY … TO PROGRAM` then gets a shell in that container and nothing beyond. Confirm that
  bound is enough.
- **S6. The runner reads `heartbeat_url` as root to ping `/fail` (R5)**, since backup has no route out.
- **S7. The uploader refuses any file without the age header (R4 step 2)**: a second line behind "plaintext never
  reaches the spool".
- **S8. `POLY_B2_AUTH_URL` (R11)** is honoured by `b2read.py` on the laptop, https or loopback only. Whoever sets the
  laptop's environment already holds the read key.

## D — Decision for the Principal

- **D1. The bad-migration restore from the box spool.** The mechanism: the encrypted file is copied from the box's
  spool to the laptop and decrypted there. The attacker's reach: someone already in control of the box could swap in
  a validly encrypted fake dump, since the box holds the public key. The restore then loads the fake into a throwaway
  container on the laptop, and that container has no network (S5). **Recommended, and ruled:** when the read key is
  given, the file must equal the bucket's first-uploaded version, or the restore stops. Without it, a WARN line. Cost:
  you need the read key at hand, and in the first minute after the deploy (before the upload) the check cannot run.
  The stronger option is to require the cross-check always: the restore then waits about a minute for the upload and
  never runs without the read key. Choose: (a) as ruled, (b) always required.

## L — Questions for the lead

- **L1.** INFRA §6.4 and §8.10 send the decrypted dump back to the box (`/srv/polycarpic/restore/`) and run
  `polycarpic-ops restore-apply` there. That step is not in the confirmed scope. This ruling stops at a throwaway
  Postgres on the laptop. Without it, the 60-minute bad-migration RTO has no built way back into prod. It needs a
  home: POLY-116, or a new issue before POLY-104.
