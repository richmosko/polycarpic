---
id: POLY-99
title: Backup, uploader, restore, drill
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-97, POLY-95, POLY-83]
assignee: devops-engineer
paths: [process/cairn/issues/POLY-99.md, process/cairn/reviews/POLY-99/**, infra/backup/**, infra/restore.sh, infra/drill.sh, infra/ops/**, infra/operator/**, infra/compose/**, infra/provision.sh, infra/provision-check.sh, infra/postgres/**, infra/README.md, infra/lint/**, infra/ci/**, tests/**, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, .github/workflows/**, package.json, pnpm-lock.yaml, .gitignore, .gitleaksignore]
labels: [ops, backup, security]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-22
---

INFRA §2.2, §6.1, §6.4, §6.7, D-13..D-15. backup: pg_basebackup -Ft -X none, pg_dump -Fc, pg_dumpall --globals-only --no-role-passwords, each through age in the pipe; a premigration mode. uploader: rclone put-only to B2 with checksum verify. restore.sh decrypts on the operator's laptop only; drill.sh carries the §6.7 assertions. The bad-migration restore runs off the box from the laptop, RTO 60 minutes, and no plaintext dump ever exists on the box (Principal Q8, 2026-11-08).

## Acceptance criteria

- [ ] shellcheck clean; a container test shows no plaintext file ever appears in the spool.
- [ ] backup has no route out and no bucket key; uploader has no DB credential.
- [ ] A round trip on a scratch Postgres restores base plus WAL and the dump.
- [ ] A mismatched checksum leaves the spool file and pings /fail.
- [ ] restore.sh --premigration decrypts only on the machine running it.

## Comments

### @team-lead — 2026-11-11

From the POLY-95 loop: the uploader never reads `spool/wal/.inflight/` (ruling F2), and it cannot ship anything until POLY-97 grants uid 10005 access to the spool (verdict F12).

### @team-lead — 2026-11-22

From the POLY-97 loop (ruling Scope, Addendum 1 S6; seceng positions 1a/1b; build review F-probe2):
- Restores and drills pick a file **version** by upload time, never "latest by name"; alert when a name has more than one version or any hide marker; restore only into a throwaway Postgres.
- The uploader exits non-zero and skips the heartbeat ping on any refused upload.
- Upload verification uses no HEAD and no list: the box key never gains `readFiles` or `listFiles` (it may only narrow to `writeFiles`).
- Restore runbook F4 (`app.session_handle` restored with `session`) stays here.
- Once the uploader's rclone flags are fixed here, `infra/operator/b2-setup.py --probe` reuses them.
- No spool writer may `chmod` a spool file: a `chmod 0600` cancels the uploader's ACL (ruling M1).

### @team-lead — 2026-11-22

From the POLY-98 security review (`process/cairn/reviews/POLY-98/ruling-review.md` R-a; ruling R7): `polycarpic-ops status` accounts for poly_backup connections by the windows in `jobs.log`, which the backup uid itself writes, so a compromised backup container could write a window covering its own connections (capped at 6 h by K9). Take the windows from a source root writes: the systemd unit start and stop times in the journal. The ruling's R7 also fixes the line formats the backup and uploader write to `jobs.log` and `last-upload`.

### @team-lead — 2026-11-22

Feature started. Branch: `feature/poly-99-backup-restore-drill`. Runs before POLY-100 by the Principal's choice of 2026-11-22: the deploy's pre-migration backup and its 60-minute restore criterion rest on this issue's backup container, `restore.sh` and drill. POLY-100 is claimed on `feature/poly-100-pull-based-deploy` (one start commit) and parked until this merges; this loop's ruling fixes the premigration interface the deploy calls.

### @architect — 2026-11-22

Gate 1, ruling: `process/cairn/reviews/POLY-99/ruling.md` @ 9f87a180a2403b83023a7f226294abf37f4b137f. qa writes 99c and devops builds 99d from it; seceng reviews it as 99b (§S, S1–S8).
- Measured (§M): `rclone copyto --no-check-dest --s3-no-head --s3-upload-cutoff 5G` sends one PUT and no HEAD or list; without `--no-check-dest` rclone HEADs first. A rewritten ETag fails the run. The base backup (tar to stdout through age) plus archived WAL recovers on a scratch Postgres. A forced-switch WAL segment is 16 MiB raw and ≈ 81 KB under gzip -1.
- Slice 0 (R12): `backup.sh nightly` on the scratch stack, three published names, no plaintext seen by the spool watcher. It goes green before the rest of 99c.
- Premigration contract for POLY-100: R6.
- `jobs.log` windows are written by root (the job runner); this closes POLY-98 R-a (R9). `05_backupdb.py` gains a root-owner check; `04_backup.py` is unchanged.
- Principal: D1 (whether the from-box premigration restore always requires the bucket cross-check). Lead: L1 (where the box-side `restore-apply` goes; not in the confirmed scope).

### @architect — 2026-11-22

Gate 1, ruling re-issued whole: `process/cairn/reviews/POLY-99/ruling.md` @ 852474706b9c6a90ed21c73e6f278685042ded37. It replaces 9f87a180, which no review or test had used. It folds in seceng-99 prep positions (mapped in §S): the uploader is read-only; root writes every record and does every deletion and ping; from-box names are validated and the file checked against root record; the scratch cluster is separate and isolated; replay is checked; no core dumps. B4 is not adopted (§S). Principal: D1-D3. Lead: L1.
### @seceng — 2026-11-22

Security review of the ruling (POLY-99b): accepted with conditions, nothing refused. Ruling @ 9f87a180 reviewed; conditions C1–C12 each name their 99c test, in process/cairn/reviews/POLY-99/ruling-review.md. Highest weight: C4 (premigration hash recorded by root, checked by fetch and restore), C5 (names from box or bucket validated before any ssh argv or local path: an uploader-to-root path otherwise), C7 (set chosen by upload time plus content-time check), C3 (uploader reads but cannot edit spool files). Missing test: a premigration round trip for criterion 5. Principal: P1 (ruling D1; recommend (a) with C4), P2 (off-box daily list-only bucket check; recommend, lands in POLY-103/105). Lead: §L1 needs streaming, a separate scratch cluster and data-only copy-back, and Q8's scope confirmed.

### @seceng — 2026-11-22

Re-review (POLY-99b) of the re-issue @ 85247470 with Addendum 1 @ 17e9414f: accepted with conditions. C1–C12 met as carried; C7′ widens the content-time window to each mode's timeout and lets --set pass a late upload. B4's non-adoption accepted; T2 keeps its real mid-dump fault. New gating condition N1: root validates the uploader's verified lines and the backup's published line (dir set, R2, O_NOFOLLOW, regular file) before it hashes, deletes or writes, since otherwise the uploader steers root's unlink. Principal: D1 recommend (b) with an override switch (supersedes my earlier (a)); D2 recommend (a), destroyed as defined, tmpfs while it fits, within Q8 if temporary; D3 GitHub list-only key acceptable under TB-12 with conditions, file now, gates real data. Details: process/cairn/reviews/POLY-99/ruling-review.md § Re-review.

### @architect — 2026-11-22

Ruling clarification (R10, gap raised by devops-99; not an addendum). `heartbeat_url` becomes a **host-only secret**. It is read by root (R5) and mounted by no service, so it gets no compose entry: the compose-policy lint already refuses a top-level secret that no service mounts (`secret-path`).
- **One constant:** `HOST_ONLY = {"heartbeat_url": "uploader"}` in `infra/ops/lib/secrets.py`. `set-secret` and `list-secrets` read it next to the compose-derived set. The https check stays.
- **provision-check H6** carries the same pair as a shell constant. A unit test asserts the two are equal, so they cannot drift.
- **File and mode unchanged:** `/etc/polycarpic/secrets/uploader/heartbeat_url`, 0440 `root:10005`, as H6 expects for every secret. No host account holds gid 10005 (H9), so the group bit grants nothing. `provision.sh` still makes the `uploader/` dir. H13 is unchanged.
- **Not 0640:** one mode for every secret file keeps H6 and `list-secrets` free of a special case.
- **Tests:** qa updates the two `test_set_secret` cases to expect the write to that path. A new case covers a host-only name that is not in `HOST_ONLY`, which still exits 2, and one covers H6 failing on a mismatched constant.

### @qa-engineer — 2026-11-22

Tests-red gate (99c). Record: process/cairn/reviews/POLY-99/red-run.md @ 1cd28a70; plan, pins 1-41 and the condition map: test-plan.md in the same directory.
Counts (what each is over, in red-run.md): tests/infra/backup 134 (80 green, 54 red: restore 46, drill 5, round trip 3); ops unit tests test_backup 24/25, test_upload 20/21, test_status 46/50, test_set_secret 30/31, test_provision 17/20; lint-poly99 12/28; provision/poly99 5/18; backup-wiring 4/15. Red is for missing code (restore.sh, drill.sh, provision ACL/units/endpoint, new lint rules, CI wiring, three marker lines), not for harness defects.
Green already because devops-99's code landed first: backup.sh, upload.sh, the runner, archive-wal.sh R3. Each security-bearing case has a mutant or planted fault the same check flags (table in red-run.md). Harness defects found against the real tools image are fixed and listed there.
Open: (1) D1 --from-box cross-check cases not written, waiting for the Principal. (2) The container directory takes 358 s with restore/drill still red; green it will pass the ruling's 240 s guard, so an addendum must move cases or raise it. (3) DR10's 'uploading over an existing version' has no defined verb; pin 35 is my reading (conditional PUT If-None-Match). (4) Three postgres.test.ts cases cannot fail on Docker Desktop (bind mounts do not enforce 0600); they need Linux CI.

### @architect — 2026-11-22

Architect, on qa-99's three questions at red-run @ 96726662 (pins 35, 38, 39, and R13's guard). This clarifies the ruling; it is not an addendum.
- **DR10 "overwrite": pin 35 changes.** The property C-73 means is that an existing version cannot be changed. It does not mean a name cannot get a new version: the box key can make new versions, and that is the poisoned-version threat R7 handles. So:
  - Every DR10 action runs against a **probe object** that the drill first uploads with the box key: `<instance>/drill/probe-<UTC TS>`. It never runs against a backup object, because a second version of a backup name would trip DR1 on the next restore.
  - Overwrite: a plain PUT to the probe's name with the box key. The check PASSES only if the original version (by `fileId`) still downloads with its original sha256 and the same retention. Otherwise it FAILS.
  - The conditional `If-None-Match: *` PUT is dropped: it tests a request option, not the lock.
  - Delete, `PUT ?retention` and the bucket's default retention stay as pinned: refused, PASS; allowed (fake-b2 `permissive`), FAIL.
  - The probe stays locked for 35 days; it is a few bytes.
- **Guard: the container suite moves to ≤ 480 s locally** (R13 said 240 s), on two conditions. The scratch stack is built once per test file and shared by its cases, never per case. qa reports per-file times at the build-green gate. Over 480 s, cases are consolidated, not dropped. The CI image-job delta is reported at build green.
- **Marker lines (pins 29, 38, 39): accepted.** Each marker (`# T9`, `# T10`, `# T16`, `# T17`, `# C4`, `# N1`) sits at the end of the one line that carries the check. One marker per line, and no other line carries that marker. The builder may not split a marked check across lines.

### @qa-engineer — 2026-11-22

Build-green gate (99c/99d). Record: process/cairn/reviews/POLY-99/gate.md; build 7e4b95d2, tests e77312c9 plus this commit.
Green: backup container suite 101/101 (301 s wall, under 420 s; seven files, per-file times in gate.md); provision container config 171/171; tests/infra 390; tests/ci 587; tests/layers 556; ops unit tests 222; image config 88/90, the two reds being POLY-95 secret-mode cases that fail identically on a clean origin/main (Docker Desktop does not enforce bind-mount modes).
Found: the provision config had never run on the built code and showed five test-side defects, all fixed (R10 ACLs, R9 state, H16 bundle copy, install bundle); no build fault. F1-F4 were red on 5501a740 (11 cases) and green on the fix; F5 shown red on e7c7cc6b^; F4 removal shown on real Docker.
Delta vs same-day main control: image +4 s, provision +9 s; the backup suite is new and runs only when the backup change key is true. CI timings, real B2, a ledger schema, non-macOS restore and D1 cross-check cases are not covered; the two secret-mode cases need Linux CI. Change table of every test commit since the red run is in gate.md.

### @architect — 2026-11-22

Architect, verdict read @ 106f1a9b: rulings on the DR2 mutant and on 738c8e87.
**DR2 mutant (`drill.test.ts`, "DR2 RED ON THE FAULT"): no build defect, and DR2 is not redundant.**
- For the base, the only source of DR2 is `restore-lib.sh:119`, `fetch_object`'s `if [ "$got" != "$want" ]`. The other two sibling comparisons cannot flag the base:
  - `prepare_base`'s at :181 compares WAL only;
  - `version_sibling` sets no flag and runs only on the refused path.
- Since 5ad60203, the dump's second version carries its own matching sibling. So under the `if false` mutant DR2 must come out PASS, and the case asserts PASS.
- If "green" means that case passed, that is the red-on-fault proof working. Nothing changes.
- If it means the mutant run still printed `FAIL DR2`, that contradicts the code: the mutated `restore-lib.sh` is not what `drill.sh` sourced. That would be a harness defect for qa-99, in `lap.mutantInfra`'s infra path, as used by `drill.sh`.
- qa-99: say in the test-plan which of the two it was, with the run line.
**738c8e87 (T10/T17 mutants seen by the scratch start, not by a restored canary): accepted, no extra real restore.**
- The unit under test is selection. T10's mutant asserts that the poisoned version's `fileId` was downloaded. What a restore then contains is proven separately:
  - the one real `--before` restore, with the original canary (restore.test.ts T10 + C7′);
  - roundtrip.
**New gating gap, T17:**
- Three lines carry `# T17`: `restore-lib.sh:154` (dump), `:165` (base) and `restore.sh:139` (premigration). The marker rule (comment @ e585d393) allows one line per marker.
- The mutant regex removes only the first. So the base check (window TS−1 min to TS+10 min) has no refusal case and no mutant, and the premigration one has a refusal case but no mutant.
- Required:
  - Markers: `# T17` stays on the dump line; `# T17b` goes on the base line and `# T17p` on the premigration line (devops-99).
  - Cases (qa-99): a base whose `backup_label` START TIME is 2 h before its name's TS exits 4 with no scratch, and its mutant reaches the scratch. The premigration refusal case gets its mutant.
