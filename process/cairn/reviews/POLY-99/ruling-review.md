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
