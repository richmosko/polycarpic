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

_None. POLY-136 (CI and migration-check follow-ups) merged 2026-11-12 via PR [#119](https://github.com/richmosko/polycarpic/pull/119) — INFRA 1.3.5, SECURITY 1.9.10. The `db` CI job runs at a 125 s median (was 144 s); installs run strict everywhere, with `allowBuilds` holding only `false` entries; the migrate program's body lives in `apps/migrate/src/run.ts`, importable only by `cli.ts` and tests. `packages/auth` runs BetterAuth 1.7.18 on the routing pool behind the `/api/auth/*` allowlist; the `edge`, `prod` and `staging` compose projects and the Postgres and Caddy images are in; nothing is deployed. Sign-up stays closed until POLY-87 and second-factor enrolment until POLY-89. Four standing constraints: no better-auth or passkey pin change merges before the S9 test in POLY-137 exists; the `db` job has about 5 s of room against its 130 s median target (the configured budget is 180 s and only warns), so a loop that adds more brings its own cut; the layer lint passes relative imports across packages, so that gap closes before POLY-87 builds on the boundary; Caddy must overwrite `X-Forwarded-For` (POLY-138) before the first deploy, or every sign-in answers 503. Follow-ups: POLY-137 (auth), POLY-138 (Caddy and edge), POLY-139 (sign-in and sessions screens); POLY-97 carries the uploader access that gates the first backup._

- **Next:** POLY-140 (layer lint, relative imports), then POLY-141 (db battery parallel and area-split), then POLY-87 (invite-only sign-up); POLY-97 (infra scaffolding; needs a real Hetzner project) alongside. POLY-131 held (P3).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
