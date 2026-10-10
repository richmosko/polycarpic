---
id: POLY-1.0
name: Tax, Sharing & Real Data (GA)
kind: product
major: POLY-V1
status: planned
target_tag: v1.0.0
ga: true
---

**Layers:** L5 tax, L6 shared-access experience, L2 first real-data adapter (docs/ARCH §2.1, §11).

**Definition of done (GA, tags v1.0.0):** the estimated-tax accrual, safe harbor and period freezes are correct against the federal and California tables, and the 2210 / Schedule AI export works. A household member with a viewer grant sees exactly what their memberships allow. The Principal runs at least one entity end to end on real data (PRD goal 1). The Playwright smoke suite is green on prod.

**Stories:** POLY-66, POLY-70, plus the real-data import adapter issue (ARCH OQ-7).
