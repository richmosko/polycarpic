---
id: POLY-81
title: Admin view (SSH-only box/stack status)
status: backlog
milestone: POLY-1.2
parent: null
blocked_by: []
assignee: null
paths: [docs/PRD/**, docs/ARCH/**, docs/SECURITY/**, docs/DESIGN/**]
labels: [product, infra, security]
priority: null
pr: null
created: 2026-10-02
updated: 2026-11-10
---

An operator-only Admin view, reachable only through an SSH tunnel to the box (never on the public listener), showing basic box and stack status with links to administrative functions still to be defined. Principal direction 2026-10-02 during the Plan-phase DESIGN review: "I want a placeholder for this in UX, pending definition in PRD/ARCH/SEC."

## Context

Not a sidebar item and not part of the primary IA (DECISIONS 2026-10-02). It is a separate surface for the operator of a self-hosted instance. The DESIGN placeholder styled screen (`docs/DESIGN/styled-screens/admin.html`, pass 13) exists first; It sits in POLY-1.2 (Principal, 2026-11-09); PRD, ARCH and SECURITY define it before any build work starts.

## Acceptance criteria

- [ ] PRD: a short functional requirement naming the Admin view, who uses it (the operator), how it is reached (SSH tunnel to a loopback-bound listener), and the first status set (services up/down, versions, DB and backup status, last sync, receiver/engine state).
- [ ] ARCH: the surface's topology (loopback bind, separate route group or process, what it reads), and its place in §2.4 and §7.
- [ ] SECURITY: trust boundary, authn (SSH as the gate, plus any in-app check), what it must never expose (credentials, raw provider payloads), audit of admin actions.
- [ ] DESIGN: placeholder styled screen promoted to a defined screen once the above exist.
- [ ] Milestone confirmed or moved by the architect once defined (placed in POLY-1.2 on 2026-11-09).

## Comments

### @team-lead — 2026-11-10

Carried from POLY-85 (status listener lands in `apps/web/src/ops/`, ruling R4; POLY-81 moves it to the admin service). Two not-gating items from that loop: (1) architect verdict @ ebfe633 — `status.ts` falls back to `process.env.STATUS_PORT` when no port is passed; `main.ts` passes `config.statusPort`, so drop the fallback in the move. (2) seceng concurrence @ 2463be2 — check the `Host` header on the listener against DNS rebinding through the operator's tunnel (TB-13). Also from seceng: refuse a secret file that is not a regular file, with a size cap, so `/dev/zero` cannot hang check-config — that one belongs to `packages/config`, place it with the next config touch if not here.
