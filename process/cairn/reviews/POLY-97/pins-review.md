# POLY-97 contract pins review (architect)

architect-97, 2026-11-22. Reviewed: `test-plan.md` lines 5–14 at `903638b0`, pins 1–5 and 8. Pins 6 and 7 are being rewritten
by qa and are not reviewed here. Authority: `ruling.md` at `1eafa6c5` (Addenda 1–3). No pin contradicts the ruling.
Three pins need one stated precision, which the build follows.

| Pin | Result | Note |
|---|---|---|
| 1 cloud-init placeholder, `users:`, `write_files:` | Consistent with R2, Addenda 2 and 3 | The substituted text is `ssh-ed25519 <base64>` only (Addendum 3). |
| 2 Python `main(...)` with injected transport, getpass, input, runner | Consistent with R3, R8 | The R3 base class still replaces `urllib.request.urlopen` and `socket.create_connection` with raisers. The injected seam does not replace that guard. |
| 3 `b2-capabilities.json`, `--b2-capabilities`, `--b2-bucket` | Consistent with R6, which puts the constant in that file; it extends R7 | See precisions 3a–3c. |
| 4 R7 layout: three scripts side by side | Consistent with R7 | `roles.sql` is found relative to the script's own directory, never through the cwd. |
| 5 `/dev/disk/by-id/scsi-0HC_Volume_*`, detection verbs | Consistent with R5 | See precisions 5a and 5b. |
| 8 relative names in DNS output, the `dns-allowed.json` strings | Consistent with R9 and Addendum 1 | — |

## Precisions

- **3a.** R7's copy list becomes four files: `provision.sh`, `provision-check.sh`, `roles.sql`, `b2-capabilities.json`.
  devops's INFRA step 11 text names all four.
- **3b.** There is one source for each value. The file holds the capabilities. The bucket comes from `--b2-bucket`
  alone, because it is per-instance (INFRA names it `polycarpic-<yourname>-backups`). A `bucketName` key in the file is
  either dropped or ignored. If both are kept, a test shows that the flag wins.
- **3c.** If either flag is missing or the file is unreadable, H12 is `FAIL … fix: pass --b2-capabilities <file>
  --b2-bucket <name>`. It is never WAIT and never a skip. WAIT stays reserved for "the credential file is absent".
- **5a.** The glob must match exactly one device. If it matches zero or more than one, provision stops (exit 1, nothing
  written) and names the matches. A planted second device is a test.
- **5b.** `wipefs` is called only with `--no-act` (`-n`). The fake exits non-zero on any `wipefs` without it, so a
  destructive call fails the dry run. The same applies to `luksFormat` on a device that `isLuks` reports as LUKS: the
  fake refuses it, so R5's "never reformatted" is tested.

## 2026-11-22 — CI guard tripped: the remedy (applies the ruling's Guards rule)

Measured by devops on one Linux run (45046572609): `image` took 407 s, against 242–260 s on the POLY-137 branch. The breakdown is about 165 s added: the test container build 47 s, shellcheck 2 s, the dry run about 115 s. The limit is 120 s. One run is enough for this decision, because the overshoot is larger than any run-to-run spread seen on `image`.

**Ruling: a new job, `provision`.** Everything this loop added to the `image` job moves there, except the database-stage test.
- **What moves:**
  - the test container build;
  - shellcheck;
  - `python3 -m unittest discover -s tests/infra/operator`;
  - every dry-run vitest case: create.sh, the host stage, the H checks, the D checks and the summaries against the fake `docker`.

  These need no built image. The dry-run tests move to `tests/infra/provision/` with their own `vitest.provision.config.ts`, and the image config no longer picks them up.
- **What stays in `image`:** the database-stage test (R5: the SCRAM verifier and the log sweep), because it needs the Postgres derivative that `image` builds. Split it out of `provision-db.test.ts`.
- **Change filter.** `infra/ci/changes.mjs` gains an area `provision`:
  - its paths are `^infra/hetzner/`, `^infra/provision(-check)?\.sh$`, `^infra/operator/` and `^tests/infra/(provision|operator)/`;
  - the `image` area gains a lookahead excluding `infra/(hetzner|operator)/` and `tests/infra/(provision|operator)/`;
  - `infra/provision.sh` stays in `image` too, because the database-stage test runs it.
- **Aggregate.** `ci.yml`'s `app` needs `provision`. In `infra/ci/aggregate.mjs`:
  - `REQUIRED` gains `provision: ['provision']`;
  - `provision` is added to the list of job results that must be present;
  - the `tests/ci` structure tests that tie `aggregate.mjs` to `ci.yml` cover the new job.

  A provisioning failure must block a merge.
- **Limits.**
  - `provision` ≤ 200 s wall, recorded in `infra/ci/budgets.json`.
  - `image` returns to within 30 s of its POLY-137 range (≤ 290 s); the database-stage test is the only addition left there.
  - Both are judged on the next two runs, not one.
- **Allowed time cut, not required.** Read-only positive cases may share one container snapshot taken after the host stage (`docker commit`, or one long-lived container per file). Each planted-fault case still starts from the clean snapshot, never from another fault's leftovers.
