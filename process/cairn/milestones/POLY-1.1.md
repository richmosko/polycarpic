---
id: POLY-1.1
name: Consolidated Roll-up
kind: product
major: POLY-V1
status: planned
target_tag: v1.1.0
ga: false
---

**Layers:** L5 reports (roll-up totals), L6 parent-entity views (docs/ARCH §2.1, §3.3, §11).

**Definition of done (tags v1.1.0):** a parent-entity viewer sees consolidated totals equal to the sum of the entities beneath it, each base entity counted once at any nesting depth, with class totals plus income and expense by top-level category for entities the viewer holds no membership on (Principal, 2026-11-06). A drill into an included entity stops at its boundary unless the viewer holds membership there. The parent-entity holdings popover (DESIGN, Allocation) lists base-entity accounts under that rule.

**Stories:** POLY-118 (parent roll-up: `app.rollup_totals`, the consolidated view, the holdings popover), POLY-119 (economic view; unaffected by tax classification, Principal 2026-11-08). Planned as the quick follow-up immediately after POLY-1.0 (Principal, 2026-11-06); the schema (parent link + membership) ships in POLY-M1.
