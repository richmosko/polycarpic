---
id: POLY-120
title: Home box first deploy
status: backlog
milestone: POLY-1.2
parent: null
blocked_by: [POLY-97, POLY-98]
assignee: devops-engineer
paths: [infra/home/**, infra/ca/**, process/cairn/reviews/**]
labels: [ops, security, post-ga-candidate]
priority: null
pr: null
created: 2026-11-08
updated: 2026-11-08
---

Post-GA, in POLY-1.2 (Principal, 2026-11-09); timing not yet set. GA runs on the Hetzner VPS (lead ruling, 2026-11-08). INFRA §3.5, §7.2, §7.3: the home-box scripts and the proofs needed before any real data there: OQ-INFRA-10 (TPM-unlocked encrypted root on Ubuntu 24.04, candidate A then B; SECURITY H1), OQ-INFRA-2 (signed PCR policies), and in private-CA mode OQ-INFRA-3 / R-20 (browser name-constraint enforcement).

## Acceptance criteria

- [ ] §7.2 step 6 checks 1–4 pass (hands-off reboot, cold start, kernel-update reboot, provision-check --disk); step 7 stops at the console with Secure Boot off.
- [ ] nftables, outbound and IPv6 checks pass; an outside-in scan from mobile data shows nothing open.
- [ ] OQ-INFRA-2, -3 and -10 results are recorded in INFRA; if neither unlock method works, stop and return to SecEng and the Principal.
- [ ] Automatic reboot stays off until check 3 passes.
