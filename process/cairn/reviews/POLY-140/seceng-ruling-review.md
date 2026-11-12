# POLY-140 gate-1 ruling: seceng review

Seceng, at 80c074f, node_modules installed in the seceng worktree (`pnpm install --frozen-lockfile --offline`). Probes used throwaway files under `packages/auth/src/zz/`, linted with `npx eslint packages/auth/src/zz` through the real `eslint.config.js`, then deleted. The tree is unchanged.

**Verdict: pass with conditions S1–S6.** The mechanism is right: path arithmetic over the layer map, failing closed on targets that do not exist, refusing even edges the map allows. A path import skips the `exports` map, and SECURITY's Database section counts on that map to keep the raw pool out of reach. The gaps below are the ways code still reaches across a boundary without a specifier this rule sees.

## 1. Do conditions 1–11 close the gap?

They close it for every specifier form they list, in the file types the lint actually reads. Four holes remain:

- **Files the lint never reads (S1). Measured.** `SRC` in `generate.mjs` is `**/*.{ts,tsx,js,mjs,cjs,svelte}`. A file `packages/auth/src/zz/a.mts` importing `@poly/migrate` and `../../../ledger/src/index.ts` gives **0 problems**. The same `@poly/migrate` line in `zz/b.ts` gives `boundaries/dependencies` and `import-x/no-extraneous-dependencies`. Copies as `.cts` and `.jsx` also give 0. TypeScript and Vite both load `.mts`/`.cts`, so one file extension skips every layer rule, not just this one. The tree has 0 such files today.
- **`new URL(<path>, import.meta.url)` (S2). Measured: lints clean.** Vite bundles the target of `new Worker(new URL('…', import.meta.url))` as code, and of a bare `new URL` as an asset. The ruling lists this as a data read. In `apps/web` it is a code edge.
- **Bare specifiers the resolver cannot place (S5). Measured: lints clean.** `import z from '#ledger'` and `import w from 'ledger-alias'` in `packages/auth/src` give no error. The resolver returns `found: false` for anything that is not `@poly/*`. A package.json `imports` entry or a dependency alias (`link:../ledger`, `file:`, `npm:`/`workspace:` alias) would make one of these resolve into another package. Whether pnpm resolves a workspace alias in this repo is unverified. The tree has 0 `imports` fields and 0 `link:`/`file:`/`npm:` specs (grep over `apps/*/package.json` and `packages/*/package.json`).
- **Static template literal (S6). Unverified.** Condition 3 refuses a template *with expressions*. A template with none, `` import(`../../ledger/src/index.ts`) ``, has to be checked as the string it is, not skipped as non-literal.

## 2. Listed open bypasses

| Bypass | Verdict |
|---|---|
| `createRequire` / require not named `require` | **Close in this loop (S4).** All 17 workspace packages are `"type": "module"` (grep: none lacks it), so bare `require`, `module.require` and `require.resolve` are undefined at runtime. The only ways in are `createRequire` and `process.getBuiltinModule('module')`. `git grep` finds 0 uses of `createRequire`, `getBuiltinModule` or `node:module` under `apps`/`packages`. Banning both now costs about two generated entries, and the gap affects every layer rule, including the `db/auth` pool restriction. |
| `new URL` + `fs` read as data | URL half: **close (S2)**. Reading a file as bytes: **accept.** It runs no code, and the secrets boundary is the database role and vault, not source files. |
| `vi.mock` / `vi.importActual` / `vi.doMock` | **Accept.** Test-only. `.dockerignore` keeps `**/*.test.ts` and root `tests` out of the image build context. |
| Untracked or runtime symlink | **Accept.** CI and the image build from a clean checkout, and condition 10 covers tracked symlinks. |
| Case-variant path | **Accept.** It fails closed. |
| Package dir missing from `layers.json` | **Accept.** `check.mjs` `missing-from-file` refuses it, and `pnpm lint` runs `check.mjs` first. |
| `apps/migrate/src` → `./run.ts` | **Accept.** It is inside the entry-point package. |

## 3. Condition 5: repo-root `tests/**` as a laundering route

Root `tests/**` reaches package internals by path on purpose. Measured: `tests/db/helpers/definers.ts` imports `../../../packages/db/src/migrations-check`. So `packages/x/src/a.test.ts` → `tests/**` → `packages/db/src/<internal>` is a real chain, and it is acceptable for tests.

It ships only if a **non-test** file can reach that test file, and condition 4 does not stop that inside the package. `apps/web/src/hooks.server.ts` → `../tests/e2e/serve.ts` stays inside `apps/web`, and `serve.ts` may go to root `tests/**` under condition 5. Likewise `src/x.ts` → `./y.test.ts`. Today the image build would fail closed, because root `tests` is dockerignored. `vite dev` and the worker's runtime would not fail, and `.dockerignore` excludes only `**/*.test.ts`, not the `.spec.*` and `.test.mjs` forms that `TESTS` treats as tests. **S3 closes this.** With S3 in place: not a laundering route into anything that ships. The tree has 0 non-test `src` imports of a test file or a package `tests/` dir (grep).

## 4. Condition 4 (stricter than the criterion)

**Support.** It makes "the only way out of a package is `@poly/<name>`" an invariant, rather than a list of forbidden destinations that has to grow with every new shared folder (`scripts/`, root `tests/`, `infra/`). It costs nothing: the prototype measured 0 non-test hits. No objection.

## 5. Conditions to add before gate 1 closes

- **S1 — every source extension is linted.** Add `mts,cts,jsx` to `SRC` and `TESTS`. Add a structure test that every tracked file under `apps/` or `packages/` whose extension TypeScript or Vite load is matched by `SRC`. Red fixture: `packages/auth/src/x.mts` → `../../ledger/src/index.ts`.
- **S2 — `new URL` is a specifier.** The rule checks the first argument of `new URL(<string or static template>, import.meta.url)`, including inside `new Worker(…)` / `new SharedWorker(…)`. Red fixture: `apps/web/src` → `new Worker(new URL('../../../packages/db/src/index.ts', import.meta.url))`. Green: `new URL('./w.ts', import.meta.url)`.
- **S3 — non-test source never imports test code.** From a non-test file under `<dir>/src`, refuse a target that matches the `TESTS` globs or lies under `<dir>/tests/**`. Red fixtures: `apps/web/src/x.ts` → `../tests/e2e/serve.ts`; `packages/config/src/x.ts` → `./log.test.ts`. Green: the existing 6 test imports in condition 5.
- **S4 — no require factory.** The generated restrictions refuse an import of `createRequire` from `module`/`node:module` in any form (named, namespace, default). They also refuse `process.getBuiltinModule`, in every package block. Red fixtures for the named and namespace forms and for `getBuiltinModule('module')`.
- **S5 — no package-level indirection.** A structure test over `apps/*/package.json` and `packages/*/package.json` refuses an `imports` field. It also refuses any dependency spec starting `link:`, `file:` or `npm:`, or a `workspace:` spec that names a package. Every workspace dependency must be declared under its own `@poly/<name>`. Red: a test input with each form. The tree passes today.
- **S6 — static template literals are strings.** A template literal with no expressions is checked exactly like a string literal in every form in condition 1. Red fixture: `` import(`../../ledger/src/index.ts`) `` from `packages/auth/src`.
