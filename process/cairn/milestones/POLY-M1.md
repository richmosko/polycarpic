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

**Stories:** POLY-62, POLY-87 (invite-only sign-up), POLY-88 (Google + GitHub), POLY-89 (second step), POLY-91 (held raise), POLY-92 (.local sign-in), POLY-93 (cap table), POLY-94 (parent placement consent).

**Enablers:** POLY-76 (migration spike) first, then POLY-82 (monorepo + layer lint), POLY-83 (roles, migrate, withTenant), POLY-84 (RLS battery), POLY-85 (runtime config + ops hooks), POLY-86 (BetterAuth routing pool + allowlist), POLY-90 (multi-owner gate + founder).

**Operations:** POLY-95 (compose + Postgres config), POLY-96 (CI build + attest), POLY-97 (provisioning), POLY-98 (ops CLI), POLY-99 (backup scripts), POLY-100 (deploy), POLY-101 (auth CI row), POLY-102 (freshness gate), POLY-103 (monitoring), POLY-104 (first staging deploy), POLY-105 (backup first-run checks).

**Close:** POLY-106 (M1 integration check, ARCH §11).
