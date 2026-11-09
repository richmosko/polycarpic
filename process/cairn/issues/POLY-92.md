---
id: POLY-92
title: Home-box .local sign-in
status: backlog
milestone: POLY-M1
parent: null
blocked_by: [POLY-88, POLY-89]
assignee: null
paths: [packages/auth/**, apps/web/src/routes/**, packages/config/**]
labels: [auth, infra]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

When the instance is configured for a .local name (home-box fallback, P7), the OAuth providers are disabled server-side and hidden on Login and Sign up; sign-in is email, password and the second step. Plain-http sign-in is refused in both home-box modes. Built and tested here; verified on the box at its first deploy.

## Acceptance criteria

- [ ] With TLS_MODE set to private-CA, the provider endpoints refuse server-side (404), and Login and Sign up show only email and password.
- [ ] With the mode off, both providers show.
- [ ] Sign-in over plain http is refused in both modes.
- [ ] The mode cross-check at startup follows ARCH §7.8 / C-76 (offline suffix test, then a public SOA; NXDOMAIN refuses start).
- [ ] The operator doc states that moving from .local to a real domain ends every session and passkey and needs authenticator or backup codes first.
