# POLY-86 verdict (gate 4): architectural review of the build @ f99b888

Architect, 2026-11-11. Against `ruling.md` (final @ 82a7d49, addendum 1 @ 326aa1b) and seceng S1–S18 (@ 8e98d78).
Method: code-read of the diff 326aa1b..f99b888 and the builder's gate-3 report. The suites are not re-run here: the full suite is the gate owners' (WORKFLOW → Four gates).

**Result: PASS at d100466 on the code; F12 is reopened (below).** CI run 42993078860 is green on every job: unit 115 s, lint 71 s, image 34 s (contents check and Trivy clean), db 152 s. F1–F11 are met, and the seceng build review (S1–S20) and the lead's visual leg pass.

| Axis | Result | Evidence |
|---|---|---|
| M1 hold | pass. The twoFactor hook is found by behaviour, exactly one or a throw, and wrapped as `original ‖ SIGN_IN_PATHS` (S10). The passkey-only after-hook deletes the session and strips its queued cookie. The idToken branch is refused. | f99b888 `packages/auth/src/second-step.ts`; the hold is measured on all three paths (gate-3 report) |
| R1 layout and pinned options | pass. The layout matches R1, plus `recent-auth.ts` split out. Cookies measured: `__Host-`, HttpOnly, Secure, Lax, `Path=/`, no Domain (S17), so C-02 needs no change. | f99b888 `options.ts`; gate-3 report S17 |
| R2 routing pool | pass. The statement grammar is closed (S4). A lease is serialised with a 5 s timeout and its waiter is cancelled (S5). `AuthUnderSystemJob` is thrown. In db: the store's `live` flag, `TransactionEnded` from `currentClient()`, the handle refusing queries after the end (S3), and the COMMIT result checked (S2). | f99b888 `routing-pool.ts`, `packages/db/src/context.ts` |
| R3 allowlist | pass. The handle 404s unlisted and blocked paths after normalising them (S7). Redirect keys must stay on our origin (S12). `drizzleAdapter` is banned through the layers generator. | f99b888 `route-policy.ts`, `hooks.server.ts`, `scripts/layers/generate.mjs` |
| R4 wrapping and commit-on-success | pass. The withTenant, withContextFreeTx and plain-pool branches match R4. `RollbackWith` fires on status ≥ 400 and on an error redirect, and its Set-Cookie is dropped (S1). Moving the claim and the wrapper assertion to `user.create.before` is right: an after-hook runs once the row is written. | f99b888 `handler.ts`, `user-hooks.ts` |
| R5 session, step-up, Sessions | pass. The 23505 retry walks `.cause`, runs once, and logs no token or email (S15). Step-up uses the database's `now()` and refuses a future stamp. Revoking another session requires step-up (S13). The 30-day cap is enforced on both paths (S14). | f99b888 `session.ts`, `recent-auth.ts` |
| R6 hooks.server | pass. `locals.session` is the token-free projection. `next` must stay on our origin. Only BetterAuth's Set-Cookie is forwarded (S15). | f99b888 `apps/web/src/hooks.server.ts` |
| R7, R8 schema and image | pass. `image` is always null (S16b). Column-level INSERT/UPDATE grants, measured as enough with no trigger (S16a). The fields map adds `twoFactor` and `passkey`. | f99b888 migrations 0004, 0005; gate-3 report S16a |
| Layers | pass. packages/auth imports no `pg` and no `PostgresDialect`, enforced by `boundaries.test.ts`. `changes.mjs` triggers the db job on `packages/auth`. | f99b888 |
| Addendum 1 item 2 | **fail (F1)**. There is no unit test for `AuthUnderSystemJob`. Only a "not covered" note in `tests/db/auth-routing-pool.test.ts`. | f99b888 |
| A test branch in production code | **fail (F2)**. `userCreateBefore` runs the wrapper assertion and the invitation claim only `if (typeof data.email === 'string')`. The branch exists so that a pure test can call the hook. It is an unguarded path through the A-40 / C-01 check. | f99b888 `user-hooks.ts` |
| SecEng build review | pass. S1–S8 and S10–S19 are met. S9's dist enumeration test is deferred, on condition that no better-auth or @better-auth/passkey pin change merges before it exists (follow-up 13). | `seceng-ruling-review.md` @ 04bd75b, section "Build review", reviewed @ 182d054 |
| Lead visual leg, re-check | pass. Sessions page, bare `/sign-in`, wrong-then-right sign-in, Log out, the per-IP limit, 503 on a bad `X-Forwarded-For`, 400 on an idToken. F4 closes through S19 and the 429 message, not a form fix. | lead's `temp/2026-11-11-lead-poly86-visual-leg.md`, "Re-check" @ 7a0d5fe |
| CI time (addendum 2) | pass. The `db` job took 118, 149 and 128 s, median 128 s against 150 s; the battery step took 101, 130 and 107 s. The 149 s run leaves no headroom: the next suite added to `db` brings its own cut. | runs 42989973126 @ 7a0d5fe, 42990359638 @ 495dc11, 42990790271 @ 0b04cea |
| `image` scan | **fail (F10)**. Trivy finds two esbuild Go binaries (0.18.20 and 0.25.12) in the prod image: 3 CRITICAL and 54 HIGH, all fixable. They arrive through better-auth's optional peers (drizzle-kit, vite) resolving into the prod install. | the same three runs |

## Conditions

- **F1.** Add `packages/auth/src/routing-pool.test.ts`, with `@poly/db/auth`'s `currentClient` mocked to `{ kind: 'withSystem' }`. Assert that `connect()` and `query()` both reject with `AuthUnderSystemJob`.
- **F2.** Make the check unconditional. The hook throws `SignUpOutsideTransaction` whenever `currentClient()?.kind !== 'withContextFreeTx'`, whatever `data` holds. Move the image rule into its own pure function (`stripImage(data)`), which the hook calls and the pure test calls directly. A non-string email reaches `claimInvitation` and is refused there.

## ARCH

§3.1c holds the M1 result, the route-policy test path and the idToken refusal. §2.2 gains the C-02 session lifetimes, `cookieCache` off, in-memory rate limits, and the idToken refusal. ARCH is now 1.15.15.

## Follow-ups (lead to file after the merge, in addition to the ruling's 1–8)

9. The handle's `/api/auth` tree test runs on the raw pathname. `/API/AUTH/...` falls through to the page routes and gets SvelteKit's 404. That is safe today, and worth one test once routes exist under `/api`.
12. qa: write the e2e step-up stamp inside the revoke spec, not in `serve.ts` before `vite build`.
13. The S9 enumeration test (grep the pinned dist for `createUser`, `createOAuthUser`, `createSession` and `setSessionCookie`, and classify each path). It must exist before any better-auth pin change merges.
14. Follow-up 1 also covers the Sessions table: readable timestamps and a device label.
11. POLY-95: Caddy's `header_up X-Forwarded-For {remote_host}` and no `trusted_proxies` (S19 point 2).
10. Providers (Google, GitHub) are not wired in apps/web: config has no client-id variable yet. Goes to POLY-88 with Open 1.

## Reopened: the lead's visual leg @ f99b888

Source: `temp/2026-11-11-lead-poly86-visual-leg.md` in the lead checkout. The code-read verdict missed these because no test drives the pages through the running server. F3–F5 are its defects 1–3. F8 is the test gap that let them through.

- **F3. `/settings/sessions` 500s** (`createdAt.toISOString` on a value that is not a Date). This blocks: criterion 4. Normalise the fields in `listSessions` (`new Date(...)`) or in the load function.
- **F4. The sign-in form is dead after one failure.** This blocks: criterion 14 rests on signing in. A failed attempt must leave the form able to submit again.
- **F5. "Log out" is disabled.** This blocks: a signed-in user must be able to end their session. The menu item posts to `/api/auth/sign-out`, then the page goes to `/sign-in`.
- **F6 (lead item 5). Ruled: blocks.** A signed-out page shows no app chrome. The root layout renders the shell only when `data.session` is set; otherwise it renders a bare page. `/sign-in` is that bare page. No route moves.
- **F7 (lead item 6). Ruled: blocks, minimally.** The account menu's **Settings** entry links to `/settings/sessions`, so criterion 4 is reachable from the UI. Profile, Notifications, Preferences and Shortcuts stay disabled placeholders and join follow-up 1 (ux-designer). `/settings` itself stays 404.
- **F8. e2e coverage of the four.** Add to `shell-signed-in.spec.ts`, or a sibling spec: `/settings/sessions` lists the current session and revokes another (after a step-up stamp seeded by the setup); a wrong password and then the right one signs in; Log out lands on `/sign-in` and the next `/dashboard` load redirects; `/sign-in` has no navigation landmark.
- **F9 (lead item 4): seceng S19 (`seceng-client-ip.md` @ a7a22c3) binds the build.** The app trusts only a single-entry `X-Forwarded-For`, with no `trustedProxies`. An unresolved IP answers 503 outside dev and is never pooled. Caddy's overwrite of the header goes to POLY-95 (follow-up 11). F9 is a verdict axis: confirmed against S19's tests at the fix sha.
- **`AuthUnderSystemJob`:** met at 385ef78 (F1). The builder's earlier line predates that commit.

### Confirmed at 7a0d5fe (code-read)

- F3: `listSessions` turns `created_at` and `updated_at` into `Date`s, and `sign-in-flow.spec.ts` renders the page.
- F4: the form posts again after a 401, and the spec checks a wrong password followed by the right one. The root cause was the shared rate-limit bucket (F9).
- F5: Log out posts `/api/auth/sign-out`, then goes to `/sign-in`.
- F6: the root layout renders the shell only when there is a session.
- F7: Settings goes to `/settings/sessions`, and the other menu entries stay disabled.
- F8: five specs.
- F9: `handleAuthRequest` answers 503 unless there is exactly one valid `x-forwarded-for` entry, when `requireClientIp` is set. apps/web passes `!dev`. `advanced.ipAddress` reads only that header and sets no `trustedProxies`. `tests/db/auth-client-ip.test.ts` has six cases.
- The image build: `pnpm-workspace.yaml` sets `allowBuilds: { esbuild: false }`, so the prod install runs no lifecycle scripts.
- Not blocking (follow-up 12, qa): `serve.ts` writes the step-up stamp before `vite build`. If the e2e run reaches the revoke spec more than 5 minutes later, that spec fails. The stamp belongs in the spec itself, just before the revoke.

### F10. The prod image carries no build tooling

- **Ruled:** the fix removes esbuild from the prod image. It never suppresses the finding: no `.trivyignore` entry, and no lowered severity.
- **The constraint:** web and worker need better-auth's Kysely path only. drizzle-kit, vite and esbuild are build-time tools and do not ship. The mechanism is the builder's: peer resolution in `pnpm-workspace.yaml`, or a prod-only install filter in the image's build stage.
- **The measurement:** `infra/ci/image.sh check` asserts that the image has no `node_modules/esbuild`, `@esbuild/*`, `drizzle-kit` or `vite`. That check fails before Trivy runs, so a return of the problem names the package rather than a CVE.
- **Closing:** I confirm the fix sha against this list, and the verdict closes on the lead's green CI re-run. If the fix needs a peer that web or worker load at runtime, the builder reports it and I rule again. seceng-86 owns any CVE judgement.
- **Confirmed at 1e83bae (code-read):** `pnpm-workspace.yaml` `overrides` remove better-auth's optional peers (drizzle-kit, drizzle-orm, pg, svelte, vitest, @sveltejs/kit) and `@better-auth/drizzle-adapter`; drizzle-orm and pg stay as packages/db's own dependencies. `image.sh check` fails before Trivy and names the package. It also starts `@poly/auth` inside the built image, which covers anything removed that better-auth loads at start. `tests/ci/prod-install.test.ts` asserts the frozen `--prod` install. No `.trivyignore`. The overrides apply to dev installs as well, so a green `db` battery at this sha shows the runtime path needs none of the removed peers. Closes on the lead's green CI run at 1e83bae or later.
- **seceng S20: pass** (`seceng-ruling-review.md` @ db1a712). In CI run 42992370983, `image` and `db` are green.
- **F11 (`unit`, blocking):** `boundaries.test.ts` "refuses drizzleAdapter in packages/auth" timed out at 5000 ms. The cause is a cold `new ESLint()` plus config load for each call (line 53). **Ruled:** build one `ESLint` instance in `beforeAll` (hook timeout 60 s) and share it across the file. If one case still exceeds 5 s, give it an explicit per-test timeout of up to 30 s. No skip and no weakened assertion: this is the A-31 lint guard.
- **F11 confirmed at d100466 (code-read):** one shared `ESLint` instance is warmed in `beforeAll`, and no `expect` line changed. The timeouts are 120 s for the hook and 60 s per case, against the ruled 60 s and 30 s. I accept that: it is a ceiling on a cold CI runner, not a skip. The next run's unit timing shows whether it is needed. The verdict closes on the lead's CI run at d100466 or later with every job green.
- Follow-up 14 also covers the Sessions page breadcrumb, which reads "polycarpic".

### Close: the db job time

The `db` job on the five runs from 495dc11 on: 149, 128, 131, 144 and 152 s. The median of all five is 144 s, and of the last three also 144 s, so addendum 2's pass line (a three-run median at or under 150 s) holds. The 152 s run is recorded here: one run over the guard with no change to the `db` suites since 7a0d5fe, so it is runner variance on a job with 6 s of headroom.

15. **The next `db` cut** (owner: qa-engineer, before any new suite joins the `db` job). Share one auth instance per file across the TLS modes (addendum 2, point 2). Also look at `runner.test.ts`, the largest file at about 30 s. Target: a median at or under 130 s, so the job has headroom again. It stays in the existing job (POLY-96).

### F12. The e2e step does not depend on a live apt download (reopened after the merge of main, head 607297c)

PR #116's required check failed in run 43052475191. On all three attempts the `unit` job's "Web e2e" step ran `playwright install --with-deps`, and the runner could not resolve Ubuntu's package hosts. Every other job at 607297c is green: lint 71 s, db 151 s, image 209 s. The Principal approved fixing the step in this PR. devops-engineer-86 owns the fix.

Pass line, which I confirm at the fix sha:
- **No live apt download as a precondition.** The browser's system libraries come from the runner image or a cache, not a fresh `apt-get` each run.
- **A bounded install.** Any remaining install step has a timeout and fails with a clear message. It never retries indefinitely.
- **The specs still run for real.** A missing browser fails the step. No skip, and no `continue-on-error`.
- **A `tests/ci` assertion** holds that shape in `ci.yml`.
- **No new top-level job** (POLY-96).

The verdict re-closes on the confirmed fix sha plus a green PR check.

**F12 at 2bf29a3: rejected by the Principal.** During the outage, every run waits out the 120 s `install-deps` timeout: the step took about 250 s against about 60 s. Run 43059584727 shows the runner image already carries the libraries.

**F12 pass line, amended:**
- **No time spent on system packages when Chromium already launches.** A launch probe runs first: a headless Chromium launch, bounded.
- **`install-deps` runs only if the probe fails.** It is bounded and non-fatal, and the probe then runs again. If the second probe also fails, the step fails, so a browser that cannot launch is never skipped.
- **The other F12 points stand:** no live apt download as a precondition, a bounded browser install, the specs run for real, a `tests/ci` assertion (which now also asserts that `install-deps` is conditional on the probe), and no new job.
- **Measured at the fix sha on a full run:** the e2e step time is within 10 s of the run before the fix, about 60 s, whether apt is reachable or not.

The verdict re-closes on the confirmed fix sha, that measurement, and a green PR #116 check.
