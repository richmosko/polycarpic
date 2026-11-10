---
id: POLY-82
title: Monorepo skeleton + layer lint
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: backend-lead
paths: [package.json, pnpm-workspace.yaml, pnpm-lock.yaml, .npmrc, .gitignore, turbo.json, layers.json, packages/*/package.json, apps/*/package.json, eslint.config.*, tsconfig*.json, packages/*/tsconfig.json, apps/*/tsconfig.json, vitest.config.*, packages/*/vitest.config.*, apps/*/vitest.config.*, packages/*/src/index.ts, packages/db/src/session.ts, packages/db/src/auth.ts, packages/db/src/migrate.ts, packages/secrets/src/open.ts, packages/*/src/*.test.ts, apps/*/src/**, scripts/layers/**, test/layers/**]
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
- [ ] Lint refuses, outside packages/db, every specifier that yields a Postgres connection, with one fixture each: `pg`, `pg-pool`, `postgres`, `@neondatabase/serverless`, the `drizzle-orm` Postgres driver subpaths (`node-postgres`, `postgres-js`, `neon-serverless`, `neon-http`, `pg-proxy`) and `PostgresDialect` from `kysely`, whether a named import or reached through a default or namespace import (`kysely.PostgresDialect`). Outside packages/db, `kysely` allows named imports only, so a fixture of each form fails. Type imports count too; db re-exports any driver type another package needs. Lint also refuses any session-level SET (ARCH §3.3, SECURITY A-39).
- [ ] Lint refuses `secrets/open` imported anywhere except apps/worker (apps/web fails; apps/worker passes), and the HPKE library imported outside packages/secrets. This passes trivially until the secrets code lands in M2.
- [ ] Outside packages/secrets, `crypto` and `node:crypto` allow named imports only. A default or namespace import fails (fixture: `import * as c from 'node:crypto'; c.createCipheriv(...)`). So do the named imports `createCipheriv`, `createDecipheriv`, `publicEncrypt`, `privateDecrypt`, `subtle` and `webcrypto`, from either specifier. `createHash`, `randomBytes` and `timingSafeEqual` stay allowed everywhere (SECURITY A-39).
- [ ] Outside packages/secrets, lint refuses `crypto.subtle.encrypt`, `decrypt`, `wrapKey` and `unwrapKey` on the global WebCrypto object, with one fixture each; `digest`, `sign` and `verify` stay allowed (SECURITY A-39).
- [ ] Lint refuses `db/session` (the SessionUserId constructor) imported anywhere except packages/auth.
- [ ] Lint refuses a cast to `SessionUserId` (`as SessionUserId`, `as unknown as SessionUserId`, `<SessionUserId>x`) outside db/session and test files. A type test shows the constructor is not exported from the `@poly/db` index (SECURITY A-39).
- [ ] An inline `eslint-disable` comment naming any of these rules fails lint: boundaries, restricted import, the `SessionUserId` cast ban, and the session-level SET ban. So does a blanket `eslint-disable` naming no rule, enforced by `eslint-comments/no-unlimited-disable`. Fixtures: a disabled `secrets/open` import in apps/web, a disabled cast, a disabled SET, and a bare `/* eslint-disable */`, each still failing (SECURITY A-39).
- [ ] Every package.json has an `exports` map listing only `.` and the subpaths `layers.json` declares. A deep import (`@poly/ledger/src/x`) fails `tsc`, which resolves with `moduleResolution: "bundler"`.
- [ ] An undeclared cross-package import fails to resolve under pnpm's strict linking (no workspace hoisting in `.npmrc`), and `import-x/no-extraneous-dependencies` reports it by name.
- [ ] Check: a declared `workspace:` dependency missing from the package's allow-list fails.
- [ ] Check: a directory under packages/ or apps/ that is absent from `layers.json` fails, and so does an entry in the file with no directory.
- [ ] Check: an allow-list entry pointing at a higher layer fails, and a cycle between two same-layer packages fails.
- [ ] Check: `layers.json` and ARCH §2.2's `data-consumes` lists disagreeing (one entry added to either side) fails.
- [ ] `layers.json` declares `db/auth` as a restricted subpath importable only by packages/auth: fixtures importing it from apps/web and packages/tenancy fail lint, packages/auth passes (ARCH §2.1, POLY-76 ruling §4.6).
- [ ] `layers.json` names exactly one module exempt from the session-level SET ban, packages/db's migrate module: a fixture with `SET ROLE poly_owner` there passes, and the same statement in another packages/db file and in packages/auth each fails (ARCH §2.1, POLY-76 ruling §4.2).
- [ ] `db/auth` is importable only by packages/auth, and the session-SET exemption is one file path in `layers.json`, not a glob. Each rule still fails under an inline or blanket `eslint-disable` (fixtures). A fixture importing the migrate module from apps/web or apps/worker fails (SECURITY C-84, C-85, A-40).

## Comments

### @team-lead — 2026-11-09

Feature started. Branch: `feature/poly-82-monorepo-skeleton-layer-lint`.

### @architect — 2026-11-09

**Ruling (architect): layers.json, the session-SET rule, the HPKE specifiers.** ARCH v1.15.

1. **`layers.json` schema** (agreed with backend-lead). The keys of `packages` are exactly the `data-consumes` tokens of ARCH §2.2, and `dir` is the row's path. The ARCH check matches a row to its entry by `dir` and compares `allow` with `data-consumes` as sets. `layer` is an integer, 0 to 6. `subpaths` are the `exports` keys besides `.`. **Every subpath is restricted by construction**: the allow entry `db` grants the index only, and `db/auth` grants that subpath. So `db/auth` and `db/session` go to auth only, and `secrets/open` to worker only. There is no separate list of importers. File checks:
   - an entry `x/y` needs `x` too, and `./y` in x's `subpaths`;
   - `sessionSetExempt` is one string with no glob characters.
2. **Migrate module**: `packages/db/src/migrate.ts`. It is not a subpath and nothing imports it, web and worker included (C-85). It runs as a package script of `@poly/db`; the entry itself is POLY-83's.
3. **Session-level SET ban.** This applies to SQL in string literals, template literals and `sql` tags outside `sessionSetExempt`, matched case-insensitively per statement.
   - **Fails:**
     - `SET x …` and `SET SESSION x …`, any parameter, `ROLE` and `SESSION AUTHORIZATION` included;
     - `RESET …`;
     - `set_config(…, false)`, with the third argument anything but the literal `true`;
     - `SET LOCAL ROLE` and `SET LOCAL SESSION AUTHORIZATION`, because only the migrate module switches roles.
   - **Passes:** any other `SET LOCAL x …`, and `set_config(…, true)`.
   - Why: `SET LOCAL` and `is_local = true` end at COMMIT or ROLLBACK (read: PostgreSQL docs, `SET`). That cannot leak across pooled requests, and that leak is the hazard A-39 bans. `withTenant` still uses `set_config` only (§3.3). ARCH ~1076's `set local role` is about the spike's migration files, not app code.
4. **HPKE library**: `@hpke/core` + `@hpke/dhkem-x25519` (proposed; SecEng signs off in the M2 secrets design, SECURITY §6.3). Outside packages/secrets, lint refuses the specifiers `hpke-js` and `@hpke/*`, meaning every `@hpke/` scope package and its subpaths. The ban covers the whole family, so it does not depend on the final pick. Fixtures: `@hpke/core` and `hpke-js` imported in apps/worker both fail.
5. **ARCH v1.15**, found while transcribing:
   - auth's `data-consumes` gains `db/auth db/session`;
   - §2.1's same-layer list gains `web → ui`;
   - §2.1 states the subpath rule and the SET rule above;
   - §2.2's secrets row names the library.
6. **Scope note for the lead**: `packages/db/src/migrate.ts` is not in this issue's `paths:`. Add it, since the skeleton stubs it.

### @architect — 2026-11-09

**Architect review: approved at 7c70152.**

| Axis | Result | Evidence |
|---|---|---|
| Lint generated from `layers.json`, nothing hand-copied | pass | `eslint.config.js` → `generateConfig(layers)`; the allow-lists, elements and subpath grants are derived from it. The fixture `03-generated/pass-after-allowlist-edit` passes. 7c70152 |
| Owners hard-coded in the generator (db, secrets, packages/, db/session.ts) | accepted | Each fails closed if renamed (ARCH v1.15.1 §2.1). S5's comment covers `no-session-set` mode. b5ea81e |
| Every subpath restricted; db/auth and db/session for auth only, secrets/open for worker only | pass | Fixtures 09, 12, 15 and 21, in static, `import()` and `require` forms. 030aa57 |
| Session-SET ruling, plus addendum 1 | pass | 08- and 17-set-matrix, covering comment-prefix, interpolated third argument, prose, SET TRANSACTION/CONSTRAINTS and UPDATE…SET. Exemption: 22-migrate-set, glob probe included. b5ea81e |
| Disable proofing: inline, blanket and config comments | pass | Fixtures 14, 16 and 23. 030aa57 |
| Resolution guards: exports map exact, no hoisting, deep import fails tsc | pass | `structure.test.ts`, the `tsc/` probes, and the `exports-mismatch` mutations, with no map and a stray `./migrate`. 904a919 |
| Checks on the file: completeness, upward, cycle, workspace deps, ARCH ↔ file | pass | `check.test.ts`: one mutation per check id, measured over the baseline. 030aa57 |
| db index does not export the `SessionUserId` constructor | pass | `tsc/db-index.ts`, plus the non-vacuous control `db-session-control.ts`. 7c70152 |
| Nothing pre-empts POLY-83/84/85 | pass | db is stubs only, with `session.ts` the brand alone. Migrate is a stub with no export. config is a stub; its contents are POLY-85's. |
| Harness green | qa-engineer's measurement | 229/229 and `pnpm lint` clean, measured by qa-engineer before the rebase onto 7c70152 (not re-run by me). The gate owner re-runs at finish. |

ARCH changes landed in this loop: v1.15 (subpath rule; auth `data-consumes`; web → ui; HPKE library; SET rule), v1.15.1 (where standing restrictions live; SET TRANSACTION passes), v1.15.2 (`packages/config` at L0).

**Follow-ups, not blocking** (for an umbrella issue, not one issue each):
- S4: `set_config` argument split stops at the first `)`. A false positive; it fails closed.
- S6: comment stripping is not quote-aware. A `'--'` inside a SQL string literal hides a later `SET`. This needs deliberate intent in reviewed db/auth code.
- SecEng signs off the HPKE library pick (`@hpke/core` + `@hpke/dhkem-x25519`) in the M2 secrets design. The lint ban already covers the whole family.
