---
id: POLY-82
title: Monorepo skeleton + layer lint
status: todo
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [package.json, pnpm-workspace.yaml, .npmrc, turbo.json, layers.json, packages/*/package.json, apps/*/package.json, eslint.config.*, tsconfig*.json, packages/*/src/index.ts, packages/db/src/session.ts, packages/secrets/src/open.ts, packages/*/src/*.test.ts, apps/*/src/**, scripts/layers/**, test/layers/**]
labels: [enabler]
priority: P1
pr: null
created: 2026-11-08
updated: 2026-11-09
---

The pnpm + Turborepo workspace with every ARCH §2.2 package and app stubbed, each with a Vitest file that runs alone, and the layer enforcement of ARCH §2.1 (v1.12) built: the layer map `layers.json`, lint generated from it, package-resolution guards, and the checks on the file. Scaffolding only; every other M1 issue builds in it. The architect owns `layers.json`. CI wiring, including the change filter, is POLY-96. Each check below is a script runnable by `pnpm lint` with pass and fail fixtures under `test/layers/`.

## Acceptance criteria

- [ ] The workspace holds the ARCH §2.2 packages plus apps/web and apps/worker, each with one passing Vitest test runnable alone.
- [ ] `layers.json` at the repo root lists every ARCH §2.2 package and app with its layer, its public subpaths and its allow-list, transcribed from §2.2's `data-consumes` attributes.
- [ ] The eslint-plugin-boundaries config is generated from `layers.json`, never hand-copied. A fixture shows that an import added to the file's allow-list becomes legal with no config edit.
- [ ] Lint refuses an import not on the importer's allow-list, both upward (ledger → posting) and sideways (ledger → import). It allows a listed same-layer import (securities → ledger).
- [ ] An upward `import type` fails lint exactly as a value import does.
- [ ] Lint refuses a cross-package re-export of an unlisted package and a cross-package `import()` with a computed specifier.
- [ ] Lint refuses `@sveltejs/kit`, `$app/*` and `$env/*` under packages/*. packages/ui importing `svelte` passes.
- [ ] Lint refuses, outside packages/db, every specifier that yields a Postgres connection, with one fixture each: `pg`, `pg-pool`, `postgres`, `@neondatabase/serverless`, the `drizzle-orm` Postgres driver subpaths (`node-postgres`, `postgres-js`, `neon-serverless`, `neon-http`, `pg-proxy`) and the `PostgresDialect` named import from `kysely`. Type imports count too; db re-exports any driver type another package needs. Lint also refuses any session-level SET (ARCH §3.3, SECURITY A-39).
- [ ] Lint refuses `secrets/open` imported anywhere except apps/worker (apps/web fails; apps/worker passes), and the HPKE library imported outside packages/secrets. This passes trivially until the secrets code lands in M2.
- [ ] Lint refuses `createCipheriv`, `createDecipheriv`, `publicEncrypt` and `privateDecrypt` from `node:crypto` outside packages/secrets; `createHash`, `randomBytes` and `timingSafeEqual` stay allowed everywhere (SECURITY A-39, recommended item).
- [ ] Lint refuses `db/session` (the SessionUserId constructor) imported anywhere except packages/auth.
- [ ] Lint refuses a cast to `SessionUserId` (`as SessionUserId`, `as unknown as SessionUserId`, `<SessionUserId>x`) outside db/session and test files. A type test shows the constructor is not exported from the `@poly/db` index (SECURITY A-39).
- [ ] An inline `eslint-disable` comment naming a boundaries or restricted-import rule fails lint: a fixture with a disabled `secrets/open` import in apps/web still fails (SECURITY A-39).
- [ ] Every package.json has an `exports` map listing only `.` and the subpaths `layers.json` declares. A deep import (`@poly/ledger/src/x`) fails `tsc`, which resolves with `moduleResolution: "bundler"`.
- [ ] An undeclared cross-package import fails to resolve under pnpm's strict linking (no workspace hoisting in `.npmrc`), and `import-x/no-extraneous-dependencies` reports it by name.
- [ ] Check: a declared `workspace:` dependency missing from the package's allow-list fails.
- [ ] Check: a directory under packages/ or apps/ that is absent from `layers.json` fails, and so does an entry in the file with no directory.
- [ ] Check: an allow-list entry pointing at a higher layer fails, and a cycle between two same-layer packages fails.
- [ ] Check: `layers.json` and ARCH §2.2's `data-consumes` lists disagreeing (one entry added to either side) fails.
