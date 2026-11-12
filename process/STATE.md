# State

> Live dashboard of where the project is. Updated by the team-lead at every phase transition, feature completion, and release.
>
> **Durable work state lives in the tracker, not here.** Majors, milestones (the roadmap), and features are cairn artifacts under [`process/cairn/`](cairn/) — view them on the board (`/cairn`, `http://localhost:8766/`) or list them with `scripts/cairn/cairn ls`. This file keeps only what the tracker deliberately doesn't model: the current phase, the active feature pointer, and shipped releases. **No history accumulates here** — this file is auto-injected into every session, so it holds only current state; work history lives in the tracker (issue comments), the git log, and the PRs.

## Current Phase

**Phase:** Implement — milestone `POLY-M1` Foundations (L0 platform, L1 identity & tenancy, L6 app shell; `process/cairn/milestones/POLY-M1.md`). Plan gate approved 2026-11-09 (POLY-127): ARCH v1.11, SECURITY v1.4, INFRA v1.2 and DESIGN v0.17 were approved at the gate; ARCH is now v1.14.2 (layer map and its enforcement; Drizzle Kit confirmed by the POLY-76 spike, §6.2; sign-up inside our own transaction, §3.1), SECURITY v1.6 (approved 2026-11-09) and INFRA v1.3, all 2026-11-09. `POLY-C` closed and archived. The first session's issues (POLY-76, 82, 83, 84, 85) are done; the throwaway prototype at `prototype/` is the look-and-feel reference until the first real screens ship.  
**Started:** 2026-11-09  
**Driver agent:** backend-lead (qa-engineer drives Validate)  
**Gate criteria:** _see [`WORKFLOW.md`](WORKFLOW.md)_

## Active Feature

A feature = one cairn issue = one PR = one Implement→Validate loop. Exists only during Implement phase. This is a pointer — the issue file (`process/cairn/issues/<ID>.md`) is the record.

- **Feature:** CI and migration-check follow-ups
- **Issue:** `POLY-136` (cairn)
- **Milestone:** `POLY-M1`
- **Branch:** `feature/poly-136-ci-migration-followups`
- **Started:** 2026-11-11
- **Goal:** Bring the `db` CI job to a 130 s median so new suites can join it, and close the batch of small CI and migration-check follow-ups.
- **Status:** In Review — PR [#119](https://github.com/richmosko/polycarpic/pull/119)

_Last merged: POLY-86 (BetterAuth: routing pool + allowlist) merged 2026-11-11 via PR [#116](https://github.com/richmosko/polycarpic/pull/116) — ARCH 1.15.15, SECURITY 1.9.9 — and POLY-95 (Compose, Postgres config + lint) via PR [#115](https://github.com/richmosko/polycarpic/pull/115) — INFRA 1.3.4. `packages/auth` runs BetterAuth 1.7.18 on the routing pool behind the `/api/auth/*` allowlist; the shell shows the session, with a bare `/sign-in`, Settings → Sessions and Log out. The `edge`, `prod` and `staging` compose projects, the Postgres and Caddy images and the compose-policy lint are in; nothing is deployed. Sign-up stays closed until POLY-87 and second-factor enrolment until POLY-89. Three standing constraints: no better-auth or passkey pin change merges before the S9 test in POLY-137 exists; the `db` job runs at a 144 s median against its 150 s guard, so the cut on POLY-136 lands before any new suite joins it; Caddy must overwrite `X-Forwarded-For` (POLY-138) before the first deploy, or every sign-in answers 503. Follow-ups: POLY-137 (auth), POLY-138 (Caddy and edge), POLY-139 (sign-in and sessions screens), and comments on POLY-79, 87, 88, 89, 97, 99, 100, 103, 104, 121, 122 and 136; POLY-97 carries the uploader access that gates the first backup._

- **Next:** POLY-87 (invite-only sign-up) follows POLY-136, with POLY-97 (infra scaffolding; needs a real Hetzner project) alongside. POLY-131 held (P3).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
