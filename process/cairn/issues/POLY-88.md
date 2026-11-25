---
id: POLY-88
title: Sign-in providers: Google, GitHub
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-87]
assignee: null
paths: [packages/auth/**, apps/web/src/routes/**]
labels: [auth]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-24
---

Login and Sign up offer Continue with Google and Continue with GitHub beside email and password. Sign in with Apple is deferred to the native iOS milestone (Principal, 2026-11-08) and has its own issue (POLY-122). Providers only authenticate an invited user; they never create an account without an invitation and never skip the second step. Each provider asserts a verified email as SECURITY C-05 pins it.

## Acceptance criteria

- [ ] Each of the two buttons completes sign-in for an already-invited email on staging.
- [ ] A provider sign-in for an email with no invitation creates nothing and shows the invite-only message.
- [ ] A provider sign-in by an owner or manager still triggers the second-step prompt.
- [ ] OAuth access and refresh tokens are stored encrypted and the ID token is not persisted.
- [ ] Linking a provider to an existing account requires a signed-in session and the same verified email.
- [ ] C-05: Google uses email_verified; GitHub reads /user/emails (primary and verified) with read:user and user:email; a test per provider.

## Comments

### @team-lead — 2026-11-10

Placed here from the POLY-85 architect ruling (Open 2): the C-76 zone (SOA) test with its log-and-retry on timeout runs at web start, and POLY-85's `check-config` stays offline. POLY-88 is where web's public server first mounts (it also mounts `/api/v1/health` from `apps/web/src/ops/health.ts`, ruling R4), so the startup zone check lands with it. POLY-120 (private-CA mode) inherits it.

### @team-lead — 2026-11-11

From the POLY-86 loop: (1) POLY-85's Open 1 moves here (ruling R11, follow-up 4). (2) Google and GitHub are not wired in apps/web: config has the secret files and no client-id variable (verdict follow-up 10). (3) Once the image serves the app, add a served `/healthz` and a sign-in smoke against the built image; they replace the `createAuth`-only smoke in `image.sh check` (seceng @ db1a712).

### @team-lead — 2026-11-20

From POLY-150 (ruling "Open 1"). A held sign-in that arrives through Google or GitHub answers JSON to a browser navigation. Turn it into a 302 to `/sign-in/second-step?with=code`. The magic-link half of the same gap is on POLY-137.

### @team-lead — 2026-11-21

From POLY-137 (ruling follow-up; SECURITY R-24): BetterAuth sets no timeout on the token call to Google or GitHub. The sign-in service's 15-second idle-in-transaction timeout now bounds a slow provider, but the call itself should time out. Also from POLY-150: the held-sign-in 302 for the Google and GitHub paths belongs here; the magic-link half was done in POLY-137.

### @team-lead — 2026-11-23

From POLY-100 (2026-11-24, Principal's decision in process/DECISIONS.md): the production web server and image build (vite build, the first mount of the server and /api/v1/health, the startup zone check) are split out of this issue into POLY-161, ahead of POLY-104. Remove those criteria here when POLY-161 starts.

### @team-lead — 2026-11-24

Two criteria removed here and done in POLY-161 (its ruling R11, `process/cairn/reviews/POLY-161/ruling.md`): "No SvelteKit route is served by the image before POLY-86's signed-out guard is in" and "The image build stage runs `vite build` with dev dependencies and copies only `apps/web/build` forward". The startup zone check and the served health path moved there too. What stays here is the two providers.

### @team-lead — 2026-11-24

From the M1 regroup (2026-11-25, architect's review): the first criterion (each button completes sign-in on staging) can only be shown after POLY-104. The code is built and tested before that; the staging proof is the last step and sits on M1's critical path (POLY-160's staging gates, POLY-104, this issue's staging proof, POLY-106). The Principal registers the Google and GitHub OAuth apps; needed by about 2026-12-01 for the M1 target.
