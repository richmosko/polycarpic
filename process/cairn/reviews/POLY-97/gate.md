# POLY-97 gate 3: qa sign-off run

Tip tested: 38cd64bd (branch `feature/poly-97-infra-provisioning`, tree clean, build ea78daae plus my fixture change). Mac, Docker 29.9.3, machine quiet (no other containers of mine; devops and seceng reading). `docker ps` after: clean.

## 1. The run

| Suite | Result | Time |
|--|--|--|
| Dry run, 3 vitest files (create 36, host stage + H 64, database stage + D 25) | **125/125** | 83.4 s |
| Python operator tools, 5 files | **70/70** | 0.06 s |
| CI wiring (6, inside the fixture suite below) | 6/6 | — |
| `tests/infra` fixture suite (9 files, includes wiring) | **326/326** | 12.5 s |
| `tests/ci` (21 files) | **553/553** | 9.0 s |
| Existing image suite (6 files) | 78/81; the 3 red are the known pre-existing `postgres.test.ts:113,:121,:184` (`expected +0 not to be +0`, macOS bind mounts; same on the lead's checkout before any of this work) | 83.5 s |
| shellcheck of the 3 scripts, in the test container | exit **0** | — |

**Suite-time delta against `main` today** (main = `git archive origin/main` extracted to a scratch dir, same machine, same minute; main has no `.git`, so 8 `tests/ci` cases that need one fail there and are ignored for time): `tests/ci` 553 tests 8.9 s on main vs 553 tests 9.0 s here (+0.1 s); `tests/infra` fixture 320 tests 12.7 s vs 326 tests 12.5 s (+6 tests, no measurable time); existing image suite unchanged (no file in it was touched; 83.5 s); **new**: dry run +83.4 s, Python +0.06 s.

**Dry run vs the ruling's 60 s local guard: 83.4 s (86.0 s on the previous run).** Over the guard by about 23 s. The cost is container start (about 0.25 s × 125 tests plus three host-stage snapshots and four Postgres starts); the db file alone is 31 s. Not reduced by anything cheap I can do without sharing state across tests. The ruling's CI guard (added `image` steps ≤ 120 s) is measured on the first green CI run, not here.

## 2. Audit: every ruled item against the tree

Grepped the three vitest files, the five Python files and the wiring test for each id and fault; every item below has at least one passing test (all 125 + 70 + 6 pass).

- H1–H15 (+ INFO H12b), D1–D6: one or more planted-fault tests each with id, found value and `— fix:` asserted, plus a positive case (H8, H12, H13, H15, D3, D5, D6 have their own positive).
- R9: wildcard, CNAME other / pointing elsewhere, pinned value (DMARC, DKIM + re-pin fix text, MX), two records, proxied, NS below apex, app/staging address, absent allowed, A/AAAA/CAA at each CNAME target (6 plants), fail-closed on `result_info` and `success:false`, pagination.
- Addendum 1: DMARC without `rua`, `ruf` fails, three CAA rows, exact TXT comparison and 255-byte join, case-insensitive names/CNAME, `authorizationToken` never printed (H12 success and failure, b2-setup, DNS tools), S7/H15 (AllowUsers, sudoers exact/0440, other sudoers file, second login account), S8 D1 extras.
- Addendum 2/3: D3 probe by reason with hygiene (tmpfs, `require_auth`, `:ro`, no `-e`, no password in output or call log), D5 staging (no verifier; a planted one fails), ssh key file (5 refusals; `"` `'` `:` `#{}` comments dropped; plain key accepted).
- pins-review 3a–c (flag wins, missing flag / unreadable file is FAIL H12 never WAIT) and 5a–b (one-device glob both ways, wipefs `--no-act` only, luksFormat on LUKS refused).
- M1 (spool as 999/10004/10005, chmod 0600 trips H7), M2 (success and forced failing ALTER, log sweep), R10 sweeps.

**No ruled item lacks a passing test.** Not testable here, and so not in the suite: R12 E1–E9 (the Principal's real run); the Docker apt key against Docker's real key (only the pinned-fingerprint branch and its refusal); `userland-proxy: false` and the address-pool check against a live daemon (fake `docker info`); B2/Cloudflare/Hetzner live shapes; R7's four-file copy (a runbook step); R11 docs. Pin 1 (Python `main()` signature) was never ruled; the architect's pins-review accepted it.

## 3. CI run 45046572609: red `guard` job

The step is `gitleaks … --redact --log-opts "origin/main..HEAD"`; its log prints only `32 commits scanned … leaks found: 1`, with no rule or file. I could not run gitleaks here (the auto-mode classifier refused to execute the downloaded binary), so I reproduced the rule's regex and 3.5-bit entropy threshold in Python over the branch diff. Two of my fixtures scored far over it: `cfFIXTURETOKENabcdefghijklmnopqrstuvwx` (5.0 bits, `tests/infra/operator/base.py`, key name contains `token`) and `hcloudFIXTURETOKEN0123456789abcdefghijklmnopqrstuvwxyz012345` (5.4 bits, `tests/infra/operator/test_laptop_check.py`, `token = "…"`): almost certainly the generic-api-key finding. Three lower ones (3.6–3.9 bits) were changed too. **Fix at the source, no allowlist: every fixture secret is now a repeated-character placeholder (`cftoken-bbbb…`), under 3 bits, same distinctness; the scan finds nothing at or above 3.5 in the branch diff.** Caveat: gitleaks scans every commit in the range, and the old values are still in earlier commits of this branch. HEAD no longer has them; a green guard needs those commits rewritten (squash before the PR) or a fresh range. That is the lead's call; I did not rewrite history.

## Verdict

PASS for tests: 125 + 70 + 6 new green, existing suites unchanged (3 known pre-existing reds), shellcheck 0, no untested ruled item. Open for the lead: the dry run is 83 s against a 60 s guard; the guard job needs the history point above.
