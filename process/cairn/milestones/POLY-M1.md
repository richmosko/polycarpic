---
id: POLY-M1
name: Foundations
kind: product
major: POLY-V1
status: planned
target_tag: null
ga: false
---

**Layers:** L0 platform, L1 identity & tenancy, L6 app shell (docs/ARCH §2.1, §11).

**Definition of done:** a user signs in (BetterAuth, one OAuth provider + email), creates an entity, and grants another user a viewer membership. The RLS battery is green in CI, including the inversion self-test and the pool-reuse test. Migrations apply in CI and on staging through the real runner as `poly_migrator`. The app shell renders DESIGN tokens. The second-step gate holds, with first enrolment anchored on the account email; a held raise promotes on enrolment; a two-owner entity's gated actions are refused until POLY-1.0 ships the approval flow (decomposition 2026-11-08).

**Stories:** POLY-62, POLY-87 (invite-only sign-up), POLY-88 (Google + GitHub), POLY-89 (second step), POLY-91 (held raise), POLY-129 (Entities screen: create, members, invite; gap filed 2026-11-09), POLY-133 (shell entity selector), POLY-134 (shell security follow-ups; reachable since POLY-161 serves the shell).

**Enablers:** POLY-76 (migration spike) first, then POLY-82 (monorepo + layer lint), POLY-83 (roles, migrate, withTenant), POLY-84 (RLS battery), POLY-85 (runtime config + ops hooks), POLY-86 (BetterAuth routing pool + allowlist), POLY-90 (multi-owner gate + founder), POLY-128 (app shell + DESIGN tokens; gap filed 2026-11-09).

**Operations:** POLY-95 (compose + Postgres config), POLY-96 (CI build + attest), POLY-97 (provisioning), POLY-98 (ops CLI), POLY-99 (backup scripts), POLY-100 (deploy), POLY-101 (auth CI row), POLY-102 (freshness gate), POLY-104 (first staging deploy), POLY-105 (backup first-run checks), POLY-160 (deploy follow-ups), POLY-161 (web server in the release image), POLY-162 (deploy test passing end to end).

**Close:** POLY-106 (M1 integration check, ARCH §11).

**Regrouped 2026-11-25** (Principal; `process/DECISIONS.md`): POLY-92 moved to POLY-1.2, POLY-93 to POLY-1.0, POLY-94 to POLY-1.1, POLY-103 and the prod gates to POLY-M6 (Production readiness), POLY-131 and POLY-143 to POLY-D. The definition of done above is unchanged; it ends at staging.

**Filing rule:** a follow-up is filed in the milestone whose gate it serves, never in the milestone of the loop that found it. This milestone takes a new issue only if its definition of done cannot be met without it; anything else is filed as a later milestone's issue, or in POLY-D if it is tooling.
