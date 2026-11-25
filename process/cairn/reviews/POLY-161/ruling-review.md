# POLY-161b: security review of the ruling (seceng)

## Verdict on `ruling.md` @ `e6628fa0` (addendum 1 included): **CHANGES REQUIRED. 1 BLOCK open (B2; B1 closed by R13), 10 CONDITIONS, 3 FOLLOW-UPS, 4 items for the Principal**

Judged against a list written before the ruling. Read: ruling, checklist, the app's hooks, routes, pool, probe and logger, compose, Caddyfile, adapter-node 6.0.1 and Kit 3.1.1 source. Run by me: only the `safeNext` inputs, in Node's URL parser (not a browser). Everything else here is by reading. No container.

R2, R3, R5's `handleError`, the Host pin (it also fixes Kit's form-origin check to our origin) and the exact public set hold, subject to the rows below. Mounting `handler.js`, never `index.js`, is right.

## BLOCKS (before tests are written)

| # | Finding | The ruling must say |
|---|---|---|
| B1 | **CLOSED by R13.** Open redirect: `safeNext` passed `/` + tab, LF or CR + `/evil.example`, and the sign-in pages hand it to `location.assign`. Anyone who got a member to open a crafted sign-in link could send them, after a real sign-in, to a page of theirs. R13's rules are enough (control characters, origin, resolved `//` path), and it found a form I did not (`/x/..//evil.example`). Its fixed-origin rule also covers the backslash, so my separate backslash ban is withdrawn | R13 as written, its Chromium cases included |
| B2 | **The dependency gate's exemption loses its ground.** The audit ignores one picomatch advisory because picomatch is in dev tools only, and the test proves that on the **production install**. R1 starts shipping code from dev dependencies inside a bundle that test never looks at | The bundle's package list is taken from the build (module ids or source maps, before the maps are deleted), is asserted against a committed list, and picomatch is not in it; red on a planted import. `audit-exemption.test.ts` covers the bundle as well as the install. The same list answers R1's Trivy/SBOM limit: it is kept as a build artefact |

## CONDITIONS (the build must meet; the test that shows each)

| # | Condition | Shown by |
|---|---|---|
| S1 | **Ruled in addendum 1 (R6, B34).** Remote functions stay empty, because Kit takes `event.url.pathname` from the client's header there | as ruled, and the test is red on a planted remote function |
| S2 | **The crawl covers what Kit answers before `handle`**: `__route.js`, `/_app/routes/…`, `/_app/env.js`, 308s, static files. The static set is listed from the built client and asserted exactly; `env.js` carries no value | crawl on the built server; red on a file planted in `static/` |
| S3 | **CSP exactly C-07's directives**, every one, on the 200 page, the 404 page and the 500 page of the built app; not "a CSP header" (R9.2). No `unsafe-inline` or `unsafe-eval` in `script-src` | header compared by value; red with `csp` removed and with one directive widened |
| S4 | **Form-origin check (C-06) on the built server**: form POST with a foreign `Origin` and with none is 403 with Kit's fixed message; positive case with our `Origin` reaches the guard's 303 | crawl, over sockets; red with the check off |
| S5 | `guardConsole` replaces **every** output method of `console` (also `dirxml`, `table`, `group*`, `count*`, `time*`, `assert`, `trace`), from the object's own keys, and Node process warnings print nothing of their text | `console.test.ts` iterates the methods; a planted warning in a child |
| S6 | **A slow reader.** R4's timeouts bound the request and idle sockets; a client that reads one byte at a time from web is not obviously bounded by either (unmeasured). Measure it; if unbounded, say that the bound is the 512 cap and Caddy | a driven socket, measured value in the gate record |
| S7 | **512 connections fit staging's 384m**: 512 slow bodies and 512 open sockets with full headers; the process lives and health answers again afterwards. M11's 56 MB is idle | driven test; peak memory recorded (with `main.ts`, not the bundle alone) |
| S8 | Zone answers: NODATA, SERVFAIL, REFUSED never refuse; the query carries the registrable domain only, never `app.` or `staging.`; a refused start logs once and exits; a late answer after 5 s cannot change the result | `zone.test.ts` reads the query name at the fake resolver |
| S9 | **Final image**: no vite, rolldown, svelte-check, playwright or `@sveltejs` under any `node_modules` of the runtime stage; no `.env*`; maps absent under `/app/apps/web` whole; the build stage gets no build arg or secret. `GIT_COMMIT` is not passed to it | `image.sh check`, with a control that `find` sees `handler.js` |
| S10 | T-real's `/dashboard` with a valid handle also shows `Set-Cookie` absent and `no-store` present, and signed out on `/sign-up?invitation=<canary>` the canary is in no web log line | T-real part 1, log sweep by name |

## FOLLOW-UP (lead files)

- F1 (POLY-160, with U1): unpinned environment keys. `NODE_OPTIONS` in `environment` can now change the whole app, not a health path. Still from the same attested commit; not new reach.
- F2: the weekly re-scan of the published image cannot see bundled packages; make it read B2's list. Until then the check after release is the lockfile audit, which runs on PRs only (read: the schedule is in `build.yml` and `renovate-check.yml`).
- F3: the per-address limit for web, if the Principal does not accept P2.

## For the Principal: exposure changes and accepted risks

| # | What, mechanism, who | Recommendation |
|---|---|---|
| P1 | **Changes what the internet can reach.** On prod anyone reaches the sign-in, reset, second-step, cancel and sign-up pages, the static JavaScript and health; on staging only the allowlist with basic auth. Signed out, the database work is one `enter_session` per request with a handle cookie | Accept: it is the issue's purpose. A guard failure would expose pages; row-level security still needs a live handle |
| P2 | **Accepts a risk: loss of service.** Anyone on the internet can fill the 512 connections or the database pool; health then goes red, and in a deploy window the deploy rolls back. No disclosure. Stronger option: a rate limiter compiled into Caddy, its own issue | Accept for POLY-M1 |
| P3 | **Accepts a risk: build tools now shape shipped code.** Vite, the Svelte compiler and their dependencies run at build and write the code that handles sessions. Before, dev packages never reached the image. Who: whoever gets a malicious version into our lockfile; it needs a reviewed lockfile change. `--network=none` stops fetching and sending at build; it does not stop a poisoned compiler altering output. Mitigations: pinned lockfile, no install scripts (C-80), audit, B2's list | Accept; there is no way to ship a built Svelte app without it |
| P4 | **Narrows C-76 and sends the zone name out.** Two resolvers must both say NXDOMAIN. This stops one wrong or filtering resolver (Quad9 answers NXDOMAIN for names it blocks, by its documentation). It does **not** stop someone on the box's network path, who can forge both: they can keep web down at its next start, nothing more. Every start tells Cloudflare and Quad9 the registrable domain and the box's address | Accept; wording below |

`--network=none` must not be dropped without P3 going back to the Principal.

## C-76 wording (I land it with the build review)

"NXDOMAIN for the zone from both of two public resolvers refuses start. Any other result without an SOA (a timeout, an error, an empty answer, or one NXDOMAIN alone) starts, logs the unverified check and retries it. A later NXDOMAIN from both is logged and never ends a running server. DNS answers are not authenticated: a forger on the path can refuse a start and can gain nothing else."

## Decisions for the lead, my side

1 (`Config.zone`): yes. 2 (sign-in smoke in T-real): yes, required; it is the guard's only positive case in the image. 3: yes, with the wording above. 4: P1 to P4.
