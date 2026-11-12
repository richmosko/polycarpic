# POLY-136 verdict (gate 4), final head 66ed997

Verdict: **PASS**, with one delta before the PR (D1).

| Axis | Result | Evidence |
|---|---|---|
| Item 1, journal ↔ file | pass | `checkJournalFiles` in migrations-check.ts; the real folder exits 0 (`node … check-migrations.ts`); stray and missing cases in checks.test.ts, red at a2b904d @ 66ed997 |
| Item 2, aggregate | pass | `REQUIRED` drives `evaluate`, with node→lint+unit+image per addendum 1; drift test against ci.yml job `if:`s; node→image red case at 4ac06da @ 66ed997 |
| Item 3, artifact expiry | pass | INFRA release bullet states the 90-day window, the weekly refresh and what to do past it; retention/doc tie in build-workflow.test.ts @ 66ed997 |
| Item 4, cuts | pass | C1 to C3 landed at 1f03f8d. `run.ts` has no `process.env` outside a comment and no `process.exit`/`on`/`once`; it passes `env` to all four callees. `cli.ts` is one line; `@poly/migrate` exports and index.ts are unchanged; the layer lint confines `run.ts` (035c176) @ 66ed997 |
| CI | pass | Five runs at 0e00993: 111, 125, 125, 107 and 157 s; median 125 s, fastest three mean 114.3 s (addendum 3). Final head run 43126411997: all 8 jobs green, `db` 124 s (≤ 135), vitest 101.1 s; job set unchanged @ 66ed997 |
| db test count | pass | 352 = vitest `Tests` total for the `db` job in run 43126411997: 350 passed plus 2 `it.fails` pinned for POLY-100 (runner.test.ts:196), executed cases including loop-generated ones. The same measure on the baseline run 43062270558 gives 335 (333 + 2). That is 17 more. `vitest list` gives 227 because it does not count loop-generated cases, so it is not the measure. The 345 and 347 in earlier reports were taken on earlier heads |
| Item 5, exit rule | pass | single-exit rule in ci-e2e.test.ts with each listed mutation red (a2b904d); green on the head @ 66ed997 |
| Item 6, fallback run | pass | run 43125303397 on the scratch branch: install-deps ran in about 3 s, the second probe passed, e2e 48 passed, the step took 59 s. The scratch branch is gone from origin (ls-remote shows only main, metrics and this feature branch); no scratch commit is in the PR range |
| Item 7, strict installs | pass | `allowBuilds: {esbuild: false}`; the four relaxations are removed from ci.yml; the README states plain `pnpm install --frozen-lockfile`. Locally the strict install exits 0 at 66ed997 (it exited 1 at 2e014ba) @ 66ed997 |
| S4 as judged | accepted | Seceng's reasoning holds. pnpm decides build scripts when it links packages into node_modules, and node_modules was empty on each runner (`added 338`). No build has ever been allowed, so the store holds no side-effects cache to replay. The non-TTY reporter prints lifecycle lines the same way append-only does. The warm store therefore does not weaken the evidence; the first lockfile change gives a cold-store install. seceng-ruling-review.md @ 66ed997 |
| Seceng C1 to C6 | pass | static and isolation tests in tests/layers/migrate-run.test.ts and tests/db/migrate-run-helper.test.ts, green in run 43126411997 |
| Docs, no history | pass | INFRA 1.3.5: one bullet extended, present tense, no issue id or version narrative. SECURITY 1.9.10: two C-80 bullets restated, present tense. The SECURITY "Last updated" date is 2026-11-12, which is the UTC date |
| Docs, PDFs | **delta D1** | SECURITY.pdf was regenerated in 66ed997. INFRA.pdf was last built at bf97ddc (1.3.4) and is stale against index.html 1.3.5 |
| Scope | pass | `guard-push POLY-136` exits 0; one feature branch on origin |

## Deltas (one batch)

- D1. Regenerate docs/INFRA/INFRA.pdf (devops-engineer, the doc owner) before the PR. This is the only blocking item.
- D2 (follow-up, not this PR). The layer lint passes relative imports across packages (addendum 2). The lead files it as an issue.
- D3 (follow-up, not this PR). POLY-87's room in `db` is about 5 s of CI time at the median, under the same two-part bound (addendum 3). Its ruling cites this.
