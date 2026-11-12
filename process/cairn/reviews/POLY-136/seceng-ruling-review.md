# POLY-136 seceng review of the gate-1 ruling (aa4a58f)

Scope: item 7 (C-80, T-63) and item 4 cut C1 (`apps/migrate/src/run.ts`). Nothing else was reviewed.

## Part 1 — item 7, strict installs everywhere: ACCEPT WITH CONDITIONS

Findings.

- The claim holds. Today CI runs with `strict_dep_builds=false`: pnpm ignores esbuild's script and warns, so no script runs. With `allowBuilds: { esbuild: false }` pnpm declines the same script by name and exits 0 (M5). Either way, no script runs. The ruling's clean-install and image-job confirmation still has to reproduce M5, because M5 ran on a warm `node_modules`.
- This strengthens C-80. Today a new dev dependency with a build script merges with nothing more than a warning in CI, and only a production dependency trips `build.yml`. After the change, any new build script fails the PR. A name-level `false` covers every esbuild version, including a future compromised release. It grants nothing.
- The ruled test is necessary but not enough. "Every value is `false`" can be bypassed by an allow-all switch or an allowlist key that sits beside `allowBuilds`, by the same keys in `package.json#pnpm` or `.npmrc`, and by a non-boolean value. The existing strict-builds test also still says "ci.yml may relax it", and that line has to flip.

Conditions (each a test in `tests/ci/strict-builds.test.ts`, `lint` job, unless stated otherwise).

- S1. `pnpm-workspace.yaml` is parsed as YAML, not grepped. Every `allowBuilds` value is the boolean `false` (`=== false`). Red cases: `esbuild: true`, `esbuild: 'false'` (a string), `esbuild@0.25.12: true`.
- S2. None of `dangerouslyAllowAllBuilds`, `onlyBuiltDependencies` or `onlyBuiltDependenciesFile` appears in `pnpm-workspace.yaml`, in the `pnpm` field of the root `package.json`, or in `.npmrc` (any spelling: camelCase, kebab-case, or a `pnpm_config_` env var). Red case: `dangerouslyAllowAllBuilds: true` added to the workspace file.
- S3. No file in `.github/workflows/`, no `Dockerfile*`, no `.npmrc` and no `pnpm-workspace.yaml` matches `/strict[_-]dep[_-]builds/i`. This replaces the "ci.yml may relax it" case. Red case: the four removed lines restored in ci.yml.
- S4. Build-green evidence, recorded on the issue: run the clean CI install with `--reporter=append-only` and show that its log has no lifecycle-script line for any package (no `postinstall`, `install` or `preinstall` run line). Show that the `image` job is green on the same head. If either fails, the README fallback applies and ci.yml stays as it is.

What SECURITY §8 (C-80) must say once item 7 lands (I edit it on request; the build does not):

- The "lifecycle scripts are blocked, with an explicit `onlyBuiltDependencies` allowlist" bullet must instead say that pnpm runs strict everywhere and that `allowBuilds` in `pnpm-workspace.yaml` holds only `false` entries (declined builds). Allowing a build is a C-80 change that needs seceng review, and no allow-all switch is set.
- The bullet that permits `pnpm_config_strict_dep_builds=false` in ci.yml goes. In its place: strict-dep-builds is set nowhere (workflows, Dockerfiles, `.npmrc`, workspace file). "Tested by" names `tests/ci/strict-builds.test.ts`.
- If the README fallback is taken instead, §8 stays as it is.

## Part 2 — item 4 C1, `run(argv, env)`: ACCEPT WITH CONDITIONS

Findings.

- No new reachability today. `@poly/migrate` exports only `.` (`src/index.ts`, which exports a name constant), and the layer map gives no package or app an allow on `migrate`. A probe confirmed that `@poly/migrate` imported from `apps/web/src` is a `boundaries/dependencies` error. The privilege sits in the credentials, not the code: `run` connects as whatever `DATABASE_*` the caller passes. A web or worker process holds only its own credentials, so an in-process caller gains nothing unless it also holds migrator credentials. The import rule is still worth having, as defence in depth.
- "Reads only `env`" is not enough as worded. `runCheckConfig(service, env = process.env)` in `packages/config/src/cli.ts` defaults to `process.env`. Today's `cli.ts` calls it with no env (`runCheckConfig('migrate')`), and the test hook `POLY_MIGRATIONS_DIR` is read from `process.env` at module load. If either is copied into `run.ts` as-is, `run.ts` never names `process.env`, yet still reads it through the default. The one ruled test covers only the bare `migrate` path, and only in one direction (env missing values while `process.env` has them). A merge such as `{ ...process.env, ...env }` passes that test.
- `run` must also stay a library function. A `process.exit` inside it, or a signal or exit handler it installs, would kill or alter the importing process. Inside the test process, that makes the helper's capture unreliable.
- Unverified gap (pre-existing, outside this loop): the probe ran from a worktree with no `node_modules`, using the main checkout's eslint. A relative import (`../../migrate/src/index.ts` from `apps/web/src`, `../../ledger/src/index.ts` from `packages/auth/src`) produced no error, and no layer fixture covers relative cross-package imports. C5 below closes this for `run.ts`. The general case goes to the architect to reproduce.

Conditions.

- C1. `run.ts` passes `env` explicitly to every callee that takes one: `runCheckConfig('migrate', env)`, `checkDatabaseConfig('migrate', env)`, and `migrate`/`plan` with `{ env, … }`. The fixture folder comes from `env.POLY_MIGRATIONS_DIR`. A static test in `apps/migrate/src` (or `tests/db`) holds: `run.ts` contains no `process.env` token, and every call to `runCheckConfig` in it has two arguments. Red cases: `runCheckConfig('migrate')`, and `const FOLDER = process.env.POLY_MIGRATIONS_DIR`.
- C2. The env-isolation test runs both directions for each of the three commands (none, `--plan`, `check-config`):
  - (a) `env` lacks `DATABASE_*` while `process.env` holds a valid set, and the result is exit 1;
  - (b) `env` is valid while `process.env` carries a stray `DATABASE_URL` and a bogus `POLY_MIGRATIONS_DIR`, and the result is the normal result, with no stray-URL refusal and the env-named folder used.
  Red cases: `{ ...process.env, ...env }` and `{ ...env, ...process.env }`.
- C3. `run.ts` contains no `process.exit`, `process.on(` or `process.once(`. Only `cli.ts` exits. The existing spawned cases for exits 0 to 4 stay as the proof that exit codes propagate. Static test, same file as C1.
- C4. `@poly/migrate`'s `exports` stays exactly `{ ".": "./src/index.ts" }`, `index.ts` does not re-export `run`, and `layers.json` gives no package an allow on `migrate`. This is a static test under `tests/layers`. Red cases: `"./run": "./src/run.ts"` added, `export { run } from './run.ts'` in index.ts.
- C5. The layer lint refuses any import of `apps/migrate/src/run.ts`, whether by package path or relative path, from any file outside `apps/migrate/src/cli.ts`, `apps/migrate/src/**/*.test.ts` and `tests/**`. A `tests/layers` fixture proves it: a relative import of `run.ts` from `apps/web/src` and from `packages/db/src` is red, and the import from `cli.ts` is green. If the generated boundaries rules cannot express this, a `no-restricted-imports` pattern on `**/migrate/src/run*` is acceptable.
- C6. The refusal and error output of `run` is unchanged from `cli.ts`. The test helper captures only `console` and `process.stderr.write`, and restores both in a `finally`. Red case: a throwing `run` leaves `process.stderr.write` patched (the next test sees it).

## Verdicts

| Part | Verdict | Conditions |
|---|---|---|
| Item 7 (C-80, T-63) | accept with conditions | S1–S4; SECURITY §8 wording as above on landing |
| Item 4 C1 (`run.ts`) | accept with conditions | C1–C6 |

## S4 judgement (CI run 43124687609, workflow_dispatch at 0e00993, all jobs success): MET

Read from `gh run view 43124687609 --log`, install steps "Install (lockfile frozen, lifecycle scripts blocked)" in image, unit, db and lint.

- Strict in CI: each step's `env:` block holds only `JOB_START` (plus `TURBO_SCM_BASE` in unit and lint); the log has 0 matches for `strict[_-]dep`. Each step runs `pnpm install --frozen-lockfile` and ends `Done in 1.9–2.4s using pnpm v12.18.0`. Strict without a covering entry is exit 1 (M5), so exit 0 here shows `allowBuilds` is what lets the install through.
- No script ran: no `postinstall`/`preinstall`/`install` run line, no ignored-build warning and no `esbuild` line in any of the four install steps.
- Image: the Dockerfile's `pnpm install --frozen-lockfile --prod` ends `Packages: +108` and `Done in 2.3s`; the job is success.
- Deviation, judged immaterial: the store was warm (`Cache hit for: pnpm-store-Linux-ea0f…`, `downloaded 0`), and `--reporter=append-only` was not passed. node_modules was empty on each runner (`added 338`), and pnpm decides on build scripts as it links packages into node_modules, so a warm store changes the fetch and nothing else. No build has ever been allowed here, so the store holds no side-effects cache for a warm store to replay. The non-TTY default reporter prints lifecycle lines the same way.
- Residual: the first lockfile change misses the cache and gives a cold-store install for free. Nothing further is required.
