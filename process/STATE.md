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

- **Feature:** Identity marker (stage 1)
- **Issue:** `POLY-147` (cairn)
- **Milestone:** `POLY-M1`
- **Branch:** `feature/poly-147-identity-marker`
- **Started:** 2026-11-13
- **Goal:** Postgres takes a user's identity only from a per-transaction marker that definer functions write, never from a setting any role can set.
- **Status:** In Progress

_Previous loop: POLY-146 (Identity hardening) merged 2026-11-13 via PR [#126](https://github.com/richmosko/polycarpic/pull/126) — ARCH 1.15.22, SECURITY 1.9.19, INFRA 1.3.10. BetterAuth's verification identifiers and magic-link tokens are stored hashed, so a value read from the table cannot be redeemed; SQL as `poly_app` can still plant a magic link until POLY-149 (SECURITY R-2). The auth secret is mounted into web alone. `polycarpic cli user invite` runs in a one-shot `operator` compose service as its own login role, `poly_operator`, with logging driver `none`; `poly_worker` can no longer issue invitations. The real invite link has not been run through a live `docker compose run`; the first staging invite (POLY-97) is that check, and POLY-97's provisioning sets `poly_operator`'s password. The identity decision is option (e1) (`process/DECISIONS.md`, 2026-11-13; record in `process/cairn/reviews/POLY-145/`). Second-factor enrolment stays closed until POLY-89. Password reset is not wired (POLY-137). Nothing is deployed. Six standing constraints: the identity work runs in the order POLY-147 (stage 1), POLY-148 (spike), POLY-89, POLY-149 (stage 2), and stage 2's design is confirmed from the spike's record (Principal, 2026-11-13; `process/DECISIONS.md`); no better-auth or passkey pin change merges before the S9 test in POLY-137 exists; a loop's `db` cost is judged against a same-day control on `main`, and cuts to the suite are POLY-143's; POLY-89's database gates land before, or with, the first route that creates a non-Person entity or sends an invitation; before the first deploy, Caddy overwrites `X-Forwarded-For` and drops the query string from its access log (POLY-138), and the provider callback and magic-link routes are rate-limited with an idle-in-transaction timeout (POLY-137, SECURITY R-24); a package is left only by its `@poly/<name>` import (lint-enforced). Follow-ups: POLY-147, POLY-148, POLY-149 (identity rework, in the order above); POLY-64 and POLY-77 carry scoped worker grants and the parser sandbox; POLY-98 (the `polycarpic-ops` wrapper targets the `operator` service; each later operator command needs its own grant review); POLY-137 (auth, the Resend mailer, a 15-minute reset expiry), POLY-138 (Caddy and edge), POLY-139 (sign-in and sessions screens), POLY-143 (CI and test time), POLY-144 (in-app instance invite by email; mandatory, behind POLY-89); POLY-97 carries the uploader access that gates the first backup._

- **Next:** POLY-147 (identity marker, stage 1, P1); POLY-97 (infra scaffolding; needs a real Hetzner project) alongside. POLY-131 held (P3).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
