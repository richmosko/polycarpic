# What `process/cairn/reviews/POLY-148/spike.md` must contain

The checks grade the measurable items. The record carries those results plus the two sizing items, which have no pass/fail. seceng writes the security reading after the build; backend-lead supplies the measurements below.

## For every check line
- The command (`node spikes/POLY-148/checks/run.mjs <id>`), the line's predicate in one sentence, and the result (PASS, FAIL or REPORT) with the run's commit sha.
- For each FAIL, what it means for stage 2 in plain words. A FAIL is a result, not a defect to hide.
- The harness's deviations from production, each with why it does not change the result: plain HTTP, rate limiting off, Google's endpoints redirected inside the service, and `second_step_at` and `recent_auth_at` set by SQL.

## The sign-in pages (sizing; the Principal decides)
1. **Every page that takes a secret.** List each one: `/sign-in`, `/sign-up`, `/sign-in/second-step`, reset password, change password and TOTP enrolment in Settings, and every step-up prompt. Say for each whether it moves. If only `/sign-in` and `/sign-up` move, a persistent web compromise still captures the passwords typed on the others.
2. **Same-origin reach, measured in a real browser (Playwright, Chromium).** A page on one origin can script another page on that origin, whichever process served it. Measure each of these with web's JS on `/` and the page served by the service, and give each a pass or fail:
   - (a) `window.open('/sign-in')` gives web's script the DOM of the sign-in page.
   - (b) An `<iframe src="/sign-in">` does the same. State whether `frame-ancestors 'none'` on the service's pages stops it.
   - (c) Web can register a service worker whose scope covers `/sign-in` and serve an altered page. State whether Caddy refusing any request that carries `Service-Worker: script` stops it.

   If (a) holds, moving the pages to the service on the same origin does not stop a persistent web compromise from capturing passwords. Only a separate origin does that (for example `auth.<domain>`), and a separate origin changes the cookie design. Say so plainly.
3. **Size.** Files and lines moved or added, the build change (does the service bundle Svelte pages or serve static HTML), and the shared UI and tokens the pages need from `packages/ui`.
4. **DESIGN.** What changes in `docs/DESIGN/index.html`: the page shell, theme cookie, and navigation back to the app.
5. **CSP and Caddy.** The CSP each process sends on its pages (from `check-pages.mjs` and the code), and the Caddy routes before and after. Also say whether the service's pages can run with no `unsafe-inline`.

## Dev and e2e with two servers (sizing)
- Vite's dev proxy: the config that sends `/api/auth/*` to the service, and how the service restarts on change.
- Playwright's `serve.ts`: how it starts web, the service and the proxy; its ports; and its readiness checks.
- Cookies on `http://localhost` in dev: whether `__Host-` and `__Secure-` cookies are kept, which Chromium does on localhost, and what that means for Firefox and WebKit runs.
- Lines changed and loop-days, as a guess marked `(guess)`. No harness change lands in POLY-148.

## Ends with
- The `__Host-` versus `__Secure-` trade-off for BetterAuth's cookies, as measured (`C.host-vs-secure`).
- Each gap for POLY-89. A held path that leaks a session, or a second-factor path the hold does not cover, goes there.
- What changes in stage 2's blocks S, E and H, and their price.
