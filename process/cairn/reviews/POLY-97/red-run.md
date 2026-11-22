# POLY-97 red run (qa-engineer-97)

Tree: worktree of `feature/poly-97-infra-provisioning` at 32cbaf33 plus the tests-red commit. Nothing under `infra/hetzner/`, `infra/provision*` or `infra/operator/` exists. Mac, Docker 29.9.3, Python 3.15, no network to any provider, no `hcloud` run on this machine.

## New tests: 189 red, 6 green by construction (updated for Addenda 2 and 3)

| Suite | Command | Result | Red because |
|--|--|--|--|
| `V:provision-create.test.ts` (36) | `pnpm exec vitest run -c tests/infra/vitest.image.config.ts --exclude '.claude/**' tests/infra/image/provision` | 36 red | `create.sh`/`cloud-init.yaml` absent: rc 127 / ENOENT, shellcheck rc 2; each assertion names the missing behaviour |
| `V:provision.test.ts` (58) | same | 58 red | setup runs the host stage: `cloud-init.yaml` absent (rc 127); each test fails with that message, none skipped |
| `V:provision-db.test.ts` (25) | same | 25 red | same cause (host stage absent) |
| `P:test_*.py` (70) | `python3 -m unittest discover -s tests/infra/operator -t tests/infra/operator -p "test_<name>.py"` ×5 | 70 red | 68 × "infra/operator/<tool>.py does not exist", 2 × missing `b2-capabilities.json` / `dns-allowed.json` |
| `provision-wiring.test.ts` (6) | `pnpm exec vitest run -c tests/infra/vitest.config.ts --exclude '.claude/**'` | 6 green | the CI steps and files they check are part of this commit; they guard the wiring |

Vitest dry-run files: 3 files, 119 tests, 10.5 s red (fails fast; the real green time is measured at build-green). Operator tests: 0.04 s.

## Harness validated, not just red

Throwaway reference scripts (a ~50-line `create.sh`, a ~70-line host stage, a cloud-init file; deleted, never committed) made 23/26 create/cloud-init tests and 18/19 host-stage tests I ran pass; the rest failed for the reference's own sloppiness (a non-idempotent rewrite; shellcheck of absent files). This proves the fakes, snapshots, ACL handling (`docker commit` loses POSIX ACLs, so snapshots are `tar --acls` files), `sshd -T`, `cloud-init schema`, and M1 work. Not validated by any reference: provision-check (H/D), the database stage against Postgres, the Python tools: those are red against absent files only, so devops will meet their first harness gaps there. Fake verbs missing from the fakes exit 99 "FAKE: unsupported …": ask qa to add them.

## Existing suites

- `tests/ci` (21 files, 553): green. `tests/infra` fixture suite (9 files, 326, includes the 6 wiring tests): green.
- `tests/infra/image` existing files (6 files, 81 tests, 84 s): 78 green, **3 red, pre-existing**: `postgres.test.ts` "web is refused a file in postgres's directory…", "a 0440 file in a service directory is refused to an unrelated uid", "an age failure (unreadable recipients file)…". The same 3 fail in the lead's checkout on `main`-based tree with none of my files, so they are not mine: they expect a permission refusal that Docker Desktop's bind mounts on macOS do not give (unverified on Linux CI). Not touched.
- `docker ps` after the runs: no test container left.
