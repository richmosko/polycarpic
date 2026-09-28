# State

> Live dashboard of where the project is. Updated by the team-lead at every phase transition, feature completion, and release.
>
> **Durable work state lives in the tracker, not here.** Majors, milestones (the roadmap), and features are cairn artifacts under [`process/cairn/`](cairn/) — view them on the board (`/cairn`, `http://localhost:8766/`) or list them with `scripts/cairn/cairn ls`. This file keeps only what the tracker deliberately doesn't model: the current phase, the active feature pointer, and shipped releases. **No history accumulates here** — this file is auto-injected into every session, so it holds only current state; work history lives in the tracker (issue comments), the git log, and the PRs.

## Current Phase

**Phase:** Plan — milestone `POLY-C` (ARCH + SECURITY + INFRA, design system in `docs/DESIGN/`, throwaway prototype at `prototype/`, GL build-vs-adopt and migration-tool research, product milestones `POLY-M1…` created and GA designated). Research gate approved 2026-09-27: PRD v1 at [`docs/PRD/index.html`](../docs/PRD/index.html); `POLY-B` closed and archived. Opening moves run in parallel: ux-designer builds the design system + wireframes with the Principal (`/generate-designdoc`), architect starts the layer model and GL research (`/generate-archdoc`); seceng and devops-engineer join once ARCH v1 exists. Hand-offs for the architect and seceng are in `temp/` (`prd-spillover-arch.md`, `seceng-research-notes.md`).  
**Started:** 2026-09-27  
**Driver agent:** architect (ux-designer drives the design-system track)  
**Gate criteria:** _see [`WORKFLOW.md`](WORKFLOW.md)_

## Active Feature

A feature = one cairn issue = one PR = one Implement→Validate loop. Exists only during Implement phase. This is a pointer — the issue file (`process/cairn/issues/<ID>.md`) is the record.

_None — Plan phase. The thirteen story-grain issues `POLY-62`–`POLY-73`, `POLY-75` sit in `backlog` with no milestone until the architect files them into `POLY-M1…`; `POLY-74` (CI filter) is an unmilestoned tooling follow-up._

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
