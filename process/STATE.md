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

- **Feature:** build.yml first-run fixes (fix-forward for POLY-96)
- **Issue:** `POLY-132` (cairn)
- **Milestone:** `POLY-M1`
- **Branch:** `feature/poly-132-build-yml-first-run-fixes`
- **Started:** 2026-11-11
- **Goal:** get the first build.yml run on `main` green end to end and close POLY-96's post-merge confirmations (attestation verify, SBOM attestation, release dry run).
- **Status:** In Review — PR [#107](https://github.com/richmosko/polycarpic/pull/107). After merge the lead confirms on `main`: build.yml green end to end, attestation verify with `--source-ref`, SBOM attestation, release.yml dry run (POLY-132 criteria 1, 4–6).
- **Last merged:** POLY-96 (CI: change filter, build, attest), 2026-11-11, PR [#106](https://github.com/richmosko/polycarpic/pull/106); `app` is a required check on `main` since 2026-11-11. Follow-ups on POLY-79, POLY-100, POLY-102.
- **Carried from POLY-85:** follow-ups on POLY-81, POLY-88, POLY-100, POLY-121; ruling Open 1 (pass the loaded `Secret` to the pool) and Open 3 (`jobs` in the status payload) attach to the next db / first worker-job feature.
- **Next:** (1) Doc-update: strip status history, "Changes" blocks and body narration from all five design docs and write the rule into the doc owners' definitions (user directive 2026-11-11). (2) Second session continues from `todo`: POLY-62 and POLY-86 (identity roots), POLY-128 (app shell), POLY-97 and POLY-95 (infra). POLY-131 held (P3).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
