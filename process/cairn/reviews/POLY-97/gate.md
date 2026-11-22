# POLY-97 gate 3: qa sign-off run (final, at the build tip 6636ee24)

Tip tested: 6636ee24 (branch `feature/poly-97-infra-provisioning`, tree clean; includes devops's probe C1 flag `--s3-no-head` and the three probe outcomes, and my test fixes). Mac, Docker 29.9.3, machine quiet. `docker ps` after: clean.

## 1. The run

| Suite | Result | Time |
|--|--|--|
| `provision` job locally: `vitest.provision.config.ts`, 3 files in parallel (create 38, host stage + H 64, D checks + summaries 18) | **120/120** | 49.1 s |
| Python operator tools, 5 files | **83/83** | 0.11 s |
| shellcheck of the 3 scripts, in the test container | exit **0** | — |
| `tests/infra` fixture suite (9 files, includes the 6 CI-wiring tests) | **327/327** | 12.4 s |
| `tests/ci` (21 files) | **573/573** | 9.8 s |
| `image` job locally: existing image suite (81) + `provision-db.test.ts` (9, the database stage and M2 sweep) | 87/90; the 3 red are the known pre-existing `postgres.test.ts:113,:121,:184` (`expected +0 not to be +0`, macOS bind mounts; also red on the lead's checkout before this work) | 91.0 s (database-stage file 8.6 s of it) |

**Suite-time delta against `main`** (measured at the previous gate run on `git archive origin/main`, same machine): `tests/ci` 8.9 s → 9.8 s (553 → 573 tests, +20 for the provision area rows); `tests/infra` fixture 12.7 s → 12.4 s (320 → 327 tests); the `image` job's local time grows by 8.6 s (the database-stage test only); the new `provision` job is 48.7 s locally. The ruling's local guard was 60 s for the dry run: **met after the architect's split (48.7 s vs 83 s serial)**. CI limits (architect, pins-review @ 5b2a5e90: `provision` ≤ 200 s, `image` ≤ 290 s) are judged on the next two CI runs, not locally.

## 2. Audit: every ruled item against the tree

Grepped the three provision files, `provision-db.test.ts`, the five Python files and the wiring test for each id and fault: none without a test, all pass.

- H1–H15 (+ INFO H12b), D1–D6 with id, found value and `— fix:`, plus positives.
- R9 faults, target health, fail-closed, pagination; Addendum 1 (DMARC pin, `ruf`, three CAA rows, exact TXT, `authorizationToken` never printed, S7/H15, S8 D1 extras); Addenda 2/3 (D3 probe by reason with hygiene, D5 staging, ssh key file); pins-review 3a–c and 5a–b; M1, M2 and R10 sweeps.
- Added since the last gate, all green on the build: build-review C2 (the probe says `listBuckets is needed` only on AccessDenied or B2's not-entitled wording, never with a credential or clock error present; bare 401/403 is INCONCLUSIVE), C1 (`--s3-no-head` in the probe argv, with a runner that refuses calls without it), the probe's three outcomes (`writeFiles alone is enough` / `listBuckets is needed` / `INCONCLUSIVE`, rclone missing inconclusive), B1 (probe via rclone's S3 backend), B2 (unrestricted key that can write = FAIL, read-only = WARN, another bucket = silent), probe master-key regeneration and 401, CAA as `data` with content-only / data-only / both list replies, second-firewall drift (detach, never delete), the A-M2 mutation case (the verifier does reach the log without the two SETs), staging stage (five roles authenticate, `poly_backup` has no verifier), and the CI wiring of the new `provision` job (changes key and paths, aggregate REQUIRED, budget).

**No ruled item lacks a passing test.** Not testable here and so not in the suite: R12 E1–E9 (the Principal's real run); the Docker apt key against Docker's real key (only the pinned-fingerprint branch and refusal); `userland-proxy: false` and the address-pool check against a live daemon (fake `docker info`); B2/Cloudflare/Hetzner live shapes (including the unmeasured `s3ApiUrl` and CAA `data` shapes); R7's four-file copy (a runbook step); R11 docs.

## 3. gitleaks

Settled by the lead and seceng: two reviewed fingerprints in `.gitleaksignore`, gitleaks 8.30.1 clean on `origin/main..df34376b`. My part: the two high-entropy fixture tokens in the tests were replaced by low-entropy placeholders (c61d6b68); new fixtures stay under 3 bits.

## Verdict

**PASS** for tests at 6636ee24: 120 + 83 + 6 wiring green, shellcheck 0, `tests/ci` and `tests/infra` green, existing image suite unchanged (3 known pre-existing reds), no untested ruled item, dry run within the local guard after the split. Open, not mine: CI limits for `provision` and `image` on the next two runs.
