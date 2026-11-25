# POLY-101 verdict (architect-101)

Build f18b6f70 (PR #158); gate record d23be899. **Overall: PASS** (V1 to V9), with the V8 flake and the notes below.
"Ran" = run by me in my worktree. "Record" = qa-101's `gate.md`, not repeated by me (it needs containers, or its outputs are in qa's worktree, which I did not read).

| Axis | Result | Evidence |
|---|---|---|
| V1 | PASS | Ran: the two `better-auth/adapters/drizzle` lines deleted, `boundaries.test.ts` 1 failed / 8 passed on the named test; restored. The named step runs that file (read). Step removed: pins red, record (`red-run.md`) |
| V2 | PASS | Ran: `changes.test.ts` green; read: 13 path cases, the B5 area cases, the manifest walk. Each dropped: record |
| V3 | PASS | Ran: `auth-row.test.ts` green; read: a case for every V3 fault, `.fails` after a call and `fails:` included, each asserting exit 1 and a reason. **Corrected:** I first passed this by reading, and missed that "one TLS mode only" stayed green with the describe match removed (seceng); fixed at 9d9fae20, its red on qa's record. F2 file-status case added. Ran at 9eaf595c: the real script on a real LINT report, `9 passed (floor 9)`; the floor is now 11 and `boundaries.test.ts` gives 11 passed (ran) |
| V4 | PASS | Read: one `routeDiff` serves the live-route test and the control; 404 asserted on both routes, over `auth.handler` and `handleAuthRequest`, with a hookless counterpart. Red cases and the HTTP 404: record |
| V5 | PASS on the record | One-offs (a) and (b), in both directions, with output paths. Nothing here checked by me |
| V6 | PASS | Ran: `aggregate.test.ts` green; based dispatch, any non-empty base, and the skipped-job cases read |
| V7 | PASS | Ran: `continue-on-error` on the lint step, an `if:` on the db step, `DISPATCH_BASE` removed, all three planted together: three pins red, one each; restored. The other pins (step order, `--affected`, distinct reports) read, not broken |
| V8 | PASS, with a flake noted | PR run 45664122857 on ae693858 (after f18b6f70: PDFs and tracker only), attempt 2: ten jobs green, `app` success. Logs read: LINT `11 passed (floor 11)`, RP `43 (43)`, POOL `40 (40)`. **Attempt 1's `db` job failed** on one test (1476 passed, 1 skipped): `tests/db/auth-service-main.test.ts`, `listen EADDRINUSE 0.0.0.0:41208`. This PR touches neither that file nor `apps/`. The rerun passed; the lead files the flake. It is not shown to be unrelated by anything beyond that |
| V9 | PASS | Same UTC day, one run each, so no trend is claimed. Full dispatch: lint 352 s against 418 s (control 45565943755), db 326 s against 374 s. PR run: db 389 s against 408 s (45568486194); lint 343 s against 202 s is **not comparable** (different filter). No slowdown seen where comparable. Diff against `main` is inside the issue paths, except the sub-issue records, `process/STATE.md` and the PDFs under `docs/` |

Ran: the five `tests/ci` files the row touches, green at f18b6f70 (481 passed). The container run was on 1cddc3af; since then no file the battery executes has changed except `auth-row.mjs` (floors), read by diff.

**Docs.** INFRA 1.3.32 says what was built (read); it names floors without numbers, and the numbers live in `auth-row.mjs`. ARCH 1.31.1 overstated the trigger ("a manifest") and did not say `.fails` or subpaths; 1.31.2 corrects both.

**Corrections to the ruling.** It names `refusedByHandle` as the first refusal; the refusal is `handleAuthRequestInner` (seceng, Part 3). G3's "(unmeasured)" 404 is now measured by qa.

**Not blocking.**
- N1: closed by two cases in `boundaries.test.ts` (subpath, and dynamic import bare and subpath).
- N2: criterion 1 rests on the control and one-off (a); no newer better-auth was installed (ruling §5).
- N3: condition 11's residue is open, for the Principal.
