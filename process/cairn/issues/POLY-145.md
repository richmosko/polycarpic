---
id: POLY-145
title: Identity trust boundary
status: in-progress
milestone: POLY-M1
parent: null
blocked_by: []
assignee: seceng
paths: [process/cairn/issues/POLY-145.md, process/cairn/issues/POLY-89.md, process/cairn/issues/POLY-137.md, process/cairn/issues/POLY-64.md, process/cairn/issues/POLY-98.md, process/cairn/issues/POLY-146.md, process/cairn/issues/POLY-147.md, process/cairn/issues/POLY-148.md, process/cairn/issues/POLY-149.md, process/cairn/reviews/POLY-145/**, process/DECISIONS.md, process/STATE.md, docs/SECURITY/**, docs/ARCH/**]
labels: [security, auth, spike]
priority: P1
pr: null
created: 2026-11-12
updated: 2026-11-13
---

A research spike, with a Principal decision at the end: which component may tell Postgres who the user is, and whether a smaller one should hold that power. Raised by the Principal at the POLY-142 loop (2026-11-13), when asked to widen accepted risk R-2 to name the worker. Quoted: "I'm really focused on making this super secure. So I would like SEC (and you) to investigate and research thouroughly what the secure option is… we shouldn't wait too long to run it, as it could imply redoing work if we decide to pivot. My gut tells me that a smaller attack surface (a-la supabase style) would be easier to audit and test thouroughly… but this is not my core expertise."

Today (SECURITY R-2, T-18): row-level security enforces access, and the app asserts identity. `poly_app` (web) and `poly_worker` set `app.user_id` themselves, so SQL injection or code execution in either process can act as any user. BetterAuth runs inside the web app and reads the session table as `poly_app`. R-2 records the earlier judgement that binding the setting to a database-verified session token "would gain little".

Run it soon. POLY-89, POLY-137, POLY-144 and POLY-129 all build on the current identity path, so each one that lands first raises the cost of a pivot. The lead's sequencing proposal: this issue runs directly after POLY-142 merges and ahead of POLY-89.

seceng drives. The architect prices the rework and the topology. The lead gives the Principal an independent read of the result. This issue ships a decision record, not product code.

## Acceptance criteria

- [x] A threat model for the identity assertion alone: who the attackers are, and what each can do today from the web process, the worker process (which parses untrusted provider and import data), a stolen database credential, and a stolen session. — process/cairn/reviews/POLY-145/threat-model.md: scenarios S1 to S8
- [x] At least these options are compared, each against the same attack scenarios: (a) today's design with its mitigations; (b) Postgres verifies a signed token whose signing key the web app and worker do not hold, with sign-in moved to a small separate service; (c) a thin generic data-access layer in front of Postgres, Supabase and PostgREST style; (d) one database role per user; (e) any stronger option the research finds. — process/cairn/reviews/POLY-145/comparison.md: §1 reach per scenario; options.md
- [x] For each option: what it stops and what it does not, in plain words; the size of the code that must be trusted and how it would be audited and tested; what it does to the worker and to operator paths such as POLY-142's. — process/cairn/reviews/POLY-145/comparison.md: §2 to §4
- [x] How Supabase, and at least one other widely used system, actually do this is taken from their own documentation or source, cited, and dated. Nothing about them is stated from memory. — process/cairn/reviews/POLY-145/prior-art.md: every claim cited and dated 2026-11-13
- [x] The architect prices each option: rework to shipped issues (POLY-86, POLY-87, POLY-142), changes to the backlog (POLY-89, POLY-137, POLY-144, POLY-129), and running cost on one VPS. — process/cairn/reviews/POLY-145/pricing.md: §2 and §3; current-state.md
- [x] How the answer changes between a single-family self-hosted instance and a hosted, multi-family one (SECURITY R-6). — process/cairn/reviews/POLY-145/comparison.md: §5; pricing.md: §6
- [x] seceng's recommendation and the architect's are stated separately, each named as theirs. The lead's independent read is a third section. — process/cairn/reviews/POLY-145/seceng-recommendation.md, architect-recommendation.md, lead-read.md
- [x] The Principal decides. The decision is logged in `process/DECISIONS.md`, and R-2 is re-worded, kept, or retired to match. If the decision is a pivot, the rework is filed as issues with their order. — process/DECISIONS.md: 2026-11-13 entry; docs/SECURITY/index.html: R-2 (1.9.18); POLY-146 to POLY-149

## Output

`process/cairn/reviews/<this issue>/` for the research record; SECURITY and ARCH change only after the Principal decides.

## Open at this issue's start

- Whether POLY-89 waits for this decision (the lead recommends yes).

## Comments

### @team-lead — 2026-11-12

Feature started. Branch: `feature/poly-145-identity-trust-boundary`. The Principal confirmed at the start that POLY-89 waits for this decision; POLY-89 is now blocked by this issue.

### @team-lead — 2026-11-13

Decision (Principal, 2026-11-13): option (e1) is the target, in the lead's order. POLY-89 waited for this decision and now waits on stage 1 (POLY-147).

Acceptance criteria, with where each is met (all under `process/cairn/reviews/POLY-145/` unless named):
1. Threat model: `threat-model.md` (S1 to S8).
2. Options compared against the same scenarios: `options.md`, `comparison.md` §1 and §2; (a), (a+), (b), (c), (d1), (d2), (e1) to (e4).
3. Per option, what it stops, trusted code, audit and test, worker and operator: `comparison.md` §2 to §4.
4. Supabase and others from their own sources, cited and dated: `prior-art.md` (Supabase, PostgREST, Neon pg_session_jwt, Hasura, PostgreSQL, BetterAuth 1.7.18). The lead re-fetched the Supabase `auth.uid()` source.
5. Pricing: `pricing.md`, `current-state.md`.
6. Single-family against hosted: `comparison.md` §5, `pricing.md` §6.
7. Three recommendations, each named: `seceng-recommendation.md`, `architect-recommendation.md`, `lead-read.md`. Independence caveat: seceng told the architect their lean before the architect's file was written; both record it.
8. Decision logged in `process/DECISIONS.md` (2026-11-13). R-2 re-worded in SECURITY 1.9.18. Rework filed in order: POLY-146, POLY-147, POLY-148, POLY-89, POLY-149; notes on POLY-64, POLY-98 and POLY-137.
