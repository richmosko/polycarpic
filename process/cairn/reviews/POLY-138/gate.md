# POLY-138 gate (build-green), qa-engineer, 2026-11-21

Tree: `4b98851c5c4903dbf302f6f44f0ec2230ffe7c16` (the build), clean, `.vite`, `.vitest-cache`, `.vite-temp` and `__pycache__` deleted first; turbo
forced (`--force`). One later commit, `eb3e43fd`, changes only `tests/infra/image/caddy-edge.test.ts` (the R3 502 cases run in parallel).
The image-job result below is at `eb3e43fd`; every other row is at `4b98851c` and the file `eb3e43fd` touches is read by none of them.

| Suite | Result |
|---|---|
| `tests/infra` (lint fixtures, static, workflow, report) | 8 files, 290 pass |
| `tests/ci` | 20 files, 542 pass |
| `tests/layers` | 8 files, 545 pass |
| `tests/image` (static; `POLY_IMAGE_BUILD` build cases skipped, as in CI) | 40 pass, 15 skipped |
| `tests/workflow` (`scripts/cairn/run_tests.py --gate green`) | 2017 tests, OK (4 skipped) |
| image job `vitest.image.config.ts`: Caddy (edge, adapt, adapt-edge, build, headers) and Postgres container tests | 78 pass, **3 fail** = the POLY-143 three (below) |
| `tests/db/connection.test.ts` (SHOW server_version = FROM minor, pgtap image) | 10 pass |
| `pnpm run lint`, exit code read | 0 |
| `turbo run typecheck --force` | 0 (19 of 19, none cached) |
| Renovate validator on the built `renovate.json` (digest-pinned image, `--strict`) | exit 0, "Config validated successfully" |

## POLY-143 failures against the same control

The same three fail on a control, and no others: "web is refused a file in postgres's directory…", "a 0440 file in a service
directory is refused to an unrelated uid", "an age failure (unreadable recipients file)…". Control = `origin/main` @ `d8cbd541`
extracted with `git archive` into a scratch dir, `pnpm install --offline --frozen-lockfile`, same image config: 3 fail, 38 pass
(41 tests), on the same Mac the same day.

## Image-job time against the same-day control

Image job = `vitest run -c tests/infra/vitest.image.config.ts`, images warm in the Docker cache both sides, one test file at a time.

| | runs | mean |
|---|---|---|
| control, `main` @ `d8cbd541` (41 tests) | 40, 47, 45 s | 44 s |
| this branch @ `eb3e43fd` (81 tests) | 85, 94, 84 s | 88 s |

Delta **+44 s** against the ruled guard of +30 s (an unmeasured estimate in the ruling): **over by about 14 s**. Per file at `eb3e43fd`:
`caddy-edge` ~35 s (it was 97 s at `4b98851c`: every 502 waits out `lb_try_duration 10s`, and the R3 cases sent 8 serial requests;
sending them in parallel took 62 s out), `caddy-adapt-edge` 2 s, `caddy-build` 3 s, `postgres` 26 s (the control's postgres file, plus one case).
At `4b98851c` the delta was +105 s. Not measured: a cold image build (`--no-cache` xcaddy). The Dockerfile change since main is two digests,
so the +180 s xcaddy allowance is untouched in principle, but I did not time it.

## Verdict

PASS on every suite and on lint and typecheck. One guard is exceeded and is the lead's call: the image job costs +44 s, not +30 s.
The remaining cost is the R3 stopped/closed cases (10 s retries by design) and four containers per run. Cutting it further means
dropping the two stack-level R3 regression cases (addendum 1 says they gate nothing) or sharing one echo stack across more files.

Not run: the cold `--no-cache` Caddy build; `image.sh scan` (Trivy).
