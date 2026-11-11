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

Two loops run in parallel (started 2026-11-11, both milestone `POLY-M1`). Both are In Review: POLY-62 as PR [#109](https://github.com/richmosko/polycarpic/pull/109), POLY-128 as PR [#110](https://github.com/richmosko/polycarpic/pull/110):

| Feature | Issue | Branch | Driver | Goal |
|---|---|---|---|---|
| Entity + membership schema | POLY-62 | `feature/poly-62-entity-membership-schema` | backend-lead | The tenancy core under RLS: entity, membership, the authz functions, notification and audit tables, and a default Person for every user. |
| App shell + DESIGN tokens | POLY-128 | `feature/poly-128-app-shell-design-tokens` | frontend-lead | The SvelteKit root layout (sidebar, one-row top bar) with DESIGN's tokens as the only source of colour, type and spacing. |

The two share only config files (`eslint.config.js`, `package.json`, `pnpm-lock.yaml`); the second PR to merge takes `main` first.

_Before these: POLY-132 (build.yml first-run fixes) merged 2026-11-11 via PR [#107](https://github.com/richmosko/polycarpic/pull/107), after POLY-96 (CI: change filter, build, attest) via PR [#106](https://github.com/richmosko/polycarpic/pull/106) ; `app` is a required check on `main`. The design docs carry current state only since 2026-11-11 (PR [#108](https://github.com/richmosko/polycarpic/pull/108); rule in `WORKFLOW.md` → Decision logging). Follow-ups on POLY-79 (CI timing ingest), POLY-100 (deploy-side `--source-ref`, digest from `digest.txt`, `RELEASE_SIGNERS`), POLY-102 (CodeQL, DB job budget, aggregate blind spot, 90-day digest artifacts, image-script filter gap). Carried from POLY-85: follow-ups on POLY-81, POLY-88, POLY-100, POLY-121; ruling Open 1 (pass the loaded `Secret` to the pool) and Open 3 (`jobs` in the status payload) attach to the next db / first worker-job feature._

- **Next:** the rest of the second session's `todo`: POLY-86 (BetterAuth), POLY-97 and POLY-95 (infra). POLY-131 held (P3). POLY-62 grows the DB battery while the `db` CI job runs at about 150 s of its 180 s budget (POLY-102).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
