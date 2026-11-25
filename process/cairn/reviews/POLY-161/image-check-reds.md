# POLY-161e: `image.sh check`, each new assertion shown red (C4)

devops. Run at tip `35908f5b` against a local `polycarpic:ci` (built by `image.sh build`, one tree earlier than the tip, with the same `web` stage). Each plant is a one-line derived image (`FROM polycarpic:ci`, `USER root`, one `RUN`, `USER node`); `image.sh check` of it ends with exit 1 and the message below. The clean image exits 0 (baseline).

| # | Assertion | Plant | Message read |
|---|---|---|---|
| 0 | clean image | none | exit 0, no output |
| 1 | no `index.js` | `touch build/index.js` | `/app/apps/web/build/index.js is in the image` |
| 2 | no `adapter-index.js` | `touch build/server/adapter-index.js` | `.../build/server/adapter-index.js is in the image` |
| 3 | no source map under `apps/web` | `touch build/server/x.js.map` | `files that must not ship: .../x.js.map` |
| 4 | no `.svelte-kit` | `mkdir apps/web/.svelte-kit` | `files that must not ship: /app/apps/web/.svelte-kit` |
| 5 | no `apps/web/tests` | `mkdir apps/web/tests` | `files that must not ship: /app/apps/web/tests` |
| 6 | no `.env*` | `touch apps/web/.env.local` | `files that must not ship: /app/apps/web/.env.local` |
| 7 | build tools refused (`rolldown`) | `mkdir apps/web/node_modules/rolldown` | `build tooling in the image: .../node_modules/rolldown` |
| 8 | `@sveltejs` set is exactly `{acorn-typescript}` (a second package) | `mkdir -p apps/web/node_modules/@sveltejs/kit` | `@sveltejs packages in the image are not exactly acorn-typescript: acorn-typescript, kit` |
| 9 | the same, blind control: the `find` sees something | the script with both `@sveltejs` finds pointed at a nonexistent path, on the clean image | `not exactly acorn-typescript:` and an empty set |
| 10 | nothing under `build` writable by uid 1000 | `chmod 777 build` | `uid 1000 can write under apps/web/build ... : /app/apps/web/build` |
| 11 | the same for uid 10101 | `chown 10101 build/handler.js; chmod u+w` | `uid 10101 can write under apps/web/build ...: /app/apps/web/build/handler.js` |
| 12 | `packages.json` present | `rm build/packages.json` | `build/packages.json is missing` |
| 13 | `packages.json` equals the committed list; picomatch refused | `svelte` renamed `picomatch` in it | `bundle packages differ from the committed list` |
| 14 | control: `find` sees `handler.js` (and the smoke imports it) | `rm build/handler.js` | the control message first; the smoke's `ERR_MODULE_NOT_FOUND` on the import |
| 15 | smoke compares status and body marker | `handler.js` replaced by one that answers 200 `x` to every path | `smoke: 200 200 null 200` then `the web bundle does not answer /sign-in (200 HTML) and /dashboard (303)` |

## What is not shown red, and why

- `/packages.json` is not served (the smoke's third request): plant 15 turns it red together with the other two clauses, so the clause is read (`s3` prints 200), not isolated. A copy of `packages.json` into `build/client` stays green: the adapter lists the client's files when it builds, so a file added afterwards is not served. The adapter's own file list is therefore the guard, and the crawl in `tests/db/web-server.test.ts` asserts the client's file list on the built server.
- A plant in the build stage itself (a bundled picomatch, a client-only import) is qa's `audit-exemption.test.ts`, on real builds.
