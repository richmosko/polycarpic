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

**Definition of done:** a user signs in (BetterAuth, one OAuth provider + email), creates an entity, and grants another user a viewer membership. The RLS battery is green in CI, including the inversion self-test and the pool-reuse test. Migrations apply in CI and on staging through the real runner as `poly_migrator`. The app shell renders DESIGN tokens.

**Stories:** POLY-62. **Enablers:** the Drizzle migration-tool spike (ARCH §6.2) comes first. The monorepo skeleton + layer-boundary lint, `packages/db` `withTenant`, and the staging compose deploy get filed at milestone decomposition.
