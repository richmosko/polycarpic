# POLY-99b — seceng's review of the ruling

Reviewed: `process/cairn/reviews/POLY-99/ruling.md` @ `9f87a180a2403b83023a7f226294abf37f4b137f`, against the tree at
`4ffd8fd0`. Read alongside: SECURITY C-73, C-79, T-61/62/89, R-29, R-30; INFRA §2.2, §6.1–§6.7, §8.10;
`infra/compose/prod.yml`, `infra/provision.sh` (`acl_dir`, `state_files`), `infra/postgres/archive-wal.sh`,
`infra/ops/status/04_backup.py`, `05_backupdb.py`, `infra/operator/b2-setup.py` (`run_probe`).

**Verdict: accepted with conditions.** No position is refused. C1–C12 below are conditions; each names the test that
proves it, red on the fault and green on the fix, and says when a fake cannot see the fault. The architect may carry
them into an addendum by reference ("seceng C1–C12, `ruling-review.md` @ <sha>"); none needs re-measuring first.
Advisories (A1–A4) do not gate. P1 and P2 need the Principal (marked section).

## What a compromise of each part reaches (as ruled, with C1–C12)

| Who is compromised | Reaches | Cannot reach | What detects it |
|---|---|---|---|
| **backup container** (10004, `backup-net`) | Every row, through poly_backup (it is a read-all login). Its own spool dirs: it can publish a forged or plaintext file under a valid name, with a valid age header. | The internet (internal network), the bucket key, the age private key, `jobs.log` (R9, root-written), the root premigration index (C4). | Nothing on the box can tell a forged backup from a real one; the age public key is there by design. A plaintext file it publishes reaches only **our** bucket, which nobody outside holds a read key for: getting it out needs a second compromise (uploader, read key, or B2 account). Connections outside a runner window: `backupdb` RED. |
| **uploader** (10005, `upload-net`) | Every spool file as ciphertext (useless without the private key); the put-only key: junk uploads, bucket fill, hide markers, new versions; `heartbeat_url`: false green pings; `last-upload`: a false "fresh" claim; unlink and create in the spool dirs. | The database (no network, no credential), plaintext, past bucket versions (Object Lock), in-place edits of a backup file (C3), the premigration record (C4). | Hide markers and extra versions: restore and drill refuse (R7, R8, C7). A silent "I uploaded, I didn't": **only the monthly drill today** (P2). |
| **root on the box** (or `polyops`, R-29) | All of the above, the live database, every secret, the age **recipient** (it can swap it, so future backups become unreadable to us). | The age private key, the read key, any bucket version already uploaded (deleted by nobody for 35 days). | Forged future backups and a swapped recipient: only a restore drill. `restore.sh --from-box` against a root attacker: the bucket cross-check (P1) and the content-time check (C7). |

The separation holds: the process that holds the database credential has no route out and no bucket key, and the
process with the route out has no database credential and no key that decrypts. To exfiltrate plaintext, an attacker
needs the backup container **and** either the uploader or a key that reads the bucket.

## Positions

| # | Ruling | Mechanism and attacker's reach |
|---|---|---|
| **S1** root-written windows (R9) | **Accept.** Closes my POLY-98 R-a; it gates this loop and is built here. | The window is the runner's own clock around `docker compose run … --rm`, written after `docker rm -f`, into a root 0644 file mounted by nothing. A compromised backup container can still connect only while it exists, which is inside a window by construction. The only other poly_backup path is provision-check's D3, also root-written. Keep K9's caps (6 h, 8 h total) and the new 1 h premigration cap: they bound a runner bug, not an attacker. T12 plus the C10 lint rule are the proof. |
| **S2** compress then encrypt (R3) | **Accept.** | Object sizes reveal compressibility to whoever sees the bucket listing (B2 and the read-key holder). A compression-length attack needs a chosen-text writer inside the ledger **and** that observer, over many WAL segments; the reward is guessing a secret inside gzip's 32 KB window. Far cheaper than a full bucket in two days (M-W), which is a real denial of backups. Residual noted in C-73. |
| **S3** rclone's DELETE after a mismatch (M-U4) | **Accept, with C9.** | The key has no `deleteFiles`, and Object Lock holds the version. Whether B2 maps an S3 `DeleteObject` with no version id to a **hide** under `writeFiles` is unmeasured (POLY-105). If it does, the mismatched version gets hidden; the retry then makes a second version of the same name. So a checksum mismatch is a **second** benign source of a two-version name next to R3's crash case, and the restore must let the operator through it quickly (C9). |
| **S4** from-box trusts the spool | **Accept with C4 and P1.** | Writers of `spool/premigration/` are the backup uid, **the uploader uid** (it has `w` on the directory to write siblings and prune) and root. The uploader is the internet-facing container. Without C4 it can replace a premigration file between publish and fetch, and the bucket cross-check does not help, because the uploader also made the bucket's first version. C4 records the hash where neither container can write. |
| **S5** `--network none`, no bind mount | **Accept with C6.** | A forged dump runs SQL as the scratch superuser; `COPY … TO PROGRAM` gives a shell in that container. With no network and no mount, it reaches the container only, then needs a container escape on the laptop's Docker VM. C6 removes the cheap escape aids (capabilities, setuid). What it can still do is make the restored **data** wrong. That matters at the copy-back step (§L1), not here. |
| **S6** runner reads `heartbeat_url` as root | **Accept.** | Root already reads every secret; the URL goes to curl on stdin, never argv. |
| **S7** uploader refuses a file without the age header | **Accept**, as a guard against **bugs** only. | A compromised backup container can prepend the 22-byte header to plaintext. What bounds that case is the table above, not S7. T8 is the proof for the bug case. |
| **S8** `POLY_B2_AUTH_URL` | **Accept with C8.** | `b2_authorize_account` sends the read key id and key to that URL, and the token then goes to whatever `apiUrl` and `downloadUrl` the answer names. A stray value left in a shell profile after a test run would send the read key to any https host. C8 narrows both. |

## Conditions (each a 99c test)

**C1. No staging room for plaintext in the backup container.** `backup`'s `/tmp` tmpfs carries `size=1m` (it holds
the two-line passfile only); the lint refuses `backup` without a size cap at or under 1 MiB, or with any other writable
mount than its two spool dirs. *Test:* a mutant `backup.sh` that writes `pg_dump` to `/tmp` before encrypting fails
with no space, publishes nothing. The scratch stack's dump must exceed 1 MiB (pad the canary table) so the fault is
visible. T1's watcher sees the spool only, so without this cap a `/tmp` detour is invisible to it.

**C2. No core dumps.** `ulimits: {core: 0}` in the `x-hardened` anchor, so on every prod and staging service; the lint
refuses its absence. `restore.sh` and `drill.sh` run `ulimit -c 0` first. *Why:* the root disk is not LUKS (C-72); a
crashing `pg_dump`, `age`, or Postgres backend may leave a plaintext core there, depending on the host's
`core_pattern` (unmeasured). *Test:* `ulimit -c` inside the rendered backup and uploader containers prints `0`; a
lint fixture without the key fails.

**C3. The uploader reads a backup file but cannot change it.** `acl_dir`'s default ACL gives `u:10005:r--` (not `rwx`)
for files; the directory's access ACL keeps `u:10005:rwx` (list, sibling, prune). Each `.inflight/` directory carries
the same **default** ACL, so a file born there and linked out is readable by 10005, and **no access entry** for 10005,
so the uploader cannot enter it. *Test (T13 extended):* after a run, every published file gives 10005 effective `r--`;
as 10005, opening a published file for write fails with EACCES and `ls .inflight` fails; H7 asserts both ACL shapes.
Red: today's `rwx` default ACL. A real filesystem in a container sees this; a fake does not.

**C4. The premigration hash is recorded where no container writes.** `backup.sh` hashes each ciphertext **in the
pipe** (`… | age -R r | tee <tmp> | sha256sum`), so no later writer can race it, and prints it on the R1/R6 line as
`<name>=<sha256>`. The runner (root) appends `<TS> <name> <sha256>` to `/var/lib/polycarpic/state/premigration.index`,
root 0644, mounted by nothing (C10). `list-premigration` prints the recorded hash per file; `fetch-premigration`
hashes the file and exits non-zero, writing nothing, when it differs from the record or the record is absent.
`restore.sh --from-box` checks the fetched bytes against the listed hash (exit 4). *Test:* as 10005, overwrite a
published premigration file with another valid age file: fetch refuses, restore exits 4. Red: a mutant fetch with
no check. The R6 contract line gains the hashes; POLY-100 writes it to `deploy.log`.

**C5. Names from the box or the bucket are data, never code or paths.**
- `list-premigration` prints only names matching R2; anything else is one `stray <n>` line.
- `restore.sh` matches every name it receives against R2 **before** it puts it in an ssh argv, and passes it as one
  argument quoted for the remote shell. ssh runs with `-o ForwardAgent=no -o ClearAllForwardings=yes`.
- Every remote or bucket text `restore.sh` and `drill.sh` print has control characters (`\x00–\x1f` except `\n`,
  `\x7f`, and ESC sequences) replaced.
- `b2read.py` names local files by `fileId` (matched `^[A-Za-z0-9_-]+$`), never by the object name, and refuses an
  object key that does not match `<instance>/<M>/<dir>/<R2 name>` exactly.
*Why:* the box's ssh login is `polyops`, root by sudo (R-29), and `spool/premigration/` is writable by the uploader.
Without this, a file named `dump-…age;<command>` is an uploader-to-root escalation through the operator's own ssh
session, and a bucket key with `../` writes outside the temp dir. *Tests:* a planted spool name with `;` and one with
`$(…)`: never in the fake ssh's argv, exit 5; a fake-b2 version keyed `prod/17/dump/../../x`: refused, nothing written
outside the temp dir; the fake ssh argv holds both `-o` options. Red: mutants without each check. The fakes see all
of this.

**C6. The throwaway Postgres is hardened.** `docker run` for each scratch instance adds `--user 999:999 --cap-drop ALL
--security-opt no-new-privileges --pids-limit 512 --memory 2g`, and the image is the `FROM` line's digest, never a tag.
*Test:* the fake docker's argv for both `--base` and `--dump` holds each flag; a real run under them restores
(criterion 3), which proves Postgres starts without capabilities.

**C7. Choose a set by what the bucket and the file say, not by the name alone.** Over R7's version rule:
- The set is chosen by **upload time** (the newest complete set), never by the `<TS>` in its name.
- Refused (exit 3, each listed): a name whose `<TS>` is in the future; a version uploaded before its `<TS>` or more
  than 4 h after it; two complete nightly sets in one UTC day; a `<sys>` differing from the newest base's.
- After decryption, before the restore: the dump's own time (`pg_restore -l`, "Archive created at") and the base's
  `backup_label` `START TIME` each within 10 min of the name's `<TS>`, else exit 4.
*Why:* the put key can upload a forged set with a fresh name that the version rule does not catch, and can re-upload
an old genuine file under a new name (stale data, valid decryption). *Tests:* fake-b2 planted with a future-`<TS>`
set; a second set on the same day; an older real dump uploaded under today's name. Each exits as above. The
content-time check uses a real `pg_dump` from the scratch stack, which a fake could not stand in for.

**C8. The B2 endpoints are pinned.** `POLY_B2_AUTH_URL`, when set, must be `http://127.0.0.1:<port>` (tests) or
exactly `https://api.backblazeb2.com`; anything else is exit 2. The `apiUrl` and `downloadUrl` from
`b2_authorize_account` must match `^https://[a-z0-9-]+\.backblazeb2\.com$`, or loopback **only** when the override is
loopback; else exit 5 before any token is sent. When the override is set, stderr says `WARN B2 auth URL overridden:
<url>`. *Tests:* each refusal, with the fake's log showing no request after the refused step.

**C9. A two-version name is loud and passable.** R3's crash retry and S3's mismatch retry both make two versions of
one name. The refusal (exit 3) lists, per version: upload time, `fileId`, and whether its bytes match the sibling.
`--before` is documented for this case in INFRA §6.4, §6.7 and §8.10. DR1 FAIL text names the cause it can see
("hide marker after a checksum mismatch" when a hide marker follows an unsiblinged version). *Test:* fake-b2 with
version 1 hidden and unsiblinged, version 2 siblinged: the listing shows both lines; `--before` after v2 restores v2.

**C10. Root-only state stays root-only.** The new lint rule (R10) also lists `premigration.index`: no service mounts
it. `05_backupdb` RED on a non-root or group/other-writable `jobs.log` (T12), and `list-premigration` refuses a
non-root or group/other-writable `premigration.index`. *Test:* fixtures for each.

**C11. No secret leaves in argv, logs or output.** The put key, the read key, `heartbeat_url` and `db_password_backup`
appear in no process argv (fake docker, fake ssh and fake-b2 logs swept for each fixture value), no stdout or stderr
of `backup.sh`, `upload.sh`, the runner, `restore.sh`, `drill.sh`, `b2read.py`, and no file outside `/run/secrets`
and the passfile. rclone gets its keys from the environment inside its own container only, never from a flag.
*Test:* POLY-97 R10's sweep extended to these scripts and the new fakes. Fixtures are described values, not
credential-shaped strings (gitleaks).

**C12. Laptop plaintext goes only onto an encrypted disk.** Before decrypting, `restore.sh` and `drill.sh` require
`fdesetup isactive` to succeed on macOS; elsewhere they refuse unless `--plaintext-disk-is-encrypted` is given, and
print `WARN` with it. The decrypt directory is made under `umask 077`, removed by a trap on `EXIT INT TERM HUP`;
`--keep` prints the path on stderr. *Why:* INFRA §8.10 already says an unencrypted laptop must not hold the decrypted
ledger; this makes the script hold that line rather than the runbook. *Test:* a fake `fdesetup` returning 1: exit 2,
no `age -d` run. A fake cannot show the disk is really encrypted: this is a guard against a forgotten setting, not
proof.

## Tests reviewed against my spec

Read in the ruling's R12 and R13 (no test code exists yet; I review it at tests-red):
- **T1** (plaintext): sound for the spool; C1 adds the `/tmp` path it cannot see.
- **T2** (all or nothing): sound. It is the only proof the premigration set is complete before a migrate, since the
  box cannot decrypt it; keep the "postgres stopped mid-dump" fault, not only the `pipefail` mutant.
- **T3, T4** (routes): sound; red cases named.
- **T5–T7** (checksum, no HEAD or list, refusal): sound against a fake that enforces `Content-MD5`. **A fake cannot
  show that B2 itself checks `Content-MD5` or returns the MD5 as `ETag`**: POLY-105 measures that on the real bucket.
  Until then, criterion 4 is proven for rclone's behaviour, not for B2's.
- **T8** (stray, non-age): sound, a bug guard (S7).
- **T9** (decrypts locally): sound; add C5's `-o` options to the same argv assertion.
- **T10** (version choice): sound; C7 and C9 add their own cases.
- **T11** (throwaway only): sound; C6 adds the flags.
- **T12** (root-written windows): sound; C10 adds `premigration.index`.
- **T13** (no chmod): sound; C3 tightens what "readable" means to `r--`.
- **Missing:** a premigration round trip. Criterion 5 is "restore.sh --premigration decrypts only on the machine
  running it", and T9 shows only the negative. Add: `backup premigration` → `restore.sh --premigration --from-box`
  (fake ssh into the box fixture) → scratch, with the canary present and C4's hash check passing.

## Advisory (not gating)

- **A1.** The recipient file: provision-check could assert one line matching `^age1[0-9a-z]{58}$` and, once the
  Principal writes its fingerprint on the recovery sheet, equality with it. A root attacker can still change both; it
  catches a mistaken edit.
- **A2.** `archive-wal.sh` should apply R1's "exactly one recipient" precondition too, so a second recipient appended
  to the file stops WAL as loudly as it stops the nightly set.
- **A3.** The premigration mode could also tee the plaintext into `pg_restore -f /dev/null` in the container, proving
  the archive parses to its end before the migrate. Whether a non-seekable custom archive is fully read that way is
  unmeasured. `pg_dump`'s exit status under `pipefail` (T2) already carries this; take it only if T2 proves weak.
- **A4.** `last-upload` and the backup heartbeat are both the uploader's own claims (the same shape as R-a, which root
  cannot check without a key that lists the bucket). P2 is the fix; until then the table above states it.

## For the Principal (via the lead)

**P1. When you undo a bad upgrade from the copy on the server, should the restore always double-check it against
the off-site copy?**
What happens: before each upgrade the server saves an encrypted copy of your data. If the upgrade breaks something, your
laptop fetches that copy from the server and unlocks it. Someone who had taken over the server could have swapped in
a fake copy, because the server can lock copies but not unlock them. The fake would land in a sealed test database on
your laptop, and you could copy wrong numbers back.
- (a) **Recommended, as ruled.** The laptop checks the copy against a fingerprint the server's own system recorded
  when the backup was made (this review's C4). That catches a swap by either backup program. When you also have the
  off-site reading key at hand, it checks against the off-site copy too, which catches a swap by someone with full
  control of the server. Day-to-day cost: none. During an incident, you need the reading key out to get the second check.
- (b) Always require the off-site check. Cost: the restore cannot run without the reading key, and waits about a
  minute after an upgrade for the copy to reach off-site storage.
Refs: ruling §D1, S4; C4; C-73.

**P2. Should something outside the server check every day that the backups really arrived?**
What happens: the server's upload program reports "backup sent". If that program were taken over, it could keep saying
so while sending nothing, and the alerts would stay green. Today only the monthly restore test would notice, so up to a
month of backups could be missing without anyone knowing.
- **Recommended:** a scheduled GitHub job once a day, holding a new key that can only **list** file names and dates in
  the backup store. It cannot read, change or delete anything. It checks that last night's backup and the last hour's
  updates arrived, and that nothing was hidden or uploaded twice. Then it pings the alert service, and it pings the
  failure address otherwise. Day-to-day cost: none; about $0 a month; one more key, which you create once with the
  existing setup tool and never type again. If it leaked, someone would learn when backups happen and how big they
  are, nothing more.
- Or: keep the monthly test as the only check (no cost; up to a month of silent loss).
Not in this loop's scope (no real bucket here): it would join POLY-103 or POLY-105.
Refs: C-73, T-62, A4; SECURITY §6.6 residuals.

## For the lead

- **§L1 carries security requirements, wherever it lands.** INFRA §6.4 sends the decrypted dump to
  `/srv/polycarpic/restore/` on the box. That conflicts with the issue's own wording ("no plaintext dump ever exists on
  the box", Principal Q8). Whoever builds the way back into prod must:
  (i) stream the decrypted data over ssh into the restore, with no plaintext file on the box;
  (ii) restore into a separate throwaway cluster on the box, never a database inside the prod cluster. A forged dump
  restored there as superuser is code execution in prod's Postgres (S5's reach, moved onto the box);
  (iii) copy back only data, for named tables, as a non-superuser.
  Whether a scratch **database** on the box's encrypted volume (not a file) is within Q8 is the Principal's to confirm.
  It holds the same data as prod at that moment.
- **Residual for C-73 (I write it at the build review):** future backups are only as trustworthy as the box when they
  are made. A compromised backup container or root can forge them or swap the recipient, and only a restore drill
  sees it. Past versions stay safe for 35 days.
- SECURITY edits (C-79 detection, C-73 restore text, the S2/S3 residuals, C3–C8) wait for the build review, since
  they quote built behaviour.

---

## Re-review: the re-issue @ `852474706b9c6a90ed21c73e6f278685042ded37` with Addendum 1 @ `17e9414f`

Read whole, against the tree at `17e9414f`. **Verdict: accepted with conditions.** C1–C12 stand as Addendum 1
carries them, with the refinements below. One new condition, **N1**, gates: it closes a path from the uploader to root
that the re-issue opened.

### C1–C12 against the re-issue

| # | State | Note |
|---|---|---|
| C1 `/tmp` cap | **Met** (R10 `size=1m`, R11 watcher on `/tmp`) | The watcher now sees a `/tmp` detour directly, so the 1 MiB padding of the scratch dump is no longer needed for the red case. |
| C2 core dumps | **Met** by Addendum 1 (`x-hardened`) | `drill.sh` must also run `ulimit -c 0`: it is a separate process, not only `restore-lib.sh`'s caller. |
| C3 uploader cannot change spool files | **Changed, stronger: met** | A read-only mount and an `r-x` ACL. The uploader now deletes and creates nothing (T14). `.inflight/` as Addendum 1 says. |
| C4 premigration hash where no container writes | **Changed: met** | Root hashes after the container is gone, instead of an in-pipe `tee`. Equivalent now: after 10004 exits, nobody but root can write `dump/` or `premigration/`. A compromised backup container can still forge the file **before** it exits. That is within its reach anyway (table above). |
| C5 names are data | **Met** for restore (R7, T16, Addendum 1) | Extended to root's own parsing: **N1**. |
| C6 scratch hardening | **Met** (R7 plus Addendum 1) | qa pins that Postgres starts under `--cap-drop ALL --user 999:999` (R7 marks it unmeasured). |
| C7 set choice | **Met** by Addendum 1, **refined here**: see C7′ | |
| C8 B2 endpoints | **Met** by Addendum 1 | The R11 sentence "`https://…` or loopback" is superseded; the builder builds C8. |
| C9 two-version names | **Met** by Addendum 1 | R3's "the one benign source" is wrong as text: the checksum-mismatch retry (S3) is a second. INFRA §6.7 must say both. |
| C10 root-only state | **Met** (R9, R10) | `list-premigration` refuses a `spool.sha256` that is not root 0644, as `05_backupdb` does for `jobs.log`. One fixture. |
| C11 no secret in argv, logs, output | **Met** by Addendum 1 | |
| C12 encrypted laptop disk | **Met** by Addendum 1 | |
| Premigration round trip | **Met** (T18) | |

**C7′ (refines my own C7; a too-tight window would block a real restore).**
- The content-time window is the runner's own timeout for the mode, not a flat 10 min. The base's `START TIME` must
  lie in `[TS − 1 min, TS + 10 min]`. The dump's "Archive created at" is taken after the base finishes, so it must lie in
  `[TS − 1 min, TS + 3 h]` for nightly and `[TS − 1 min, TS + 30 min]` for premigration. A replayed old file is off by
  days, so the wider window loses nothing. The globals file carries no time, so it is checked only through its set.
- An upload more than 4 h after `<TS>` is refused (exit 3) and listed. Naming the set explicitly with `--set <TS>`
  passes it with a `WARN late upload`. Otherwise a B2 outage longer than 4 h would block every restore of the sets it
  delayed.
- WAL names carry no time. WAL is chosen by the version rule and by the base's `<sys>` only.
- *Tests:* a dump with an archive time 2 h after `<TS>` in a nightly set restores, but fails in a premigration set; a
  late set is refused without `--set` and passes with it.

### B4 not adopted

**Accepted.** The architect's reason holds: a `tee` into a process substitution is a stage that `pipefail` does not see,
so the check would add a silent failure path to guard against one. What makes the premigration set trustworthy before
the migrate step runs is then:
- `pg_dump` exited 0, with every pipe stage seen by `pipefail`;
- all or nothing: nothing is published unless both files are complete;
- root's own hash, taken once no container can write.

**T2 must keep its real fault** (Postgres stopped during `pg_dump`), not only the `pipefail` mutant. That fault is the
proof.

**Residual:** a dump that `pg_dump` wrote cleanly but that does not restore is found only when it is restored. The
nightly `dump` takes the same path and is restored by every drill. I record this in C-73.

### New in the re-issue

| Item | Ruling | Mechanism and reach |
|---|---|---|
| Uploader read-only; root deletes after comparing (R4, R5, T14, T15) | **Accept with N1** | The uploader can no longer plant, replace or delete anything. But root now acts on the uploader's stdout, so that stdout is input to root. |
| Root alone pings and alone holds `heartbeat_url` (R5, R10) | **Accept** | This matches SECURITY's host-only secret row, which the old compose file did not. A compromised uploader can no longer send a false green ping directly. It can still claim `verified` falsely, and root then pings green and deletes the spool copy. That reach is the same as before, and **D3** is what catches it. |
| `last-upload` root-written, RED otherwise (R9) | **Accept** | Root writes it, but it is still built from the uploader's claims (A4 stands). |
| From-box checked against root's record always (R7) | **Accept** | |
| T14–T18 | **Accept** | Each red case is a mutant or a planted file, as required. In T15 the uploader is faked, and that is correct: the unit under test there is the runner. |

**N1. Root validates what the containers print before it opens any path (gates).** Root reads paths from two
containers:
- the uploader's `verified <dir> <name> <sha>` lines;
- the backup's `published <dir> <TS> <sys> <name>…` line.

Rules:
- `<dir>` must be exactly `wal`, `dump` or `premigration`.
- `<name>` must match R2 for that directory.
- Root opens the file relative to that spool directory with `O_NOFOLLOW` and requires a regular file. Only then does it
  hash it, delete it, or write a sibling.
- Any line that fails is a fault: nothing is touched, the run exits 1 and pings `/fail`.

*Why:* without it, a compromised uploader prints `verified wal ../../../etc/polycarpic/ops.conf <sha>`. It reads that
file through its own mount, so it knows the sha. Root then deletes a host file of the uploader's choosing, and a
symlink in the spool does the same through a valid name. This is the internet-facing container steering root's
`unlink`.

*Tests:* a fake uploader prints a `../` path, a bad `<dir>`, a valid name that is a symlink to a root-owned file, and
a name with a newline. In each case root deletes nothing, the target is unchanged, the runner exits 1, and `/fail` is
pinged. The same cases run on a fake `published` line. Red: a mutant runner that joins the path without the checks.
The fakes see all of this.

**Advisory A5.** Root reads the uploader's stdout capped: at most 1 MiB, and lines over 4 KiB are faults. That way a
flood cannot exhaust the runner.

### The Principal's three decisions

These replace P1 and P2 above. Each is in plain words for the lead to carry. The IDs are on the refs lines.

**D1. When you undo a bad upgrade from the copy kept on the server, must the laptop always check it against the
off-site copy as well?**
- *Mechanism.* The laptop fetches the encrypted pre-upgrade copy from the server and unlocks it with your private key.
  It always checks the copy against the fingerprint the server's root account recorded when the copy was made. That
  catches a swap by either backup program.
- *Attacker's reach.* Someone with full control of the server could swap both the copy and the fingerprint. You would
  then load a fake into a sealed test database and might copy wrong figures back. Only the off-site copy, uploaded
  before they arrived, gives that away.
- *Ruled (a):* the off-site check runs only when you give the reading key; otherwise you see a warning.
- *Stronger (b):* the off-site check is always required, with an explicit override switch that prints a loud warning
  for the day the key is out of reach. Cost: you get the reading key out on every such restore. It sits in the same
  place as the private key you already need. If the upgrade is less than about a minute old, you wait for the upload.
- **My recommendation: (b) with the override.** It costs one more key at hand in a rare event. It turns "a fully
  compromised server could feed me a fake" from silent into a refusal. Addendum 1 records (a) as my earlier
  recommendation, made before I weighed the override form. This supersedes it.

Refs: ruling §D1, R7; C4; C-73.

**D2. Where may the unlocked pre-upgrade data sit while you compare it and copy back what the upgrade damaged?**
- *Mechanism.* (a) The laptop unlocks the copy and streams it straight into a temporary, sealed database **on the
  server**, so no unlocked file is ever written there. (b) Everything stays on the laptop, and a separate, audited tool
  copies the corrected rows back.
- *Attacker's reach.* The difference is where a **fake** copy's hidden code would run. A fake copy can carry
  instructions that run inside the temporary database.
  - Under (a), that is a sealed container on the same machine as your live data. To reach the live data, it must also
    break out of the container.
  - Under (b), it runs inside the laptop's container instead.

  The fingerprint checks of D1 run before anything is streamed. So under (a), a fake gets in only if the backup program
  was already taken over when the copy was made, or if the attacker holds root on the server, which already reaches
  everything.
- *Is a temporary database on the encrypted disk within your rule (Q8)?* As I read it, **yes, if it is temporary.** The
  rule exists so that someone who captures the running server finds no readable **backup history** on it. The
  temporary database holds the state of just before the upgrade, which is nearly what the live database already holds,
  on the same encrypted disk, and only for the hours you work on it. Left in place after you finish, it becomes a
  backup copy kept on the server, which is what the rule forbids.
- **"Destroyed" must mean all of this:**
  - the container is stopped and removed;
  - its data directory is a fresh directory used for nothing else, and is removed;
  - the removal is verified by the tool listing no temporary database;
  - the status screen shows RED for any temporary database or its directory older than 24 hours.

  Dropping a database inside a running cluster does not count. Overwriting the disk blocks is not required: the deleted
  blocks sit on the same encrypted disk as the live data's.
- *Stronger option within (a):* put the temporary database's files in memory (tmpfs) rather than on disk, so they
  vanish when it stops. Cost: it is limited by the server's spare memory. Today's data is a few hundred MB
  (unmeasured), which fits. A larger database would fall back to the disk form.
- **My recommendation: (a), destroyed as above, in memory while it fits.** It keeps the 60-minute recovery target,
  and it builds no second copy-back tool. Whoever builds it is bound by §L1 (i)–(iii): stream it, use a separate
  cluster, copy back data only, as a non-superuser.

Refs: ruling §D2, §L1; Q8; INFRA §6.4.

**D3. A daily check, from outside the server, that last night's backup really arrived.**
- *Mechanism.* A scheduled GitHub job runs once a day. It lists the backup store with a key that can **only list**:
  names, sizes, upload times, and whether anything was hidden or uploaded twice. It pings the alert service if all is
  well, and its failure address otherwise.
- *Attacker's reach today, without it.* A taken-over upload program can report "sent" while sending nothing. The
  server then deletes its local copy and the alerts stay green. Only the monthly restore test would notice, so up to a
  month of backups could be missing.
- *My ruling on GitHub holding that key (TB-12):* **acceptable**, with these conditions.
  - The key holds exactly `listFiles` (plus `listBuckets` only if B2 measures it necessary), restricted to the one
    bucket. `b2-setup.py` creates it and asserts that set.
  - It is a GitHub **environment** secret, used by one scheduled workflow with `permissions: contents: read`. No
    third-party action runs in that job (a stdlib script only), and the runner image is pinned.
  - The job prints counts and pass or fail, never object names.
  - The job's own ping address is its own check. Whoever holds it can fake that one check's green, as the server can
    for its own.

  TB-12's concern was GitHub holding a credential that **reads the ledger**. This key reads no content and writes
  nothing. Stolen, it shows when backups run, how big they are, and the cluster's system id. That is metadata, with no
  path to data or to deletion.
- *Timing.* There is no real bucket in this loop, so it cannot be built here. But until it exists, a lying uploader is
  invisible for up to a month.
- **My recommendation: file it now as its own issue** (Addendum 1 places it in POLY-105). **It gates the first real
  household data**, as Healthchecks does. It should not wait on POLY-103's alerting design: it needs only one more
  Healthchecks check. Cost: about $0 a month, one key made once with the existing setup tool and never typed again,
  and a small loop.

Refs: ruling §D3; TB-12; C-73; T-62; A4.

### The three deltas Addendum 1 names, ruled by name (@ `17e9414f8f33b53a86c82a7fd853398a9b099a66`)

- **C4 by root's post-exit hash, not an in-pipe `tee`: accepted.** It is sound because, once 10004 has exited, no uid
  but root can write `dump/` or `premigration/`: 10005 has a read-only mount and `r-x`. If either of those is ever
  loosened, C4 is open again. So T14 is also C4's precondition test, and it must stay.
- **C11 by a 0600 rclone config file passed as `--config <path>`: accepted.** The key is never in argv or the
  environment, and the file is on a 1 MiB tmpfs inside the container that dies with `--rm`. The sweep covers its
  contents (Addendum 1).
- **C3's `.inflight/` ACL taking precedence over R10: accepted.** That ACL is a default `u:10005:r--` with no 10005
  access entry. The other three dirs keep `r-x` and the read-only mount, which is stricter than my original C3.

### Does "by reference" leave any condition without a test qa can point to?

Two would, as written in my C-text, so they are restated here. Every other C names its test in this file.

- **C4's test.** "As 10005, overwrite a published file" cannot run now, because 10005 cannot write. Restated: after
  `backup premigration`, a fixture step **as root** replaces the published dump with another valid age file. Then
  `fetch-premigration` exits 1, writing nothing, and `restore.sh --from-box` exits 4. A second case deletes the file's
  line from `spool.sha256`: fetch refuses. Red: a mutant fetch without the comparison.
- **C7.** C7′ replaces C7's windows. Its tests are listed under C7′.
- **N1 is not in Addendum 1.** It needs carrying, with its tests as listed under N1.

### Gate

**Not yet a PASS on `17e9414f`.** C1–C12 and the three deltas are accepted. The re-issue's root-side parsing has no
validation (N1). The plan gate clears when an addendum carries:
- **N1**, with its tests;
- **C7′**, with its tests;
- the restated C4 test;
- the two text fixes: R3's second benign source of a two-version name, and `ulimit -c 0` in `drill.sh`.
I re-read that sha and pass it, unless it changes something else.

### Gate verdict: **PASS on `09aeeeb2`** (Addendum 2)

Addendum 2 carries the following:
- N1 and its tests, with A5;
- C7′, with its tests;
- `ulimit -c 0` in `drill.sh`;
- C10's `spool.sha256` check;
- the R3 correction.

It changes nothing else in the ruling. The restated C4 test (the section above) is a test specification, not a
ruling change, so it needs no addendum. qa takes it from this file as one of C1–C12's tests. With that, every
condition has a test qa can point to. The plan gate is clear on my side.

**Confirmations on `09aeeeb2f64f09ee775cecbf8deab161d8df85ea`:**
- **N1 covers the hash and the delete.** Its sentence makes root validate the line first ("only after that hashes,
  deletes or writes a sibling"), and it covers both the `verified` and the `published` line. The ruling gives the test
  no T-number, so qa files it as **T19 (N1)**: a fake uploader prints `verified` lines carrying a `../` path, a `<dir>`
  outside the set, a valid R2 name that is a symlink to a root-owned file, and a name with an embedded newline. The
  same four cases run on a fake `published` line. In each, root hashes nothing outside the spool directory, deletes
  nothing, writes no sibling and leaves the target byte-identical, the runner exits 1, and fake-hc records `/fail`. It
  is red on a mutant runner that joins `<dir>/<name>` and opens it without the set, R2 and `O_NOFOLLOW` checks. One
  further case, a 5 MiB stdout and a 5 KiB line, proves A5.
- **D1 as the text builds it today: (a).** R7 cross-checks against the bucket only when `--read-credential` is given,
  and prints `WARN` otherwise. Addendum 2 records that the architect and I both recommend (b), but it does not change
  R7, and the Principal has not chosen. So the builder builds (a). If the Principal picks (b), the change is small:
  the from-box path refuses (exit 2) without `--read-credential` unless `--skip-bucket-check` is given, which prints
  the loud `WARN`. That takes one argument rule and two tests (refused without either flag; passes with the override
  and the `WARN`). It can land before build green without reopening the ruling, if the lead records the Principal's
  choice on the issue first.

## The clarification @ `351c9f4c98af62f4438ab68f6ebeac5491d09ee7`: `heartbeat_url` as a host-only secret

**Accepted with condition H-1.** As written it is **refused on one point, the file's group.** The rest stands.

**H-1. The file's group must be root, not 10005.**
- *Mechanism.* The clarification keeps `/etc/polycarpic/secrets/uploader/heartbeat_url` at 0440 `root:10005`, inside
  `uploader/`, which is `root:10005` 0750. The uploader container runs as `10005:10005`. H9 is right that no host
  **account** holds gid 10005, but the kernel checks numbers, not accounts. A process that escapes the uploader
  container into the host's mount namespace carries gid 10005, traverses `uploader/` and reads the URL.
- *Reach.* Whoever holds the URL can send the backup check's green pings, and so hide a stopped backup. SECURITY's
  host-only rule is "never mounted into a container, so a container escape short of root does not reach them". At
  `root:10005` it does reach them. The extra reach over a plain compromise is small, since a lying uploader already
  gets root to ping green (D3). But the rule is stated as a property, and this would make it false.
- *Required:*
  - The file is `/etc/polycarpic/secrets/host/heartbeat_url`, `root:root` 0400, in a directory `secrets/host/`,
    `root:root` 0700, which `provision.sh` creates.
  - `HOST_ONLY = {"heartbeat_url": "host"}`. H6 expects `root:root` 0400 for every `HOST_ONLY` entry, and `root:<gid>`
    0440 for the rest.
  - R5's read path and H13's check and fix text move to the new path.
  - Why a new directory rather than chgrp in place: a host-only file left in `uploader/` invites a later mount of
    that directory.
  - The one-mode-for-every-secret argument does not hold here. The special case is one branch keyed on a constant
    that is already there.
  - *Cost:* one H6 branch and one `provision.sh` directory.
  - Migration: a box provisioned before this keeps the old file. `provision.sh` moves it, keeping the value, never
    printing it, with a `change:` line. H6 fails on a `heartbeat_url` still under `uploader/`.
- *Tests:*
  - H6 fails on the file at `root:10005` 0440, and on the file under `uploader/`.
  - H6 passes at `root:root` 0400 under `host/`.
  - The `provision.sh` move keeps the value and prints none of it (swept).

**Does each tool still account for it?**
- `set-secret`: yes. It writes through `HOST_ONLY`, keeps the `https://` check, and refuses a host-only name not in
  the set (exit 2, the clarification's test).
- `list-secrets`: yes. It lists it from `HOST_ONLY`, with its path and mode, never its value.
- H6: yes, through the mirrored shell constant, with the equality test.
- H13: yes, at the new path.

**What stops `HOST_ONLY` from growing quietly.** The equality test only keeps the two copies the same. They could grow
together. Add a pin:
- A unit test asserts `HOST_ONLY == {"heartbeat_url": "host"}` exactly, with a comment naming SECURITY's host-only
  row. Any addition (POLY-100's `github_read_token` will be one) then fails that test and comes to seceng's review.
- A second test asserts that no `HOST_ONLY` name is also a compose-mounted secret.
- The compose-policy lint refuses any service volume or secret whose source is under `/etc/polycarpic/secrets/host/`.

**Can any container still read the URL?** Not once built as above:
- No service mounts it. The lint refuses a top-level secret that no service mounts, and the new rule refuses the
  `host/` directory.
- `ops.conf` and `host.env`, which the uploader mounts, carry no URL. H6 admits only the `B2_` lines there.
- The `0700` root directory stops an escape short of root.

Two tests prove it:
- in the rendered uploader, `/run/secrets/heartbeat_url` does not exist;
- the C11 sweep finds the fixture URL in no container's mounts or environment.

**Applies equally to R10's in-place correction @ `5ee29c4ea87a2a5b9f81c08ef5cca2fe388a8df7`.** It carries the same
text into the ruling, and the same ruling applies: accepted with H-1. Its line "Who reads it: root only" is not true
at `0440 root:10005`. Any process with gid 10005 reads the file, an escaped uploader included. It becomes true under
H-1's `root:root` 0400 in `secrets/host/`. H-1's tests and the `HOST_ONLY` pin are added to that correction's test
list.

**H-1 carried: PASS on `dea63614609e6719fa8238a0e6fba90496a27b9a`.** R10's correction now holds everything H-1
requires:
- the path, owner and mode;
- the `root:root` 0700 directory;
- the move of an old file, with its value swept from output;
- H6's `HOST_ONLY` branch and its failure on the old location and group;
- the exact pin, the no-overlap test and the `secrets/host/` lint rule;
- R5's and H13's read path.

Nothing else changed. The plan gate stays clear.

## Two build choices, ruled before build green (test-plan pins 28–29; qa `e2c7974d`, `49fff8d9`)

**B-1. T16: a validated name must also be passed safely. Two guards, not one.** **Refused as agreed**: "the builder
passes the box name to ssh as a raw word, and the grammar check is the only guard". The test must not shape the code
toward a single guard.
- *Mechanism.* ssh has no remote argv. It joins its arguments with spaces, and `polyops`'s login shell parses the
  result **before** `sudo` runs. So `--` or argv discipline on the laptop does not reach the remote side. The only
  second guard is quoting for that shell. A hostile name that gets past the grammar check runs as `polyops`, who is
  root by `sudo` (R-29). The name comes from `list-premigration`, whose spool the backup uid writes.
- *Required in `restore.sh`:*
  1. The grammar check, as pinned (the `# T16` line).
  2. The remote command is one string, built by a single function. Only that function may build it, and only for the
     two fixed forms: `sudo polycarpic-ops backup list-premigration` and `sudo polycarpic-ops backup
     fetch-premigration '<name>'`. The name is wrapped in single quotes, and any `'` inside it becomes `'\''`. R2 names
     contain none, so this is the second guard, not a rewrite. Mark that line `# T16q`.
  3. `ssh … -- <user@host> "<that string>"`. The `--` stops a hostile `--from-box` value from being read as an ssh
     option (`-oProxyCommand=…`), on top of the `bad --from-box` pattern check. No other remote command is ever sent.
- *Fake ssh.* It must run the remote string through a real `sh -c`, as sshd does. A fake that execs argv cannot see
  shell injection, and T16 would then pass on code that is exploitable.
- *How T16 shows red with two guards.* The hostile names are the five already pinned. One of them, `$(touch <canary>)`,
  writes a canary file in the box fixture.
  - **T16a**, the mutant without the `# T16` check: red, because it sends a `fetch-premigration` for the hostile name.
    The assertion is "exit 5 and no further ssh command". The canary stays absent, because `# T16q` still quotes the
    name.
  - **T16b**, the mutant without both `# T16` and `# T16q`: red, because the canary file appears. This proves the
    fake's shell is real.
  - **T16c**, the mutant without `# T16q` only: green. The check alone stops it. That is expected, and shows the
    quoting is an independent guard, not dead code.
  - Plus a static case: the ssh line holds `--` before the destination.

**B-2. No production script reads a test variable.** **Ruled: none may.**
- *Rule.* No tracked file under `infra/` reads `POLY99_SCRATCH_FAIL` or any other test-only variable. The shim that
  reads `POLY99_SCRATCH_FAIL` lives under `tests/` only, and is put on `PATH` by the harness.
- *The one override production honours* is `POLY_B2_AUTH_URL`, bounded by C8. It is named in the allowlist, never
  matched by a pattern.
- *The proof.* A new case in `tests/infra/lint-poly99.test.ts`, the **`no-test-vars`** rule:
  - Over `git ls-files infra/`, no file matches `\bPOLY99_`, `\bPOLY_TEST`, `\bFAKE_` or `_FAKE\b`.
  - Every `POLY_*` name read in `infra/backup/`, `infra/restore.sh`, `infra/drill.sh` and `infra/ops/` is in a
    pinned allowlist: `POLY_INSTANCE`, `POLY_POSTGRES_IMAGE`, `POLY_TOOLS_IMAGE`, `POLY_APP_IMAGE`,
    `POLY_B2_AUTH_URL`, plus any the builder shows is already read on `main`.
  - *Red:* a fixture copy of `restore.sh` with a `${POLY99_SCRATCH_FAIL:-}` read fails the rule, and so does one
    reading an unlisted `POLY_DEBUG`.
  - Today `git grep POLY99_` finds the name only under `tests/` and in `test-plan.md`, so the rule starts green on
    the tree.

**Noted for the build review:**
- I will read `infra/lint/policy.json` (the uploader's allowlist, which devops-99 changed) by name, as a diff
  against `09aeeeb2`.
- SECURITY's host-only row lists `backup_store_credential`, which the uploader container mounts by design (C-79). I
  correct that row when I edit SECURITY.
