# POLY-140 ruling (gate 1): relative imports across packages

Architect. Measured at b4b8234 with node_modules installed (`pnpm install --frozen-lockfile`), through the real `eslint.config.js`, with a throwaway rule appended to the generated config. The prototype is a measurement only; the builder writes the real rule.

## Why it passes today (measured)

`scripts/layers/resolver.cjs` resolves `@poly/*` specifiers only and returns `found: false` for everything else. `boundaries/dependencies` therefore cannot classify the target of a relative specifier and reports nothing. The POLY-136 C5 regex catches only specifiers that contain `migrate/run`. Measured: all of the following lint clean at b4b8234, from `apps/web/src` or `packages/auth/src`: `../../migrate/src/index.ts`, `../../ledger/src/index.ts`, `../../db/src/index.ts`, the same target through `export {…} from`, `export * from`, `import type`, `import()`, `require()`, `import x = require()`, a directory specifier (`../../ledger/src`), a file that does not exist, `../../../packages/ledger/src/index.ts`, `../../../scripts/…`, an absolute path, a `?raw` suffix, `../node_modules/@poly/db/src/index.ts`, `import.meta.glob('../../../packages/*/src/*.ts')`, a type-position `import('…').X`, and the same import in a `.svelte` script. The control `@poly/migrate` from `apps/web/src` gives `boundaries/dependencies`.

## Mechanism

A new custom rule, `poly/no-relative-cross-package`, in `scripts/layers/plugin.mjs`. It works by path arithmetic over the layer map. It does not use a resolver or the filesystem, so a target that does not exist yet is still refused. Measured with the prototype: every case above is an error, and `./index.ts`, `../index.ts` (from `src/sub`), `../package.json`, `./lib/*.ts` globs, `$lib/x` and `../../auth/src/index.ts` from inside `packages/auth` pass.

Rejected options:
- Extending the resolver so `boundaries/dependencies` sees relative targets. That applies the layer map's allow-list, but the criterion refuses a relative import even where the map allows the edge (for example, auth → db by path).
- `import-x/no-relative-packages`. It uses the nearest `package.json` rather than the layer map, and it fails open when resolution fails.

Why the rule refuses a relative import even where the map allows the edge: a path import skips the package's `exports` (its public surface) and the subpath allow-list. The only legal edge between two packages is the `@poly/<name>` specifier, which `boundaries/dependencies` checks.

## Conditions (each one is a red fixture or test for qa and a build target)

1. **Forms.** The rule checks the specifier of: ImportDeclaration (including `import type`), ExportNamedDeclaration with a source, ExportAllDeclaration, ImportExpression, `require()` called by the identifier `require`, TSImportEqualsDeclaration (`import x = require`), TSImportType (`import('…').X`), `import.meta.glob` (a string or an array of strings; a leading `!` is stripped before the check), and `/// <reference path="…" />`. It does this in `.ts`, `.js`, `.mjs`, `.cjs`, `.tsx` and `.svelte` files.
2. **What counts as a path specifier.** A specifier that starts with `./`, `../`, `/` or `file:`, or that equals `.` or `..`. `?query` and `#hash` suffixes are stripped first. The target is `path.resolve(dirname(file), spec)`. It is not case-folded and symlinks are not followed.
3. **Refused from every file in a package's dir:** a target inside another layer-map package's `dir`; a target with a `node_modules` segment anywhere below the importer's own dir; any absolute or `file:` specifier; and any computed relative specifier, meaning a template with expressions or a `+` concatenation whose static prefix is a path specifier. The message names the package reached, when there is one. (Computed relative specifiers are allowed by `poly/no-computed-import` today. This rule closes that gap. The lint finds no source that uses one.)
4. **Also refused from a non-test file under `<dir>/src`:** any target outside the importer's own `dir`. A non-test source file never leaves its package by path, so it cannot reach another package's internals through a third location (root `tests/`, `scripts/`) either.
5. **Tests inside a package.** A file that matches the existing `TESTS` globs, or a file in the package dir but outside `<dir>/src` (for example, `apps/web/tests/e2e/**`), may go outside its own dir only to repo-root `tests/**`. Conditions 3 and 4 still apply to it in every other respect. This passes the 6 imports the lint finds today: `packages/config/src/{loader,log,log-seceng,seceng}.test.ts` → `../../../tests/log/canary.ts` and `apps/web/tests/e2e/serve.ts` → `../../../../tests/db/helpers/{api,pg}.ts`.
6. **Generated.** `generateConfig` emits the rule in each `poly/restrictions/<n>` block. Its options (own dir, map of other package names to dirs, and allowed outside roots) are derived from `layers.json` only. The rule name does not appear in `eslint.config.js`. It is under `poly/*`, so `eslint-comments/no-restricted-disable` already refuses an inline disable. Fixtures `fail-…-bare-disable` and `fail-…-inline-disable` show this.
7. **Freshness.** Three checks. (a) A fixture under the existing variant `ledger-allows-posting` shows `packages/ledger/src` → `../../posting/src/index.ts` red, so the map's allow-list does not lift the rule. (b) A new variant adds a package `packages/newpkg` to the map, and `packages/auth/src` → `../../newpkg/src/index.ts` is reported with a message that names `newpkg` under that variant. Under the real map the same import is still red, but as "leaves this package", with no package named. This shows the package list comes from the map. (c) A `structure.test.ts` case shows that `generateConfig(layers)` has the rule on for every package in `layers.json`, with own dir = that package's `dir`.
8. **Required fixtures (criterion 2):** red for `apps/web/src` → `../../migrate/src/index.ts` and `packages/auth/src` → `../../ledger/src/index.ts`; red for each form in condition 1 and each case in condition 3; red for a non-test `src` file → `../../../tests/log/canary.ts`; green for a relative import inside one package (`./x.ts`, `../x.ts` from `src/sub`, `../package.json`); green for a colocated test → `../../../tests/log/canary.ts`; red for a colocated test → `../../ledger/src/index.ts`.
9. **The tree is clean (criterion 3).** `pnpm lint` passes on the build-green head with the rule on. Measured with the prototype at b4b8234: across 124 files under `packages` and `apps`, no file reaches into another package, and the only imports that leave a package are the 6 test imports in condition 5.
10. **No tracked symlink** under `apps/` or `packages/`. A structure test checks `git ls-files -s apps packages` for no mode `120000` entry (0 today). Path arithmetic does not follow a symlink, and this keeps that safe.
11. **No path alias reaches out.** A structure test refuses `compilerOptions.paths`, `baseUrl` and `rootDirs` in any `apps/*` or `packages/*` tsconfig and in `tsconfig.base.json`, and refuses an `alias` key in `apps/web/vite.config.ts` (`kit.alias` and `resolve.alias`). None exists today. SvelteKit's built-in `$lib` points inside `apps/web/src`.

## run.ts (POLY-136 C5): subsumed

The `migrate/(src/)?run` pattern in `no-restricted-imports` is removed. Each case it covers is refused by something else. `../../../migrate/src/run.ts` (from web) and `../../../apps/migrate/src/run.ts` (from db) are refused by this rule. `@poly/migrate/run` is refused by the `@poly/*/*` subpath ban. The C5 tests in `tests/layers/migrate-run.test.ts` stay unchanged and must stay green after the removal; they are the guard that the subsumption holds. Measured gap that the regex never covered and this loop does not change: another file inside `apps/migrate/src` can import `./run.ts` (it lints clean before and after).

## Out of scope: repo-root `tests/**` and `tests/layers/fixtures/**`

These are not in the lint file set (`eslint packages apps scripts/layers`). They import package sources by path on purpose, to test internals. They are never bundled or deployed, and the layer map governs runtime edges between shipped packages. Bringing them in would mean exempting all of them. Fixtures are linted under their `@virtual-path` and are covered in that way.

## Bypasses this rule does not close (for seceng)

- `createRequire(import.meta.url)` and any require function not named `require`, as well as `module.require` and `require.resolve`. This gap already exists for every layer rule. The lint finds no use today; `git grep createRequire -- apps packages` is empty. Banning `createRequire` from `node:module` in packages is a possible follow-up (unmeasured).
- `new URL(rel, import.meta.url)` or `fs` reads followed by `import(url.href)`. The import is refused as computed, but reading another package's file as data is not.
- `vi.mock`, `vi.importActual` and `vi.doMock` with a relative path in a colocated test. These affect test code only.
- A symlink created at runtime, or one that is untracked. Condition 10 covers tracked symlinks only.
- A case-variant path on a case-insensitive filesystem fails closed (it is refused as leaving the package), not open.
- A package dir missing from `layers.json`. Its files are outside every block. `scripts/layers/check.mjs` is the guard for this, and this loop does not change it.

## Budget

The lint-time cost is (unmeasured): it is pure string and path work on each import node. It runs in the `lint` job, not `db`.
