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

**Definition of done (GA, tags v1.0.0):** the estimated-tax accrual, safe harbor and period freezes are correct against the federal and California tables, and the 2210 / Schedule AI export works. A household member with a viewer grant sees exactly what their memberships allow. The Principal runs at least one entity end to end on real data (PRD goal 1). Co-owner approval and the founder's force work end to end; an entity purges with its guards and an account deletes in-flow. The restore drill (POLY-116) passes. The Playwright smoke suite is green on prod.

**Stories:** POLY-66, POLY-113 (period close + tax true-up), POLY-70, POLY-112 (co-owner approvals + founder; the M1 gate refuses until then, lead ruling 2026-11-08), POLY-114 (entity purge + former holder), POLY-115 (account deletion), POLY-77 (file import as the real-data path), POLY-93 (cap table; built first, since POLY-66, 112, 113 and 114 need it), POLY-144 (in-app instance invite), POLY-154 (trust this device), POLY-139 (sign-in and sessions screens; before any second person signs in).

**GA gates:** POLY-116 (restore drill), POLY-117 (capacity + cost), POLY-164 (first prod deploy; blocked by every issue of POLY-M6 and by POLY-106).
