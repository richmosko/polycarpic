# POLY-100e verdict: pull-based deploy and timers

Architect. Judged on `a9d35481` (product, tests, CI config); everything after it on the branch is documents. Scope: the ruling through G12
(`ruling.md`, `process/DECISIONS.md` @ `b23eb989`).

**Verdict: PASS WITH FOLLOW-UPS, on three of the four classes. The fourth, "a bad release stays running", is NOT MET. The Principal accepted it
into POLY-160 as a gate (`process/DECISIONS.md` @ `53cbf119`), which POLY-104 waits on.** No real deploy has completed.

| Axis | Result | Evidence |
|---|---|---|
| An unverified release runs | nothing found | reading; `test_deploy_candidate.py`, `test_deploy_flow.py`; `red-run.md`; seceng third review @ `8a873388` |
| The compose guard is bypassed | nothing found | reading; `test_deploy_guard.py`, `test_deploy_judged.py`, `test_deploy_render*.py`, `render-isolation.test.ts` on CI's Linux; seceng, same |
| Data is lost or exposed | nothing found (H3 below is close: a failed save on a first prod deploy leaves backup timers off) | reading; `test_deploy_t13.py`, `test_deploy_prod.py`, `runner.test.ts`; seceng, same |
| A bad release stays running | **accepted, not met (H1)** | `build-review.md` H1, shown on the harness (R1, R2, R4); I read the same code, agree, and had missed it. Rollback inside a run: G2 tests, on fakes |
| Criteria 1–7 | met on fakes and CI, within the limits below | `gate.md` @ `55e483e9`, the list under Acceptance criteria |
| CI | green on every job | ci.yml run 45343856328 |
| seceng | FAIL on H1 by the letter of class 4; PASS WITH FOLLOW-UPS if accepted into POLY-160, which it was | `build-review.md` @ `8a873388` |
| qa | signed, except the provision budget | `gate.md` @ `55e483e9` |
| Suite budgets | image, lint, db: ruling R13's table. **Provision: not established on these runs; re-measure on POLY-160** | the same box tests ran 82 s and 145 s, and 86 s and 107 s. I withdraw the "inside, +5 s" I wrote at `bc3b5dd9`: at `dd94e1c8` its control step and the dry run did not slow together |
| ARCH | §8.1 and the health passage say what lands, H1's two gaps included | `docs/ARCH/index.html`, this commit |

**What I read.** The whole product delta `2825b6f7..a9d35481`, `gate.md`, `treal-findings.md`, the third review, the mutant table for G10–G12.
**What I did not.** I ran no test. I did not re-read code unchanged since `2825b6f7` for this verdict (seceng did not either), nor the T-real
harness and most test files line by line; there I rely on `gate.md` and `red-run.md`.

## Not proven here

- **No real deploy has completed, and today none can.** T-real runs in no CI step. In a container on the Mac it reached `up` and stopped at health.
- **The image has no health answer:** nothing listens on 3000 (G15, POLY-162; the real server POLY-161).
- **No database is created** on a fresh cluster (G13, POLY-162).
- **The worker's command:** without G14 (POLY-162) the worker, which holds the keyring, runs the image's default `web`. No `v1.*` or `edge-*` tag before POLY-162.
- So the healthy path, the rollback window, quarantine and the restore are proven against fakes only, never on real Docker.
- G10's box cases are green in CI; no mutants were made for them. CI's Compose is GitHub's binary, the box's is Docker's apt package.
- `build.yml`'s `siblings` and `release-lint` run for real for the first time at the merge: read the result before anything else lands.
- Live staging, timers on schedule, the real token, real systemd: POLY-104. The real bucket: POLY-105. The first prod deploy and the 60 minutes: POLY-116.

## For POLY-160

**Gate:** H1. **Before the first prod deploy:** H3. **Then:** H2, H4–H8, H10 of the third review, and mine:

1. `_healthy` failing part way leaves `current` naming the new digest after the old release is back (H2). I did not class it 4: the digest it could later restore had passed health.
2. A crash between `_healthy`'s pointers and clearing `in-progress`, twice, quarantines the running digest.
3. A slow `check-config` is a quarantine.
4. `rel.log` in the `Transient` handlers can raise on a full disk: no `transient-since`, no alert.
5. `infra/ci/deploy-real-undo.sh` is outside the `deploy` trigger.
6. `provision.sh` does `cd /` (line 37) before it resolves `BASH_SOURCE` (162, 327, 531): a relative `bash provision.sh`, as H25's fix text has it, looks under `/`. By reading; `polycarpic-ops provision` passes an absolute path.
7. INFRA: §4.6 "the run's project owns the edge", §4.5's backup named twice, and §4.4 (`in-progress` to the end of the run) do not match the code under H1.
8. Re-measure the provision job against a same-day control.
