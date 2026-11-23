# POLY-99e verdict: backup, uploader, restore, drill

Architect. **Ruled on build `a780368fea8426f529e6a44c6120b65842c37930` with tests at `be02507b76bbc00bef1cd160a7af99dd3b53e8e1`.** I read the candidate
`7e4b95d2` in full and the delta to `be02507b` file by file. Gates:
- seceng PASS on `a780368f`: `build-review.md` @ `f38ae493`, conditional on qa's gate.
- qa build-green: `gate.md` @ `be02507b`, with the backup suite 112/112 in 384 s.

**Verdict: PASS.** The advisories in §9 do not gate.

## 1. Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| shellcheck clean; no plaintext file ever in the spool | PASS | **shellcheck:** the provision-job step over 10 scripts (`ci.yml`). **Spool watcher:** `slice0.test.ts`, which covers the spool and `/tmp` and is red on its own fixtures. **T1 mutant:** `backup.test.ts`. **C1 `/tmp` cap:** lint `tmp-size` |
| backup has no route out and no bucket key; uploader has no DB credential | PASS | **Routes:** `uploader.test.ts` T3/T4, from the rendered services. **Lint:** the C-79 set plus `state-mount`, `host-secrets` and `uploader-spool-ro`. **T14:** read-only spool, `read_only` taken from the rendered `prod.yml` |
| A round trip on a scratch Postgres restores base + WAL and the dump | PASS | `roundtrip.test.ts`, on a stack carrying the real migration chain. `--base`: the row inserted after the base is present, and the cluster is promoted. `--dump`: the original canary is present and the later row is not |
| A mismatched checksum leaves the spool file and pings /fail | PASS | **Container half:** `uploader.test.ts` T5 (exit 1, file kept, no `verified` line). **Root half:** `tests/infra/ops/test_upload.py` (a wrong sha or uploader exit 1 keeps the file, pings `/fail`, exits 1). The exit code is the seam, pinned on both sides |
| `restore.sh --premigration` decrypts only on the machine running it | PASS | **T9:** `restore.test.ts`, no identity byte and no `age -d` over ssh. **T18:** `roundtrip.test.ts`, a real premigration set goes from the box shim to the laptop scratch and is checked against root's record |

## 2. Ruling items and the tests that prove them
The mapping is `test-plan.md` at `be02507b`, which I read case by case.
- **R1:** backup preconditions and messages, the published line, all or nothing, leftovers. In `backup.test.ts` and
  `slice0.test.ts`.
- **R2:** grammar tables, in `uploader.test.ts` and `postgres.test.ts`.
- **R3:** the archive target, `exists`, and the stale temp. In `tests/infra/image/postgres.test.ts`.
- **R4:** the argv, the config file at 0600, the `verified` lines, strays. In `uploader.test.ts`.
- **R5, N1, A5:** the runner. In `test_backup.py` and `test_upload.py`.
- **R6:** list and fetch, and the C4 hash. In `restore.test.ts`, `test_backup.py` and roundtrip T18.
- **R7:** restore.
  - T9–T11, T16a/b/c and T17/T17b/T17p (each line its own marker and mutant);
  - C5–C9, C12;
  - F1, F2 and F4.
- **R8:** the drill.
  - the happy run;
  - the all-faults run, with DR1 and DR2 each proven by its own mutant;
  - the DR2 WAL single fault;
  - DR8 on real tables, with three mutants;
  - F3, F5, F6, F7, F8.
- **R9:** the status root-owner checks, in `test_status.py`.
- **R10:** lint, provision, H6/H7/H8/H16, and H-1. In the provision suites, `lint-poly99`, `test_set_secret.py` and
  the `HOST_ONLY` pin.
- **R11:** fake-b2 self-tests, in `fake-b2.test.ts`.

## 3. Case accounting (134 → 101 in the restructure `738c8e87`, 112 at the tip)
I compared the cases title by title between `96726662` and the tip. Every assertion from before the restructure is
still asserted, in a merged case or a table. Two changed on purpose, each by a ruling:
- the conditional `If-None-Match` PUT was dropped (comment `e585d393`);
- C5's `..` key is skipped and counted (R7 correction, F1).

I re-checked these by their assertions, not their titles:
- C6's flags, on all three roundtrip restores;
- both halves of C8;
- the sibling match on `--dump`;
- F4/DR8, now on real tables;
- the laptop temp area, which is empty without `--keep`.

## 4. Test commits since the red run, read for loosening

| Commit | What changed | Reading |
|---|---|---|
| `b81227e7` | the data-only check | stricter: three files, and `-a` and clusters are caught |
| `da848159` | slice-0 names now check `dump/` and `premigration/` only | no loss: the WAL grammar is asserted where it is produced (R3, `postgres.test.ts`) and where it is consumed (uploader) |
| `738c8e87` | T10/T17 mutants are seen at the scratch start | accepted @ `3f635dc3`: T10 asserts the poisoned fileId is downloaded, and one real `--before` restore keeps the original canary |
| `a0938f6b` | provision cases follow R9 and R10 | corrected: `r-x` ACLs, root-written state; M1 now asserts what 10005 may not do |
| `5ad60203` | the F2 unknown-id case, and the fault-run masking | fixed: messages asserted; DR1 and DR2 are each red on their own mutant |
| `4cfca88f`, `b3d1d36f`, `ac615b11`, `be02507b` | T17b/T17p, the DR2 WAL case, F6, F7, F8 | stricter; each removed line was replaced by a stronger assertion on the new verdict line |

## 5. The combined drill fault run
At `7e4b95d2`, two faults could mask a third:
- DR2 also failed from the dump's unsiblinged version;
- DR1 also failed from the strays alone.

Since `5ad60203`, the second dump version carries its own sibling, and both faults have their own proof. With
`if false` in place of the comparison at `restore-lib.sh:119`, the drill prints PASS DR2, and DR1's text loses its
second-version cause when the T10 line is removed. qa confirmed this. The WAL copy of the comparison (`:181`) has its
own single-fault case. DR3, DR10 and DR11 each have a single cause.

## 6. Docs against built output
- **INFRA and `infra/README.md`:** read against the code at the tip. The six drift items found at `7e4b95d2` are fixed
  (`ac42a4d1`), and the F6/F7/DR8 text follows the build. The added text carries no status wording.
- **SECURITY:** `a3574945` and later carry C-73's restore controls and residuals, C-79's uploader and root-written
  windows, and the host-only secrets row.
- **ARCH §7.2** matches the build.

## 7. Ruling corrections (each labelled in `ruling.md`)
- **Re-issue and addenda:**
  - the ruling re-issued whole at `85247470`;
  - Addendum 1 at `17e9414f`;
  - Addendum 2 at `09aeeeb2`, including the correction to R3.
- **R10, `heartbeat_url` as a host-only secret:** `5ee29c4e`, amended per H-1 at `dea63614`.
- **Guards:**
  - `2bf5a6ba`: the suite design;
  - `91d8e94e`: the change key;
  - `450ba87c` and `40eee5f4`, closed by the final line in this commit: the cap of 18, the F6+F8 fallback struck,
    384 s measured with a 36 s margin, and the next real restore to be consolidated first.
- **R7 and R8:**
  - `2d4568e9`: F1, F2;
  - `0114d25b`: F3, F4;
  - `f22ac698`: F5;
  - `5ec6ea61`: the real migration chain, and DR8 FAILs on absent tables;
  - `7e030ed8`: F6, F7;
  - `3913ebfa`: F8.
- **Issue comments still in force:**
  - `e585d393`: DR10 on a probe object, and the marker rule;
  - `3f635dc3`: DR2 and T17;
  - `4eee566c` narrowed by `5fd52dd6`: the WAL single fault.

  `351c9f4c` is superseded.

## 8. Unmeasured, by the issue that inherits it

**POLY-105 (real bucket):**
- whether B2 returns the MD5 as the `ETag` for a single-part PUT, and enforces `Content-MD5`;
- whether B2 refuses the box key's DELETE, or turns it into a hide marker;
- whether `{writeFiles}` alone is enough (E9 with the uploader's argv);
- DR10 on real Object Lock;
- the `b2_list_file_versions` fields as fake-b2 models them;
- rclone 1.76 against `s3.<region>.backblazeb2.com`;
- real Healthchecks pings;
- WAL compression on real activity, against the 10 GB cap;
- OQ-INFRA-11.

**POLY-100 (deploy):**
- `images.env` is written;
- both timers are enabled;
- R6 is called and its exits are honoured;
- the tools image is published and attested;
- the bundle comes from the verified image (R-b);
- the deploy's lock works alongside `backup.lock`;
- `github_read_token` joins `HOST_ONLY` through seceng's pinned-set review. SECURITY's host-only row already names it.

**POLY-103 (monitoring):** the 2 h spool alert, the 26 h `last-upload` alert, the 45-day drill alert, the slot-WAL alert.

**POLY-104 (staging):**
- the ACLs on real LUKS ext4;
- `core: 0` and the host's `core_pattern`;
- the units under real systemd;
- `docker compose run`'s timeout and `rm -f`;
- the `secrets/host/` move, and the `jobs.log`/`last-upload` chown on a provisioned box;
- `backupdb` against real logs;
- the nightly run's duration and its 256 MB limit;
- `CONNECTION LIMIT 3` when the nightly and premigration runs meet;
- the two POLY-95 secret-mode cases, which cannot fail on Docker Desktop and need Linux CI.

**POLY-116 (drill, GA gate):**
- the 60-minute bad-migration recovery, timed;
- DR9 on a ledger schema;
- `fdesetup` on a real Mac;
- whether a `--rm` scratch survives a Docker Desktop restart (the build-review residual);
- timings at real data size.

**CI:** the backup step's time in the `image` job, which devops-99 reports from the PR run.

**For the lead, unhomed:**
- L1, the box-side `restore-apply` route into prod, bound by seceng's (i)–(iii);
- the Principal's D1–D3 (D1 is built as (a), and seceng and I recommend (b));
- D3's daily list-only check, as its own issue.

## 9. Debt and drift (advisory, not gating)
- INFRA §6.7 implies F8 through "listing DR9" but does not say it in words: "a SKIP of any other id with no FAIL is a
  FAIL". One sentence for devops-engineer at the next INFRA touch.
- `HOST_ONLY` has two copies (Python and shell), held equal by a test. A third consumer should read a single data file
  instead.
- `restore.sh`, `restore-lib.sh` and `drill.sh` together are the largest shell surface in the repo. If POLY-116 adds
  more drill logic, move selection and verdict logic into `b2read.py`-style Python with unit tests. Keep the shell for
  the age/docker orchestration only.

## 10. Carried to `b7bde21d`
The verdict carries to `b7bde21d`, which rewrites the shellcheck findings (SC2148, SC2015) in four scripts. I read
each of the seven rewritten lines:
- every `A && B || X` became `if ! { A && B; }; then X` or its De Morgan form, so each is equivalent;
- `# T16` still ends the box-line validation line;
- the patterns the mutants key on (`# T10`, `if [ "$got" != "$want" ]; then`) are unchanged.

No other line changed.
