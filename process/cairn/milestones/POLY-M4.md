---
id: POLY-M4
name: Securities & Market Data
kind: product
major: POLY-V1
status: planned
target_tag: null
ga: false
---

**Layers:** L2 refdata (EOD prices, CPI-U), L3 securities sub-ledger, L5 portfolio (docs/ARCH §2.1, §11).

**Definition of done:** persona 3 (buys, sells, dividends, return of capital) produces correct lots, lot matches and book value, and is valued at the daily EOD price. The allocation view compares holdings against targets. Any time-series chart toggles real vs nominal on CPI-U.

**Stories:** POLY-67, POLY-69, POLY-75. ARCH OQ-5 (EOD price provider) must be answered at the start.
