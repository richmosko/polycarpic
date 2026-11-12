# POLY-140 verdict (gate 4)

qa-140, measured at 8d8bd56 from the qa-140 worktree (`pnpm install --frozen-lockfile --offline`). **Pass**, with the notes under Deltas.

## Runs at 8d8bd56

| Run | Result |
|---|---|
| `pnpm lint` (check.mjs, eslint packages apps scripts/layers, check-migrations) | exit 0, 2.4 s wall |
| `vitest run tests/layers` | 5 files, **452/452**, 9.6 s |
| `pnpm test --force` (turbo, 17 packages) | 17/17 tasks successful (config 303, web 88, auth 31, db 8, rest 1–3) |
| `vitest run tests/ci tests/config tests/log tests/workflow tests/infra` | 440 passed, 40 skipped, 2 files failed: `tests/infra/image/{caddy,postgres}.test.ts`, which need Docker and time out under parallel load. `caddy` passes alone (10/10); `postgres.test.ts` fails 3 tests on `docker run` assertions and a 10 s hook timeout. This loop touches nothing under `tests/infra` or the image. Whether they fail on main: unmeasured. |
| `tests/db`, `tests/image` | not run (need the pgTAP container). Unmeasured; nothing in this loop touches them. |

`tests/layers` time: **10.9 s, 259 tests before** (58e66d7) → **9.6 s, 452 tests after**. The 193 new tests cost nothing measurable (fixtures lint in about 1 ms each; run-to-run noise is about 1 s). `pnpm lint` time before the rule: unmeasured.

Red-first record (gate 2, a5df7e8 / 8acedb1): 133 of 192 new tests were red for the right reason (rule or guard absent, no parse errors); the other 59 are green controls and mutant-proved guards. All 259 old tests stayed green.

## Acceptance criteria

| # | Criterion | Proof |
|---|---|---|
| 1 | Relative import into another package is a lint error from any file under `apps/*/src`, `packages/*/src`, whatever the map says | `fixtures/25-relative-cross-package/fail-*` (all forms), incl. `fail-auth-to-db-allowed-edge` and `fail-map-allows-posting-still-refused` (map allows, still red); lint.test.ts green |
| 2 | Fixtures red for the two reproduced cases, green inside a package | `fail-web-to-migrate-index`, `fail-auth-to-ledger-index`; `pass-same-dir`, `pass-parent-from-subdir`, `pass-package-json`, `pass-own-dir-via-own-name` |
| 3 | No existing source file trips the rule | `pnpm lint` exit 0 with the rule on (124+ files; the 6 test imports to root `tests/` pass under cond 5) |
| 4 | Rule generated from the map; freshness test covers it | `relative-structure.test.ts` "generated from layers.json" (17 packages × 2 rules, own dir and every other dir from the map), "eslint.config.js does not name either rule"; `fail-new-package-named-from-map` (map variant adds `newpkg`, message names it); `tests/ci/generated-freshness.test.ts` green |
| 5 | ARCH states both forms refused, present tense | ARCH 1.15.16 §2.1 Rule + bullet 85; read against `plugin.mjs` and `generate.mjs`, consistent (see Docs) |

## Ruling conditions (as amended by addenda 1–3)

| Cond | Proof |
|---|---|
| 1 forms, all extensions | fixtures `fail-form-*` (import type, export from, export *, import(), require, import=, TS import type, glob string/array/negated, `/// reference`, svelte), `fail-ext-{tsx,js,mjs,cjs}` |
| 2 specifier syntax | `fail-suffix-query-raw`, `fail-suffix-hash`, `fail-root-relative-path`, `fail-directory-specifier`, `fail-nonexistent-target`; `pass-sveltekit-lib-alias`, `pass-new-url-http` |
| 3 refused from every file | `fail-absolute-path`, `fail-file-url`, `fail-node-modules-segment(-in-test)`, `fail-computed-{template,concat,relative-inside-own-package}`; message names the package (`@message:`) on 8 fixtures |
| 4 src never leaves its package (**awaiting the Principal; judged as built**) | `fixtures/26-condition-4-droppable/*` (5 red) plus `pass-*` for tests in 25; built and green. Dropping it is `git rm -r` of that directory. Note `fail-src-to-newpkg-real-map-names-none` asserts the real-map message names no `newpkg` |
| 5 tests may reach only root `tests/` | `pass-colocated-test-to-root-tests`, `pass-colocated-spec-…`, `pass-package-tests-dir-to-root-tests`; `fail-colocated-test-to-{ledger,scripts}`, `fail-package-tests-dir-to-{migrate,scripts}` |
| 6 generated, not disableable | structure test (above); `fail-bare-disable`, `fail-inline-disable` in 25 and 27. Harness note: ESLint reports "Definition for rule not found" under the missing rule's id; lint.test.ts now ignores that message so these cannot pass falsely |
| 7 freshness (a)(b)(c) | (a) `fail-map-allows-posting-still-refused`; (b) `fail-new-package-named-from-map` + cond-4 real-map twin; (c) structure test per package |
| 8 required fixtures | all listed in 25/26 (see 1, 2, 4, 5) |
| 9 tree clean | `pnpm lint` exit 0 |
| 10 no tracked symlink | `relative-structure` "no tracked symlink" (tree 0; mutant red) |
| 11 no path alias | `relative-structure` "no path alias" (tsconfigs incl. base, vite config; 5 mutants red) |
| 12 every extension linted | `fixtures/29-source-extensions/*` (6 red), structure tests: x.mts/cts/jsx get layer rules, x.test.mts gets cast exemption, every tracked source file matched by SRC |
| 13 `new URL` | `fail-new-url-{in-worker,in-shared-worker,bare,static-template,computed}`; `pass-new-url-same-dir`, `pass-new-url-http` |
| 14 src never imports test code | `fixtures/28-*` (5 red, 2 green) |
| 15 (a) factory tokens (b) every `module`/`node:module` import (d) no `.cjs`/`.cts` under src | `fixtures/27-require-factory/*` (a: named, renamed, member, bracket, destructured, string, template, computed process/globalThis/global key, in secrets/db/web blocks; b: namespace, default, named other, named `Module`, side-effect, export from, `import()`, `require()`); (d) `relative-structure` ".cjs/.cts" (3 red inputs, tree 0) |
| 16 indirection | `relative-structure` "package-level indirection": 13 red inputs (imports field; link/file/npm in each dep field; workspace alias both forms; wrong key; root overrides, resolutions, pnpm.overrides; workspace.yaml overrides npm/workspace), real tree clean; "no pnpmfile hook": file, `.npmrc`, yaml key, package.json#pnpm key red, `ignore-pnpmfile` green |
| 17 static templates | `fail-template-{import-expression,require,glob,ts-import-type}`, `fail-new-url-static-template`, `pass-template-no-expr-inside` |
| Addendum 3 | `14-disable-proofing/fail-inline-disable-inert-no-console` (afc246c): green on this build |

## Docs against code

- ARCH 1.15.16 §2.1 (Rule, bullet at line 85, Lint bullet at line 92) and SECURITY 1.9.11 (bullets at lines 833–836) match `plugin.mjs`/`generate.mjs`: path-specifier set, refusals (other package, `node_modules`, absolute, computed), src-leaves-package and test-code rules, test/outside-src to root `tests/`, forms list, source extensions (`SRC` in generate.mjs), `noInlineConfig`, `poly/no-require-factory`, `.cjs`/`.cts`, indirection guards. `.dockerignore` lists `tests`, as SECURITY says.
- PDFs: ARCH.pdf and SECURITY.pdf were committed in the same commits as their index.html (30ef4a9, 0627f08), carry 1.15.16 / 1.9.11, and contain the new bullets verbatim (checked with `pdftotext` on the rule bullet, the Lint bullet, and the four SECURITY bullets). A whole-document paragraph diff is not reliable on these PDFs (tables and diagrams extract out of order), so a full match is unmeasured beyond those bullets and the version strings.

## Deltas

1. `tests/infra/image/postgres.test.ts` fails and `caddy.test.ts` flakes under parallel load in my run (Docker-dependent). Unrelated to this loop; not measured on main.
2. Condition 4 still awaits the Principal. As built it passes its 5 fixtures; removing it means deleting `fixtures/26-condition-4-droppable/` and, if the rule is changed, the cond 4 branch in `plugin.mjs`.
3. Residuals are as the ruling states them (computed key via an aliased global object; `vi.mock` in colocated tests); no new ones found.
