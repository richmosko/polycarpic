# POLY-137c: gate (qa-engineer)

**Verdict: PASS** at `13c1e405576b17cd7c3cca617af293e92bc26cdb` (the build at `c74a8920` plus review commits plus one test file: `tests/db/second-step-gates.test.ts`, whose r13c ids collided with a fixed uid once the file grew). A clean tree at that sha: `.svelte-kit`, `build`, `test-results`, e2e `.auth`, vite and vitest caches and `.turbo` deleted, `pnpm install --offline --frozen-lockfile`, then `svelte-kit sync`. Machine quiet (nothing else running). Two CI-only fixes follow this gate in a later commit (below); they touch `infra/ci/image.sh` and one test's timeout, not the product.

## Steps at 13c1e405

| Step | Result |
|---|---|
| `scripts/layers/check.mjs`, `eslint packages apps scripts/layers`, `check-migrations` | exit 0 each |
| `turbo run typecheck --force` | 20 of 20, none cached, exit 0 |
| `vitest run tests/layers` | 556 passed |
| `tests/ci` | 553 passed (21 files) |
| `tests/infra` (lint, wiring, lint-sc, auth-service) | 187 passed, including the compose-policy "repo itself is clean" |
| `tests/config` | 97 passed (15 skipped) |
| `turbo run test --force` (every package from its own directory) | 19 of 19, none cached, exit 0 |
| `tests/db` full, both projects | 58 files, 1400 passed, 2 expected fail, 148 s |
| e2e full (`turbo run e2e --force`, Chromium) | 80 passed, 2 m 43 s |
| `tests/infra/image` (`vitest.image.config.ts`, the container files) | 38 passed, **3 failed**, all in `postgres.test.ts` (two secret-file permission cases, one age-failure case). The same three fail on `origin/main` in this environment (Docker Desktop on macOS: file-permission semantics), so they are environmental and CI's Linux runner covers them. Not caused by this loop |

## Findings during the gate (all closed)

1. At `2f65e869`: `tests/infra` compose-policy lint failed (`${MAIL_FROM}` raw interpolation in `prod.yml` and `staging.yml`). Fixed by the builder at `c74a8920`; green above.
2. At `2f65e869`: `second-step-gates` r13c, a duplicate `user_pkey`. Mine: `uid(960 + n)` reached `uid(990)`. Moved to `uid(7000 + n)`; green above.
3. **MAIL_FROM delivery, asked by the lead.** A rendered `docker compose -f prod.yml config` contains no `MAIL_FROM`, and equally no `TLS_MODE`, `PUBLIC_ORIGIN` or `APP_ENV`: no compose file lists or interpolates a host setting, and the compose policy forbids `env_file`. So nothing in this repository delivers `MAIL_FROM` from `/etc/polycarpic/host.env` to `auth` and `worker`; that path is the ops bundle's (INFRA D-1 names it), the same as for every other host setting. No test can cover it here. The fail-closed side is covered: a staging or production `auth` or `worker` without the key and `MAIL_FROM` refuses to start (`packages/config/src/mail-137.test.ts`), so a delivery gap shows at the first deploy rather than as silent mail loss.

## The db time against a same-day control on main

Same machine, same day, one extra Postgres container at a time, nothing else running. Control: `origin/main` (`d8cbd541`) extracted with `git archive` to a scratch directory, installed offline, `vitest run -c tests/db/vitest.config.ts`.

| Run | main (53 files, 1192 tests) | branch (58 files, 1402 tests) |
|---|---|---|
| 1 | 138 s | 148 s (the gate run at `13c1e405`) |
| 2 | 116 s | 147 s |
| 3 | 114 s | 150 s |

The branch runs 2 and 3 were at `2f65e869` plus the test-id fix (before the compose change, which no db test reads). Main's control runs carry 33 failures in `ops-status` and `ops-hardening` that fail fast in a scratch directory (environmental), so main's times are a lower bound. Delta: about +30 s (+27 %) for 5 more files and 210 more tests, i.e. roughly 0.14 s per added test, in line with the suite's existing cost. The five new files are in the `auth` area; `gate-check-role-setting` runs in the serial project.

## What was run once, and where it stands

- Single-file db runs of every `tests/db` file in the auth area, `pgtap` and `gate-check-membership` were run while migrating (see the commit history); the full run above supersedes them.
- Rows: POLY-137's 15 rows are ticked with their proving tests (each line carries its `**Proof:**`).
- Mutations: every test that was green on arrival has its mutation recorded in `red-run.md` (raw-path pair, signed-in `/API/AUTH` pair, `accountLockout`, lockfile, refused-by-hook).
