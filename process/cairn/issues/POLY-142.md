---
id: POLY-142
title: Operator invite CLI
status: todo
milestone: POLY-M1
parent: null
blocked_by: [POLY-87]
assignee: backend-lead
labels: [auth, cli]
priority: null
pr: null
created: 2026-11-12
updated: 2026-11-12
---

The operator issues invitations from the box: `polycarpic user invite <email>` for a standalone invitation, and `--bootstrap` for the first user on an empty instance. This is part B of the invite-only sign-up split (Principal, 2026-11-12); POLY-87 ships the sign-up transaction that claims and accepts an invitation, and this issue adds the only way to issue one without an existing user. The seam is ruled in `process/cairn/reviews/POLY-87/ruling.md` R7: the command runs in the worker container (INFRA §7.5), reaches the database through a new `@poly/db/operator` subpath as `poly_worker`, and calls a definer that takes an advisory lock, enforces the bootstrap rule and writes the audit event. The link is printed once to stdout; emailing it is a follow-up. After this ships, the only way into an instance is still a link the operator issues on the box.

## Acceptance criteria

- [ ] The first user on an empty instance is created only by `polycarpic user invite <email> --bootstrap`, once; an empty instance accepts no other first sign-up (INFRA S-1). With `--bootstrap`, the command refuses when any user exists and revokes every earlier unclaimed no-entity invitation; without it, the command refuses when no user exists.
- [ ] `polycarpic user invite <email>` issues a single-use invitation sharing no entity and writes an `invitation.issued` audit event with no entity; that user sees only their own Person.
- [ ] A bootstrap invitation cannot be claimed once any user exists (`issued_via` on the invitation; `claim_invitations` refuses it).
- [ ] `withOperatorTx` is importable only from `apps/worker/src/cli/**`, runs context-free on the worker pool with `app.actor = 'operator:cli'` set local, and refuses nesting. SECURITY C-84 states both context-free paths.
- [ ] The plaintext token is printed once to stdout and is never stored or logged; only its sha256 is stored.
- [ ] Two concurrent `--bootstrap` runs yield exactly one live bootstrap invitation.

## Proposed paths

`process/cairn/issues/POLY-142.md`, `process/cairn/reviews/POLY-142/**`, `apps/worker/**`, `packages/db/**`, `packages/tenancy/**`, `tests/db/**`, `tests/ci/**`, `tests/layers/**`, `scripts/layers/**`, `infra/ci/changes.mjs`, `layers.json`, `docs/ARCH/**`, `docs/SECURITY/**`, `docs/INFRA/**`.

## Open for the Principal at this issue's start

- The default expiry of an operator invitation (the architect proposes 7 days).
- Whether printing the link to stdout is enough for the first release, with email as a follow-up.
