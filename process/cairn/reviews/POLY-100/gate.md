# POLY-100 gate (qa-100) — SIGNED at a9d35481: ci.yml run 45343856328 is green on every job

Plan: `test-plan.md` (pins), `red-run.md` (every test shown red on the build before its fix, and every security test on a mutant), `treal-findings.md` (what the real-Linux run found). Local numbers are this Mac, my worktree, one suite at a time; Linux CI is the authority for the container suites and for the Linux-only cases. The scope is the Principal's (`process/DECISIONS.md` @ b23eb989): the branch lands through G12; G13, G14, G15 and a passing real deploy are POLY-162.

## CI at the sign-off sha, against the two earlier runs

| Job (run 45343856328 at a9d35481) | Time | Green run at 2825b6f7 | PR #150's last run |
|---|---|---|---|
| provision | 240 s (ops CLI tests 32 s, dry run 157 s) | 149 s (ops step 15 s, dry run 86 s) | 150 s |
| image | 644 s (container tests 126 s, backup suite 350 s) | 626 s (134 s, 333 s) | 737 s |
| lint | 117 s (infra lint fixtures 42 s) | 100 s (fixtures 33 s) | n/a |
| db | 275 s (battery 246 s) | 196 s | 244 s |
| unit | 300 s | 319 s | n/a |

Readings, plainly: image is inside the range of the two earlier runs; unit is the same; db sits 31 s above PR #150's and 79 s above the 2825b6f7 run on a loop that changed one db file (`runner.test.ts`) and nothing the battery imports beyond `packages/db/src/{migrate,journal}.ts`, so I read it as runner variance, not as added tests. **provision grew by 91 s** (dry run +71 s): that is G10's box cases, G1/H23/H24, G8 and the compose-version fakes in `tests/infra/provision/host.test.ts`; the R13 ruling counts provision as added time with a 60 s allowance and this is over it by about 30 s. It is the one budget I am not signing as met: it needs architect-100's word or a trim of the box cases. lint grew by 17 s (the flags, compose-cwd, deploy-key and compose-pin suites).

## Local counts at a9d35481 (this Mac)

| Suite | Result |
|---|---|
| ops unit: `unittest discover tests/infra/ops` | 555/555, 116 s (busy machine; CI shows the ops CLI tests at 32 s) |
| lint: `vitest -c tests/infra/vitest.config.ts` | 576 passed, 3 skipped (`render-isolation`, which needs Linux and ran in CI), 22 files, 22.8 s |
| `tests/ci` | 641 passed, 6 failed: all six are `generated-freshness` (drizzle-kit is not installed in my worktree); green in CI |
| provision config | 198/198 (last run at a9d35481's parent, after the cli pin moved), about 100 s |
| image config (container tests) | 93 tests, 91 pass here and the two Docker-Desktop ownership cases do not; green in CI (126 s). Last run on this Mac before G10; not re-run at the sha |
| backup suite | 112/112, last run on this Mac at 2825b6f7; green in CI (350 s). Not re-run at the sha |
| db: `tests/db/runner.test.ts` | 44/44, last run at 2825b6f7; the db job is green in CI |

## Acceptance criteria (POLY-100.md, all seven ticked) and the proving tests

1. An unverified image is never run: `test_deploy_candidate.py` (V1 argv, label alone does not bind), `test_deploy_flow.py::test_t7_…`, the guard cases (`test_deploy_guard.py`, `compose-real.test.ts`), `test_deploy_judged.py` (F9).
2. A failed attestation, a bad tag signature and a wrong commit label each stop and alert: `test_deploy_candidate.py`, `test_deploy_prod.py`.
3. An unhealthy release rolls back within 120 s and is quarantined; a failing migration leaves the old containers running: `test_deploy_flow.py` (T10, T11), `test_deploy_hang.py`, `test_deploy_budget.py` (G7), `test_deploy_unwind*.py` (G2).
4. The script never rewrites itself: `test_deploy_flow.py::test_t7_…`, `test_deploy_render.py`.
5. The bad-migration runbook's inputs are proven: `test_deploy_t13.py`.
6. A failing migration file leaves tracking and schema as before: `tests/db/runner.test.ts` "a failing file leaves schema and tracking unchanged (one transaction)".
7. Two migrate runs together: the second waits on the advisory lock and applies nothing: `runner.test.ts` T-lock.

Every finding of the three reviews (F1–F16, G1–G12, S31–S40) has its tests and its mutants in `red-run.md`, each shown red before the fix; the cases that stay green under a mutant are listed there as equivalent or layered, with the reason.

## Not proven here

- **T-real did not run in CI.** It runs on a real Linux box (root, Docker, Compose, a registry answering as ghcr.io) and is switched off on this branch (its steps are on `feature/poly-162-deploy-test-passing`); the files, the `deploy` key and the classifier pins are here. It ran only in a privileged Ubuntu container on this Mac (recipe in `treal-local-container.md`), where it got as far as the health window.
- **No real deploy has completed.** The first-deploy flow reached `up` for real (install, images, render, guard, check-config, plan, migrate) and then stopped at health: web serves nothing on port 3000 until the public listener (G15) exists, and the worker has no command (G14). So the healthy path, a rollback after a real unhealthy window, and quarantine on real Docker are **unproven**; they are proven against fakes only.
- **G10's box cases** (`host.test.ts`: the exact-version install and the single hold, the downgrade, an unlisted version, provision-check on other versions) are written red-first and green in CI's provision dry run, but I made **no mutants** for them.
- **G13** (the `polycarpic` database is not created by anything), **G14** (command and entrypoint pinned for every service, the worker's command), **G15** (the public health listener): no tests on this branch; POLY-162 owns them (my G15 test file is `temp/…public-health.test.ts`, handed to POLY-162).
- **POLY-160** (the lesser findings of the third review), **POLY-161** (the real web server that replaces the health listener) and **POLY-162** (a deploy test that passes end to end): named by the Principal's scope decision, not touched here.
- The S31 cases on real tools (`render-isolation.test.ts`) and the G11 real-Compose cases (`render-cwd.test.ts`) ran green on CI's Linux (lint job); not on this Mac (no `unshare`).
- Compose is pinned at 5.7.1; a box on another Compose is `render-env` by design (G10). The bind rule stays strict.

## What I changed my mind on, and why

Three of my own tests were wrong and were fixed, not the product: the F15 "still there after rm" case stayed green with its mutant removed (the fake showed the stuck container too early); G8's "script with the words" case was masked by an adjacent-words glob quirk (told to devops-100); G5's stdout case needed an empty stderr to bite. Each is in `red-run.md`.
