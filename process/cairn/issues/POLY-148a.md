---
id: POLY-148a
title: Spike predicates and review
status: done
milestone: POLY-M1
parent: POLY-148
blocked_by: []
assignee: seceng
paths: [spikes/POLY-148/checks/**, process/cairn/reviews/POLY-148/**, process/cairn/issues/POLY-148.md, process/cairn/issues/POLY-148a.md]
stage: execute
estimate.cost_usd: "6.00"
estimate.gate_cycles: 2
actual.cost_usd: "8.4747"
actual.tokens: 19274856
actual.gate_cycles: 2
actual.wall_clock: 40
ratio: "1.41"
labels: [security, auth, spike]
priority: null
pr: null
created: 2026-11-15
updated: 2026-11-15
---

seceng writes, before the harness exists, one executable check per measurable item of POLY-148 under `spikes/POLY-148/checks/`, so the builder does not grade their own work. Each check states its command and predicate and exits non-zero with a named reason until the spike satisfies it. seceng then reviews each result and owns the security reading in the record.

## Acceptance criteria

- [x] One check per POLY-148 item (session handle per sign-in path, same-origin service and its grant list, cookie scope, sign-in pages, magic link and second factor), each asserting against real responses, cookies or the database catalog, never a file's presence.
- [x] A single entry point runs them all and prints pass or fail per item; with no spike present every check fails for its stated reason, and that run is recorded in a comment on this issue.
- [x] A short README states the contract the harness must expose (commands, ports, role names) and nothing more.
- [x] After the build, seceng's review of each result is in `process/cairn/reviews/POLY-148/spike.md`, including the `__Host-` versus `__Secure-` trade-off and any gap handed to POLY-89.

## Comments

### @seceng — 2026-11-15

Checks written before the harness: `spikes/POLY-148/checks/` (contract in README.md, record requirements in RECORD.md). Entry point `node spikes/POLY-148/checks/run.mjs`.

**Red run, no harness present (2026-11-15):** 34 lines, 34 FAIL, 0 PASS, exit 1. Every line fails for the same named reason: Caddy :58480, web :58481 and the service :58482 refuse connections, and container `poly148-pg` does not exist. Lines: H 14 (one per session-creating path, plus sign-out and forgery), S 11, C 4, M 3, P 2 (report only).

The pure parts were checked against independent oracles: TOTP matches the RFC 6238 vector, the software passkey verifies under `@simplewebauthn/server` 13.3.3, and the cookie jar applies the RFC 6265 path and prefix rules. Every other predicate is exercised for the first time against the harness.

H covers six session-creating routes the issue does not list, read from the 1.7.18 dist: sign-up, backup code, two-factor disable, change-password, passkey sign-in, and passkey registration with createSession.
