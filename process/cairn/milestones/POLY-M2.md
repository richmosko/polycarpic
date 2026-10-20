---
id: POLY-M2
name: Ledger & Import
kind: product
major: POLY-V1
status: planned
target_tag: null
ga: false
---

**Layers:** L2 import (raw) + fake adapter, L3 ledger, L4 posting (docs/ARCH §2.1, §11).

**Definition of done:** the fake persona 1 import lands raw rows (hash de-duped), and rules propose drafts. Confirming a draft posts a balanced entry, and posted rows reject UPDATE/DELETE at the DB. Corrections are reversal + new entry. Categories and tax-treatment tags apply.

**Stories:** POLY-64, POLY-65.
