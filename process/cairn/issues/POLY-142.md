---
id: POLY-142
title: Operator invite CLI
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-87]
assignee: backend-lead
paths: [process/cairn/issues/POLY-142.md, process/cairn/reviews/POLY-142/**, apps/worker/**, packages/db/**, packages/tenancy/**, tests/**, scripts/layers/**, infra/ci/**, .github/workflows/**, layers.json, eslint.config.js, package.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**]
labels: [auth, cli]
priority: null
pr: null
created: 2026-11-12
updated: 2026-11-12
---

The operator's command on the box: `polycarpic user invite <email> [--bootstrap]`. Without the flag, it issues a single-use, audited invitation that shares no entity. With `--bootstrap`, it creates the first user's invitation on an empty instance, and only once. It runs in the worker container: INFRA §7.5 has `polycarpic-ops cli …` execute it there. It reaches the database as `poly_worker`, through a context-free operator transaction that never sets `app.user_id`. It builds on POLY-87's claim and accept definers (`process/cairn/reviews/POLY-87/ruling.md`). PRD §4 invite story; SECURITY C-01; INFRA S-1. This is part B of the invite-only sign-up split (Principal, 2026-11-12); the text below is the seam from the POLY-87 ruling, filed as written.

## Acceptance criteria

- [ ] The first user on an empty instance is created only by `polycarpic user invite <email> --bootstrap`, once. With any `user` row present it exits non-zero and writes nothing. An empty instance accepts no other first sign-up (INFRA S-1).
- [ ] `polycarpic user invite <email>` issues a single-use invitation that shares no entity, and writes an `audit_event` of kind `invitation.issued` (`entity_id` null, `actor` `operator:cli`). The invitee sees only their own Person.
- [ ] Without `--bootstrap`, the command refuses on an empty instance, so it cannot create the first user.
- [ ] A second `--bootstrap` on an empty instance revokes the earlier unclaimed bootstrap invitation. Two concurrent runs leave exactly one live one, because the issuing definer serialises them on an advisory lock.
- [ ] `claim_invitations` refuses a bootstrap invitation once any user exists (`issued_via = 'bootstrap'`).
- [ ] `withOperatorTx` (subpath `@poly/db/operator`) runs on the `poly_worker` pool and sets only `app.actor`, locally. It refuses to nest with the other three wrappers. Lint refuses to import it from anywhere but `apps/worker/src/cli/**`.
- [ ] The invitation is written only by `app.issue_operator_invitation` (owner `poly_govern`, EXECUTE `poly_worker` alone), and `poly_worker` holds no INSERT on `invitation`.
- [ ] The link is printed once to stdout. The plaintext token is never logged or stored, and the expiry is 7 days.
- [ ] Exit codes: 0 issued, 2 refused (instance state), 1 anything else. `check-config` validates the worker's `DATABASE_*` first.

## Proposed paths

`process/cairn/issues/POLY-142.md`, `process/cairn/reviews/POLY-142/**`, `apps/worker/**`, `packages/db/**`, `packages/tenancy/**`, `tests/db/**`, `tests/layers/**`, `scripts/layers/**`, `infra/ci/changes.mjs`, `layers.json`, `eslint.config.js`, `package.json`, `pnpm-lock.yaml`, `docs/ARCH/**`, `docs/SECURITY/**`, `docs/INFRA/**`. Its tests go in a new `db` area, `operator`, with paths `^apps/worker/src/cli/`, added to `TABLE.db`.

## What POLY-87 leaves in place

- the `invitation` claim columns and `claim_invitations` / `accept_invitations`;
- no-entity acceptance, which gives the invitee their own Person only;
- `hashInvitationToken` exported from `@poly/tenancy`;
- the `confined` key in `layers.json` and the `poly/confined-module` rule, which B reuses for `db/operator`;
- `seedInvitation` in the test helpers;
- condition 23's closure test.

B changes condition 23 to "only `issue_operator_invitation` and the `poly_app` owner policy insert". seceng re-words C-84 in B: `db/auth` and `db/operator` are the two context-free paths, and only `db/auth` sets `app.user_id`.

## Open for the Principal at this issue's start

- The 7-day default expiry of an operator invitation (the architect's proposal).
- Whether printing the link to stdout is enough for the first release, with email as a follow-up.

## Comments

### @team-lead — 2026-11-12

Feature started. Branch: `feature/poly-142-operator-invite-cli`.

### @team-lead — 2026-11-12

Principal decisions at kickoff (2026-11-13), on the two questions the issue left open:

1. **Expiry: 7 days**, as the architect proposed.
2. **Delivery: email, not stdout only.** The Principal's reason: nobody sees the CLI's stdout except perhaps during initial setup. This overrides the "link is printed once to stdout" criterion as the only delivery path and pulls the Resend mailer (POLY-137's `sendMagicLink` item, ruling follow-up 3) into reach of this loop. State of the tree: `RESEND_API_KEY_FILE` is registered for web and worker (`packages/config/src/registry.ts`, optional) and mounted in `infra/compose/prod.yml`; no mailer code exists, and `apps/web/src/lib/server/auth.ts` answers 503 for a magic link. Whether stdout survives for `--bootstrap` on a box with no mail key is for the gate-1 ruling.

The Principal also asked for an email invite option that does not invite the new user to a group entity. Scope of that (CLI only, or an in-app route) is open with the Principal; an in-app route that sends an invitation falls under the POLY-89 ordering rule in STATE.md.
