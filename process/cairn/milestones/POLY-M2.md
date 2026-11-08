---
id: POLY-M2
name: Ledger, Import & Dashboard
kind: product
major: POLY-V1
status: planned
target_tag: null
ga: false
---

**Layers:** L2 import (raw) + fake adapter, L3 ledger, L4 posting, L6 first screens (docs/ARCH §2.1, §11).

**Definition of done:** the fake persona 1 import lands raw rows (hash de-duped), and rules propose drafts. Confirming a draft posts a balanced entry, and posted rows reject UPDATE/DELETE at the DB. Corrections are reversal + new entry. Categories and tax-treatment tags apply. The per-entity dashboard renders the posted entries in under 2 s at single-household scale.

**Stories:** POLY-64, POLY-65, POLY-63 (in that order: the dashboard needs posted entries to show). With POLY-M1 this is the first Implement slice (Principal, 2026-11-06).

**Hash chain (Principal, 2026-11-07):** the per-entity ledger hash chain and its weekly verifier ship with the ledger (SECURITY C-24, docs/ARCH §3.2.9); its story is filed at decomposition.
