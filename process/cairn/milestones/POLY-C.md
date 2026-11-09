---
id: POLY-C
name: Plan
kind: process
major: POLY-V1
status: in-progress
target_tag: null
ga: false
---

**Definition of done:** ARCH + SECURITY + INFRA approved; design system encoded in `docs/DESIGN/`; GL build-vs-adopt and migration-tool research concluded; product milestones created in `milestones/` + GA designated; first session planned.

**Gate issues** (filed 2026-11-09; Plan doc edits stay doc updates, these track the exit criteria):

- POLY-123 — throwaway UX prototype at `prototype/` (frontend-lead; ux-designer reviews)
- POLY-124 — GL build-vs-adopt decision (architect; ARCH §6.1)
- POLY-125 — migration-tool decision, provisional pending the M1 spike POLY-76 (architect; ARCH §6.2)
- POLY-126 — first Implement session planned (team-lead)
- POLY-127 — Plan gate review: ARCH + SECURITY + INFRA + DESIGN approved (team-lead; blocked by the four above)

**Already done:** product milestones POLY-M1…M5, POLY-1.0 and POLY-1.1 exist with `target_tag` set; POLY-1.0 is the GA milestone (`ga: true`, tags `v1.0.0`).
