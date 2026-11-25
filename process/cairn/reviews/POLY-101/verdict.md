# POLY-101 verdict (architect-101)

Build 9eaf595c; gate record dbf156d2; read at 9e3ee1b2. **V1 to V7: PASS. V8, V9: PENDING** (run 45661985841). No overall verdict until those are in.
"Ran" = run by me in my worktree. "Record" = qa-101's `gate.md`, not repeated by me (it needs containers, or its outputs are in qa's worktree, which I did not read).

| Axis | Result | Evidence |
|---|---|---|
| V1 | PASS | Ran: the two `better-auth/adapters/drizzle` lines deleted, `boundaries.test.ts` 1 failed / 8 passed on the named test; restored. The named step runs that file (read). Step removed: pins red, record (`red-run.md`) |
| V2 | PASS | Ran: `changes.test.ts` green; read: 13 path cases, the B5 area cases, the manifest walk. Each dropped: record |
| V3 | PASS | Ran: `auth-row.test.ts` green; read: a case for every V3 fault, `.fails` after a call and `fails:` included, each asserting exit 1 and the named reason. Ran: the real script on a real LINT report, `9 passed (floor 9)` |
| V4 | PASS | Read: one `routeDiff` serves the live-route test and the control; 404 asserted on both routes, over `auth.handler` and `handleAuthRequest`, with a hookless counterpart. Red cases and the HTTP 404: record |
| V5 | PASS on the record | One-offs (a) and (b), in both directions, with output paths. Nothing here checked by me |
| V6 | PASS | Ran: `aggregate.test.ts` green; based dispatch, any non-empty base, and the skipped-job cases read |
| V7 | PASS | Ran: `continue-on-error` on the lint step, an `if:` on the db step, `DISPATCH_BASE` removed, all three planted together: three pins red, one each; restored. The other pins (step order, `--affected`, distinct reports) read, not broken |
| V8 | PENDING | Run 45661985841 is a `workflow_dispatch` full run on 9e3ee1b2. It can show `lint`, `db`, `app` green and the row's lines; the pull request's own run is still needed for the merge |
| V9 | PENDING | Timing against a same-day control; diff against `main` is inside the issue paths except the sub-issue records (read) |

Ran: five `tests/ci` files together, 478 passed. Both floors commits after the container run touch only `auth-row.mjs` and its test (read, `--stat`).

**Docs.** INFRA 1.3.32 says what was built (read); it names floors without numbers, and the numbers live in `auth-row.mjs`. ARCH 1.31.1 overstated the trigger ("a manifest") and did not say `.fails` or subpaths; 1.31.2 corrects both.

**Corrections to the ruling.** It names `refusedByHandle` as the first refusal; the refusal is `handleAuthRequestInner` (seceng, Part 3). G3's "(unmeasured)" 404 is now measured by qa.

**Not blocking.**
- N1: adapter subpaths are refused (ran: one static and one dynamic import, both errors), but no standing test covers the subpath patterns; B4 asked for the package alone.
- N2: criterion 1 rests on the control and one-off (a); no newer better-auth was installed (ruling §5).
- N3: condition 11's residue is open, for the Principal.
