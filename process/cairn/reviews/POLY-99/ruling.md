# POLY-99 ruling: backup, uploader, restore, drill

Architect, 2026-11-22. This replaces the ruling at `9f87a180` whole. It folds in seceng-99's prep positions
(mapped in §S). Neither a review nor a test had used the earlier text. Tree read at
`d1dae3438f982f3b01cd8393cc84f0c10c05de2b`. Scope: the description, five
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

- Bash, `set -euo pipefail`, `ulimit -c 0`, shellcheck clean. There is no `tee` or process substitution in any
  pipe, so `pipefail` sees every stage. It runs in the Postgres derivative image (`POLY_POSTGRES_IMAGE`, the
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
  0 published; 1 a step failed; 2 usage; 3 precondition. It writes nothing outside its two spool directories and
  `/tmp`; every record is root's (R5).

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
  until the segment has been shipped and root has removed it (about one minute). The retry then uploads a second version of that
  name. That is one benign source of a two-version name; the checksum-mismatch retry (S3) is the second. Restore treats
  both as an alert (R8), not as silence. *(Correction, Addendum 2: this said "the one benign source".)*

## R4 — The uploader: `infra/backup/upload.sh` and the tools image

The uploader is the container that faces the internet, so it can **read** the spool and nothing more. It deletes
nothing, writes no spool or state file and sends no ping. It reports what it verified, and root acts on the report
(R5).

- **Image:** `infra/backup/tools.Dockerfile`: `debian:bookworm-slim@sha256:…`, `ca-certificates`, `curl`, and rclone
  **v1.76.0** (the measured version) from the official release zip, checked against a SHA-256 pinned in the file. It is
  built in the tests here; `build.yml` publishes and attests it in POLY-100 (POLY-95 F3).
- Bash, `set -euo pipefail`, `ulimit -c 0`, shellcheck clean, as `10005:10005` on `upload-net`. It holds
  `backup_store_credential` (two lines, POLY-97 R6) and nothing else secret, plus read-only mounts of the spool,
  `ops.conf` and `host.env` (the last two are world-readable already). It parses `B2_BUCKET`, `B2_S3_ENDPOINT` (R10's
  pattern) and `POLY_INSTANCE` by exact pattern, never by `source`. The rclone config (`type = s3`,
  `provider = Other`, `endpoint`, `no_check_bucket = true`, the two keys) is written to `/tmp/rclone.conf` under
  `umask 077` and passed with `--config`. No key goes into argv or the environment, and no script carries an endpoint
  override.
- **The exact upload argv**, one object per call, and the same for the `.sha256` sibling:
  `rclone --config /tmp/rclone.conf copyto <file> b2:<bucket>/<object> --no-check-dest --s3-no-head
  --s3-upload-cutoff 5G --retries 1 --low-level-retries 1`. Never `--ignore-checksum`, never `--s3-disable-checksum`.
  `b2-setup.py --probe` adopts this argv (F-probe2): its `rcat` becomes `copyto` of a 1-byte file with these flags.
  Single-part only, so `Content-MD5` covers the whole object and the response `ETag` is compared with it (M-U1, M-U4).
- **Object name:** `<POLY_INSTANCE>/<M>/<dir>/<spool name>`, where `<dir>` is the spool subdirectory, and the major
  in the path is the one in the name. The sibling `<object>.sha256` holds `<sha256 hex>  <spool name>\n`, built in
  `/tmp`.
- **Per run:** for `wal/`, then `dump/`, then `premigration/`, every regular file (never `.inflight/`, never a symlink,
  sorted by name):
  1. Not matching R2 for its directory: **stray**. Nothing is uploaded for it; exit 2 after the loop.
  2. Its first 22 bytes are not `age-encryption.org/v1\n`: refused as stray. This guards against a bug, not an
     attacker (S7). Over 5 GiB: refused (exit 1).
  3. In `premigration/` with a `.sha256` sibling present: already uploaded, so skipped.
  4. Compute the sha256 and upload the file, then the sibling.
  5. Print `verified <dir> <name> <sha256 hex>` to stdout.
  The first failed upload stops the run (exit 1).
- **Stdout** carries only `verified` lines. **Exit:** 0 done (nothing to do included); 1 an upload was refused or
  mismatched (S6(d)); 2 a stray file; 3 config missing (credential, endpoint, bucket, instance).

## R5 — The host job runner (root): `polycarpic-ops backup …` and `polycarpic-ops upload`

New modules `infra/ops/commands/backup.py` and `commands/upload.py`, in the POLY-98 house style (root, an injected
`ctx`, argv lists, a fixed env, every K-condition). **Root writes every record the status, the alerts and the restore
read:** `jobs.log`, `last-upload`, the premigration record and the spool siblings. The backup and uploader uids write
none of them (closes R-a and S8(a) of the POLY-98 review).

- `backup nightly|premigration`: `flock /run/polycarpic/backup.lock`, waiting at most 30 min (exit 4 if not got).
  Image = the running prod postgres container's `Config.Image` (as D3 takes it); none running → exit 3.
  `t0`; `docker rm -f polycarpic-prod-backup` (a stale one); then
  `docker compose -p polycarpic-prod -f /opt/polycarpic/ops/current/compose/prod.yml --profile backup run --rm
  --no-deps -T --name polycarpic-prod-backup backup /usr/local/bin/backup.sh <mode>` with `POLY_POSTGRES_IMAGE` set.
  Timeout 3 h (nightly) or 30 min (premigration); on timeout `docker rm -f` the named container. **After** the
  container is gone, failures included, root records `t1` and appends `<t0> <t1> backup-<mode> ok|failed` to
  `/var/lib/polycarpic/state/jobs.log`.
- On exit 0, root parses R1's `published` line, checks each named file is a regular file in the stated directory, and
  computes **its own** sha256 of each. It appends `<sha256> <dir>/<name>` lines to
  `/var/lib/polycarpic/state/spool.sha256` (root 0644; the **spool record**). A named file that is missing turns the
  run into `failed`.
- On failure it pings `<heartbeat_url>/fail`. Root reads `secrets/host/heartbeat_url` (R10 correction) (the backup check's full
  ping URL) and passes the URL to curl on stdin (`--config -`). On success it runs
  `systemctl start --no-block polycarpic-uploader.service`.
- `upload`: a non-blocking `flock /run/polycarpic/upload.lock` (busy → exit 0, since the minute timer overlaps).
  It reads `POLY_TOOLS_IMAGE` and `POLY_POSTGRES_IMAGE` (the second only to render) from `/opt/polycarpic/images.env`,
  root 0644, lines `NAME=<ref>@sha256:<64 hex>`; missing → exit 3. It runs the `uploader` service the same way and
  reads its stdout. For each `verified <dir> <name> <sha>` line (any other line: ignored and counted as a fault):
  - root recomputes the spool file's sha256. It must equal `<sha>`, and for `dump/` and `premigration/` it must also
    equal the spool record. On a mismatch the file is kept, the run counts as failed, and the reason is printed.
  - On a match: `wal/` and `dump/`, root deletes the file. `premigration/`, root writes the `.sha256` sibling beside
    it (the uploaded marker).
  - **Premigration prune:** a file with a sibling whose `<TS>` is more than 7 days old is deleted with its sibling by
    root. Spool-record lines for files that are gone are dropped when the record is rewritten (tmp + rename).
- **Nightly set complete** = in this run root confirmed a `globals-<M>-<sys>-<TS>`, and no `base` or `dump` of the
  same `<sys>-<TS>` is left in `dump/`. Only then does root rewrite `last-upload` (POLY-98 R7 format: line 1
  `YYYY-MM-DDTHH:MM:SSZ`, then the three object names; tmp + rename, root 0644) and ping `<heartbeat_url>`. WAL
  uploads do neither, because WAL alone would otherwise keep the 26-hour alert and the heartbeat green while the
  nightly set failed.
- Uploader exit 1 or 2, or any root-side mismatch: ping `/fail`, exit 1. A failed ping does not change the exit code.
- `backup list-premigration` and `backup fetch-premigration <name>`: R6.
- **Units** in `infra/backup/systemd/`:
  - `polycarpic-backup.service`: oneshot, `ExecStart=/usr/local/sbin/polycarpic-ops backup nightly`,
    `TimeoutStartSec=4h`, with a `.timer` set to `OnCalendar=*-*-* 02:15:00 UTC` and `Persistent=true`.
  - `polycarpic-uploader.service`: oneshot, `ExecStart=… upload`, with a `.timer` set to `OnCalendar=minutely`.
  - `provision.sh --stage host` installs the four files into `/etc/systemd/system/` and runs `daemon-reload`, **not
    enabled**. POLY-100's first-deploy enables both timers once `images.env` exists. POLY-103 adds none of these.
- `install.sh`'s bundle `PATHS` gains `infra/backup` and `infra/postgres/archive-wal.sh`.

## R6 — The premigration contract (POLY-100 builds against this)

- **Call:** as root on the box, `polycarpic-ops backup premigration`. Precondition: prod postgres running.
- **Success:** exit 0, and the last stdout line is exactly
  `premigration-set <TS> dump-<M>-<sys>-<TS>.age globals-<M>-<sys>-<TS>.age`. At that point:
  - both files are in `/srv/polycarpic/spool/premigration/`;
  - root has recorded their sha256 in the spool record;
  - `jobs.log` has `<t0> <t1> backup-premigration ok`;
  - the uploader has been started.
  The deploy writes that line to `deploy.log` and migrates **only** on exit 0.
- **Failure:** 1 the backup failed (nothing published); 3 not ready; 4 the lock was not got in 30 min (a nightly run
  holds it). The deploy does not migrate on any of them and alerts.
- **Kept:** on the spool until 7 days after its `<TS>`, and never before its upload (R5); in the bucket for 35 days at
  `<instance>/<M>/premigration/<name>`.
- **Found by restore:**
  - `ssh <user@host> sudo polycarpic-ops backup list-premigration` prints one line per complete set, oldest first:
    `<TS> <dump name> <dump sha256> <globals name> <globals sha256> uploaded|pending`. The sha256 values come from
    root's spool record.
  - `… fetch-premigration <name>` checks the name against R2, opens `spool/premigration/<name>` with `O_NOFOLLOW`,
    requires a regular file, and writes its bytes to stdout.
  - Nothing else on the box takes part, and neither command reads a secret.

## R7 — `infra/restore.sh` (runs on the laptop, decrypts there only)

```
restore.sh --identity <age key file> --premigration --from-box <user@host> [--set <TS>] [--read-credential <file> --bucket <name>]
restore.sh --identity <age key file> --read-credential <file> --bucket <name> (--base | --dump) [--instance <i>] [--before <UTC>]
```

- **Process hygiene:** `ulimit -c 0`, `umask 077`, `set -euo pipefail`. The identity file is passed by path only,
  never by argv to a child other than `age -d -i <path>`, never in the environment. It must be mode 0600 or tighter,
  or the script exits 2. Decryption is a local `age -d` process.
- **ssh:** `ssh -a -x -o ForwardAgent=no -o ClearAllForwardings=yes -o BatchMode=yes`. Only `list-premigration` and
  `fetch-premigration <name>` are ever sent.
  - Every name and TS that comes back from the box is checked against R2 and `^[0-9]{8}T[0-9]{6}Z$` **before** any
    command uses it. A line that fails is refused (exit 5): through `sudo`, a box-supplied name is input to root.
  - Bytes outside 0x20–0x7E are replaced with `?` before any box output is printed.
- **From the box:** the newest set, or `--set`. The sha256 of each fetched file must equal the root spool record that
  `list-premigration` printed, or exit 4. With `--read-credential`, the file must also equal the bucket sibling of the
  **first** version of its object, and that object must have exactly one version, or exit 4. Without that check, or
  while the set is `pending`, it prints `WARN not cross-checked against the bucket` (§D1).
- **From the bucket:** B2's native API with the read key (`b2_list_file_versions`, `b2_download_file_by_id`), Python
  stdlib in `infra/backup/b2read.py`, no rclone. It picks a **version** (`fileId`), never a name.
  - A name with more than one upload version, or any `hide` action, refuses the selection (exit 3). Each version is
    printed with its upload time.
  - With `--before <UTC>`, it takes the newest version uploaded before that time instead, and prints `WARN`.
  - The sha256 sibling, chosen by the same rule, must match the download, or exit 4.
- **Replay check** (seceng R3), on every chosen artifact:
  - The time inside the archive must lie within 15 min of the name's `<TS>`, or exit 4. That time is
    `pg_restore -l`'s "Archive created at" for a dump, and `backup_label`'s `START TIME` for a base.
  - An upload time earlier than `<TS>` is also exit 4.
  - An upload more than 48 h after `<TS>` prints `WARN late upload`.
- `--base`: the newest complete nightly set, then every `wal-<M>-<sys>-…` version from the base's start to the
  newest, chosen by the same rule. `--dump`: the dump and globals of the newest set.
- **Only into a throwaway Postgres:** it always starts its own **separate cluster** in a container, never a database
  inside a running cluster:
  - The image comes from `infra/postgres/Dockerfile`'s `FROM` line.
  - The container runs with `--network none --cap-drop ALL --security-opt no-new-privileges --user 999:999`, with no
    bind mount and no secret. Input goes in by `docker cp` and `docker exec -i`. That this set starts Postgres is
    `(unmeasured)`, and qa pins it.
  - It reads no `PG*` variable and takes no host or port flag.
  - Globals go in first, then `pg_restore` of the whole dump. It is never `--data-only`, so INFRA's F4 holds:
    `app.session_handle` comes with `session`. A base is restored with a `restore_command` reading the decrypted WAL
    inside the container.
  - It prints the container name and the `docker exec` line to reach it.
  - The decrypted files sit in a `mktemp -d` directory, removed on exit unless `--keep`.
- **Exit:** 0 restored; 1 restore failed; 2 usage; 3 selection refused; 4 integrity or replay; 5 the box or bucket
  refused, or a box line failed validation.
- *(Correction, from seceng's build review F1 and F2, `build-review.md` @ `78b0b0a6`.)*
  - **A stray bucket key is skipped, not fatal.** A record whose key or `fileId` fails C5 is left out, is never used
    as a path or key, and is counted. `restore.sh` prints `WARN <n> stray objects in the bucket` and goes on.
    `drill.sh` fails DR1, giving the count.
  - **A two-version name is passable (C9).** `--before` cannot pass one, because every version up to the cutoff
    still counts. So:
    - the refusal lists `version <fileId> <upload time> <key> sibling yes|no`, with `hide marker` where one exists;
    - a new repeatable `--accept-version <fileId>` takes that version for its name and prints `WARN accepting
      version …`;
    - a `fileId` belonging to no chosen name exits 2;
    - the sibling check still applies, so accepting a bad version exits 4;
    - this holds for WAL keys under `--base` too;
    - the drill stays FAIL DR1.
  - **The scratch has a bounded life (F4).**
    - It runs `docker run -d --rm`, labelled `polycarpic.restore=scratch`, with `sleep` set from `--hours <n>`
      (default 8, range 1–24, outside that exit 2).
    - It prints its end time and the cleanup command.
    - `restore.sh --cleanup` removes every labelled scratch (`docker rm -f -v`) and prints the count.
    - Every run first warns about any labelled scratch still present.
    - `--keep` still means only the decrypt directory.

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
| DR8 | No `public.session` row lacks an `app.session_handle` row (F4). *(Correction, verdict read:)* FAIL, not PASS, when either table is absent: a check with nothing to check fails loudly |
| DR9 | Trial balance sums to zero per entity; the hash-chain verifier passes; the newest journal entry is within 20 min of the drill's start. SKIP while the schema has no ledger (today) |
| DR11 | R7's replay check on every chosen artifact (archive time vs name vs upload time) |
| DR10 | With the box credential: deleting an object, uploading over an existing version, shortening a retention, changing the bucket default retention are each refused |

Last line `DRILL PASSED` (exit 0), `DRILL PASSED WITH SKIPS: <ids>` (exit 3) or `DRILL FAILED: <ids>` (exit 1); usage
2. `--report` writes the date, timings and results as markdown for the lead to file. *(Correction, F3:)* per object it
gives only kind, `<TS>`, upload time and sibling sha256, and no bucket name, fileId, system id or object key. The
fileIds stay in the terminal output, on **stderr** *(correction, F5)*. Stdout carries only the check lines, the
scratch name and the verdict, so a redirected drill bypasses nothing. The
GA gate (POLY-116) accepts exit 0 only. Scratch containers are removed on exit.

## R9 — Records root writes, and the status readers

- seceng's R-a is closed in this loop by root writing the windows. The journal is not parsed for them:
  - The runner (R5) writes the `backup-nightly` and `backup-premigration` lines; provision-check writes
    `provision-check-d3`, as built.
  - No container mounts anything under `/var/lib/polycarpic/state` (R10).
  - Why not the journal: it carries the same root trust. The runner's window covers the whole life of the container by
    construction, because it is written after `docker rm -f`. It keeps POLY-98 R7's line format and reader, and it is
    testable without systemd as PID 1.
- `provision.sh`: `jobs.log` and `last-upload` become `0:0` 0644 (an existing file is chowned); it also creates an
  empty `spool.sha256`, `0:0` 0644. `last-dump` has no reader and is no longer created; an empty one is removed (with a
  `change:` line).
- **`infra/ops/status/05_backupdb.py`:** RED `jobs.log is not root-written` when the file's uid is not 0 or its mode
  has group or other write. `CAPS` gains `backup-premigration: 3600`; `backup-nightly` keeps the 6 h default.
- **`infra/ops/status/04_backup.py`:** the same check on `last-upload`, which is RED `last-upload is not root-written`.
  Its path and its line 1 do not change, but line 1 now means "the last complete nightly set" (R5).

## R10 — Compose, lint, provisioning

- **`prod.yml`, `backup`:** add the `backup.sh` mount, and `tmpfs` `/tmp:size=1m` (enough for the passfile, too small to
  stage a dump: seceng B1).
- **`prod.yml`, `uploader`:**
  - Mount `/srv/polycarpic/spool:/spool:ro`.
  - Drop the `/srv/polycarpic/uploader-state` mount and the `heartbeat_url` secret: root pings (R5).
  - *(Correction: R10 left out a consequence of dropping that mount; amended by seceng H-1, `ruling-review.md` @
    `58cdecef`.)* `heartbeat_url` is a **host-only secret**.
    - **Where:** `/etc/polycarpic/secrets/host/heartbeat_url`, `root:root` 0400, in `secrets/host/`, `root:root`
      0700, which `provision.sh` creates. The group is root, not 10005: an escaped uploader carries gid 10005.
      `provision.sh` moves a file left under `uploader/`, keeps its value and never prints it (with a `change:`
      line).
    - **Who reads it:** root only, meaning R5's runner and H13, at the new path. No service mounts it, so it has no
      compose entry.
    - **How it is written:** `infra/ops/lib/secrets.py` gains `HOST_ONLY = {"heartbeat_url": "host"}`.
      `set-secret` writes that name and no other beyond the compose-derived set, still under the https check.
    - **How it is accounted for:**
      - `list-secrets` lists it, with its path and mode.
      - provision-check H6 mirrors the constant in shell, and a test asserts the two copies are equal.
      - H6 expects `root:root` 0400 for `HOST_ONLY` entries and `root:<gid>` 0440 for the rest. It fails on a
        `heartbeat_url` under `uploader/`.
    - **Guards on growth:**
      - a unit test pins `HOST_ONLY` exactly (any addition comes to seceng);
      - a test asserts that no `HOST_ONLY` name is compose-mounted;
      - a compose-policy lint rule refuses any service volume or secret sourced under `/etc/polycarpic/secrets/host/`.
    - **Tests:**
      - The two `test_set_secret` cases expect the new path.
      - A host-only name outside `HOST_ONLY` exits 2.
      - H6 fails on a mismatched constant, on `root:10005` 0440, and on the file under `uploader/`.
      - H6 passes at `root:root` 0400 under `host/`.
      - The move keeps the value, which appears in no output (swept).
      - In the rendered uploader, `/run/secrets/heartbeat_url` is absent.
  - Add `../backup/upload.sh:/usr/local/bin/upload.sh:ro`, `/etc/polycarpic/ops.conf:/etc/uploader/ops.conf:ro` and
    `/etc/polycarpic/host.env:/etc/uploader/host.env:ro`.
  - `tmpfs` `/tmp:size=1m`, which holds the rclone config and the sibling.
  - No new interpolated variable. Compose interpolates every service whatever its profile, so a `${…:?}` here would
    fail every prod render and every deploy `up`.
- **`backup`, `uploader` and `postgres`:** `ulimits: {core: 0}`. The root disk is not on LUKS, and a core file holds
  plaintext (seceng B3).
- **`infra/lint/policy.json`:** the mount allowlists follow. New rules:
  - no service mounts anything under `/var/lib/polycarpic/state`;
  - `uploader`'s spool mount is read-only;
  - those three services set `core: 0`;
  - `backup`'s and `uploader`'s `/tmp` carry a size of at most 1m.
- **`provision.sh --stage host`:**
  - The spool ACL for 10005 becomes **`r-x`**, both access and default, on `wal/`, `dump/` and `premigration/` and
    their `.inflight/`. It is no longer `rwx`: only root deletes. 10005's effective rights on a created file are
    then `r--` (unmeasured for `r-x`; POLY-97 M1 measured `rwx`; qa pins it).
  - It creates `.inflight/` in each of the three, with the parent's owner and ACLs.
  - It installs the units (R5).
  - `--b2-endpoint <url>` writes `B2_S3_ENDPOINT=<url>` into `ops.conf`, matching
    `^https://s3\.[a-z0-9-]+\.backblazeb2\.com$`. `polycarpic-ops provision` forwards the flag (K2).
- **`provision-check.sh`:**
  - H6 admits exactly the `B2_BUCKET=` and `B2_S3_ENDPOINT=` lines.
  - H7 asserts the new ACLs and covers the `.inflight/` dirs.
  - H8's 10-minute rule covers all three `.inflight/` dirs, and admits `.sha256` in `premigration/` only.
  - New **H16**: the four unit files equal the bundle's copies. Whether they are enabled is POLY-100's line.

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
  - *(Correction, verdict read; measured.)* After `roles.sql`, the stack applies the real migration chain from
    `packages/db/migrations`. Each file runs in journal order as `poly_owner`, one transaction per file, after the
    `drizzle` schema and tracking table are created.
    - Measured: twice, on `polycarpic-postgres:ci`, 0.39 s and 0.44 s for the whole chain, with
      `public.session` and `app.session_handle` present after it.
    - The stack plants one `session` row with its handle before the set is taken. So DR8, DR7 (real FORCE-RLS tables)
      and INFRA's F4 run on real tables.
    - Tests:
      - the happy drill passes DR8 with one session counted;
      - a mutant restore that loads the dump data-only, or deletes the handle in the scratch, makes DR8 FAIL;
      - with the tables dropped from a scratch, DR8 FAILs and names them.
    - Cost: under 1 s of setup, plus a slightly larger set. No new restore.
- **Spool watcher:** `inotifywait -m -r` on the spool and on the backup container's `/tmp` (`CREATE`, `CLOSE_WRITE`,
  `MOVED_TO`) in a side container. In `/tmp`, nothing but the passfile may appear. In the spool, each
  created name must match R2 or the `.inflight` temporary form. Each closed file must start with the age header and
  must not contain the canary (a unique string the stack inserts into a FORCE-RLS table).

## R12 — The thin slice, then the rest

**Slice 0 (green before qa writes the rest):** `backup.sh nightly` against the scratch stack. It must publish exactly
three R2 names in `spool/dump/`, each giving 10005 an effective `r--` (`getfacl`). The watcher must see no
plaintext, and the R1 stdout line must be printed. qa commits the stack, the watcher and this one test first; the builder makes
it green; qa's contract pins (anything here the builder needs pinned further) go in that same first commit.

**Security-bearing behaviours, each red on the fault, green on the fix. The fault is a mutant copy of the script
under test or a planted file; never a fake of the script under test:**

| # | Behaviour | Red on |
|---|---|---|
| T1 | No plaintext ever in the spool | a mutant that writes `pg_dump` output to `.inflight/` before encrypting; the watcher fails |
| T2 | All or nothing | `postgres` stopped during `pg_dump`: nothing published, `.inflight/` empty; a mutant without `pipefail` publishes a truncated file |
| T3 | Backup has no route out, no bucket key | from the rendered backup service: TCP to fake-b2 fails; the lint SC cases already cover the mounts. Red: the same network with `internal: false` connects |
| T4 | Uploader has no DB credential or route | TCP to `postgres:5432` from the rendered uploader fails; no `db_password_*` in its mounts |
| T5 | Mismatched checksum keeps the file and pings `/fail` | fake-b2 `etag`: uploader exit 1, runner exit 1, file still in the spool, `/fail` in fake-hc, no success ping, `last-upload` unchanged. Red: a mutant uploader with `--ignore-checksum` |
| T6 | No HEAD, no list | fake-b2's log over a full run holds PUTs only, plus at most one refused DELETE after a T5 mismatch (M-U4). Red: a mutant without `--no-check-dest`, and one without `--s3-no-head` (M-U2, M-U3) |
| T7 | Refused upload fails loudly | fake-b2 `refuse`: exit 1, `/fail`, file kept |
| T8 | Uploader never ships a non-age or stray file | a planted plaintext file with a valid name, and a `wal-…` name in `dump/`: exit 2, no PUT for it, `/fail` |
| T9 | Decrypts only on the machine running it | restore `--premigration --from-box`: the fake ssh's argv and stdin logs hold no byte of the identity file and no `age -d`. Red: a mutant that runs `age -d` over ssh |
| T10 | Restore picks a version | fake-b2 holds two versions of the dump (the newer one poisoned: a different canary) and a hide marker: exit 3 listing them; with `--before` the older fileId is downloaded and the restored canary is the original. Red: a mutant that takes the newest |
| T11 | Restore only into a throwaway Postgres | with `PGHOST` pointing at a decoy Postgres: the decoy receives no connection. Red: a mutant honouring `PGHOST` |
| T12 | Windows are root-written | status RED when `jobs.log` is owned by 10004 or group-writable (fixture), OK when root 0644 |
| T13 | No chmod on spool files | after T1's run every published file gives 10005 `r--`. Red: a mutant adding `chmod 0600` (H7 flags it too) |
| T14 | The uploader cannot change the spool | from the rendered uploader service: creating, replacing or deleting a spool file fails (read-only mount, `r-x` ACL). Red: the same run with the mount `rw` |
| T15 | Root deletes only what it verified | a fake uploader prints `verified` with a wrong sha, or for a file whose bytes differ from the spool record: root keeps the file, runner exit 1, `/fail`. (This fakes the uploader, which is not the unit under test here; the runner is.) Red: a mutant runner that deletes without the comparison |
| T16 | Box-supplied names are validated | the box fixture's `list-premigration` returns a name carrying `;`, a newline or `$(…)`: restore exits 5 and sends no further ssh command. Red: a mutant without the check runs the name |
| T17 | Replay is detected | a dump whose "Archive created at" is 2 h before its name's `<TS>`: restore exits 4. Red: a mutant without the check restores it |

## R13 — Acceptance text per stage

**99c (tests red).** Slice 0 first, as R12. Then each case red for its own missing behaviour, asserting the message and
exit code: R1's exit 3 per precondition, and the stdout line; R2's grammar over a table of good and bad names (each
`.backup`, `.history`, `.partial` form; a name with `/`; an 8-digit major); R3's target name and the `exists` failure;
R4's run order, the `verified` lines, sibling content, the premigration skip, exit 3 per missing config, the rclone
config file at 0600 with no key in argv or env; R5's argv to docker (fake docker) per mode, the `jobs.log` line on ok,
failed and timeout, lock busy → 4, no postgres → 3, the spool record, the R6 line, deletion only after the sha
comparison, the 7-day prune, the set-complete rule (WAL-only run: no `last-upload` write, no ping), the pings;
R6's list format and `fetch` refusing a symlink, a bad name and a non-regular file; R7's exit 2 on a 0644 identity,
the ssh options, control characters replaced, the root-record check, the bucket cross-check (match, mismatch → 4,
absent → WARN), the scratch container's flags; R8's final line and exit for each outcome, DR3 failing
on a planted hash, DR10 failing under fake-b2 `permissive`; R9's status cases; R10's lint and provision cases; T1–T17.
**Criterion 3:** one round trip (backup → spool → uploader → fake-b2 → `restore.sh --base` and `--dump` → scratch)
with the canary row inserted **after** the base present after recovery.

**99d (build green).** Every 99c case green, none loosened; shellcheck clean over `infra/backup/*.sh`, `restore.sh`,
`drill.sh`, `archive-wal.sh`; the image and provision jobs green on CI; the INFRA and SECURITY edits (§E) in the same
PR quoting built output; the builder's unmeasured list in the build-green commit.

**Guards.** *(Correction. The 240 s guard was set without a measurement. This text replaces it, and replaces the
480 s figure in the POLY-99 comment @ `e585d393`.)*

*Measured:* the red run @ `96726662`, per file (qa-99):

| file | backup | uploader | restore | slice0 | drill | fake-b2 | roundtrip |
|---|---|---|---|---|---|---|---|
| wall time | 82 s | 67 s | 66 s | 13 s | 7 s | 5 s | 4 s |

That is 244 s in the files and 358 s wall, and restore, drill and roundtrip ran setup only. Green as written, the suite
would take 15–20 min `(unmeasured, qa's estimate)`. The cost is not stack setup (about 10 s up and 4 s down per file).
It is the per-case container work: roughly one scratch restore of 15–25 s in each of restore's 46 cases, two per
drill run, and a backup of 3–4 s per backup case.

*The design:*
- **(a) One stack, one real set.** A vitest `globalSetup` does these once per suite:
  - builds the two images;
  - brings the stack up;
  - takes one nightly set and one premigration set;
  - uploads them to fake-b2;
  - writes them read-only to a shared fixture directory.

  Every file reuses the stack and those sets. A file that changes stack state (spool, fake mode) restores it in its
  own `afterEach`. Only `backup.test.ts` takes its own backups.
- **(b) A refusal exits before any scratch.** Each refusal case asserts its code before `docker run` of a scratch;
  the fake docker log shows no scratch started. The cases are R7's usage, validation, selection, integrity, C5, C7,
  C8 and C12. They cost under 1 s each.
- **(c) Real scratch restores: at most 9 in the whole suite.**
  - roundtrip: `--base`, `--dump` and `--premigration`, 3. T11's decoy rides on the `--dump` one, and C6's flags
    are asserted on all three.
  - T10's `--before`: 1.
  - T17's mutant: 1.
  - drill: one happy run and one run carrying every planted fault at once (hash, permissive fake, two versions,
    replay). The second run asserts each FAIL id from its one output. Together 4.
- **(d) One container run per table.** R2's good and bad names are all planted together. One uploader run then
  asserts shipped or stray per name. The same goes for backup's precondition table where the cases share a fixture.

*Targets:*
- Locally, the whole `tests/infra/backup` directory green: **≤ 420 s** on this Mac, one suite at a time.
- The ops unit tests: ≤ 20 s.
- qa reports per-file times at the build-green gate. Over the target, cases are consolidated further, never dropped
  or loosened, and the lead hears it at once.

*CI:*
- The suite joins the existing `image` job as one more step, and no new job is added.
- That step runs only when a new `backup` output of `infra/ci/changes.mjs` is true. It is true for `infra/backup/`,
  `infra/restore.sh`, `infra/drill.sh`, `infra/postgres/` (the whole directory), `infra/compose/prod.yml`,
  `infra/ops/commands/backup.py`, `infra/ops/commands/upload.py`, `packages/db/sql/roles.sql` and
  `tests/infra/backup/`.
- *(Correction: this list first named only `archive-wal.sh` under `infra/postgres/`, and left out `roles.sql`.)*
  The stack applies `roles.sql`, poly_backup's grants come from it, and the drill's DR5 and DR6 read it. The stack is
  also built from the derivative `Dockerfile`, `postgresql.prod.conf` and `pg_hba.prod.conf`. A change to any of
  them can break the suite.
- **Before:**
  - `image` takes 306 s.
- **After:**
  - on a PR that touches none of those paths, `image` is unchanged at 306 s;
  - on one that does, it takes about 306 s plus the suite, target ≤ 306 + 420 s `(unmeasured on CI;` the builder
    reports the CI figure at build green`)`.
- Why not a separate job: CI's wall clock would shrink only on backup PRs, against the house rule. Gated this way,
  most PRs pay nothing.
- The suite's fixed subnets mean it cannot run alongside another container suite on one daemon. The job's steps are
  sequential, so that holds.

## E — Doc passages (owners)

**INFRA (devops-engineer), each to say what R1–R10 say:** §2.2 the backup row (image: the Postgres derivative, not
"the app image or a tools image") and the uploader row (the tools image file, its mounts and environment); "How the
two halves hand over" (`.inflight/` publish, all or nothing; the uploader reads only and root deletes after its
comparison; siblings in `premigration/` only); §2.3 the spool row (10005 `r-x`), the state row (`jobs.log`,
`last-upload` and `spool.sha256` written by root only, mounted nowhere; `last-dump` gone; `last-upload` meaning the last
complete nightly set), `ops.conf` (two lines) and `/opt/polycarpic/` (`images.env`); §6.1
Nightly (names, gzip, the runner, the uploader start), Continuous (gzip, the system id, the history forms), the upload
step (R4's argv and what it checks, the refused DELETE, the 5 GiB limit); §6.2 rewritten to R2 and R4's object name;
§6.4 the bad-migration path to R6 and R7, with the box-side step as §L1 and §D2 place it; §6.5 root sends the
backup heartbeat, only after a complete nightly set, `heartbeat_url` is the full check URL and no container holds it,
`backupdb` windows root-written; §6.7 to R8 (ids, SKIP,
exit codes); §8.10 step 2 to R7's CLI plus the F4 sentence; D-15's meaning of `last-upload`; OQ-INFRA-11 answered by
M-P1 and criterion 3.

**SECURITY (seceng):** C-79's detection text (root-written windows); C-73's restore text (the root-record and bucket
cross-checks, the scratch cluster's isolation, the replay check, the DELETE rclone sends after a mismatch, the
read-only uploader).

**ARCH (architect):** §7.2 edited in this commit: the uploader is the container, WAL is compressed then encrypted, the
windows are root-written.

## S — Positions for seceng (POLY-99b)

Seceng's prep positions, and how this ruling carries each:

| Prep | Carried | Where |
|---|---|---|
| B1 no staging room in backup; the watcher also covers `/tmp` | yes: `/tmp:size=1m`, read-only rootfs, watcher on `/tmp` | R10, R11 |
| B2 exit status of every stage; `.partial` then rename | yes: there is no `tee` in any pipe; `pipefail`; `.inflight/` then `ln`, all or nothing | R1, T2 |
| B3 no core dumps | yes: `core: 0` on three services, `ulimit -c 0` in the scripts | R4, R7, R10 |
| B4 completeness check in the pipe (`tee` into `pg_restore`) | **not adopted.** A `tee` process substitution is exactly the stage `pipefail` misses (B2). `pg_dump`'s exit status already covers a truncated stream (T2). Parsing a non-seekable custom archive is unmeasured. Root computes the ciphertext sha256 itself after the container exits | R5 |
| B5 root writes `jobs.log`, `last-upload` and the premigration record | yes | R5, R9 |
| U1 uploader read-only; root prunes after comparing with the record | yes | R4, R5, R10 |
| U2 names by grammar; the age header check is a bug guard | yes | R4 |
| U3 verify with no HEAD and no list; single-part; the fake enforces it | yes, measured (M-U1–M-U6) | R4, R11 |
| U4 no secret in argv or env; rclone config in tmpfs 0600 | yes | R4 |
| R1 no forwarding; validate box names; strip control characters; hygiene | yes. Streaming into `restore-apply` belongs to §L1 / §D2 | R7 |
| R2 a separate throwaway cluster, never a database inside prod | yes, for the laptop. Binding on whoever builds the box side (§L1) | R7 |
| R3 internal time vs name vs upload time | yes | R7, DR11 |
| R4 check the from-box sha256 against root's record | yes | R6, R7 |
| Off-box daily list check | the Principal's call | §D3 |

Positions left for the review:

- **S1. Root-written windows instead of the journal (R9).** They carry the same trust as the journal, and the window
  spans the container's life. Accept, or require journal timestamps.
- **S2. Compress before encrypting (R3, M-W).** Object sizes reveal how compressible the data is, but only to read-key
  holders and to B2. The alternative is a full bucket in about two days. Accept.
- **S3. rclone's DELETE after a mismatch (M-U4).** It cannot be turned off without `--ignore-checksum`. The key lacks
  `deleteFiles`, and Object Lock holds the version (POLY-105 measures the refusal). Accept.
- **S4. The from-box path (R7, §D1)** is checked against root's record always, and against the bucket when the read
  key is given.
- **S5. The scratch cluster (R7)** runs with no network, no capabilities, no bind mount and no secret. A poisoned
  dump runs SQL as superuser there; `COPY … TO PROGRAM` reaches a shell in that container and nothing beyond.
  Confirm that bound is enough.
- **S6. Root reads `heartbeat_url` to ping (R5).** No container holds it any more.
- **S7. The age header check (R4 step 2)** is a guard against a bug, not against an attacker. An attacker on the box
  can encrypt to the public key.
- **S8. `POLY_B2_AUTH_URL` (R11)** is honoured by `b2read.py` on the laptop only, over https or loopback. Whoever sets
  the laptop's environment already holds the read key.

## D — Decisions for the Principal

- **D1. The bad-migration restore from the box spool.**
  - **The mechanism:** the encrypted file is copied from the box's spool to the laptop and decrypted there. Its
    sha256 must equal the record root wrote when the backup finished.
  - **The attacker's reach:** someone already in control of root on the box could swap both the file and the record
    for a validly encrypted fake dump. The fake then loads into a throwaway container with no network on the laptop
    (S5).
  - **Ruled:** when the read key is given, the file must also equal the bucket's first-uploaded version, or the
    restore stops. Without it, a WARN.
  - **The stronger option:** require the bucket check always. The cost is about a minute's wait for the upload after
    the deploy, and no restore without the read key.
  - **Choose:** (a) as ruled; (b) always required.
- **D2. Where the decrypted premigration data may exist on the box (with §L1).** Q8 (2026-11-08) says no plaintext
  dump is written on the box. INFRA §6.4 sends one there as a file. Two ways through:
  - **(a) Stream, seceng's proposal:** the laptop decrypts and streams the restore over ssh stdin into a throwaway
    cluster on the box. There is no plaintext file, but the scratch cluster's data files are plaintext on the LUKS
    volume until it is destroyed.
  - **(b) Laptop only:** no plaintext reaches the box in any form, and the comparison is done on the laptop's scratch
    (this ruling). Copying corrected rows back into prod then needs its own audited path.
  - **Recommended: (a)**, provided the scratch cluster is destroyed in the same session. Its exposure is the same as
    prod's own data files on the same volume.
- **D3. A daily off-box check of the bucket listing** (seceng). A scheduled job outside the box, holding a key with
  `listFiles` only, would see hide markers and a silent uploader daily rather than at the monthly drill.
  - The cost: GitHub would hold a bucket credential (TB-12). It reveals object names, not contents.
  - **What it would catch that nothing else does:** an uploader that prints `verified` without uploading. Root
    then deletes the spool copy, and the gap shows only at the next listing. Today that listing is the monthly drill.
  - **Recommended:** not before POLY-103 decides alerting, and only with seceng's ruling on TB-12. Until then, the
    26-hour heartbeat (R5) catches an uploader that stops reporting, but not one that lies.
  - **Choose:** (a) defer to POLY-103; (b) add it now as a new issue.

## L — Questions for the lead

- **L1.** INFRA §6.4 and §8.10 put decrypted data on the box and run `polycarpic-ops restore-apply` there. That step
  is not in the confirmed scope, and this ruling stops at a throwaway cluster on the laptop. Without it, the
  60-minute bad-migration recovery has no built route back into prod.
  - Its design follows §D2.
  - Whoever builds it is bound by R7's scratch rules: a separate cluster, no network, never a database inside prod,
    and names validated before use.
  - It needs a home: POLY-116, or a new issue before POLY-104.

## Addendum 1 — seceng's ruling review (`ruling-review.md` @ `465a7753`, read against `9f87a180`)

seceng C1–C12 are carried by reference and are 99c tests as written there. The deltas against the re-issued text:
- **C3** wins over R10 on `.inflight/`: it gets the default ACL `u:10005:r--` and **no** 10005 access entry. On the other spool dirs 10005 keeps R10's `r-x` and the read-only mount, which is stricter than C3's `rwx`, so the uploader prunes nothing and root does (R5).
- **C4**: R5's root hash, taken after the container is gone, stands for the in-pipe `tee`. No uid can write `dump/` or `premigration/` between publish and that hash, because 10004 has exited and 10005 is read-only. `spool.sha256` is C4's index. `fetch-premigration` hashes the file and refuses (exit 1, nothing written) on a mismatch or a missing record. The R6 line gains `<name>=<sha256>` per file.
- **C2**: `ulimits: {core: 0}` moves into `x-hardened`, so it covers every service in prod and staging. **C6**: the scratch also gets `--pids-limit 512 --memory 2g` and the `FROM` digest. **C8** replaces R11's auth-URL rule. **C12** adds the `fdesetup` guard.
- **C7** replaces R7's replay bullets: choose the set by upload time, use C7's refusals (an upload more than 4 h after `<TS>` is refused, not merely warned), and allow 10 min, not 15, for content time.
- **C9**: DR1's text and the refusal listing. **C5**: `b2read.py` names local files by `fileId`, refuses a key other than `<instance>/<M>/<dir>/<R2 name>`, and `list-premigration` prints `stray <n>` lines.
- **C11**: R4's rclone config in a 0600 tmpfs file stands; `--config` takes a path, never a key. The sweep covers that file's contents too.
- **T18 (criterion 5):** `backup premigration` → `restore.sh --premigration --from-box` (fake ssh into the box fixture) → scratch, with the canary present and the C4 check passing.
- **§D:** D1 is seceng's P1, and both recommend (a). D3 is P2. Seceng recommends a daily list-only job, and I now agree. It catches an uploader that lies, which nothing on the box can. It is not built in this loop; it goes to POLY-105. §L1 carries seceng's (i)–(iii).

## Addendum 2 — seceng's re-review (`ruling-review.md` § Re-review @ `2eea8816`); the addendum budget is now closed

- **N1 (gates)** is carried as written there, with its tests. Root accepts a `verified` or `published` line only when
  `<dir>` ∈ {`wal`, `dump`, `premigration`} and `<name>` matches R2 for that dir. It then opens the file relative to
  that spool dir with `O_NOFOLLOW` and requires a regular file, and only after that hashes, deletes or writes a
  sibling. Any failing line touches nothing: exit 1 and `/fail`. **A5** is adopted: at most 1 MiB of uploader stdout,
  and a line over 4 KiB is a fault.
- **C7′** replaces Addendum 1's C7 bullet. The base `START TIME` must fall in `[TS−1 min, TS+10 min]`. The dump's time
  must fall in `[TS−1 min, TS+3 h]` for nightly or `[TS−1 min, TS+30 min]` for premigration. WAL is chosen by the
  version rule and `<sys>` only. An upload more than 4 h after `<TS>` is refused (exit 3) unless `--set <TS>` names
  the set, which passes it with `WARN late upload`.
- `drill.sh` runs `ulimit -c 0` itself. `list-premigration` refuses a `spool.sha256` that is not root-owned 0644
  (C10). R3 is corrected in place.
- **§D supersedes:** seceng's D1–D3 in the re-review are the text the lead carries to the Principal.
  - D1: I concur with (b), with a loud override switch.
  - D2: I concur with (a), destroyed as seceng defines it, in tmpfs while it fits.
  - D3: I concur with filing it now as its own issue that gates the first real household data; this replaces my
    POLY-105 placement.
