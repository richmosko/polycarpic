---
id: POLY-87
title: Invite-only sign-up
status: done
milestone: POLY-M1
parent: null
blocked_by: [POLY-62, POLY-86, POLY-140, POLY-141]
assignee: backend-lead
paths: [process/cairn/issues/POLY-87.md, process/cairn/reviews/POLY-87/**, packages/auth/**, packages/tenancy/**, packages/db/**, apps/web/src/routes/**, apps/web/src/hooks.server.ts, apps/web/tests/e2e/**, tests/db/**, tests/ci/**, tests/layers/**, scripts/layers/**, infra/ci/changes.mjs, layers.json, eslint.config.js, package.json, pnpm-lock.yaml, docs/ARCH/**, docs/SECURITY/**]
labels: [auth]
priority: null
pr: https://github.com/richmosko/polycarpic/pull/123
created: 2026-11-08
updated: 2026-11-12
---

After the first (operator) user, an invitation is the only way into an instance; no setting reopens public sign-up (Principal P6, 2026-11-07). An invitee creates an account from the invite and lands on the invited entity, or on their own Person if invited with no entity. The operator can issue a standalone single-use, audited invitation from the box; that person gets only their own Person. PRD §4 invite story.

## Acceptance criteria

- [x] With no invitation, the sign-up route refuses account creation; no config flag, env var or admin setting changes that. _Proved by: tests/db/auth-signup-invite.test.ts C1+28, C2, C23._
- [x] An invitation link works once and expires; an accepted, revoked or expired link cannot be replayed. _Proved by: auth-signup-invite C1, C3, C4 (single use, replay, race)._
- [x] An invitee with an entity invite lands on that entity; one without lands on their own Person. _Proved by: auth-signup-invite C6, C7; apps/web/src/routes/page.server.test.ts; e2e shell.spec.ts root redirect._
- [x] /sign-up/email without a live invitation is refused at the route allowlist (ARCH §3.1c). _Proved by: auth-signup-invite C1+28 (route hook 403), C24; route-policy tests._
- [x] Sign-up by invitation commits the user row, the Person, the owner membership and the seeded accounts together; after a forced rollback of our transaction none of them exists (ARCH v1.14 §3.1). _Proved by: auth-signup-invite C9, C10, C32 variants._
- [x] Inside the sign-up transaction the hook sets `app.user_id` with `is_local = true` through packages/db before provisionPerson, and provisionPerson's inserts succeed as poly_app under FORCE RLS; with the step removed, the same sign-up is refused by RLS and leaves no user row. _Proved by: auth-new-user-step C5, C13; auth-signup-invite C12 variant._
- [x] A throw inside provisionPerson fails the sign-up and leaves no user row, Person, membership or account. _Proved by: auth-signup-invite C10 (provisionPerson trigger); the seeded accounts are ticked against the Person and its owner membership, as ruling R3 says._
- [x] After the sign-up transaction commits, `app.user_id` is unset on that pooled backend (a context-free query there sees zero tenant rows). _Proved by: auth-signup-invite C11 (pool max 1, commit and rollback)._
- [x] The new-user step is reachable only through withContextFreeTx's handle, not from the db/auth index. It refuses an existing user's id, a second call, a call outside withContextFreeTx, and an id whose insert was rolled back to a savepoint (SECURITY C-84, T-90). _Proved by: auth-new-user-step C13 (handle), C14; tests/layers fixtures 30-32._
- [x] A throw after the new-user step leaves no user, entity or membership row. After both a commit and a rollback, the next checkout of that backend reads app.user_id empty. _Proved by: auth-signup-invite C10, C11._
- [x] The invitation is checked and consumed in the sign-up transaction. Two sign-ups racing on one invitation yield exactly one user, and the loser leaves no user row. _Proved by: auth-signup-invite C4, C27._
- [x] The step refuses a provisioned user's id planted in the setting by set_config; a rollback to the savepoint clears the recorded id. _Proved by: auth-new-user-step C13 (forged setting, savepoint); pgtap 05 C17, C32._
- [x] A membership on an invited entity is written only by the invitation-accept definer: `poly_app` holds no INSERT on `membership` (POLY-62 ruling R4). The definer seats `app.current_user_id()` against a matching live invitation, and for manager or owner only after the second step is enrolled. _Proved by: pgtap 05 C15, C18; tests/db/pgtap/04_tenancy.sql._
- [x] Operator invitations with no entity have their own definer path: `invitation` rows with `entity_id IS NULL` pass no `poly_app` policy, and `app.gate_owner_changes()` refuses them today (POLY-62 verdict). _Proved by: pgtap 05 C16, C23; auth-signup-invite C23._

## Comments

### @team-lead — 2026-11-11

From the POLY-86 loop (ruling follow-up 6): this issue builds the real `claimInvitation`, the new-user step and `provisionPerson` at sign-up. Until then `packages/auth` passes a stub that refuses every sign-up, and the check runs in `user.create.before` inside `withContextFreeTx` on every user-creating route.

### @team-lead — 2026-11-11

From the POLY-136 loop. **Order:** POLY-140 (layer lint, relative imports) and POLY-141 (db battery parallel and area-split) run first (Principal, 2026-11-12). **Room in the `db` job:** about 5 s of CI time at the median (125 s against the 130 s target; `process/cairn/reviews/POLY-136/ruling.md`, addendum 3). The bound is two-part: median ≤ 130 s and the fastest three of five runs averaging ≤ 120 s; POLY-141 resets it. The configured budget is 180 s and only warns (`infra/ci/budgets.json`). **New-user step:** `apps/migrate/src/run.ts` shows the pattern POLY-140 generalises: a file importable only from named callers, by package path and by relative path.

### @team-lead — 2026-11-12

Feature started. Branch: `feature/poly-87-invite-only-sign-up`. POLY-140 and POLY-141 are done, so the earlier note on `db` room is superseded: the `db` job runs at an 86 s median against a 100 s warning budget (INFRA 1.3.8), and every new `tests/db/*.test.ts` must be placed in exactly one area in `infra/ci/changes.mjs` (POLY-141 C7). Paths front-loaded with the issue record, `packages/db/**`, `tests/db/**`, `tests/ci/**`, the area map, the layer files and the two docs; the architect names any other at the ruling.

### @team-lead — 2026-11-12

Gate 1: ruling at 319a22d (`process/cairn/reviews/POLY-87/ruling.md`, 22 conditions in five build steps; ARCH 1.15.17). Split accepted by the Principal (2026-11-12): this issue keeps the sign-up transaction; the two CLI criteria (first user by `--bootstrap`; `polycarpic user invite` with an audit event) moved to POLY-142, which is blocked by this issue. Paths: `scripts/layers/**` and `tests/layers/**` added; `apps/cli/**` removed (POLY-142 takes it as `apps/worker/**`). seceng reviews the ruling before the tests are written.

### @team-lead — 2026-11-12

seceng review at fcc376b: pass with conditions S1–S12, two of them holes (a forged sign-up setting seating an existing user; an unverified provider email claiming invitations). Ruling addendum 1 at 9fbc2ec: 31 conditions; S12 amended after the architect's probe showed the xmin test also passes for an updated row, so the proof is a `user.signup_txid` column stamped by a BEFORE INSERT trigger, and the `app.signup_user_id` setting is gone; S2 built in this loop; S6 seats viewers only. ARCH 1.15.18. Path `apps/web/tests/e2e/**` added (C29). seceng checks the amended S12, S7 and S2 before the tests are written.

### @team-lead — 2026-11-12

Gate 1 closed: ruling at f00f2ab, 32 conditions, addenda 1 and 2 plus two in-place corrections (C32: only `poly_app` inserts are stamped, after qa found the first text would refuse every user fixture; R3 item 6: landing read from membership, replacing a builder-added invitation read policy). seceng: no condition open. Gate 2: tests red complete at 4274162 (steps 1–7, the C14 `withSystem` case, C16 additions, an e2e spec); `tests/ci` 528 of 528 on the lead's run. qa reports the battery at 410 tests with 59 red before the build, and 39 to 45 s local wall time. Existing tests changed, each to follow the ruling: pgTAP `04_tenancy` 19 and 27, the 32-byte token hash in `helpers/tenancy.ts`, `auth-fields` and `auth-signup-wrap` seeding real invitations, the client-IP header in condition 2. Open with the Principal: manager and owner invitees claimed at sign-up and seated in POLY-89.

### @team-lead — 2026-11-12

Gate 3: build at 833491f (steps 1–7, then the architect's R3 fix and condition 33). Lead's runs at 833491f: db battery 412 passed and 2 expected fail of 414 in 48 s locally (39 s before this loop); `tests/ci` 528, `tests/layers` 502, `tests/infra` 142, `pnpm test` 17 tasks, `pnpm lint` and `check-migrations` clean. Architect's build check at f948057: R1–R6 built as ruled apart from the 42501 mapping scope, fixed at 9984d48; the builder's additions (`myLandingEntity`, lint `globals`, exact-match `/sign-up` in `hooks.server.ts`) accepted. seceng's build check at e18b818: S1–S13 met, probed on the real migrations; it found S14 (a new user's email rewritten mid-sign-up to take another tenant's viewer invitation), ruled as condition 33 at 74e0ae8 and built as a trigger in 0007. The ruling stands at 33 conditions. ARCH 1.15.19, SECURITY 1.9.14. Path `apps/web/src/hooks.server.ts` added. SECURITY R-22 to R-24 await the Principal's approval.

### @team-lead — 2026-11-12

PR https://github.com/richmosko/polycarpic/pull/123 marked ready. Verdict PASS at 9051d1d (`process/cairn/reviews/POLY-87/verdict.md`, b86b055); head-match PASS. Timing, lead's runs: five sequential dispatch runs on 9051d1d, `db` 109, 106, 94, 92, 87 s (median 94; runs 43341943047, 43342512609, 43343144183, 43343666158, 43345203202); same-afternoon control on `main` 7eaa51a, 93, 94, 87 s (median 93; 43344193896, 43344702525, 43345784207); guard ruled met at 01cfd9c. Finish gate at b86b055: cairn Python suite 2017 OK, board JS suite 494, dashboard type check 0 errors, dist fresh. The Principal accepted the manager/owner rule (2026-11-13); SECURITY R-22 to R-24 await approval.

### @team-lead — 2026-11-12

Validate passed; merging via PR #123. Closing. The Principal approved SECURITY R-22, R-23 and R-24 (2026-11-13; SECURITY 1.9.16). Follow-ups placed: POLY-142 (operator CLI, the first way to issue an invitation), POLY-89 (seat claimed manager and owner rows; the ordering rule on entity and invitation routes), POLY-90 (existing-user acceptance), POLY-137 (rate limit and idle timeout before the first deploy), POLY-139 (landing tie-break), POLY-143 (test-time items, including the seed-helper cut).
