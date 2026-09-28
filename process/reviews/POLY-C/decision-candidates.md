---
kind: deliverable
target: process/DECISIONS.md
topic: Plan-phase GL build-vs-adopt + migration tool decision candidates (architect)
---

Source: docs/ARCH/index.html §6 (branch phase/plan-arch). Team-lead words the ledger entries; text below is the proposed substance.

## General ledger — build a home-grown double-entry schema (not adopt a library)

**Decision.** The GL is a home-grown schema in our Postgres: entity-scoped chart of accounts, multi-leg journal entries with signed `numeric` lines carrying `currency / native_amount / base_amount / fx_rate`, a deferred constraint trigger enforcing Σ base_amount = 0 per entry, append-only triggers on posted rows, reversal-only corrections.
**Why.** No candidate library fits. pgledger (the only credible in-Postgres library) has no tenant column or RLS, models two-legged transfers rather than multi-leg entries, keeps one currency per account with no base/fx columns, and lacks a hierarchical CoA and versioned migrations. Adopting it means forking it into our design. TS ledger libraries are MongoDB-based (Medici) or external services (excluded by kickoff §2.5). mosko-fintech's journal is post-hoc grouping of single-entry legs under direct-owner tenancy, which is not a stored GL and not our tenancy model.
**Borrowed.** From pgledger: append-only entries as the source of truth. From mosko-fintech: immutability triggers (004), the append-only lot_match junction (032), price observations with source priority (019), unique-index de-dup (021), the RLS inversion self-test, and the NOLOGIN-owner migration ownership pattern.
**Cost accepted.** We own ledger correctness. Mitigations: DB-enforced invariants, property-based tests, the RLS battery in CI.

## Migration tool — Drizzle Kit, gated by a POLY-M1 spike; fallback dbmate + Kysely

**Decision.** Schema in Drizzle (TS). drizzle-kit generates SQL migrations committed to the repo; triggers, functions and roles go in hand-written custom SQL migrations in the same chain. A one-off migrate container applies them as `poly_migrator`, with objects owned by the NOLOGIN `poly_owner`. Same runner on VPS, in CI (fresh Postgres), and as a Vercel build step against Neon.
**Why.** One schema source for queries and migrations; RLS policies and roles declared in schema; BetterAuth's Drizzle adapter keeps auth tables in the same chain. mosko-fintech's incumbent (Supabase CLI `db push` over 120 plain-SQL files) assumes a Supabase stack we don't run. Its lessons carry over: a tracking table is mandatory, test through the real apply path, keep a distinct NOLOGIN owner.
**Gate.** The spike must show (a) pgPolicy round-trips with no spurious diff, (b) BetterAuth's schema migrates cleanly, (c) a trigger + SECURITY DEFINER custom migration applies as poly_migrator with poly_owner ownership and a tracking row written, (d) it runs against Neon. If (a) or (c) fails, switch to dbmate + Kysely codegen. That change is confined to packages/db.
