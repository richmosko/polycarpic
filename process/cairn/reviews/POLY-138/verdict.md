# POLY-138 verdict (architect)

Build read at `e98cc512c0e1ab76e4d104f424031b7a1bfaa0a6`, against `ruling.md` (R1–R10, addenda 1–2).

**Verdict: held.** The APPROVE line is written once qa's final delta at `e98cc512`, seceng's delta review of finding 3 and CI on
`e98cc512` are in. Every axis below is a pass except those three, which are pending.

| Axis | Result | Evidence (sha) |
|---|---|---|
| Caddyfile = ruled text (R1–R4) + R10 | pass, direct: the non-comment lines equal the target block plus the `(no_store)` snippet and its two imports, each right after `import security_headers` | `e98cc512` |
| `renovate.json` = R8 | pass, direct: parsed JSON equal to the ruled block | `e98cc512` |
| Caddy FROM digests (addendum 2), xcaddy `--replace` kept (R7) | pass, direct | `e98cc512` |
| Postgres 17.12 @ `b60e9004…`, hold before upgrade in both Dockerfiles (R6) | pass, direct | `e98cc512` |
| `.dockerignore` names and order (R9) | pass, direct | `e98cc512` |
| Compose-policy lint, CI's env | pass, direct: `compose-policy: clean`, exit 0; `lint-edge.test.ts` 51/51 | `e98cc512` |
| Suites, lint, typecheck; container tests (R1, R2, R3, R10, R6 `server_version`, R7 x/net and checksum env) | pass, from qa: all green; the three `postgres.test.ts` failures are POLY-143's, matched on a `main` control | `gate.md` @ `4b98851c` / `eb3e43fd` / `bb728fa6`; final delta @ `e98cc512` **pending** |
| Security review | pass on every ruled item, from seceng; findings 1–2 on `check-report.sh` met | `build-review.md` @ `36fe64dc`; finding 3 delta **pending** |
| CI | green at `4b98851c` (run 44926953668), from the lead | run on `e98cc512` **pending** |
| Image-job guard | **re-ruled: +44 s accepted** (see below) | `gate.md` @ `eb3e43fd` |
| Arch drift | pass: no new top-level job beyond D1(b)'s `renovate-check.yml`; the Caddy and lint changes stay in their files | `e98cc512` |
| ARCH current | updated: the client address, "Secrets in URLs" (R3's path-segment rule) and the web↔auth network sentence | this commit |
| Docs carry current state only | pass: ARCH, INFRA, SECURITY diffs state the rule, with no history | `e98cc512` |

## Image-job guard

The ruling's +30 s was tagged `(unmeasured)`. qa measured +44 s (88 s against a 44 s same-day control on `main`, three runs each).
Accepted at the measured number: +44 s is the guard from here, and growth past it reopens the guard. Reason: the remainder is the two
stack-level R3 cases, each waiting out `lb_try_duration 10s` on a failing upstream, plus four containers. Those cases gate nothing
(addendum 1), but they are the only check that the real stack writes no request URI on a 502. The isolated test cannot see that,
because it runs without `handle_errors`. The image job runs only on infra and image changes. A cut would save about 10 s and lose that check.

## Taken from others, not re-run

Container tests, suite runs and timings (qa). The reading of the security controls (seceng). CI (the lead). D2 is built as ruled and still awaits the Principal.

## Follow-ups (the lead files after merge)

F1 (drop xcaddy when a release carries x/net ≥ 0.62.0; until then the `--replace` version itself is unwatched, per seceng's note),
F3 (Renovate coverage for Node, pnpm, Actions), F4 (maintenance page), F5 (deploy shows the real client address), F6 (`auth` trusts
the header only from Caddy's fixed address). F2 is closed by addendum 2; F7 lapsed when D3 was taken.
