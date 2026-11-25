# POLY-161b: security build review (seceng)

## Verdict @ `577be1de`: **CHANGES REQUIRED. 1 BLOCKS, 6 FIX HERE, 2 FOLLOW-UP**

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
| F6 | frontend, then qa | **S-7(c) is red on `ops/console.ts` (CI, lead's reading) and needs no exemption.** The file has no `console` method access: every match is the event name `console.suppressed` (two in code, one in a comment). The static test is not touched | Rename the event to `web.console_suppressed` (valid under the log schema's event pattern) in the file, its comment and the tests that name it; architect's R12 row follows. S-7(c) stays true for every file, this one included. A later `console.` member access in it still goes red |

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

## Delta `577be1de..35908f5b`: **PASS WITH CONDITION. 0 BLOCKS open**

By reading; nothing run by me. Red and green below are qa's record (`gate.md`).
**Condition:** a full green CI run at `35908f5b` or later with no product change after it; run 45533753986 was queued when I read it. `gate.md`'s suite run is at `4971dc28`, before F1's tests and devops's two commits; they change tests, `.dockerignore` and `ci.yml` only.

- **B1 closed (D1a).** Exact deep equal in `apps/web` only, ten mutants, `#web-build` named in `main.ts` only. No lint rule changed.
- **F1 closed.** Exact list on a dead handle (unit, db, T-real), none on any signed-out answer, `cookies.set` refused; red on the public-branch and second-append mutants.
- **F2 closed** (`aca1ddc5`, pinned, five mutants). **F3 dropped** (D3, measured). **F4 closed** (`01c654e4`, `857beb36`).
- **F5 closed.** S7: at most 153 MiB of 384, host reading. S6: still open at 160 s; accepted until prod is opened (POLY-163).
- **F6 closed.** Event renamed; S-7(c) untouched.
- **Not shown red, accepted:** S1 (no remote planted: the test asserts the generated `remotes: {}` by text, which any entry breaks); S4 (asserts Kit's 403 and message, which cannot hold with the check off); S10; B38 (positive on the image only). B31 and B7/B28 by reading.
- D4: `qrcode-generator` is loaded from the production install, where Trivy sees it. No new reach.
- One e2e failure in one run (`second-step-locked.spec.ts`), unexplained, in a spec this loop does not touch. Not counted as evidence either way.

SECURITY 1.21.0: C-07, C-76, C-82 and TB-2 state this. **Not written:** risk rows for P2 (flooding, slow readers) and P3 (build tools). A row names the approver, and I have no record of the Principal's approval. I add both when the lead has it.
- **qa's two stated gaps do not matter to security.** B38 not red: a missing `qrcode-generator` is a 500 on one page, a loss of function, and exposes nothing. One total floor for the bundle list: the exact comparison is the control, and a plant on the client side alone goes red, so an unread client side cannot pass; a per-side floor would add nothing.
