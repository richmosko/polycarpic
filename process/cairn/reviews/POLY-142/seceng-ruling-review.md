# POLY-142 gate-1: security conditions (seceng)

Written before the ruling, so the architect can fold these in as numbered conditions. Each condition names the test that proves it. I read: the POLY-142 issue and the lead's kickoff comments; the POLY-87 ruling and my review; migrations 0001, 0003, 0005 and 0007; `context.ts`, `pool.ts`, `@poly/tenancy`'s `invitation.ts`, `@poly/config`'s `check.ts` and `registry.ts`; `apps/worker/src/main.ts`; `infra/compose/prod.yml`; SECURITY C-01, C-84, R-2, R-22 to R-24; INFRA §7.5 and the bootstrap step of the first-deploy runbook.

**Probes** (scratch `postgres:17.10`, removed afterwards; nothing tracked was changed):

- **Q1.** With a transaction holding `pg_advisory_xact_lock(142)`, a second transaction that sets `lock_timeout = '500ms'` fails on the same call with "canceling statement due to lock timeout" (`55P03`). So a function-level `SET lock_timeout` bounds the advisory wait.
- **Q2.** A plain `LOGIN` role with no grants can call `pg_try_advisory_lock(142)`. The advisory functions are EXECUTE to PUBLIC, so `poly_app` can take the bootstrap key and stall `--bootstrap`. That is a denial of service only, and Q1 bounds it.

## Threat review

1. **Who can issue.** The credential that issues is `poly_worker`'s. The worker process will also parse untrusted provider and import data. Code execution in the worker can already set `app.user_id` to any user and act as them under RLS, so minting a no-entity invitation gives it nothing new beyond one more account. The only extra harm is a new sign-up holding an empty Person. Accepting that requires that an operator invitation can never seat anything, now or in POLY-89 or POLY-90 (O3). R-2 names `poly_app` only. See Bubble-up.
2. **`withSystem` and the issuing definer share a role.** Without a guard, a job transaction (with `app.user_id` set to a job principal) could call `issue_operator_invitation`. The definer must refuse whenever `app.user_id` is set (O2), and the literal must be reserved to one file (O9).
3. **The audit actor must not come from the caller.** `poly_worker` can set `app.actor` to anything, for example `system:<job>`. The definer writes the literal `operator:cli` (O5).
4. **Bootstrap.** On an empty instance there is nothing to steal, and a stranger cannot win the first sign-up, because every user-creating route needs a live invitation (POLY-87 C23). What remains:
   - (a) the rule "once any user exists, a bootstrap invitation is dead" has to hold in `accept_invitations` too, where the sign-up's own user already exists (O6);
   - (b) the advisory-lock DoS from Q2 (O4);
   - (c) an instance whose users are all removed becomes empty again, and `--bootstrap` works again. That is the operator's power, and I accept it. Today nothing deletes a `user` row.
5. **The plaintext token on a terminal.** The Principal chose stdout. Where it can persist:
   - terminal scrollback, which is the operator's own box;
   - the container log driver, if the CLI runs as a container's PID 1 (`docker compose run`), because `json-file` keeps PID 1's stdout on disk;
   - the structured logger or the OTEL exporter, if the link goes through them.

   `docker compose exec` output reaches only the caller. `sudo` logs the command line (the email) to `auth.log`, never the output (O7, O8).
6. **The link's origin.** It must come from the validated `PUBLIC_ORIGIN` (https, origin only, `check.ts`), never from argv or an ad-hoc env var. Otherwise an operator could be talked into a link that points elsewhere (O8).
7. **The email argument.** `claim_invitations` matches on `lower(email)`. An address with CR/LF, control characters, spaces or no `@` gives a dead invitation at best and log or terminal injection at worst. The definer validates the address too, because `poly_worker` can call it directly (O10).
8. **Oracle.** The CLI exit codes tell the operator whether the instance is empty. Only the operator sees them. `poly_worker`'s existing `invitation_select` policy (`has_role(entity_id, 'owner')`) shows it 0 no-entity rows, because the operator transaction has no user (O2 test).

## Conditions

- **O1. `withOperatorTx`.**
  - It runs on `workerPool()` only. Its first statement asserts that `app.user_id` is empty, the same way `withContextFreeTx` does.
  - It sets only `app.actor = 'operator:cli'`, with `set_config(…, true)`.
  - It refuses to nest inside, or to wrap, `withTenant`, `withSystem` and `withContextFreeTx`.
  - Its handle has no `enterNewUser`.
  - **Tests:** a nesting matrix, all 4×4 pairs, each raising `NestedContextError`. On a pool of `max: 1`, `app.actor` and `app.user_id` read empty on the next checkout, after commit and after rollback. Calling `current_setting('app.user_id')` inside it reads empty.
- **O2. The definer refuses any user context.** `app.issue_operator_invitation` raises `42501` when `app.current_user_id()` is not null.
  - **pgTAP:** it fails under a `withSystem`-shaped context (`app.user_id` set as `poly_worker`), and it fails as `poly_app`, `poly_govern` and `poly_authz` (no EXECUTE).
  - `definers.json`: owner `poly_govern`, EXECUTE `["poly_worker"]`, `search_path = ''`.
  - `poly_worker` holds no INSERT or UPDATE on `invitation` or `audit_event` (`has_table_privilege` and `has_column_privilege`).
- **O3. Shape of an operator invitation.**
  - The definer writes `entity_id NULL`, `inviter_user_id NULL`, `role 'viewer'`, `expires_at = now() + interval '7 days'`, and an `issued_via` column set to `'operator'` or `'bootstrap'`. No caller parameter sets the expiry, the role or the entity.
  - `poly_app` has no INSERT or UPDATE on `issued_via`.
  - `poly_govern` gets column-exact INSERT on `invitation`, under one policy: `WITH CHECK (issued_via IN ('operator','bootstrap') AND entity_id IS NULL AND inviter_user_id IS NULL AND app.current_user_id() IS NULL)`. The claim and accept definers, which `poly_govern` also owns, cannot use it to write an entity invitation.
  - A check constraint: `issued_via IN ('operator','bootstrap')` implies `entity_id IS NULL AND inviter_user_id IS NULL`. It must not say the converse, that every no-entity row is an operator row: POLY-144 needs a no-entity row issued by a signed-in user.
  - **Tests:**
    - pgTAP: `expires_at - created_at = 7 days`;
    - a `poly_app` INSERT that supplies `issued_via` is refused with `42501`;
    - an UPDATE of `issued_via` by any role is refused;
    - the accepted operator invitation leaves `visible_entities()` at exactly one element, the Person.
- **O4. Serialisation.** `--bootstrap` takes `pg_advisory_xact_lock` on one fixed key inside the definer, under `SET lock_timeout = '5s'`, then re-checks that no user exists and revokes any unclaimed bootstrap row. A timeout exits 1 and writes nothing.
  - The `poly_govern` UPDATE policy that allows the revocation is limited to `USING (issued_via = 'bootstrap' AND claimed_at IS NULL)`, and the grant is `UPDATE (revoked_at)` only.
  - **Tests:**
    - two concurrent `--bootstrap` runs leave exactly one live bootstrap row;
    - a session holding the key as `poly_app` makes `--bootstrap` exit 1 within 6 s;
    - pgTAP: no `poly_govern` UPDATE policy on `invitation` lets `revoked_at` change on a non-bootstrap row, or on a claimed one;
    - S10's set-once still refuses un-revoking.
- **O5. Audit.** One `audit_event` per issue (`invitation.issued`) and one per bootstrap revocation (`invitation.revoked`). Each is written inside the definer in the same transaction, with `actor` set to the literal `'operator:cli'`, `actor_user_id` null and `entity_id` null.
  - The payload carries the invitation id and `issued_via` only, never the token, the hash or the email.
  - **Tests:**
    - with `app.actor` forged to `system:x`, the row still says `operator:cli`;
    - the payload's keys are exactly `{invitation_id, issued_via}`;
    - a forced failure after the insert leaves neither row.
- **O6. The bootstrap rule in both claim and accept.**
  - `claim_invitations` refuses a bootstrap row when any `user` exists.
  - `accept_invitations` refuses one when any `user` other than `app.current_user_id()` exists. The rows it re-selects must match the claim's predicate.
  - **Tests:**
    - a bootstrap sign-up succeeds on each of the three `USER_INSERTING` routes;
    - with one user seeded by a superuser, a live bootstrap invitation is refused on all three routes, the token-less ones included, and no user row is left;
    - a plain operator invitation still works with users present.
- **O7. Token output.**
  - The CLI generates the token with `randomBytes(32)`, encodes it canonically, and passes only `hashInvitationToken(token)` to the database.
  - It writes the link with one `process.stdout.write`, only after `COMMIT` has returned.
  - The link never goes through `createLogger`, OTEL attributes or stderr.
  - **Tests:**
    - stdout has exactly one line containing the token, and the stored hash equals `hashInvitationToken` of it;
    - captured logger output, stderr and any span attributes contain neither the token nor the link, on success and on every refusal;
    - a forced failure at commit prints no link and exits 1;
    - the query log of the test cluster contains no 43-character token, and the hash appears only as a bind parameter.
- **O8. Origin and execution.**
  - The link is `<config.publicOrigin>/sign-up?invitation=<token>`, from `loadConfig('worker')`. No argv flag or extra env var changes it.
  - `PUBLIC_ORIGIN` must be registered for `worker` if it is not already.
  - **Test:** setting `BETTER_AUTH_URL` or `ORIGIN` to another value does not change the printed origin.
  - **INFRA (devops):** `polycarpic-ops cli` uses `docker compose exec -T worker …`, never `run`.
- **O9. Confinement.**
  - `@poly/db/operator` is importable only from `apps/worker/src/cli/**` (`confined` key; the POLY-140 C1 forms: relative path, re-export, dynamic import).
  - `issue_operator_invitation` joins the reserved literals, allowed only in the one file under `packages/db` or `apps/worker/src/cli` that wraps it. The S7 forms apply: escaped literals, `eval` and `new Function`.
  - **Tests:** red and green lint cases, as in POLY-87 C20 and C21.
- **O10. Email validation in two places.**
  - The CLI and the definer both refuse: more than 254 characters; any character in `[\x00-\x20\x7f]`; anything other than exactly one `@` with non-empty sides. The CLI exits 1 and writes nothing. The definer raises `22023`.
  - The stored email is lower-cased.
  - **Tests:** a table of bad addresses, against the CLI and against the definer, called directly as `poly_worker`.
- **O11. Closure, replacing POLY-87 C23's second and third bullets.**
  - pgTAP finds INSERT on `invitation` only for `poly_app`, under the owner policy, and for `poly_govern`, through an INSERT policy reachable only from `issue_operator_invitation`.
  - The `pg_proc` scan finds exactly one `app` function whose body inserts into `invitation`, and none that inserts into `public."user"`.
  - On a fresh instance, the plain invite exits 2 and writes nothing, and `--bootstrap` on a non-empty one exits 2 and writes nothing, the audit included.

## SECURITY doc edits (mine, after the ruling)

- **C-01:** the operator invitation's shape (O3), the bootstrap rule (O4, O6), the link printed once to stdout, the 7-day expiry, and the test list.
- **C-84:** reworded. `db/auth` and `db/operator` are the two context-free paths, and only `db/auth` can set `app.user_id` (through the step). Add `withOperatorTx`'s guarantees (O1, O2).
- **C-15:** the allowlist entry for the new definer.
- **New threats** (T-98 and up):
  - a worker or job transaction issues invitations (O2);
  - the link persists in container logs or telemetry (O7, O8);
  - the bootstrap is stalled or replayed after the instance has users (O4, O6).

## POLY-144 (the in-app instance invite)

- **Closes no door it needs**, as long as O3's constraint is one-directional. POLY-144 adds a third `issued_via` value, written by its own definer with `inviter_user_id = app.current_user_id()`. It must not reuse `issue_operator_invitation`: O2 makes that impossible, and that is intended.
- **Opens none it should not**, as long as POLY-144's caller cannot write `issued_via` (O3).
- **POLY-144 needs a "who may invite to the instance" rule.** Nothing in the schema says who the instance's operator user is. The bootstrap claimant can be derived (`issued_via = 'bootstrap'`, and `claimed_user_id` is set once). So bootstrap rows must never be deleted or purged, and no cleanup job may touch them.
- **Email delivery from web** puts the plaintext token through Resend. That is a T-95 / R-22 matter for POLY-144's own review, not this loop's.

## Bubble-up

- **R-2 covers `poly_app` only.** Code execution in the worker can already forge `app.user_id` as `poly_worker`, and now it can also issue no-entity invitations. My recommendation: widen R-2 to name `poly_worker`, with the same rationale and mitigations plus O2, O3 and O5. That is a change to an accepted risk, so it needs the Principal's approval.
- **INFRA is stale for this loop.** §7.5 and the first-deploy bootstrap step both say "an email to them". After this loop the CLI prints the link and sends nothing. That is devops's edit, plus O8's `exec` rule.
