# POLY-136 ruling (gate 1)

Builder: devops-engineer-136. Tests: qa-engineer-136. Every title ends `[red if: <mutation>]`; tests-red shows each new test failing on its named mutation.

## Decided (team-lead, recorded here)

- D1. Item 4 is built and proven first; it gates POLY-87, whose suites join `db`.
- D2. Item 4 evidence is five CI runs of the branch (`gh workflow run ci.yml --ref feature/poly-136-ci-migration-followups`, full run, one at a time: a newer run on the same ref cancels the older), `db` job median ≤ 130 s.
- D3. Item 3 takes the documentation route unless the attestation lookup is cheap and clearly better (ruled below: documentation).
- D4. Item 6 is one throwaway run on a scratch branch with the probe forced to fail; only its result goes on the issue; nothing from the scratch branch merges.
- D5. No new top-level CI job; any new test joins an existing per-package job.

## Measurements behind this ruling

- M1. CI `db` job, run 43062270558 (PR #116): vitest Duration 127.47 s, job 140 s. Per file (s): runner 29.6, checks 13.2, tenancy 11.1, routing-pool 8.2, ops-hardening 6.0, ops-status 5.8, route-policy 5.3, session 4.6, template-clone 4.5, client-ip 3.9, matrix 3.6, rest < 2.5 each. 335 tests in 18 files.
- M2. Local run of the same battery at 2e014ba (`vitest run -c tests/db/vitest.config.ts --reporter=json`): wall 84.5 s; runner 19.8, checks 9.9, tenancy 7.1. CI/local ratio ≈ 1.5 (not the 1.29 the POLY-102 profile used).
- M3. Local unit costs (mean of 5, throwaway probe under tests/db, deleted): `freshDb()` 85 ms; `freshDb()`+one migrate CLI spawn 471 ms, so a spawn costs ≈ 386 ms, of which bare `node --experimental-strip-types` startup is 63 ms; `migrate check-config` spawn 339 ms; `pnpm --filter @poly/db check-migrations` 143 ms vs `node … check-migrations.ts` 99 ms.
- M4. checks.test.ts local: check-config block 16 tests 5.46 s; file-check block 19 tests 2.71 s. runner.test.ts calls `migrateCli` 30 times plus 2 raw `spawn`s.
- M5. `pnpm install --frozen-lockfile` locally (pnpm 12.18.0): exit 1, ERR_PNPM_IGNORED_BUILDS (esbuild 0.18.20, 0.25.12, 0.28.2). Same command with `allowBuilds: {esbuild: false}` appended to pnpm-workspace.yaml: exit 0, lockfile unchanged (warm node_modules; file restored after).

## Item 1: journal ↔ file check

- Seam: `export function checkJournalFiles(folder: string, entries: { idx: number; tag: string }[]): Problem[]` in `packages/db/src/migrations-check.ts`, called from `checkFolder` after `checkJournalOrder`. `Problem['check']` gains `'journal-files'`.
- Rules, both directions: each entry needs `<tag>.sql` and `meta/<idx padded to 4>_snapshot.json`; each root `*.sql` needs an entry with that tag; each `meta/*_snapshot.json` needs an entry with that idx. `_journal.json` is not a snapshot. A stray `.sql` is still scanned by `checkSql` (fail closed).
- Message (unchanged printer in scripts/check-migrations.ts): `journal-files: <file>: <detail>`, where `<file>` is folder-relative and `<detail>` is `not in meta/_journal.json` or `journal entry <tag> has no <file>`. Exit 1 on any problem, 0 on none (unchanged).
- `writeMigrations` (tests/db/helpers/api.ts) writes a `meta/NNNN_snapshot.json` stub per entry so existing fixtures stay valid. The real folder passes as-is (6 entries, 6 .sql, 6 snapshots).
- Tests in checks.test.ts (db job), through `node` (item 4 cut C3): stray .sql, stray snapshot, entry missing its .sql, entry missing its snapshot, each red with the message shape; the real folder exits 0.

## Item 2: aggregate cross-check

- Gap: `lint` runs on node|layers|image|ci and `unit` on node|image, but `KEYED` maps one job per output, so node=true with `lint` skipped, or image=true with `lint`/`unit` skipped, aggregates green.
- Seam: `export const REQUIRED = { node: ['lint','unit'], layers: ['lint'], ci: ['lint'], image: ['lint','unit','image'], db: ['db'] }` in `infra/ci/aggregate.mjs` replaces `KEYED`; `evaluate` checks every job in the list. Message shape unchanged: `output <out>=true but <job> is <result>`; exit 1 red, 0 green.
- Drift guard (tests/ci, `lint` job): REQUIRED equals, per output, the set of jobs whose job-level `if:` in ci.yml names `needs.changes.outputs.<out>`. Red if ci.yml or REQUIRED changes alone.
- aggregate.test.ts: the keyed loop covers every (output, job) pair in REQUIRED, including node→lint, image→lint and image→unit.

## Item 3: image artifact expiry (documentation route)

- Why not the attestation: the attestations API is keyed by subject digest (`/repos/{o}/{r}/attestations/{digest}`), so it cannot turn a commit into a digest. A GHCR `sha-<commit>-*` tag lookup could, but it rewrites `release-lookup.sh` (a C-83 surface), and the SBOM that `release.yml` publishes lives only in the artifact. The repo is public, where 90 days is GitHub's retention ceiling, so retention cannot be raised.
- Runbook (INFRA release section, devops-engineer's doc, present tense, no history): `release.yml` finds a commit's digest only while that commit's `image-<commit>` artifact exists, 90 days after its `main` build; the weekly rebuild refreshes it for `main`'s head; to release an older commit, merge a new commit and tag that. Re-running `build.yml` builds `main`'s head, never an old commit.
- Test (tests/ci, `lint` job): build.yml's `image-` upload `retention-days` equals the day count the INFRA runbook states. Red if either changes alone.

## Item 4: `db` job to a ≤ 130 s median

Need ≈ 14 s off on CI (median 144 s from 149, 128, 131, 144, 152). Savings are local × 1.5 (M2). Land C1, run once, then C2, C3; C4 only if the five-run median is still over 130 s.

| Cut | What changes | Saving (CI) | What the tests still prove |
|---|---|---|---|
| C1 runner in-process | New `apps/migrate/src/run.ts`: `export async function run(argv: string[], env: NodeJS.ProcessEnv): Promise<number>` holds today's `main` plus the MigrateRefusal → `e.exit` mapping (stderr `refused (<check>): <message>`, anything else 1). It reads only `env`, never `process.env`. `cli.ts` becomes `run(process.argv.slice(2), process.env).then((c) => process.exit(c))`. Helper `migrateRun(db, dir, args?, env?)` in tests/db/helpers/api.ts returns the same `Run` shape by capturing console and `process.stderr.write`. About 25 of 30 `migrateCli` calls switch to it. | ≈ 12 s (derived from M3: 25 × ≈ 0.32 s × 1.5; in-process residual per call unmeasured) | Every exit code and refusal path, the poly_migrator connection from `DATABASE_*`, tracking rows and the one-transaction rule, all through the same code. Still spawned: one case each for exits 0, 1, 2 and 3, plus the two lock/concurrency `spawn`s (exit 4), so exit-code propagation through a real process stays proven. New test: `run` given an env without `DATABASE_*` exits 1 while `process.env` has them. |
| C2 check-config in-process | 14 of 16 check-config cases call `run(['check-config'], env)`; good config → 0 and one fault → 1 stay spawned. | ≈ 7 s (M4: 14 × ≈ 0.34 s × 1.5) | Each fault names its variable, with exits 0 and 1 through the real CLI. |
| C3 check script via node | `check()` in checks.test.ts spawns `node --experimental-strip-types packages/db/scripts/check-migrations.ts`; one case keeps `pnpm --filter @poly/db check-migrations`. | ≈ 1.5 s (M3: 44 ms × ≈ 21 × 1.5); smaller than the earlier 5 s estimate | Every file rule; the package-script wiring through one case. |
| C4 one auth per file | route-policy builds one instance per mode in `beforeAll` and shares it. | (unmeasured), small: auth files are 13.6 s locally, mostly tests | Same assertions per mode. |

Rejected: the crash-preload timer is already 500 ms (ops-hardening.test.ts:92), so nothing is left to cut. `WAIT_MS` 5 s (routing-pool, 5.0 s locally) and the 4.8 s ops-hardening wait are production constants. The test proves the real value, so they stay. File parallelism or concurrency in `runner`/`ops-status` is not safe (POLY-102 profile).

Guards: test count in the `db` battery stays ≥ 335 (a cut changes how, never how many); `db` job `timeout-minutes` and the job-report budget are unchanged. Proof: five sequential dispatch runs at the item-4 head, `db` job median ≤ 130 s and the fastest three averaging ≤ 120 s (addendum 3), run ids and times recorded on the issue at build-green. The final head's own full run has `db` ≤ 135 s.

## Item 5: e2e early-exit guard

Replace both `exit 0` assertions in tests/ci/ci-e2e.test.ts with one rule over the `Web e2e` step: every `\bexit\b` is followed by a nonzero integer literal, except exactly one `exit 0` on the line holding `grep -q '@poly/web' affected.txt`, and that line comes before `playwright install chromium`. A bare `exit`, `exit $x` and `return` are red. After the last `fi` nothing remains but whitespace, and `turbo run e2e` lines carry no `||`. Red cases qa shows: a mid-line `; exit 0; fi` after the install, a bare `exit`, `exit $X`, `exit 0 # note` at end of line, a second `exit 0`, `turbo run e2e || true`.

## Item 6: fallback branch, one scratch run

devops-engineer-136 pushes `scratch/poly-136-e2e-fallback` (from the branch head; only the first probe line becomes `node -e 'process.exit(1)'`), dispatches one full run on it, records on POLY-136 the run id, whether install-deps ran, whether it timed out, whether `::warning` appeared, the second probe's result, the e2e result and the step's duration, and then deletes the scratch branch. The second-failure path (`exit 1`) stays covered by the static test. Nothing merges from the scratch branch.

## Item 7: local install (align, README fallback)

- Ruled: add `allowBuilds: { esbuild: false }` to pnpm-workspace.yaml (this declines esbuild's build script by name, and no script runs that did not run before) and drop the four `pnpm_config_strict_dep_builds: "false"` lines from ci.yml. CI then runs strict like local, build.yml and the Dockerfile, so a new dependency with a build script fails CI instead of being silently ignored. M5 shows the local exit going from 1 to 0.
- Builder confirms on a clean install (`rm -rf node_modules` and the store cache miss in CI) and in the image job. If either fails, fall back to the README: state the CI-equivalent local command and leave ci.yml as it is.
- tests/ci/strict-builds.test.ts: ci.yml no longer mentions strict-dep-builds; every `allowBuilds` value in pnpm-workspace.yaml is `false` (allowing a build is a C-80 change). README states plain `pnpm install --frozen-lockfile`.

## Paths

`apps/migrate/src/**` is added to the issue's paths for C1.

## Pre-registered review checklist (gate 4 verdict axes)

| Axis | Pass condition |
|---|---|
| Item 1 | four stray/missing cases red with `journal-files: <file>: <detail>`, exit 1; real folder 0 |
| Item 2 | REQUIRED drives `evaluate`; drift test ties it to ci.yml job `if:`s; node→lint and image→unit red when skipped |
| Item 3 | runbook statement present, no history; retention/doc tie test |
| Item 4 | C1 to C3 landed; ≥ 335 db tests; `run` ignores `process.env`; spawned case per exit 0 to 4 |
| CI | five dispatch runs, `db` median ≤ 130 s, fastest three mean ≤ 120 s; final head `db` ≤ 135 s; job set unchanged; suite-time delta reported |
| Item 5 | single exit rule; each listed mutation red |
| Item 6 | scratch run result on the issue; scratch branch deleted; no scratch commit in the PR |
| Item 7 | strict CI install green, or README fallback with the reason recorded |
| Scope | changes within paths; `guard-push` clean; no prod behaviour change beyond the `cli.ts` → `run.ts` split (same exit codes and messages) |

## Addendum 1: REQUIRED for `node`

Item 2's map was wrong for `node`. In ci.yml the `image` job's `if:` is `image == 'true' || node == 'true'`, so `REQUIRED.node` is `['lint','unit','image']`. The rule is the one item 2 states: REQUIRED is whatever the job-level `if:`s in ci.yml say, and the drift test settles any difference. The aggregate tests also cover node→image (red when `image` is skipped and node=true). AC 2 is corrected in place.

## Addendum 2: seceng conditions (process/cairn/reviews/POLY-136/seceng-ruling-review.md)

Both parts are accepted with conditions. Every condition below is binding and is a gate-2 test unless it says otherwise; qa adds them on top of a2b904d.

- Item 7: S1 to S4 as written. S1: YAML-parsed `allowBuilds`, every value `=== false`. S2: no allow-all or allowlist key in the workspace file, `package.json#pnpm` or `.npmrc`, in any spelling. S3: strict-dep-builds is set nowhere, which replaces the "ci.yml may relax it" case. S4: a clean install with `--reporter=append-only` shows no lifecycle-script line, and the `image` job is green on the same head; both are recorded on the issue at build-green. If S4 fails, the README fallback applies and S1 to S3 do not land.
- Item 7: when item 7 lands, seceng edits SECURITY §8 (C-80) to the wording in the review. `docs/SECURITY/**` is added to paths for that edit only.
- Item 4 C1: conditions C1 to C6 as written. They replace the ruling's single env test. `run.ts` holds no `process.env` token and no `process.exit`, `process.on(` or `process.once(`; it passes `env` explicitly to `runCheckConfig`, `checkDatabaseConfig`, `migrate` and `plan`; env isolation is tested in both directions for all three commands; `@poly/migrate`'s exports and `index.ts` are unchanged; the layer lint refuses `run.ts` from anywhere except `cli.ts`, tests and `tests/**`, by package path and by relative path; the capture helper restores `console` and `process.stderr.write` in a `finally`.
- Reproduced by the architect, and outside this loop except where C5 covers `run.ts`: with node_modules installed, relative imports across packages pass the layer lint (`apps/web/src` → `../../migrate/src/index.ts` and `packages/auth/src` → `../../ledger/src/index.ts` give no error, while `@poly/migrate` from `apps/web/src` gives a `boundaries/dependencies` error). This goes to the lead as a follow-up issue.

## Addendum 3: item 4 pass condition (requested by the lead, measured)

- Measured: five runs at 0e00993 gave a `db` job time of 111, 125, 125, 107 and 157 s; the median is 125 s. Run 5 compared with run 4, per file: every file is slower, 1.06× to 1.83×, and the total is 1.40× (87.1 s against 62.1 s). The two files bound by production timers barely moved (ops-hardening 1.06×, routing-pool 1.11×). Setup and steps outside vitest grew too (vitest 126.7 s against 84.6 s; the rest of the job 30 s against 22 s). This is a slow runner, not a regression.
- Ruled: "none ≥ 150 s" is replaced by "the fastest three average ≤ 120 s". Here that is 107, 111 and 125, mean 114.3 s. A single slow runner cannot breach this bound, and a real regression still moves it. Any run over 150 s is recorded alongside a per-file comparison of this kind. Item 4 passes at 0e00993; no sixth run, and C4 stays in reserve.
- The final head's one full run passes at ≤ 135 s, or, if it is over, with the same per-file comparison against the fastest run at 0e00993.
- Room for POLY-87: about 5 s of CI `db` time at the median (125 s against the 130 s target), which is about 3.5 s locally at CI ≈ 1.4–1.5 × local. The cap against the 180 s budget is not the limit that binds. POLY-87's ruling holds the same two-part bound measured the same way. Suites that add more than 5 s bring their own cut, starting with C4 (unmeasured).
