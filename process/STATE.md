# State

> Live dashboard of where the project is. Updated by the team-lead at every phase transition, feature completion, and release.
>
> **Durable work state lives in the tracker, not here.** Majors, milestones (the roadmap), and features are cairn artifacts under [`process/cairn/`](cairn/) — view them on the board (`/cairn`, `http://localhost:8766/`) or list them with `scripts/cairn/cairn ls`. This file keeps only what the tracker deliberately doesn't model: the current phase, the active feature pointer, and shipped releases. **No history accumulates here** — this file is auto-injected into every session, so it holds only current state; work history lives in the tracker (issue comments), the git log, and the PRs.

## Current Phase

**Phase:** Implement — milestone `POLY-M1` Foundations (L0 platform, L1 identity & tenancy, L6 app shell; `process/cairn/milestones/POLY-M1.md`). Plan gate approved 2026-11-09 (POLY-127): ARCH v1.11, SECURITY v1.4, INFRA v1.2 and DESIGN v0.17 were approved at the gate; ARCH is now v1.15.22 (layer map and its enforcement; Drizzle Kit confirmed by the POLY-76 spike, §6.2; sign-up inside our own transaction, §3.1), SECURITY v1.9.19 and INFRA v1.3.10. `POLY-C` closed and archived. The first session's issues (POLY-76, 82, 83, 84, 85) are done; the throwaway prototype at `prototype/` is the look-and-feel reference until the first real screens ship.  
**Started:** 2026-11-09  
**Driver agent:** backend-lead (qa-engineer drives Validate)  
**Gate criteria:** _see [`WORKFLOW.md`](WORKFLOW.md)_

## Active Feature

A feature = one cairn issue = one PR = one Implement→Validate loop. Exists only during Implement phase. This is a pointer — the issue file (`process/cairn/issues/<ID>.md`) is the record.

- **Feature:** Second sign-in step
- **Issue:** `POLY-89` (cairn)
- **Milestone:** `POLY-M1`
- **Branch:** `feature/poly-89-second-sign-in-step`
- **Started:** 2026-11-16
- **Goal:** Owners and managers must enrol a second factor (authenticator app or passkey), anchored on an emailed code, asked on a new device and as a step-up; the own unshared Person is exempt until a forcing action; every guard is a database gate read from the POLY-147 marker.
- **Status:** In Review — PR [#131](https://github.com/richmosko/polycarpic/pull/131)

_Standing context. POLY-148 (Sign-in service spike) merged 2026-11-16 via PR [#129](https://github.com/richmosko/polycarpic/pull/129) — SECURITY 1.9.21. The record is `process/cairn/reviews/POLY-148/spike.md`, accepted by seceng: 28 PASS, 4 FAIL, 4 REPORT on 36 check lines, Chromium 7 of 7. Stage 2 (POLY-149) is ruled from it. Three changes are required there: the session lookup takes the plain handle and hashes inside Postgres; a `provision_person` definer replaces the service's tenancy write grant (stage 2's price is re-opened, about +0.5 loop-day, a guess); the service enters by its own session and never holds `enter_asserted_user`. Refresh re-issuing neither cookie needs a stage-2 ruling. The Principal decided the sign-in pages stay in web (`process/DECISIONS.md`, 2026-11-15); the accepted risk is SECURITY R-25 (T-101), and neither of its mitigations is built yet (POLY-138, POLY-89). Follow-ups are filed on POLY-149 (stage 2's required changes and the refresh ruling), POLY-89 (the `two_factor_enabled` guard; the first-verify rotation's `recent_auth_at` grant gap), POLY-138 (Caddy refuses `Service-Worker: script`) and POLY-143 (`tests/infra/image` unexplained failures on macOS)._

_Standing context. POLY-147 (Identity marker, stage 1) merged 2026-11-15 via PR [#127](https://github.com/richmosko/polycarpic/pull/127) — ARCH 1.16.0, SECURITY 1.9.20, INFRA 1.3.12. Postgres takes a transaction's user only from its row in `app.tx_identity`, written by the `enter_*` definers; `app.current_user_id()` reads that marker and no setting. Each definer accepts only its own exact, parameter-bound call, every runtime query is sent in extended mode, and the bootstrap revokes plpgsql from the runtime roles and PUBLIC's EXECUTE on the 17 built-ins that run a SQL string (`process/DECISIONS.md`, 2026-11-15). SECURITY R-2 is narrowed, not closed: SQL as `poly_app` outside a marked transaction can plant a magic link and sign in as any user, and a stolen `poly_app` password or code execution in web can name any user, until POLY-149. The marker's `session_id` is web's word until then. The worker enters only through `app.enter_job`; `app.job_targets` returns no rows today. The marker's cost was measured on one Mac host (p95 +0.24 ms, WAL +231 B per transaction); it is re-read at the first staging deploy (POLY-97). `packages/db/sql/roles.sql` is re-run after any restore or major Postgres upgrade (INFRA §8.10). The real invite link has not been run through a live `docker compose run`; the first staging invite (POLY-97) is that check, and POLY-97's provisioning sets `poly_operator`'s password. The identity decision is option (e1) (`process/DECISIONS.md`, 2026-11-13; record in `process/cairn/reviews/POLY-145/`). Second-factor enrolment stays closed until POLY-89. Password reset is not wired (POLY-137). Nothing is deployed. Seven standing constraints: the identity work runs in the order POLY-148 (spike), POLY-89, POLY-149 (stage 2), and stage 2's design is confirmed from the spike's record (Principal, 2026-11-13; `process/DECISIONS.md`); no better-auth or passkey pin change merges before the S9 test in POLY-137 exists; a loop's `db` cost is judged against a same-day control on `main`, and cuts to the suite are POLY-143's; POLY-89's database gates land before, or with, the first route that creates a non-Person entity or sends an invitation, and no POLY-89 guard treats the marker's `session_id` as proof of a session; before the first deploy, Caddy overwrites `X-Forwarded-For` and drops the query string from its access log (POLY-138), and the provider callback and magic-link routes are rate-limited with an idle-in-transaction timeout (POLY-137, SECURITY R-24); a package is left only by its `@poly/<name>` import (lint-enforced); no real household data is deployed before the last PR of POLY-149 (the revocation) merges, while a staging deploy with test data may go ahead (Principal, 2026-11-16; `process/DECISIONS.md`). Follow-ups: POLY-148, POLY-149 (identity rework, in the order above); POLY-64 and POLY-77 carry scoped worker grants and the parser sandbox; POLY-98 (the `polycarpic-ops` wrapper targets the `operator` service; each later operator command needs its own grant review); POLY-137 (auth, the Resend mailer, a 15-minute reset expiry), POLY-138 (Caddy and edge), POLY-139 (sign-in and sessions screens), POLY-143 (CI and test time), POLY-144 (in-app instance invite by email; mandatory, behind POLY-89); POLY-97 carries the uploader access that gates the first backup._

- **Next:** POLY-149 (stage 2), after POLY-89; POLY-97 (infra scaffolding; needs a real Hetzner project) alongside. POLY-131 held (P3).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
