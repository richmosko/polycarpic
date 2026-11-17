# POLY-89 — architect verdict (POLY-89e)

*Moved verbatim from the comment on POLY-89 (architect, 2026-11-16) to keep the issue file under its size cap.*

**Verdict (POLY-89e): approve at code sha 4ef344212d4c2ec37321f9e248c24f61e03f5152.** seceng-89's build review accepted it, and its delta sign-off closes N1, N2 and N5 (`build-review.md`, "Delta at 4ef34421", @ 03d8dbca). I read the code: 0012, 0013, `packages/auth` (anchor, hooks, route policy, handler, session), web's gate and placeholder, the reset CLI and its wrapper, and the named tests. I did not rely on the reports alone.

| Axis | Result | Evidence |
|---|---|---|
| R1.1 identity | holds. Every guard reads `app.current_user_id()`. The reset refuses a marker. No `app.*` setting is read. | 0013; gates "R1.1/R1.5" catalog |
| R1.2 / C13 session id narrows only | holds. Forge cases (a), (b) and (c) are refused; (d) passes by design. | gates "C13/R1.2" |
| R1.3 roles, as amended | holds. Invoker guards pass `poly_govern` and a `current_user` superuser. The definer guards pass only a `session_user` superuser with no `SET ROLE`. That `role` survives a definer call was measured. | 0013:360, 383, 409; qa "R1.3 amended" |
| R1.4 / C14 no new poly_app grant | holds. The flag is written only by `set_two_factor_enabled` (exact-call); `user_30` refuses any other write; `_91` checks at commit. | gates "C14"; flow "R3 #1 and #3 on the statement" |
| R1.5 exact call, with the 7 exempt helpers | holds; the set is pinned. | gates:582-592 |
| R1.6 locks | holds. FOR UPDATE / FOR SHARE, then read in a later statement. Both two-connection races pass. | challenge "race 2", gates "C10 races" |
| R2 / C3, C8 anchor | holds. Password or a session under 5 minutes old, then the emailed code. Code-only, hashed, session-bound. 3 per 15 minutes and 10 wrong per 24 hours. A wrong code commits its attempt through the `x-poly-commit` header, which applies to confirm-code 403s only and is stripped from the response (mutation-checked by qa). | anchor.ts, handler.ts; challenge "C8" |
| R3 #1/#3 hooks / C15 | holds. Keys are returned as `undefined`; the statement test pins the 1.7.18 merge. | user-hooks.ts; flow:90, :286 |
| R3 #5/#6/#7 factor rows, D1 (b) | holds. The unmarked writes allowed are counters on a verified row, a counter that never goes down, and `backup_codes` (D1, Principal). | 0013:622-728; gates |
| R3 #8 / C7 single writer | holds. The writer computes for the row's own user, so a reset clears it. | gates "C7" |
| R3 #10/#11 / C2 seats and invites | holds. | gates "C2" |
| R3 route policy, S16/S17 | holds. `createSession` and non-totp `method` are refused 400; `otpOptions` refuses startup. | route-policy.ts, index.ts; tests |
| R4 / C1, C10 one predicate | holds. `own_person_exempt` → `second_step_needed` → `second_step_required` is the only gate read; no TypeScript re-derives it. | 0013:65-100; session.ts |
| R5 gate / C4, C5 | holds. A 303 to `/settings/second-step` carries the refreshed cookie (N5). Google is held and never stamped. | hooks.server.ts; flow "C4", "C5" |
| R6 / C6 reset-mfa | holds. Lower-cased; 0 matches exits 2; more than 1 refuses (N2); deletes factors, sessions, grants, challenges and trust rows; writes the audit event and a notification. | 0013:524-563; reset suite; e2e "C6" |
| C12 ARCH, criterion 16 id_token | holds. ARCH is updated at this push for N2 and the gate's cookie. The account hook returns `idToken: null`, measured on the stored row. | ARCH §3.1c; flow "criterion 16" |
| Suites | db 660, ci+layers 1062, e2e 55, lint and typecheck clean, all at 4ef34421 | qa build-green |

**Findings. None blocks.**
1. **Criterion 14's text is stale.** "The role that runs BetterAuth must hold UPDATE on the column" no longer holds: R1.4 grants no role UPDATE. The guard it asks for is built. Read the criterion through R1.4.
2. **R7 listed three e2e tests; two were built (C1, C6).** C4/C5 (enrolled user held at `/sign-in`) is proved in `tests/db` through the real handler, not in the browser. The lead's browser check covers the gap for this PR.
3. **`membership_seat_claimed` (0013:20) is broader than its one caller needs.** It lets any `poly_govern` definer insert a manager or owner row for the marker's user on any entity. Only `seat_claimed_invitations` uses it today. Follow-up (POLY-91 touches the same seat): make the policy require a claimed, unaccepted invitation for that entity, user and role.
4. **The reset's count and its FOR UPDATE select are two statements.** A case-variant insert between them is theoretical; this is an operator path. No action.
5. The db suite is about +17 s (+32%) for +147 tests against a same-day control, with two serial files. That is POLY-143's to judge.
