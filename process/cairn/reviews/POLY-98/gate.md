# POLY-98 build-green gate (qa-98)

Sha under test: `5a6ed6cab150bdc242db6ffa7f093ff111996157` (devops-98's build on my tests at `49eb5c59`). Run 2026-11-22 from a clean worktree at that sha, machine quiet, suites one at a time.

| Suite | Cases | Result |
|---|---|---|
| ops unit (`unittest discover -s tests/infra/ops`, all 98c U: cases incl. K1–K12) | 152 | green, 5.3 s (R14 ≤ 20 s) |
| operator unit (incl. B: `test_b2_rclone_output`, R10/K11) | 93 | green, 0.3 s |
| provision container config (create, host, checks-db, `ops.test.ts` with C:, H6, D3, G2) | 151 (21 are `ops.test.ts`) | green, 68.7 s |
| `tests/ci` (incl. W: `changes.test.ts` rows) | 579 | green, 10.3 s |
| `tests/infra` (incl. `ops-wiring`, `provision-wiring`) | 332 | green, 13.1 s |
| `tests/layers` | 556 | green (not touched by this loop) |

No test was loosened: `git diff 49eb5c59..5a6ed6ca -- tests` is empty. Every case in the red run is now green; the 10 positive twins and regression guards stayed green.

## Suite-time delta, against a same-day control on `main` (`2062ecf9`, same machine, run straight after)

| Suite | main | this sha | delta |
|---|---|---|---|
| provision container config | 64.5 s, 130 tests | 68.7 s, 151 tests | +4.2 s (+6 %) for +21 container cases and the git-in-image rebuild; R14's CI limit is 200 s |
| tests/ci | 10.4 s, 573 | 10.3 s, 579 | none |
| tests/infra | 13.4 s, 327 | 13.1 s, 332 | none |
| ops unit (new) | — | 5.3 s, 152 | new step, R14 limit 20 s |

One run each (a control, not a trend); the provision delta is within the run-to-run spread I would expect but is reported as measured.

## Not covered here (said plainly)

- The CI `provision` job itself is not run here; devops-98 owns the push and the CI run against the 200 s guard.
- Production `tls_probe`/`statvfs` need a real box (POLY-104).
- R13's INFRA/README edits and A3's step-16 text are docs, checked at the architect's verdict.
