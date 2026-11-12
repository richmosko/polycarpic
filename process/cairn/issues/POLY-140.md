---
id: POLY-140
title: Layer lint relative imports
status: todo
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [tests/layers/**, scripts/layers/**, eslint.config.js, layers.json, infra/ci/generated.json, docs/ARCH/**]
labels: [lint, security]
priority: null
pr: null
created: 2026-11-11
updated: 2026-11-11
---

The layer lint enforces the layer map only for imports written by package name. A relative import that reaches into another workspace package passes: `apps/web/src` → `'../../migrate/src/index.ts'` and `packages/auth/src` → `'../../ledger/src/index.ts'` give no error, while `'@poly/migrate'` from `apps/web/src` gives a `boundaries/dependencies` error. Found by seceng on POLY-136 and reproduced by the architect with node_modules installed (`process/cairn/reviews/POLY-136/ruling.md`, addendum 2). No `tests/layers` fixture covers the relative form. POLY-136 closed it for `apps/migrate/src/run.ts` only, with a pattern in `scripts/layers/generate.mjs`. This runs ahead of POLY-87, which builds the new-user step on a boundary the lint is meant to hold (Principal's call, 2026-11-12). The architect rules the seam; seceng reviews the ruling.

## Acceptance criteria

- [ ] A relative import that resolves into another workspace package's folder is a lint error from any file under `apps/*/src` or `packages/*/src`, whatever the layer map says about the two packages.
- [ ] `tests/layers` fixtures show it red for the two reproduced cases (`apps/web/src` → `../../migrate/src/index.ts`, `packages/auth/src` → `../../ledger/src/index.ts`) and green for a relative import inside one package.
- [ ] No existing source file trips the rule, or each one that does is fixed in this loop. (A text search at 8d2173e found no non-test file under `apps/*/src` or `packages/*/src` with an import climbing two or more directories; unconfirmed by the lint itself.)
- [ ] The rule is generated from the layer map by `scripts/layers/generate.mjs`, not hand-written in `eslint.config.js`, and the generated-freshness test covers it.
- [ ] ARCH's layer-enforcement section states that both import forms are refused (present tense, no history).
