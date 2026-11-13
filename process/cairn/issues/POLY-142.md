---
id: POLY-142
title: Operator invite CLI
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: [POLY-87]
assignee: backend-lead
paths: [process/cairn/issues/POLY-142.md, process/cairn/reviews/POLY-142/**, apps/worker/**, packages/db/**, packages/tenancy/**, tests/**, scripts/layers/**, infra/ci/**, .github/workflows/**, layers.json, eslint.config.js, package.json, apps/*/package.json, packages/*/package.json, pnpm-lock.yaml, pnpm-workspace.yaml, .gitignore, docs/ARCH/**, docs/SECURITY/**, docs/INFRA/**, bin/polycarpic]
labels: [auth, cli]
priority: null
pr: null
created: 2026-11-12
updated: 2026-11-12
---

The operator's command on the box: `polycarpic user invite <email> [--bootstrap]`. Without the flag, it issues a single-use, audited invitation that shares no entity. With `--bootstrap`, it creates the first user's invitation on an empty instance, and only once. It runs in the worker container: INFRA §7.5 has `polycarpic-ops cli …` execute it there. It reaches the database as `poly_worker`, through a context-free operator transaction that never sets `app.user_id`. It builds on POLY-87's claim and accept definers (`process/cairn/reviews/POLY-87/ruling.md`). PRD §4 invite story; SECURITY C-01; INFRA S-1. This is part B of the invite-only sign-up split (Principal, 2026-11-12); the text below is the seam from the POLY-87 ruling, filed as written.

## Acceptance criteria

- [x] The first user on an empty instance is created only by `polycarpic cli user invite <email> --bootstrap`, once. With any `user` row present it exits non-zero and writes nothing. An empty instance accepts no other first sign-up (INFRA S-1). — tests/db/operator-invite.test.ts: "C1: the first user" (bootstrap signs up, then exits 2 with counts unchanged) and "C1b" (token-less Google claim on a second empty clone); tests/db/auth-signup-invite.test.ts: "condition 23" (no other first sign-up)
- [x] `polycarpic cli user invite <email>` issues a single-use invitation that shares no entity, and writes an `audit_event` of kind `invitation.issued` (`entity_id` null, `actor` `operator:cli`, payload exactly `{invitation_id, issued_via}`). The invitee sees only their own Person. — tests/db/operator-invite.test.ts: "C2 + C6 + C8" (row, audit payload keys, invitee has only a Person); tests/db/pgtap/06_operator_invitation.sql: C2/O5 audit assertions
- [x] Without `--bootstrap`, the command refuses on an empty instance, so it cannot create the first user. — tests/db/operator-invite.test.ts: "C3: the plain invite on an empty instance" (exit 2, nothing written)
- [x] A second `--bootstrap` on an empty instance revokes the earlier unclaimed bootstrap invitation. Two concurrent runs leave exactly one live one, because the issuing definer serialises them on an advisory lock, bounded by a 2 s `lock_timeout`. — tests/db/operator-invite.test.ts: "C4: re-issue and concurrency" (revoke + audit; two concurrent runs both exit 0, one live); "C10: the lock bound" (2 s bound)
- [x] `claim_invitations` refuses a bootstrap invitation once any user exists (`issued_via = 'bootstrap'`), and `accept_invitations` once any other user exists. — tests/db/pgtap/06_operator_invitation.sql: "R2: claim_invitations and accept_invitations carry the bootstrap predicate"; tests/db/operator-invite.test.ts: "C5: the bootstrap rule" (all three routes refused)
- [x] `withOperatorTx` (subpath `@poly/db/operator`) runs on the `poly_worker` pool and sets only `app.actor`, locally. It refuses to nest with the other three wrappers. Lint refuses to import it from anywhere but `apps/worker/src/cli/user-invite.ts`. — tests/db/wrappers.test.ts: "no nesting: all sixteen ordered pairs" and "withOperatorTx (@poly/db/operator)"; tests/layers/fixtures/33-operator-wrapper/ (fail-* and pass-user-invite-imports-it) via tests/layers/lint.test.ts
- [x] The invitation is written only by `app.issue_operator_invitation` (owner `poly_govern`, EXECUTE `poly_worker` alone), and `poly_worker` holds no INSERT on `invitation`. — tests/db/pgtap/06_operator_invitation.sql: "C12 owner/EXECUTE", "C13 poly_worker holds no INSERT/UPDATE/DELETE", "C15 exactly one app function inserts into invitation"; tests/db/operator-invite.test.ts: "C12 (catalog half in TS): definers.json"
- [x] The link (`PUBLIC_ORIGIN` + `/sign-up?invitation=<token>`) is printed once to stdout, after commit. The plaintext token is never logged, stored or sent to the database, and the expiry is 7 days. — tests/db/operator-invite.test.ts: "C2 + C6 + C8" (one-line stdout, PUBLIC_ORIGIN via the dispatcher, 7-day expiry), "C7: the token goes nowhere else" (stderr, rows, query spy, failed commit prints no link)
- [x] Exit codes: 0 issued, 2 refused (instance state), 1 anything else. `check-config` validates the worker's `DATABASE_*` first. — tests/db/operator-invite.test.ts: "C6 + C9: through the image dispatcher" (bad argv and bad config exit 1, no connection), "C3" and "C1" (exit 2); tests/image/dockerfile.test.ts: "dispatches ... cli"

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

## Decided at this issue's start (Principal)

- Decided: an operator invitation expires after 7 days.
- Decided: the link is printed once to stdout, for `--bootstrap` and for the plain invite. No mailer is built in this loop; email with the link embedded is the in-app invite's mechanism (POLY-144).

## Comments

### @team-lead — 2026-11-12

Feature started. Branch: `feature/poly-142-operator-invite-cli`.

### @team-lead — 2026-11-12

Principal decisions at kickoff (2026-11-13), on the two questions the issue left open:

1. **Expiry: 7 days**, as the architect proposed.
2. **Delivery: email, not stdout only.** The Principal's reason: nobody sees the CLI's stdout except perhaps during initial setup. This overrides the "link is printed once to stdout" criterion as the only delivery path and pulls the Resend mailer (POLY-137's `sendMagicLink` item, ruling follow-up 3) into reach of this loop. State of the tree: `RESEND_API_KEY_FILE` is registered for web and worker (`packages/config/src/registry.ts`, optional) and mounted in `infra/compose/prod.yml`; no mailer code exists, and `apps/web/src/lib/server/auth.ts` answers 503 for a magic link. Whether stdout survives for `--bootstrap` on a box with no mail key is for the gate-1 ruling.

The Principal also asked for an email invite option that does not invite the new user to a group entity. Scope of that (CLI only, or an in-app route) is open with the Principal; an in-app route that sends an invitation falls under the POLY-89 ordering rule in STATE.md.

### @team-lead — 2026-11-12

Principal amendment (2026-11-13), replacing decision 2 in my previous comment. Quoted: "The in-app option is manditory... and the mechanism should be an email invite with the link embedded. but for the initial user and for now, STDOUT is probably fine."

My reading, labelled as mine: this loop keeps the issue's criteria as filed. The CLI prints the link once to stdout, for `--bootstrap` and for the plain invite, and no mailer is built here. Email with the link embedded is the mechanism for the in-app invite, which is mandatory and filed as its own issue behind POLY-89. Expiry stays 7 days. Both of the issue's open questions are now closed.

### @architect — 2026-11-12

Gate-1 ruling: process/cairn/reviews/POLY-142/ruling.md (R0–R9, C1–C16, seceng's O1–O11 folded in). The acceptance criteria are amended in place: the command is `polycarpic cli user invite`, lint confines `@poly/db/operator` to `apps/worker/src/cli/user-invite.ts`, the bootstrap rule holds in accept too, and the link is written after commit. Paths to add: `bin/polycarpic`. The operator tests join the `auth` db area, so there is no new area and no `ci.yml` edit. Timing cap: +9 s on the battery-step median against a same-day main.

### @team-lead — 2026-11-12

Gate 1 closed: ruling at 6d74446 (`process/cairn/reviews/POLY-142/ruling.md`), 16 conditions, one addendum (seceng G1 corrects C14 in place; G2 confines the tenancy issuer file). seceng review at 9400c41 (O1–O11), ruling check at 0b7293b, no condition open. Command is `polycarpic cli user invite`. No new CI area and no `ci.yml` edit; the tests join `auth`. Timing cap +9 s on the battery-step median against a same-day main (the architect's estimate, unmeasured). Path `bin/polycarpic` added (R9).

Gate 2: tests red at c8df69d, 75 red for missing implementation, all 16 conditions and the CI-map pins covered (`red-gate.md`). qa's caveat: the tests that need the CLI fail at import, so their assertions are unproven until the build runs them. Suite cost unmeasured until gate 3.

Open with the Principal: widening accepted risk R-2 to name `poly_worker` (seceng and the architect recommend yes). The SECURITY edits wait on it; the build does not.

### @team-lead — 2026-11-12

Gate 3 closed: build green at f4f1a4f (build commits 55bdd41, 0e262d3, f4f1a4f; test fixes 713d615, 5225f83, 09165dc). qa's run of record at f4f1a4f: db battery 446 pass + 2 expected fail (448), 53.4 s; whole web e2e 52 pass (`build-gate-qa.md` @ 1e8868c). Timing guard, measured at 09165dc (f4f1a4f changes one line in `apps/worker/src/cli/main.ts`): median 57 s branch against 50 s on main at 558caf6, n = 3 alternating, local Docker; +7 s against the +9 s cap. `operator-invite.test.ts` runs 12.4 s as a file against the ruling's 7 s estimate. The CI `db` job median is read on the PR's first run (about 93 s on main, 100 s warning budget).

Architect build check at 321b62a: A1–A8 pass, A5 corrected by f4f1a4f, A10 is ARCH 1.15.21. seceng build check at ca0c3c9: O1–O11, G1, G2 met; SECURITY 1.9.17, C-28 definition at 66fc9b6; R-2 text held for the Principal. Builder changes accepted by both: owner EXECUTE revoked, `poly_app` SELECT on `issued_via`, revoked payload `{invitation_id}`, no `close()`, outcome-only log line. Every teammate worktree clean at this gate.

### @architect — 2026-11-12

Gate 4 verdict (architect): **pass** at f4f1a4f. Ruling: process/cairn/reviews/POLY-142/ruling.md (R0–R9, C1–C16, addendum 1, build check).

| Axis | Result | Evidence |
|---|---|---|
| Schema and definers (A1–A3) | Pass. 0008 generated; 0009 as ruled; claim and accept differ from 0007 only by the bootstrap predicate | 55bdd41, 0e262d3; build check @ 321b62a |
| Wrapper and confinement (A4, A7) | Pass. Four kinds; `db/operator` and `tenancy/operator-invitation` each confined to `user-invite.ts` | 55bdd41; layers check exit 0 @ ca2c2b2 |
| CLI contract (A5, A6) | Pass after correction. The crash handler now logs to stderr; stdout carries only the link | f4f1a4f |
| CI map (A8) | Pass. The `auth` area; no `.github/workflows` diff | 55bdd41 |
| Conditions C1–C16 | Pass. db battery 446 + 2 expected fail = 448; web e2e 52 green; two spot mutations each turned only their named test red | build-gate-qa.md @ 1e8868c |
| Timing (A9) | Pass. +7 s battery wall median against a +9 s cap (n = 3, local, same hour). `operator-invite.test.ts` is 12.4 s against an estimate of 7 s, absorbed by the parallel group | build-gate-qa.md @ 1e8868c |
| Docs (A10) | Pass. ARCH 1.15.21 and the PDF; SECURITY C-01, C-15, C-28, C-84 and T-98 to T-100 | 321b62a, ca0c3c9, 66fc9b6 |
| `cairn gate` | Pass | c6c48af |

Open, not blocking the verdict:
- R-2 widening to `poly_worker` is with the Principal.
- INFRA §7.5 and the first-user runbook step still say the invite sends an email; they should say the link is printed once, and the wrapper must use `exec -T`. This is the INFRA owner's edit.
- The 12.4 s file time is a candidate for POLY-143: it could share one clone and drop a child process.
