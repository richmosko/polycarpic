---
id: POLY-140
title: Layer lint relative imports
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [tests/layers/**, scripts/layers/**, eslint.config.js, layers.json, infra/ci/generated.json, docs/ARCH/**, docs/SECURITY/**, package.json, pnpm-lock.yaml, process/cairn/issues/POLY-140.md, process/cairn/reviews/POLY-140/**]
labels: [lint, security]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-11
---

The layer lint enforces the layer map only for imports written by package name. A relative import that reaches into another workspace package passes: `apps/web/src` → `'../../migrate/src/index.ts'` and `packages/auth/src` → `'../../ledger/src/index.ts'` give no error, while `'@poly/migrate'` from `apps/web/src` gives a `boundaries/dependencies` error. Found by seceng on POLY-136 and reproduced by the architect with node_modules installed (`process/cairn/reviews/POLY-136/ruling.md`, addendum 2). No `tests/layers` fixture covers the relative form. POLY-136 closed it for `apps/migrate/src/run.ts` only, with a pattern in `scripts/layers/generate.mjs`. This runs ahead of POLY-87, which builds the new-user step on a boundary the lint is meant to hold (Principal's call, 2026-11-12). The architect rules the seam; seceng reviews the ruling.

## Acceptance criteria

- [x] A relative import that resolves into another workspace package's folder is a lint error from any file under `apps/*/src` or `packages/*/src`, whatever the layer map says about the two packages. Proof: `fixtures/25-relative-cross-package/fail-*`, incl. `fail-auth-to-db-allowed-edge` (map allows, still red).
- [x] `tests/layers` fixtures show it red for the two reproduced cases (`apps/web/src` → `../../migrate/src/index.ts`, `packages/auth/src` → `../../ledger/src/index.ts`) and green for a relative import inside one package. Proof: `fail-web-to-migrate-index`, `fail-auth-to-ledger-index`; green `pass-same-dir`, `pass-parent-from-subdir`, `pass-package-json`.
- [x] No existing source file trips the rule, or each one that does is fixed in this loop. (A text search at 8d2173e found no non-test file under `apps/*/src` or `packages/*/src` with an import climbing two or more directories; unconfirmed by the lint itself.) Proof: `pnpm lint` exit 0 at 8d8bd56 with the rule on.
- [x] The rule is generated from the layer map by `scripts/layers/generate.mjs`, not hand-written in `eslint.config.js`, and the generated-freshness test covers it. Proof: `tests/layers/relative-structure.test.ts` (generated blocks per package) and `tests/ci/generated-freshness.test.ts`.
- [x] ARCH's layer-enforcement section states that both import forms are refused (present tense, no history). Proof: ARCH 1.15.16 §2.1, read against `plugin.mjs`; see `process/cairn/reviews/POLY-140/verdict.md`.

## Comments

### @team-lead — 2026-11-11

Feature started. Branch: `feature/poly-140-layer-lint-relative-imports`.

### @team-lead — 2026-11-11

Gates 1 to 3 at 8ebe007. Ruling: `process/cairn/reviews/POLY-140/ruling.md` (17 conditions, addenda 1 and 2), seceng review pass with S1–S6 folded in. Tests red at 8acedb1: 133 failed, 318 passed of 451 in `tests/layers`. Build at 8ebe007: `tests/layers`, `tests/ci`, `tests/config` 740 of 740, `pnpm lint` clean (lead's own runs). `docs/SECURITY/**` added to paths for the import-boundary lines seceng named. Open: the architect rules on two builder choices (`noInlineConfig` on the layers block; `poly/no-computed-import` no longer exempting relative specifiers); condition 4 awaits the Principal.
