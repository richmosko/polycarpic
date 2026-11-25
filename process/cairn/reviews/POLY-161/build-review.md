# POLY-161b: security build review (seceng)

## Verdict @ `577be1de`: **CHANGES REQUIRED. 1 BLOCKS, 5 FIX HERE, 2 FOLLOW-UP**

**Read:** `git diff origin/main...577be1de`: product, Dockerfile, `image.sh`, the workflow and trigger diffs, the new tests. `server.test.ts`, `zone.test.ts`, `console.test.ts`, `web-server-start.test.ts` and `web-stage.test.ts` mostly by case title. **Run by me: nothing.** "Red on" is what a test names or is written to show; I have seen no mutant record for this loop (no qa gate file at this tip). The pass, when given, is conditional on qa's gate, its mutant record, and a full green CI run at the final product sha. Run 45527250708 was still in progress when I read it.

## BLOCKS

| # | Owner | Finding | A fix must achieve |
|---|---|---|---|
| B1 | frontend, architect (D1), qa | **`#web-build` breaks a standing guard.** `tests/layers/relative-structure.test.ts` (POLY-140) refuses any package.json with an `imports` field; `apps/web/package.json` now has one, and no file under `tests/layers` changed in this branch. By reading, that suite is red at this tip. The guard has a reason: the relative-import rule cuts a specifier at `#`, the resolver answers only `@poly/*`, and the driver bans match names, so `"#pg": "pg"` or a `#` path into `packages/db` would pass the lint | Either no `imports` field (D1's own form), or **one exact exemption**: the guard accepts `imports` in `apps/web/package.json` only, deep-equal to this one entry, with mutants red for a second key, a changed target, another condition, and any other package. I accept either. The guard is not loosened to "apps/web may have imports" |

**What can satisfy `#web-build` otherwise:** under Node's default conditions only `./build/handler.js`; a target cannot be an arbitrary path from the environment. `apps/web/build` is kept out of the context, and the only copy into it is the `web` stage's, root-owned and not writable. `NODE_OPTIONS` can choose the `types` condition (it then loads the `.d.ts`, with no handler) or replace anything at all: that is U1 (POLY-160), not new.

## FIX HERE

| # | Owner | Finding | Wanted |
|---|---|---|---|
| F1 | qa | **The narrowed cookie test does not hold "any other cookie".** It counts source lines with `set-cookie`: a second append on the same line passes, so does `event.cookies.set(…)` on a public page (the fakes' `set` is a no-op or an unchecked spy). The random-handle cases (unit, db, T-real) check that the clearing cookie is there, not that it is the only one. The built `/dashboard` 200 does assert none | `getSetCookie()` equals exactly `[the clearing line]`, all attributes, on a dead handle (unit, db and T-real); the crawl asserts no `Set-Cookie` on every signed-out answer, public pages included; the source test also refuses `cookies.set`. Red on a second append on the same line, and on `cookies.set` in the public branch |
| F2 | devops | `.dockerignore` has `.env*`, which matches the root only. An `apps/web/.env` would reach the web stage, where Vite reads it at build, and public-prefixed values go into served code. CI checkouts have none; a local build may. `image.sh`'s `.env*` check cannot see an inlined value | `**/.env*`, pinned; red without it |
| F3 | devops, or a delta by architect | R14's last clause ("a server file that has no map and no plugin record fails") is **not built**: `collect()` unions and never asks per file | Build it, or architect drops it. I accept dropping it: the plugin sees every chunk of both builds, and a plant on each side is written to go red |
| F4 | lead | POLY-163 lost three of the four required items' detail: IPv6 counted by /64, `__data.json` inside the cookie bucket, prod and staging apart with bounded limiter state, the second-address control; and S6's measurement is not in it | Add them; state that a write timeout must bound the slow reader (S6) |
| F5 | qa | S6 and S7's numbers go to `temp/`, which is not kept | The measured numbers in the gate record |

## Conditions

| | Result at this tip | Shown by; turned red by |
|---|---|---|
| S1 remotes | Met by test | empty `remotes` in the built manifest, header request; red on a non-empty one by its regex (no planted remote seen) |
| S2 before the hook | Met by test | exact static list, `env.js`, `__route.js`, 308, crawl from the manifest; a planted `static/` file |
| S3 CSP | Met by test | by value on 200, 404, 500, redirect; one header; Chromium runs the page's script; `kit.csp` removed |
| S4 form origin | Met by test | four origins and three content types on the built server, forged Host 421; positive case |
| S5 console | Met by test | own keys, warnings, un-guarded control in a child |
| S6 slow reader | **Measured by qa: not bounded by web** (160 s against 60 s; the lead's figure, I have not seen the record). Accepted as ruled: the bound is the 512 cap and the edge. Who: any client that reaches prod, holding slots for long. Loss of service only, on POLY-163, before prod is opened | F4, F5 |
| S7 512 under 384m | Test asserts under 300 MiB on the host's process, not in a cgroup. Enough, with the number recorded | F5 |
| S8 zone | Met by test | pair table, query name, late answers, retry, one refusal line; spawned `main.ts` holds 3000 closed |
| S9 image | Met by reading `image.sh` and the stage pins; the `@sveltejs` set is exact and an empty set fails, `@rolldown` refused | devops reports the two red cases |
| S10 | Met by test, T-real (pending a run): no-store, no `Set-Cookie`, invitation canary absent from web's log | F1 for the dead handle |
| R13 | Met by test | control and origin rules; Chromium with tab, LF, CR, backslash, `/x/..//`, and the second step; a plain `next` still lands |
| R14 | Met by test but for F3 | server, client-only and picomatch plants on real builds |
| R15 | Met by test | directive by directive on the 500 page |

By reading, also good: the Host pin and probe exception are exact; `guardConsole` runs before the bundle is imported; the zone bound is our own timer; nothing in the environment moves the bind; the CSP default is set before the handler. `handleError` logs type, code, status and route id only.

## The lead's four questions

1. Cookie: F1. The product line itself is right: own cookie, fixed attributes, nothing from the request.
2. `#web-build`: B1.
3. Slow reader on POLY-163: right place, with F4.
4. **Web exits 1 when Postgres drops its connections: POLY-160 before the first staging deploy is right, and it is not a blocker here.** By reading, no pool in `packages/db` has an `error` listener, so `auth` and the worker have the same fault: fix it in the pool, once. I found no request that makes Postgres drop a `poly_app` connection (only `poly_auth` has an idle-in-transaction timeout), so a stranger cannot trigger it by that route. The container restarts; each restart runs the zone check again, so a Postgres restart during a zone outage (both resolvers NXDOMAIN) keeps web down. POLY-160's text did not name it when I grepped this tip: check it landed. The fix needs a checked-out client's error as well as an idle one's.

## FOLLOW-UP (POLY-160)

- U1 as before: `NODE_OPTIONS` and other unpinned environment keys.
- `bits-ui` to dev dependencies, which takes `svelte` out of the runtime install.

SECURITY (C-76 wording, C-07's home `csp.ts`, TB-2) lands with the confirmed delta.
