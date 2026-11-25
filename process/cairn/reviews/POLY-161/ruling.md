# POLY-161a ruling: web server in the release image

Architect. Gating. "measured" = run by me at `a506889d` on this Mac (Node 26.13.1): `vite build` of `apps/web`, then the built `build/handler.js` mounted on a bare `node:http` server and driven over raw sockets with no database, about 75 requests; and a DNS probe. Nothing was run in a container; everything about the image is `(unmeasured)`. The checklist is `verdict.md`.

## What was measured, and what it decides

| # | Measured | Decides |
|---|---|---|
| M1 | Kit 3.1.1 / adapter-node 6.0.1: `vite build` takes under 1 s and needed no environment variable; 5.5 MB, 4.5 of it `build/server`; 53 source maps, none under `client`; no import outside `node:*` was found in `build/server`, so `pg`, pino and every `@poly/*` package are **inside the bundle** | The built app needs no `node_modules`. It has its own copy of `@poly/db`: its own pool, separate from `main.ts`'s |
| M2 | `build/index.js` binds 0.0.0.0:3000 itself and reads `HOST`, `PORT`, `SOCKET_PATH`, `LISTEN_FDS` (read). `build/handler.js` exports `handler(req, res, next)` and binds nothing; it reads `HOST_HEADER`, `ADDRESS_HEADER`, `PROTOCOL_HEADER`, `PORT_HEADER`, `XFF_DEPTH`, `BODY_SIZE_LIMIT` (read) | R1, R2: we mount `handler.js`; `index.js` does not reach the image; the adapter's variables get a refused prefix |
| M3 | The signed-out guard holds on every path tried, `%2e%2e`, `%2f`, `//`, absolute form, upper case and `__data.json` included: 303 to `/sign-in` (for `__data.json`, a 200 whose body is that redirect) | R6 |
| M4 | `isPublic` is a prefix test: any future file under `routes/sign-in/` is public the day it lands. `/healthz` is public and has no route (404). `/api/v1/health` is a 303 today | R6: an exact set |
| M5 | `Host` decides the URL: `GET /dashboard` with `Host: x/sign-in?` is answered as `/sign-in`. A form post whose `Origin` matches a forged `Host` passes Kit's cross-site check. Not reachable from a browser; reachable by anything on the edge network | R4: Host is pinned |
| M6 | There is no `handleError` hook. With the database down, one request with any handle cookie prints the raw pg error **with its stack** to stderr through `console.error`. The adapter prints too (`Could not determine request origin: …`) | R5: C-33 is broken the day the image serves this, unless fixed here |
| M7 | No request raised an unhandled rejection. `main.ts` exits 1 on one, so a single reachable rejection would be a remote stop | R3 catches every rejection of the handler |
| M8 | Node's own answers: garbage 400, headers over 16 KiB 431, CONNECT closed with no bytes, `Expect: foo` 417, Upgrade answered as a plain request. None echoed the client | R4 leaves them to Node |
| M9 | `server.timeout` 1500 closed a connection whose handler never answered after 1505 ms | R4 |
| M10 | `dns.promises.Resolver.resolveSoa`: an answer; `ENOTFOUND` for NXDOMAIN; `ENODATA` (empty), `ESERVFAIL`, `EREFUSED`, `ETIMEOUT` apart. `{timeout: 1000, tries: 1}` took 2001 ms against a silent server | R7; the bound is our own timer, not the resolver's |
| M11 | Memory after the run: 56 MB resident (bundle alone, no `main.ts`) | `mem_limit` 384m unchanged |

## R1 The build (devops: `Dockerfile`, `.dockerignore`, `infra/ci/image.sh`; frontend: `vite.config.ts`)

- A new stage `web`, same pinned base as the others, between `build` and the runtime: pnpm as in `build`; `COPY . .`; `pnpm install --frozen-lockfile` (dev dependencies; `--filter "@poly/web..."` if it works `(unmeasured)`); then the build in `apps/web` by the local `vite` binary, under `RUN --network=none`: third-party build code runs with no network. If `--network=none` fails in CI's BuildKit, devops brings the error to the lead; it is not dropped silently. `(unmeasured)`
- In that stage, after the build: delete `build/index.js`, `build/server/adapter-index.js` and every `*.map` under `build/`.
- Runtime: one added copy, `COPY --chown=root:root --from=web /app/apps/web/build /app/apps/web/build`, then not writable (`chmod -R a-w`). Nothing else comes from `web`. The `build` stage's `pnpm install --prod` is unchanged.
- `.dockerignore` gains `**/.svelte-kit`, `apps/web/build`, `apps/web/tests`.
- `vite.config.ts`: `adapter({ envPrefix: 'POLY_ADAPTER_' })`.
- `image.sh check` gains, on the built image: `build/handler.js` exists; no `index.js`, no `adapter-index.js`, no `*.map` under `build`, no `.svelte-kit`, no `apps/web/tests`; nothing under `build` is writable by uid 1000 or 10101; and, with `--network none`, a script that imports `handler.js`, mounts it on loopback and gets 200 and HTML for `/sign-in` and 303 for `/dashboard`. The `createAuth` smoke **stays**: it checks another process. Each new assertion is shown red on a planted fault.
- Limit, stated: the bundled packages (Svelte, Kit, `bits-ui`) are not in the image's `node_modules` as packages, so Trivy and the SBOM do not see them `(unmeasured)`. `pnpm audit` over the lockfile does.

## R2 Startup order (`apps/web/src/main.ts`)

1. Crash handlers. 2. `check-config` exits as today (offline, no build needed). 3. `guardConsole(log)` (R5). 4. `loadConfig('web')`; then any environment name starting `POLY_ADAPTER_` is refused: `config.refused {var, fault: 'forbidden'}`, exit 1. 5. `init()` (schema). 6. `verifyZone` (R7). 7. `startStatusServer`. 8. `await import` of `../build/handler.js` **by a computed URL**, so typecheck and the unit suites need no build; a failure is `web.build_missing {err}`, exit 1. 9. `startWebServer`. 10. `web.started`.

The import is after the zone check because importing runs Kit's `server.init`. `main.ts` calls `startStatusServer` and `startWebServer` once each. `SIGTERM`: stop listening, close idle connections, after 5 s close all, exit 0 (Compose's grace is 10 s).

## R3 The server (`apps/web/src/ops/server.ts`)

`startWebServer(opts: { publicOrigin: string; handler: WebHandler; log: Logger; port?: number }): Promise<Server>`, `type WebHandler = (req, res, next: () => void) => unknown`. Bind `0.0.0.0` and 3000 are constants; `port` is for tests. Bind failure: `web.bind_failed {err}` through the logger (closes POLY-162's D1), exit 1. Every request: the R4 checks, then `await` the handler inside `try`; a throw or rejection is `web.request_failed {err}` and a fixed 500 `{"error":"internal"}`, or a destroyed socket when headers are out. It never reaches the crash handler. `next` is the fixed 404 `{"error":"not found"}`.

`public-health.ts` and its test are deleted. `createServer` appears under `apps/web/src` in `server.ts` and `status.ts` only.

## R4 Limits: kept, changed, gone

| Stand-in (G15) | Now | Where |
|---|---|---|
| One path, fixed 404 elsewhere | **Gone.** The whole app; R6 lists it | hooks |
| `maxHeaderSize` 8 KiB | 16 KiB, set explicitly; 431 with no body | Node |
| `headersTimeout` 5 s | 10 s | Node |
| `requestTimeout` 5 s | 30 s (whole request, body included) | Node |
| `keepAliveTimeout` 1 s | 125 s: above Caddy's 2-minute idle default `(unmeasured, its documentation)`, so web never closes a connection Caddy is about to reuse for a POST | Node |
| `connectionsCheckingInterval` 1 s | the same | Node |
| (none) | `server.timeout` 60 s: a request whose answer never comes (a hung database) is closed (M9) | Node |
| `maxConnections` 64 | 512; the next is refused | Node |
| `maxRequestsPerSocket` 1, `connection: close` | **Gone**; keep-alive | |
| Body never read | **Gone.** Only a form action reads one, up to 512 KiB (`BODY_SIZE_LIMIT`'s default, which no variable can now move); an unread body is drained, bounded by 30 s | Kit, Node |
| Nothing echoed | **Changed.** `Host` is never echoed (below). The path and query come back inside `next=` of the 303, through `safeNext`, and nowhere else by us | hooks |
| Nothing logged from the request | Kept, by R5 | hooks, `main.ts` |
| `clientError` and CONNECT destroyed | Node's fixed answers (M8). A destroyed socket would make Caddy retry | Node |

**Before the handler, in `server.ts`:** `req.url` must start with one `/` and not `//`, else 400 `{"error":"bad request"}`. `Host`, lower-cased, must equal the host of `PUBLIC_ORIGIN` (with its port if it has one), else 421 `{"error":"misdirected"}`; the one exception is `GET` with `req.url` exactly `/api/v1/health` and `Host` exactly `127.0.0.1:3000`, which compose's healthcheck and R7's probe (`infra/ops/lib/stack.py`) send. Both fixed answers: `content-type: application/json`, `cache-control: no-store`, `connection: close`. Caddy passes the browser's `Host` unchanged `(unmeasured here)`; POLY-104 shows it.

**Residual, named:** the two health readers still share the cap, and now the application's pool, with strangers. A flood from the internet (slow bodies; or random handle cookies, each of which opens a transaction) can make web slow or unhealthy; in a deploy window that is a rollback. It is loss of service, never disclosure. Stock Caddy has no rate limiter `(unmeasured)`. Staging is behind the allowlist; prod is not.

## R5 Logging (C-33)

- `apps/web/src/ops/console.ts`: `guardConsole(log)` replaces `console.log, info, warn, error, debug, trace, dir`. A call logs `console.suppressed` at warn with `{err}` if an argument is an `Error`, and **nothing else of the arguments**. It is the last guard for the bundle and its libraries.
- `hooks.server.ts` exports `handleError`: status 500 and above → `web.error {outcome: 'error', err, status, route}` (`route` is `event.route.id`, omitted when null; never a URL); below 500 → nothing. It returns `{ message }`, Kit's own fixed message.
- No access log in web. No schema change.

## R6 What the image now serves

**Before any hook (static, public):** the files under `build/client`: `/_app/immutable/**`, `/_app/version.json` (the build time), `/theme.js`. Kit's own, data-free: `/_app/env.js` (`env={}`), 404 for other `/_app/*` files, 400 for `__route.js`, 308 for a trailing slash on a known route. The client JavaScript of every page is public; it holds no data and the repository is public.

**Signed-out routes, an exact set** in `hooks.server.ts`, replacing `isPublic`, exported as `PUBLIC_ROUTES` from `apps/web/src/lib/public-routes.ts`: `/api/v1/health`, `/sign-in`, `/sign-in/cancel-method`, `/sign-in/forgot`, `/sign-in/reset`, `/sign-in/second-step`, `/sign-up`. `/healthz` goes: one health path. An unknown path under `/sign-in/` is a 303 like any other. Their `__data.json` stays public (measured for two of them under today's test; asserted on the built server under the exact set).

**Everything else** (`/`, the eight sidebar pages, `/settings/second-step`, `/settings/sessions`, every unknown path, every method, every `__data.json`): the guard. `/api/auth` and below: web's 404, as today; Caddy sends that tree to auth.

`/api/v1/health` is `src/routes/api/v1/health/+server.ts`: `GET` returns `handleHealth()` and nothing else is exported. It goes through Kit on purpose: health is red when the app cannot answer. `HEAD` answers as GET without a body, other methods 405 `(unmeasured)`. Differences from G15: a query string is ignored, a trailing slash is a 308. `handleHealth`'s bodies, `no-store`, single flight and memo are unchanged. Not on 8081.

Exposure, for the Principal's summary: on prod the sign-in, sign-up (invitation needed) and health pages become reachable by anyone; on staging by the allowlist plus basic auth, as today. What the attacker reaches is the form pages, the static files, and one database transaction per request that carries a handle cookie (`enter_session`, which refuses an unknown handle).

## R7 The zone check (`apps/web/src/ops/zone.ts`; C-76)

`verifyZone(zone: string | undefined, opts: { log: Logger; resolvers?: string[]; timeoutMs?: number; retryMs?: number }): Promise<'verified' | 'unverified' | 'refused' | 'skipped'>`. `main.ts` passes only `log`; nothing in the environment changes the rest.

- `undefined` (private-ca, and so every development localhost) → `skipped`, no query. `Config` gains `zone: string | undefined`: the registrable domain `tldts` already parses, set only in real-domain mode, so one parse decides both tests.
- Resolvers `1.1.1.1` and `9.9.9.9`, asked in parallel, one `Resolver` each with `setServers`, never the container's own. SOA for the zone. Whole check bounded at 5000 ms by our own timer.
- **Any SOA → `verified`** (`zone.verified`, info). **No SOA and every resolver answered `ENOTFOUND` → `refused`** (`zone.refused`, fatal, `{outcome: 'refused', err}`), `main.ts` exits 1. **Anything else** (timeout, SERVFAIL, REFUSED, empty, or one NXDOMAIN beside a resolver that did not answer) → `unverified` (`zone.unverified`, warn) and the server starts. Two resolvers must agree because a DNS answer is unauthenticated: one forged NXDOMAIN must not keep the box down. This narrows C-76's "an NXDOMAIN refuses start"; seceng words it.
- After `unverified`: again every 600 s on an unref'd timer until verified. A later all-NXDOMAIN logs `zone.missing` (error) and keeps retrying; it never ends a running server.
- A restart is a start: a zone that lapses keeps web down at its next restart. Ratified by C-76.
- Not here: the warning for a public A record of the box's own name, which makes sense only on the local box (POLY-92, POLY-120). `check-config` stays offline. The zone name is not logged.

## R8 Compose, guard, lint, Caddy: no change

Web's command, environment, memory, networks and pinned healthcheck are unchanged: same path, same 200. `compose-allow.json` and `compose-policy.mjs` are not touched. The Caddyfile is unchanged.

## R9 T-real and its trigger (qa; devops: `changes.mjs`)

Against the built image, in part 1 after the healthy deploy:
1. In web's network namespace, the listening TCP sockets are exactly `0.0.0.0:3000` and `127.0.0.1:8081` (`/proc/net/tcp` and `tcp6`; Docker's own resolver on `127.0.0.11` left out by that exact address). One listener on 3000.
2. With `Host: staging.example.com`: `/sign-in` is 200 HTML with a marker of the page and a CSP header; the first `/_app/immutable/` file it names is 200; `/dashboard` is 303 to `/sign-in?next=%2Fdashboard`; another `Host` is 421. Health over loopback is 200 `{"ok":true}`.
3. **Sign-in smoke, the guard's positive case and the only run of the bundle's own database path in the image:** a user seeded as the superuser (hash made in the auth container, random password, recorded with `secret()`), signed in through auth, then `GET /dashboard` on web with the handle cookie: 200 with the user's name. A random handle: 303 and the cookie cleared.
4. Web's `docker logs`: every line is JSON with an `event`; none contains the handle, the password, a planted cookie or a planted path; `zone.verified` or `zone.unverified` is there before `web.started`.
5. The rollback case is unchanged: the stub replaces `main.ts`, and nothing else in the image listens.

The `deploy` key gains, each pinned in `ROWS`: `apps/web/src/ops/(server|zone|console).ts` (and loses `public-health`), `apps/web/src/hooks.server.ts`, `apps/web/src/lib/(public-routes|safe-next).ts`, `apps/web/src/app.html`, `apps/web/src/routes/api/v1/health/+server.ts`, `apps/web/vite.config.ts`, `apps/web/package.json`. Page components and the lockfile stay out, as ruled in POLY-100.

`deploy-real` took 436 s of 900 (POLY-162); the dev install and vite build are extra, in `image` and in `deploy-real` `(unmeasured)`. Over 840 s in either, devops brings it to the lead.

## R10 Other tests (qa)

- Units, no build: `ops/server.test.ts`, `ops/zone.test.ts` (a fake UDP resolver, as in M10), `ops/console.test.ts`, `hooks.server*.test.ts`, `lib/public-routes.test.ts`. `hooks.server.auth.test.ts` today pins `/sign-in/anything` and `/healthz` as public: it changes with R6.
- The real artefact: `tests/db/web-server.test.ts` (in `DB_AREAS.ops`), which spawns `main.ts` against Postgres with the built app, and crawls **every route id in `build/server/manifest.js`** signed out, in each method and as `__data.json`: the public set is exactly R6's, everything else the guard. It runs where 3000 is free. The db job gains a `@poly/web` build beside its `svelte-kit sync` (devops; under 1 s here).
- `zone.refused` through a spawned `main.ts`: an `--import` preload replaces `dns.promises.Resolver.prototype.resolveSoa`; no product seam.
- `ops-hardening.test.ts`'s crash case now needs the build (or exits 1 for the wrong reason): qa checks its `23505` still comes from the planted error.

## R11 Moves here from POLY-88 (the lead removes them there)

Criteria "No SvelteKit route is served by the image before POLY-86's signed-out guard is in" and "The image build stage runs `vite build` …". Comments: 2026-11-10 (zone check); 2026-11-11 item 3 (`/healthz` is replaced by `/api/v1/health`; the smoke is R9.3, and the `createAuth` smoke stays). Stay there: 2026-11-11 items 1 and 2, the held sign-in 302, the provider timeout. POLY-92's startup criterion: the zone half is met here.

## R12 Seam

| Thing | Value |
|---|---|
| Exports | `startWebServer`, `WebHandler` (`ops/server.ts`); `verifyZone` (`ops/zone.ts`); `guardConsole` (`ops/console.ts`); `PUBLIC_ROUTES: ReadonlySet<string>` (`lib/public-routes.ts`); `handle`, `handleError` (`hooks.server.ts`); `GET` (health route); `Config.zone` |
| Events | `web.started`, `web.bind_failed`, `web.build_missing`, `web.request_failed`, `web.error`, `console.suppressed`, `zone.verified`, `zone.unverified`, `zone.refused`, `zone.missing`, `config.refused` |
| Exit 1 | config, `POLY_ADAPTER_*`, schema, `zone.refused`, `web.build_missing`, `web.bind_failed`, crash. Exit 0: `SIGTERM` |
| Environment | none added. `POLY_ADAPTER_*` refused |
| Fixed bodies | 400 `{"error":"bad request"}`, 404 `{"error":"not found"}`, 421 `{"error":"misdirected"}`, 500 `{"error":"internal"}` |

## Decisions for the lead

1. **Paths:** add `packages/config/src/check.ts` (frontend, `Config.zone`). The other way is a second `tldts` parse in `apps/web`, which could disagree with the first. Recommended: add the path.
2. **Sign-in smoke in T-real (R9.3).** Recommended: yes; otherwise nothing runs the bundle against a database in the image before POLY-104.
3. **Two resolvers must agree on NXDOMAIN (R7)** narrows a ratified control's wording (C-76). Recommended: yes; seceng decides the wording.
4. **The exposure in R6 and the residual in R4** go to the Principal's summary. Decided: addendum 2.

## Addendum 1: `safeNext`, remote functions, one instance

**R13 `safeNext` (frontend: `apps/web/src/lib/safe-next.ts`; qa: its test). BLOCKS.** Measured (Node's URL parser, 19 values): today it passes `/` + tab, LF or CR + `/evil.example` or `\evil.example`, which resolve to `https://evil.example`; and `/x/..//evil.example`, whose path becomes `//evil.example`. Ruled: a value is honoured only if it is a string, starts with `/`, holds no code point U+0000 to U+001F or U+007F anywhere, resolves against a fixed base (`https://self.invalid`) to that same origin, and the resolved pathname does not start with `//`. Anything else, a parse error included, is `/`. An honoured value is returned **unchanged**. One module, every consumer through it: the two sign-in pages, the set-up dialog, both hook redirects.
Test rows, refused: the measured four, `/\0/evil.example`, `/x/..//evil.example`, `/./\evil.example`, `//x`, `/\x`, every control in second and in later position. Passed unchanged: `/dashboard`, `/a?b=c`, `/a#d`, `/a?n=//evil.example`, `/%09/evil.example`, `/%2f/evil.example`, `/@x`, `/%`. And in Chromium (e2e): a real sign-in from `/sign-in?next=%2F%09%2Fevil.example`, and the same through `/sign-in/second-step`, ends on our origin; red on today's module. The control rule is tested apart from the origin rule, each dropped in turn.

**R6, added:** Kit takes `event.url.pathname` of a remote call from a client header, which the guard trusts (seceng, read). `manifest.js`'s `remotes` is empty; a test holds it empty, and a request to `/_app/remote/x/y` with `x-sveltekit-pathname: /sign-in` is asserted on the built server. A service worker file is absent from `build/client`; its file list is asserted exact outside `_app/immutable`.

**R2, added:** two copies of `@poly/db` are ruled, not an accident. The bundle's serves every request and health; `main.ts`'s serves `init()` and `/status` only. Both read the same environment and both log through the schema. Neither calls `configure`. One instance would mean keeping `@poly/*` external, so the bundle would load TypeScript sources at run time; not taken.

## Addendum 2: seceng's review (`ruling-review.md` @ `0079a2a0`) and the lead's decisions

**All of S1 to S10 and the C-76 wording are adopted as written there**, and bind the build and the tests. Decisions 1 to 3 are yes. Decision 4: R4's residual is accepted **for this loop, which deploys nothing**; a rate limiter at Caddy is a gate on POLY-156 before prod is opened to the internet. This replaces "accept for POLY-M1" here and in seceng's P2.

**R14 What is in the bundle (closes B2).** Measured: the source maps of `build/server` name 39 packages, picomatch not among them; 28 of 81 server files have no map and the client has none, so maps alone are not enough. Ruled: a Vite plugin (frontend, `apps/web/bundle-packages.ts`, used in `vite.config.ts`) records every module id of both the client and the server build in `.svelte-kit/`; `infra/ci/bundle-packages.mjs` (devops) takes the union of those ids and the maps' sources, before the maps are deleted, and writes `build/packages.json`: sorted `{name, version}`. Client maps are never emitted: the adapter would list and serve them. The file travels in the image, is outside `build/client` and is not served (asserted): it is the kept artefact, and F2 reads it. The names are compared exactly with the committed `apps/web/bundle-packages.txt` (frontend), in the stage and in `image.sh check`; picomatch is refused by name whatever the list says. Versions are not in the committed list. `audit-exemption.test.ts` builds and checks the bundle too (qa). Red on an import planted in a server file and on one planted in a client-only component. A server file that has no map and no plugin record fails.

**R15 CSP on every HTML answer (S3).** Measured: the 500 page has no CSP header, because Kit's static error page does not go through it. `apps/web/src/lib/csp.ts` (frontend) holds C-07's directives once; `vite.config.ts` reads them, and `server.ts` sets them as the default header before the handler, which Kit's own (with its nonce) replaces. `(unmeasured: the replacement)`. The `deploy` key gains `csp.ts`, `bundle-packages.ts` and `infra/ci/bundle-packages.mjs`.

**Owners.** Product: S3 (R15), S5 and S8 frontend; S9 devops. Tests and measurements: S1 to S8 and S10 qa; S9 devops's `image.sh check` with qa's Dockerfile cases. P3: `--network=none` may not be dropped; R1's "brings the error to the lead" goes on to the Principal. P2's gate is the list in seceng's "The gate on R4's residual".

**S6, S7** are measured by qa before the gate. If S7 does not fit 384m, the cap comes down, not the memory up; the number comes back to me once.
