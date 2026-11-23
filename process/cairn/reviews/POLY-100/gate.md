# POLY-100 gate (qa-100) — SIGNED OFF at 2825b6f7: local set green (one Mac-only exception, below) and ci.yml run 45288873465 green on every job

Plan: `test-plan.md` (pins), `red-run.md` (every test shown red on the build before its fix, and every security test on a mutant). Numbers are this Mac, my worktree, one suite at a time. Linux CI is the authority for the container suites and for the Linux-only cases. Sign-off: CI green at the same sha 2825b6f7.

## Results by job

| Job / command | Result | Wall time | Control and budget |
|---|---|---|---|
| ops unit: `unittest discover -p 'test_*.py'` in tests/infra/ops | 469/469 | 76 s (busy Mac); CI Linux 12.3 s at d9547d58 | budget 46 s (architect-100); the Mac figure is load, the CI figure is the measure |
| lint: `vitest run -c tests/infra/vitest.config.ts` | 572 passed, 3 skipped (render-isolation: needs Linux), 0 red | 19.7 s | control (main, 390 tests) 13.7 s = +6 s; budget ≤ 20 s total: met |
| db: `tests/db/runner.test.ts` | 44/44 | 21.1 s | control (main's file) 13.2 s = +7.9 s; budget ≤ 10 s: met |
| provision: `vitest.provision.config.ts` | 190/190 | 85.5 s | control (main, 171 tests) 72.4 s = **+13.1 s**; budget was ≤ 60 s for the box fixture. OVER by the delta: the added tests are the box fixtures (host H23, ops, edge-net, sauth-box); the budget needs the lead's/architect-100's reading, not mine |
| image: `vitest.image.config.ts` | 91/93 | 109 s | the three F1 built-image tests are new (one image build, ≈ 25 s of it); budget ≤ 5 s added: **over** unless CI's cached build says otherwise |
| backup: `vitest.backup.config.ts` | 112/112 | 348 s | quiet machine; infra/backup unchanged on the branch |
| ci: `vitest run -c tests/ci/vitest.config.ts` | 581/587 | — | the 6 reds are `generated-freshness.test.ts` (drizzle-kit): `node_modules/.bin/drizzle-kit` is absent in this worktree, "cannot-run: generator failed"; this branch changes no schema or config. Environment; CI decides |

Reds, with my reading:
- image `postgres.test.ts` ×2 (0440 file ownership refusals): Docker Desktop does not enforce bind-mount uid/gid; CI Linux was green for them.
- `tests/ci` freshness ×6: as above, worktree without drizzle-kit.

## CI, ci.yml run 45288873465 at 2825b6f7 (Linux; the authority)

Every job green: provision 149 s (ops unit step 15 s, dry run 86 s), image 626 s (container tests 134 s, backup suite 333 s), lint 100 s (infra lint fixtures 33 s, `render-isolation.test.ts` included and passing on Linux), db 196 s, unit 319 s. PR #150's last run, for comparison: provision 150 s, image 737 s, db 244 s. This settles the two Docker-Desktop ownership reds and the six `generated-freshness` reds above as this Mac and worktree, not the branch. The Linux-only S31 cases ran for the first time here and passed.

## Acceptance criteria and the proving test

1. Pull-based deploy, verified chain, bundle as data, compose guard, strict edge: `test_deploy*.py` (flow, candidate, bundle, guard, probe, quarantine, secrets, token_lock, edge, help, t13, sauth_gate, policy, state, faults, shared_release, render, render_users, render_prune, judged, hang, oneoff, flags).
2. Rollback within 120 s: T10 (`test_deploy_flow.py`), T-probe, T10q; F2 `test_deploy_hang.py` for a hanging health read.
3. Quarantine: T10, T10q (S18), T11, F11 (`current-guard-<rule>`).
4. Timers and units: `deploy-wiring.test.ts`, `env-wiring.test.ts`.
5. Runbook inputs: T12 (`test_deploy_prod.py`), T13 (`test_deploy_t13.py`); the 60-minute run is POLY-116's.
6. A failing migration file leaves the schema unchanged: `tests/db/runner.test.ts` "a failing file leaves schema and tracking unchanged".
7. Concurrent migrate: T-lock (`runner.test.ts`).
8. Build review F1–F16: one test file per finding (red-run.md, F-table); F1 also built-image (`tests/infra/image/release-bundle.test.ts`).
9. A18 render user: `test_deploy_render.py` RenderUser, `host.test.ts` H23.
10. Option validity of every docker/compose/gh argv (F16/T14): `test_deploy_flags.py`, `tests/infra/flags-real.test.ts`.

## What stays unmeasured, and where it is

- `tests/infra/render-isolation.test.ts` (S31 on the real tools): needs Linux with `unshare`, `setpriv`, root or sudo; written and skipped here; CI's lint job is its first run (ci.yml run 45288873465 at 2825b6f7). Its case 3 control (a remote include connects when not isolated) is unmeasured on CI's Compose.
- The swap-between-two-renders case is a unit case only; the `-f -` re-render as the real render user has no Linux test beyond case 1 to 3.
- T13 as a container case against POLY-99's fake ssh and real restore: not written; the unit version holds the line's grammar against restore's own regexes.
- F4's `up` from the saved file on Linux (a container run, the lead's go-ahead): not run by me.
- S35: no natural mutant for a secret *file* value (secret values never enter a render); the baked-value mutants (print, log) are red.
