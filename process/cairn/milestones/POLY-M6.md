---
id: POLY-M6
name: Production readiness
kind: product
major: POLY-V1
status: planned
target_tag: null
ga: false
---

**Layers:** L0 platform, L1 identity, the edge (docs/ARCH §2.1, §11).

**Definition of done:** every condition on opening prod to the internet and on holding real household data is met and shown on staging or a test box. The edge limits, the maintenance page and the monitoring hold under abuse and failure. A bad migration can be rolled back by copying a pre-migration backup back into prod, and the off-box bucket check runs daily. The auth gates for a second person are in. Prod is not deployed here: prod accepts only a `v1.*` tag, which is POLY-1.0's, and no real data is loaded before the restore drill (POLY-116) passes (`process/DECISIONS.md`, 2026-11-06).

**Target:** ready by 2026-12-13 (lead's estimate, 2026-11-25; a readiness date, not a prod-open date). Runs after POLY-M1; it does not block POLY-M2.

**Operations:** POLY-163 (edge limits at Caddy), POLY-157 (prod maintenance page), POLY-158 (rollback: copy back into prod), POLY-159 (daily off-box bucket check), POLY-103 (monitoring, heartbeat, alerts), POLY-156 (edge follow-ups 2), POLY-135 (CodeQL scanning), POLY-165 (deploy follow-ups: before prod; split from POLY-160).

**Identity:** POLY-155 (auth follow-ups 2; its gate part is the operator's second-step reset with the owner's email, the per-email sign-in limit, the reused-code refusal, the lock notice and the recent-changes view; the cut is confirmed by seceng at its ruling).

**Filing rule:** a follow-up is filed in the milestone whose gate it serves, never in the milestone of the loop that found it. A milestone takes a new issue only if its definition of done cannot be met without it; anything else is filed as a later milestone's issue, or in POLY-D if it is tooling.
