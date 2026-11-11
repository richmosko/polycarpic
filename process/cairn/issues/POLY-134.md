---
id: POLY-134
title: Shell security follow-ups
status: backlog
milestone: POLY-M1
parent: null
blocked_by: []
assignee: frontend-lead
paths: [apps/web/**, scripts/layers/**, tests/layers/**, docs/SECURITY/**, docs/PRD/**]
labels: [frontend, security]
priority: null
pr: null
created: 2026-11-10
updated: 2026-11-10
---

Non-blocking follow-ups from the POLY-128 loop, batched: seceng's pre-merge review (`reviewed @ 5229d9b`, `@ daac457`, `@ 89f020a`) and one doc line the loop could not touch. None is reachable by a user until POLY-88 serves the shell.

## Acceptance criteria

- [ ] The CSP test compares each directive exactly, so a loosened directive fails; today it checks three substrings (`frame-ancestors 'none'`, `object-src 'none'`, no `'unsafe-inline'` in `script-src`).
- [ ] Lint refuses the other HTML-injection routes in `.svelte` files, `innerHTML` and `bind:innerHTML`, with fail fixtures beside the `{@html}` ones (SECURITY C-41).
- [ ] `hooks.server.test.ts` covers the `sidebar:state` cookie as it covers `poly-theme`: hostile values are never echoed into the page, and the placeholder is never left in it.
- [ ] The test for SvelteKit's cross-origin form check (a forged form post is refused, SECURITY C-06) exists; it lands with the first route that changes data, and this criterion names that issue when it is known.
- [ ] PRD says eight sidebar items, with Tax, matching DESIGN §5.10 and ARCH §2.4 (`docs/PRD/index.html` still says "seven nav items"). The product-manager owns that line.
