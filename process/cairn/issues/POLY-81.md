---
id: POLY-81
title: Admin view (SSH-only box/stack status)
status: backlog
milestone: null
parent: null
blocked_by: []
assignee: null
paths: [docs/PRD/**, docs/ARCH/**, docs/SECURITY/**, docs/DESIGN/**]
labels: [product, infra, security]
priority: null
pr: null
created: 2026-10-02
updated: 2026-10-02
---

An operator-only Admin view, reachable only through an SSH tunnel to the box (never on the public listener), showing basic box and stack status with links to administrative functions still to be defined. Principal direction 2026-10-02 during the Plan-phase DESIGN review: "I want a placeholder for this in UX, pending definition in PRD/ARCH/SEC."

## Context

Not a sidebar item and not part of the eight-screen IA (DECISIONS 2026-10-02). It is a separate surface for the operator of a self-hosted instance. The DESIGN placeholder wireframe exists first; PRD, ARCH and SECURITY define it before it is scheduled into a milestone.

## Acceptance criteria

- [ ] PRD: a short functional requirement naming the Admin view, who uses it (the operator), how it is reached (SSH tunnel to a loopback-bound listener), and the first status set (services up/down, versions, DB and backup status, last sync, receiver/engine state).
- [ ] ARCH: the surface's topology (loopback bind, separate route group or process, what it reads), and its place in §2.4 and §7.
- [ ] SECURITY: trust boundary, authn (SSH as the gate, plus any in-app check), what it must never expose (credentials, raw provider payloads), audit of admin actions.
- [ ] DESIGN: placeholder wireframe promoted to a defined screen once the above exist.
- [ ] Milestone assigned by the architect once defined.
