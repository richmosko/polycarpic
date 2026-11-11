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

_None. POLY-102 (CI: generated-output freshness) merged 2026-11-11 via PR [#113](https://github.com/richmosko/polycarpic/pull/113) — ARCH 1.15.13, INFRA 1.3.3, SECURITY 1.9.6. The `lint` job regenerates the migrations and compares bytes; the `db` job is at 93–113 s of its 180 s budget (target ≤ 150 s) and now runs on everything the battery imports; a feature that commits a generated file registers its pair in `infra/ci/generated.json` in the same PR. Follow-ups: POLY-135 (CodeQL scanning), POLY-136 (journal ↔ file check for migrations; POLY-96 A-2 and A-3), POLY-79 (no bare `/tmp` writes in the agent definitions; the PDF export's leftover Chrome profiles)._

_Before this: POLY-128 (App shell + DESIGN tokens) via PR [#110](https://github.com/richmosko/polycarpic/pull/110) and POLY-62 (Entity + membership schema) via PR [#109](https://github.com/richmosko/polycarpic/pull/109), both 2026-11-11. The shell is not served by the image until POLY-88, and shows no session until POLY-86. Follow-ups on POLY-86 (session loader calls `provisionPerson`, one retry on 23505; `locals.session`; POLY-85's Open 1), POLY-87 (operator-invitation definer), POLY-88 (no route before POLY-86's guard; image build stage), POLY-90 (self-Person owner row), POLY-95 (Caddy security headers), POLY-79 (`guard-commit` merge exemption; CI timing ingest), POLY-100 (deploy-side `--source-ref`, digest from `digest.txt`, `RELEASE_SIGNERS`), POLY-133 (shell entity selector), POLY-134 (shell security follow-ups)._

- **Next:** POLY-86 (BetterAuth) is unblocked; POLY-95 and POLY-97 (infra) can run alongside it. POLY-131 held (P3).

## Releases

**Template base:** bootstrapped 2026-09-23 from [`project_template`](https://github.com/richmosko/project_template) **v0.12.2** — diff template updates against that tag when porting them here.

Full history, every tagged release with its notes, lives at [the GitHub Releases page](https://github.com/richmosko/polycarpic/releases) — this row is a pointer, not a log. Cut via `/merge-pr`; `/merge-pr` **replaces** this row (never appends) on every tag.

| Version | Date | Major line | Milestone shipped | Branch | Notes |
|---|---|---|---|---|---|
| — | — | POLY-V1 | none yet | main | No release cut |

## Decisions

The Decision Log lives alongside this file at [`DECISIONS.md`](DECISIONS.md) (under `process/`) — split out so this file stays compact for auto-loading. Append new entries there; conventions are documented in [`WORKFLOW.md`](WORKFLOW.md) → Decision logging.
