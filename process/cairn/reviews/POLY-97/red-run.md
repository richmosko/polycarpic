# POLY-97 red run (qa-engineer-97)

Tree: worktree of `feature/poly-97-infra-provisioning` at 32cbaf33 plus the tests-red commit. Nothing under `infra/hetzner/`, `infra/provision*` or `infra/operator/` exists. Mac, Docker 29.9.3, Python 3.15, no network to any provider, no `hcloud` run on this machine.

## New tests: 195 red, 6 green by construction (authority 1eafa6c5 + pins-review a483460d)

| Suite | Command | Result | Red because |
|--|--|--|--|
| `V:provision-create.test.ts` (36) | `pnpm exec vitest run -c tests/infra/vitest.image.config.ts --exclude '.claude/**' tests/infra/image/provision` | 36 red | `create.sh`/`cloud-init.yaml` absent: rc 127 / ENOENT, shellcheck rc 2; each assertion names the missing behaviour |
| `V:provision.test.ts` (64) | same | 64 red | setup runs the host stage: `cloud-init.yaml` absent (rc 127); each test fails with that message, none skipped |
| `V:provision-db.test.ts` (25) | same | 25 red | same cause (host stage absent) |
| `P:test_*.py` (70) | `python3 -m unittest discover -s tests/infra/operator -t tests/infra/operator -p "test_<name>.py"` ×5 | 70 red | 68 × "infra/operator/<tool>.py does not exist", 2 × missing `b2-capabilities.json` / `dns-allowed.json` |
| `provision-wiring.test.ts` (6) | `pnpm exec vitest run -c tests/infra/vitest.config.ts --exclude '.claude/**'` | 6 green | the CI steps and files they check are part of this commit; they guard the wiring |

Vitest dry-run files: 3 files, 125 tests, 10.2 s red (fails fast; the real green time is measured at build-green). Operator tests: 0.04 s.

## Harness validated, not just red

Throwaway reference scripts (a ~50-line `create.sh`, a ~70-line host stage, a cloud-init file; deleted, never committed) made 23/26 create/cloud-init tests and 18/19 host-stage tests I ran pass; the rest failed for the reference's own sloppiness (a non-idempotent rewrite; shellcheck of absent files). This proves the fakes, snapshots, ACL handling (`docker commit` loses POSIX ACLs, so snapshots are `tar --acls` files), `sshd -T`, `cloud-init schema`, and M1 work. Not validated by any reference: provision-check (H/D), the database stage against Postgres, the Python tools: those are red against absent files only, so devops will meet their first harness gaps there. Fake verbs missing from the fakes exit 99 "FAKE: unsupported …": ask qa to add them.

## Existing suites

- At 14788740: `tests/ci` 21 files, 553 tests green; `tests/infra` fixture suite 9 files, 326 tests green (includes the 6 wiring tests).
- `tests/infra/image` existing files (6 files, 81 tests), run at 14788740 with `--exclude 'tests/infra/image/provision*'`: 78 green, **3 red, pre-existing on this Mac** (same 3 in the lead's checkout without any of my files). Each fails the same first line, `AssertionError: expected +0 not to be +0` at `expect(<run>.code).not.toBe(0)` (a permission refusal that Docker Desktop's macOS bind mounts do not give; unverified on Linux CI):
  1. `postgres.test.ts:113` "web is refused a file in postgres's directory, and postgres in web's (0440 root:gid is not world-readable)"
  2. `postgres.test.ts:121` "a 0440 file in a service directory is refused to an unrelated uid"
  3. `postgres.test.ts:184` "archive_command: age, fail closed … an age failure (unreadable recipients file) -> non-zero, no .age, .inflight empty"
  Any other red in that suite at build-green is a regression.
- `docker ps` after the runs: no test container left.

## Harness fixes during the build

All in `tests/**`; no assertion was weakened. Each row: what the test asserted before, and after. At the sha of this section all three dry-run files run clean against devops's build: `provision-create` + `provision` 100/100, `provision-db` 25/25.

| # | Gap | Fixed at | Before → after |
|--|--|--|--|
| 1 | `CHECK` not imported in `provision.test.ts` (ReferenceError in 5 tests) | ec0c768c | import added; assertions unchanged |
| 2 | `waitPg` compared untrimmed psql output | c808535a | `out === '1'` → `out.trim() === '1'`; same readiness test |
| 3 | `STAGE()` built `…password\n; bash …` (syntax error) | b3dae06c | `.trim()` on the point lines; same commands |
| 4 | M2 forced failing ALTER: `CREATE EVENT TRIGGER … ON ALTER ROLE` is refused by Postgres 17 | b3dae06c | trigger plant replaced by the fake psql (`psql-break-alter`) rewriting each verifier line to `ALTER ROLE <r> BREAKME …`. **The rewritten statement still carries the real verifier** (sed inserts one word, touches nothing else), and Postgres rejects it ("unrecognized role option"), so the error-statement path runs; the log sweep (no `SCRAM-SHA-256$`, no plaintext, nothing of any generated secret) is the same assertion as before and proves M2's case D (`log_min_error_statement = panic` keeps the failing statement out of the log). Without the script's SET, Postgres would log that statement, so the test is not vacuous. Control assertion changed from `/planted failure/` to `/unrecognized role option\|syntax error/` (same intent: the ALTER failed inside Postgres) |
| 5 | `point()` ended in a newline (`…\n; touch …`) in the failing-ALTER and `--project` runs | fe92c630 | `.filter(Boolean)`; same commands |
| 6 | idempotency `rc=0\n1$` vs untrimmed output | fe92c630 | `/rc=0\n1\n?$/` (formatting only; same two facts) |
| 7 | the sweep's secret list: `cat secrets/*/*` concatenated files that carry no trailing newline into one value, so `not.toContain` checked one giant string and `vals.length > 5` failed | this commit | one value per file (`for f; do cat; echo; done`): **stricter**, three uses |

Gap 8, none: no other harness error appeared in the 125 dry-run tests against the build. Containers: `docker ps` shows only `boring_goldstine`, not mine (names `poly97-pg*`); my networks and Postgres containers are removed by `afterAll`.

| 8 | `test_dns_records` expected-set key stripped every trailing quote, so CAA `0 issue "letsencrypt.org"` could never match | next commit | strip on all content, now only on TXT (CAA compared exactly as sent); not weakened |

| 9 | `test_b2_setup` probe: `line(out+err, "master")` returns the first line containing "master" (the opening instruction), so the still-live regex could never match | 5ef6a2d0 | `line(out+err, "master", "still")`; same regex `still (live|valid|authori)`; not loosened |
| 10 | second-firewall test: jq `[a \| length, (b), (c)]` pipes everything after the bar into the array ("Cannot index array") | 5ef6a2d0 | each element parenthesised; same three expected counts `[1,0,1]` |
| 11 | dry-run files moved by the CI remedy (provision-create/provision/provision-box to tests/infra/provision/, box.ts, pg.ts); D checks run on the pinned base image, not the derivative | 0393d972 | imports only; the D1-D6 and summary assertions are unchanged; the database-stage tests keep the derivative |

| 12 | F1 "nbg1 was asked" test matched `--location` anywhere in the output, so the change line also satisfied/violated it; devops reworded the change line to pass | this commit | the fallback is asserted on the hint line itself (the line saying "no stock", requires the OTHER location, forbids the asked one), and a new assertion requires the `change: hcloud server create` line to keep `--location <asked>` (R1). Stricter, not looser |
