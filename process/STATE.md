# State

> Live dashboard of where the project is. Updated by the team-lead at every phase transition, feature completion, and release.
>
> **Durable work state lives in the tracker, not here.** Majors, milestones (the roadmap), and features are cairn artifacts under [`process/cairn/`](cairn/) — view them on the board (`/cairn`, `http://localhost:8766/`) or list them with `scripts/cairn/cairn ls`. This file keeps only what the tracker deliberately doesn't model: the current phase, the active feature pointer, and shipped releases. **No history accumulates here** — this file is auto-injected into every session, so it holds only current state; work history lives in the tracker (issue comments), the git log, and the PRs.

## Current Phase

**Phase:** Implement — milestone `POLY-M1` Foundations (L0 platform, L1 identity & tenancy, L6 app shell; `process/cairn/milestones/POLY-M1.md`). Plan gate approved 2026-11-09 (POLY-127): ARCH v1.11, SECURITY v1.4, INFRA v1.2 and DESIGN v0.17 were approved at the gate; ARCH is now v1.14.2 (layer map and its enforcement; Drizzle Kit confirmed by the POLY-76 spike, §6.2; sign-up inside our own transaction, §3.1), SECURITY v1.6 (approved 2026-11-09) and INFRA v1.3, all 2026-11-09. `POLY-C` closed and archived. POLY-76 is done; the rest of the first session's issues are in `todo` (POLY-82, 83, 84, 85); the throwaway prototype at `prototype/` is the look-and-feel reference until the first real screens ship.  
**Started:** 2026-11-09  
**Driver agent:** backend-lead (qa-engineer drives Validate)  
**Gate criteria:** _see [`WORKFLOW.md`](WORKFLOW.md)_

## Active Feature

A feature = one cairn issue = one PR = one Implement→Validate loop. Exists only during Implement phase. This is a pointer — the issue file (`process/cairn/issues/<ID>.md`) is the record.

- **Feature:** RLS battery harness
- **Issue:** `POLY-84` (cairn)
- **Milestone:** `POLY-M1` Foundations
- **Branch:** `feature/poly-84-rls-battery-harness`
- **Started:** 2026-11-10
- **Goal:** the pgTAP battery's cross-cutting probes in `tests/db` — catalog-derived per-table RLS/FORCE probe with a named exemption list and canaries, inversion self-test, dirty-backend pool reuse (C-12), WITH CHECK forgery, definer allowlist (C-15), role hygiene (C-10), view/matview/TRUNCATE checks, and the SECURITY §4.2.1 permission matrix as a data-driven test — run through the real runner against a fresh Postgres.
- **Status:** In Review — PR [#103](https://github.com/richmosko/polycarpic/pull/103); QA green @ 87f17b2, architect + seceng approved.
- **Previous:** POLY-83 merged 2026-11-10 via PR #102 (ARCH v1.15.3, SECURITY v1.7; follow-ups on POLY-131, deploy-side on POLY-100).
- **Next:** POLY-85 (runtime config + ops hooks).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
