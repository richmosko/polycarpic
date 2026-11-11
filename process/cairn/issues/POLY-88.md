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
updated: 2026-11-10
---

Login and Sign up offer Continue with Google and Continue with GitHub beside email and password. Sign in with Apple is deferred to the native iOS milestone (Principal, 2026-11-08) and has its own issue (POLY-122). Providers only authenticate an invited user; they never create an account without an invitation and never skip the second step. Each provider asserts a verified email as SECURITY C-05 pins it.

## Acceptance criteria

- [ ] Each of the two buttons completes sign-in for an already-invited email on staging.
- [ ] A provider sign-in for an email with no invitation creates nothing and shows the invite-only message.
- [ ] A provider sign-in by an owner or manager still triggers the second-step prompt.
- [ ] OAuth access and refresh tokens are stored encrypted and the ID token is not persisted.
- [ ] Linking a provider to an existing account requires a signed-in session and the same verified email.
- [ ] C-05: Google uses email_verified; GitHub reads /user/emails (primary and verified) with read:user and user:email; a test per provider.
- [ ] No SvelteKit route is served by the image before POLY-86's signed-out guard is in (POLY-128 ruling R4).
- [ ] The image build stage runs `vite build` with dev dependencies and copies only `apps/web/build` forward; `.dockerignore` gains `**/.svelte-kit`, `apps/web/build` and `apps/web/tests` (POLY-128 ruling R11).

## Comments

### @team-lead — 2026-11-10

Placed here from the POLY-85 architect ruling (Open 2): the C-76 zone (SOA) test with its log-and-retry on timeout runs at web start, and POLY-85's `check-config` stays offline. POLY-88 is where web's public server first mounts (it also mounts `/api/v1/health` from `apps/web/src/ops/health.ts`, ruling R4), so the startup zone check lands with it. POLY-120 (private-CA mode) inherits it.
