# POLY-142 ruling (gate 1): operator invite CLI

Architect, read at 9d58648. seceng-142's conditions O1–O11 (`seceng-ruling-review.md` @ 9400c41) are folded in; the table at the end says where each one went. Each claim is marked **read** (with its file), **measured** (with the command), or **(unmeasured)**. An unmeasured claim is a condition a red test settles; no build step rests on it alone.

## R0. What this loop ships, and what waits for POLY-98

- **Ships:** the command `polycarpic cli user invite <email> [--bootstrap]`, run inside the worker image. The image dispatcher `bin/polycarpic` gains one entry, `cli`, which runs `apps/worker/src/cli/main.ts`. Every later operator subcommand in INFRA §7.5 (`user reset-mfa`, `membership remove-owner`, `secrets rotate`) hangs off that one entry, so the dispatcher does not grow per command.
  - The name moves from the issue's `polycarpic user invite` to `polycarpic cli user invite`. That matches INFRA's "`polycarpic cli` subcommands" (read, `docs/INFRA/index.html` §9.3) and maps one-to-one onto `polycarpic-ops cli user invite`. Criterion 1 is amended in place.
- **Waits for POLY-98:** the host wrapper `polycarpic-ops cli …`, which becomes `docker compose exec -T worker /app/bin/polycarpic cli …` and never `run` (O8). Nothing in this loop touches `infra/`.
- **How it runs in this loop:** tests run the command two ways.
  - In-process, through the exported `runUserInvite` (R5), against a cloned database as `poly_worker`.
  - As a child process, through `sh bin/polycarpic cli user invite …`, which proves the dispatch, the configuration refusal and the exit codes.
  - On a box before POLY-98, the operator would run `docker compose exec -T worker /app/bin/polycarpic cli user invite …`. Today that exits 1 at the configuration check, because the worker service in `infra/compose/prod.yml` sets no `DATABASE_*` or `PUBLIC_ORIGIN` (read). That refusal is correct, and the service environment belongs to POLY-97.

## R1. Schema

**0008 (generated from `schema/tenancy.ts`).**
- New column `invitation.issued_via text NOT NULL DEFAULT 'owner'`.
- Check `invitation_issued_via_check`: `issued_via IN ('owner', 'operator', 'bootstrap')`.
- Check `invitation_operator_shape_check`: `issued_via = 'owner' OR (entity_id IS NULL AND inviter_user_id IS NULL AND role = 'viewer')`. It is one-directional: an operator row has no entity, but a no-entity row need not be an operator row, which POLY-144 needs (O3).
- `poly_app`'s INSERT column grant (read, `0003_tenancy_rules.sql:305`) does not name `issued_via`, so an owner-issued row always takes `'owner'`. No role gets UPDATE on `issued_via`.

**0009 (custom, the 0003/0007 pattern; every function has `SET search_path = ''` and an entry in `packages/db/sql/definers.json`).**
- `app.issue_operator_invitation(text, bytea, boolean) RETURNS TABLE (o_invitation_id uuid, o_expires_at timestamptz)`, owner `poly_govern`, EXECUTE `poly_worker` alone (R2).
- `CREATE OR REPLACE` of `app.claim_invitations` and `app.accept_invitations` with the bootstrap predicate (R2). Owners, grants and every other clause stay as built.
- A partial unique index `invitation_one_live_bootstrap` on `((true)) WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL`. The database then holds at most one unclaimed, unrevoked bootstrap row, whatever the lock does.
- **`poly_govern` grants:** `INSERT (email, role, token_hash, expires_at, issued_via)` and `UPDATE (revoked_at)` on `invitation`.
- **`poly_govern` policies on `invitation`:**
  - `invitation_operator_issue FOR INSERT TO poly_govern WITH CHECK (entity_id IS NULL AND inviter_user_id IS NULL AND issued_via IN ('operator', 'bootstrap') AND role = 'viewer' AND app.current_user_id() IS NULL)`;
  - `invitation_bootstrap_revoke FOR UPDATE TO poly_govern USING (issued_via = 'bootstrap' AND claimed_at IS NULL) WITH CHECK (issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NOT NULL)`.
  - Permissive policies OR together. A claim UPDATE by `accept_invitations` still passes the existing `claimed_user_id = app.current_user_id()` check; the new policy only adds the revoke of an unclaimed bootstrap row. `invitation_set_once()` keeps `revoked_at` set-once (read, 0007).
- `poly_worker` gets nothing new. It keeps its column SELECT on `invitation` (read, `0003:298–299`) and holds no INSERT or UPDATE on `invitation` or `audit_event`.

## R2. The definers

**`issue_operator_invitation(p_email, p_hash, p_bootstrap)`**, with `SET lock_timeout = '2s'`, in this order:
1. Raise `42501` if `app.current_user_id()` is not null. This refuses any `withSystem` or tenant context (O2).
   - `app.actor` is not read. `poly_worker` can set it to anything, so it proves nothing, and the definer writes its own literal (O5).
2. Raise `22023` unless `p_email` is at most 254 characters, contains no character in `[\x00-\x20\x7f]`, and has exactly one `@` with something on both sides (O10). The row stores `lower(p_email)`. The 32-byte hash is enforced by the existing check (`23514`).
3. `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app.issue_operator_invitation', 0))`. Every call takes it, bootstrap or not.
   - Any role can take that key (seceng Q2), so a `poly_app` session can stall the issuer. That is denial of service only. `lock_timeout` bounds it at 2 s, and the CLI exits 1 (seceng Q1 measured the bound).
   - The wait it normally covers is milliseconds: another issuer, or a sign-up holding a bootstrap row's lock across password hashing (unmeasured; C4 and C10 measure it).
4. With `p_bootstrap`:
   - Revoke every row with `issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL` (`revoked_at = now()`), writing one `invitation.revoked` audit row for each.
   - **Then** raise `55000`, message `instance_not_empty`, if any `public."user"` row exists (`SELECT u.id`; `poly_govern` holds that column, read 0007).
   - The revoke comes first on purpose. If a sign-up holds that row's lock, the UPDATE waits for its commit, and the next statement takes a new snapshot (READ COMMITTED), sees the new user and refuses. The whole call then rolls back, revoke and audit included. (unmeasured; C4 measures it)
5. Without `p_bootstrap`: raise `55000`, message `instance_empty`, if no `user` row exists.
6. Insert the row: the email, role `viewer`, `p_hash`, `expires_at = now() + interval '7 days'`, and `issued_via` set to `'bootstrap'` or `'operator'`. No parameter sets the expiry, the role or the entity.
7. Insert `audit_event` with `entity_id` null, `actor_user_id` null, `actor` the literal `'operator:cli'`, `kind 'invitation.issued'`, `subject_user_id` null, and payload exactly `{invitation_id, issued_via}` (O5). There is never a token, hash or email in the payload.
8. Return the id and the expiry.

**`claim_invitations`** adds `AND (i.issued_via <> 'bootstrap' OR NOT EXISTS (SELECT u.id FROM public."user" u))`.
**`accept_invitations`** adds the same predicate with `WHERE u.id <> v_uid`, because by then this transaction's own user exists (O6). Accept still re-selects exactly the rows claim would lock (POLY-87 R2).

## R3. `withOperatorTx` (`@poly/db/operator`)

- `context.ts` gains a fourth kind, `withOperatorTx`, so the existing nesting check refuses all 4 × 4 pairs (O1).
- `withOperatorTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>` runs on `workerPool()`.
  - Setup: assert that `app.user_id` is empty (`ContextNotEmptyError`, the `withContextFreeTx` check), then `set_config('app.actor', 'operator:cli', true)`. Nothing else is set.
  - It takes no argument besides `fn`, and its handle has no `enterNewUser`.
  - The actor setting exists for the database's own logs. The definer does not trust it.
- New file `packages/db/src/operator.ts` re-exports `withOperatorTx` and `close`, so the CLI can end the pool. It is the subpath `./operator` in `packages/db/package.json` and in `layers.json`.
- `@poly/db`, `/auth`, `/session`, `/migrate` and `/startup` do not export it. The confinement rule cannot see a re-export out of `context.ts`, so C11 tests the export surface.

## R4. Tenancy

- `packages/tenancy/src/invitation.ts` gains:
  - `newInvitationToken(): { token: string; hash: Buffer }`: `randomBytes(32)`, canonical base64url, hashed through `hashInvitationToken` (O7);
  - `invitationLink(origin: string, token: string): string`, which returns `<origin>/sign-up?invitation=<token>`;
  - `validOperatorEmail(s: string): boolean`, the O10 rule, which the CLI uses.
- New file `packages/tenancy/src/operator-invitation.ts`: `issueOperatorInvitation(tx, { email, bootstrap })` returns `{ token, invitationId, expiresAt }`.
  - It is the one file holding the literal `issue_operator_invitation`. Seceng's O9 placed the literal in `packages/db` or the CLI; tenancy is where the other invitation definer literals live, and the rule is the same.
  - It maps `55000`, by message, to `InstanceStateRefused` with reason `'not_empty'` or `'empty'`. Every other error is rethrown unchanged.
  - Only the hash is sent to the database. The token never appears in a query's text or parameters.

## R5. The CLI

- `apps/worker/src/cli/main.ts`:
  - The argv grammar is `user invite <email> [--bootstrap]`: exactly one positional, with `--bootstrap` before or after it. Anything else, or an email that fails `validOperatorEmail`, prints usage to stderr and exits 1, and nothing connects.
  - Then `loadConfig('worker')`. That is the full check, so the worker's `DATABASE_*` and `PUBLIC_ORIGIN` are validated before any pool exists (`PUBLIC_ORIGIN` is checked for every service; read, `check.ts:121–139`). On failure: `config.refused` lines on stderr, exit 1.
  - Then `assertSchemaNotBehind('worker')`; on failure exit 1.
  - Then `runUserInvite`, `close()`, and `process.exit(code)`. The logger is created with stderr as its stream.
- `apps/worker/src/cli/user-invite.ts` exports `runUserInvite({ email, bootstrap }, { stdout, stderr, origin }): Promise<0 | 1 | 2>`. It is the only file that imports `@poly/db/operator`. `origin` is `config.publicOrigin` and nothing else: no flag and no other variable (O8).
  - **stdout:** one `write` of `invitationLink(origin, token) + '\n'`, made only after `withOperatorTx` has resolved, which means after COMMIT returned. Nothing else is ever written there (O7).
  - **stderr:** a human line, `invitation recorded (<bootstrap|operator>), expires <ISO>`, and one log line, `invitation.issued {outcome: 'ok', invitation_id, issued_via}`. The token, the link, the hash and the email never go through the logger or stderr. No span is created.
  - **Exit codes:**
    - 0: issued;
    - 2: `InstanceStateRefused`, with one stderr line, `refused: the instance already has a user` or `refused: the instance has no user; use --bootstrap`;
    - 1: anything else (usage, configuration, schema guard, `42501`, `22023`, `55P03`, `23505`, a failed commit), as one stderr line without SQL text.
- `bin/polycarpic` gains `cli) exec node "$here/apps/worker/src/cli/main.ts" "$@" ;;`, and its usage line names `cli`.
- `apps/worker/package.json` gains `@poly/tenancy`.

## R6. Confinement (`layers.json`, generated)

- `packages.db.subpaths` gains `"./operator"`. `packages.worker.allow` gains `"tenancy"` and `"db/operator"`.
- `confined` gains `"packages/db/src/operator.ts": ["apps/worker/src/cli/user-invite.ts"]`.
  - The rule matches exact files (read, `scripts/layers/plugin.mjs:391`), so the caller is one named file. That is narrower than O9's `apps/worker/src/cli/**`, and criterion 6 is amended in place.
  - Each later subcommand that needs the wrapper is added by name, which makes it a review point.
- `reservedLiterals` gains `"issue_operator_invitation": ["packages/tenancy/src/operator-invitation.ts"]`. The S7 forms (escapes, `eval`, `new Function`) are already covered by the POLY-87 rules.
- The plugin itself does not change.

## R7. Tests and cost

| File | Area | Covers | Cost (unmeasured) |
|---|---|---|---|
| `tests/db/operator-invite.test.ts` (new) | `auth` | C1–C10 | ≤ 7 s file time: two `cloneMigrated` databases, about four BetterAuth sign-ups, two child processes, one 2 s lock wait |
| `tests/db/pgtap/06_operator_invitation.sql` (new; run by `pgtap.test.ts`) | `tenancy` | C12–C15 | ≤ 1 s |
| `tests/db/wrappers.test.ts` (edited) | `tenancy` | C11 | ≤ 1 s |
| `tests/layers/` fixtures | lint job | C16 | lint job |
| `tests/image/dockerfile.test.ts` (edited: `cli` in the dispatch list) | node | C9 | 0 |

- **Clone sharing.** `operator-invite.test.ts` uses one clone in order (empty → C3 → C4 → C1 → C2 → C5 → C10), plus a second empty clone for the token-less bootstrap success in C1. The config-refusal child process needs no database.
- **No new area.** The issue proposed an `operator` area, and the cost of one is out of proportion:
  - it changes the `changes` job's outputs and `ci.yml` (read: lines 159–162, 186 and 539–542), and five `tests/ci` files that pin the area list;
  - its tests also need BetterAuth sign-up and `@poly/tenancy`, which the `auth` area already has.
  - So `operator-invite.test.ts` joins `auth`:
    - `DB_AREAS.auth.paths` and `TABLE.db` each gain `^apps\/worker\/src\/cli\/`, `^apps\/worker\/src\/startup\.ts$`, `^apps\/worker\/package\.json$` and `^bin\/polycarpic$`;
    - `tests/ci/db-filter-imports.test.ts` adds `apps/worker/src/cli/main.ts` to its roots;
    - `tests/ci/db-areas.test.ts` adds the file to its `auth` pin.
  - This loop does not edit `.github/workflows/`.
- **Guard (the POLY-87 wording):**
  - Measure the branch head against main at the merge base, in the same session, n ≥ 3 each, on the battery-step median.
  - The cap is +9 s, the table's estimate rounded up. The new file runs in the parallel group, so the makespan delta should be less (unmeasured).
  - Over the cap, the loop cuts its own files: fewer sign-ups, or shared clones. Suite-wide cuts are POLY-143's. The 100 s job budget stays a warning on main.
- This branch touches `packages/db/**`, which is in `DB_SHARED`, so CI runs every area on it (read, `changes.mjs:9`).

## R8. Room for POLY-144 (not built)

- POLY-144's caller is a signed-in user under `withTenant`, as `poly_app`, with delivery by email. It gets its own definer, with EXECUTE `poly_app`, its own rate limit and its own audit, and `inviter_user_id = app.current_user_id()`. It cannot reuse `issue_operator_invitation`, because O2 refuses any user context, and that is intended.
- What it reuses: `newInvitationToken`, `invitationLink`, no-entity acceptance, and the `issued_via` column. POLY-144 widens the column's check with a new value in its own migration. The one-directional shape check (R1) already admits a no-entity row with an inviter.
- What it must keep: bootstrap rows are never deleted or purged. The bootstrap claimant (`issued_via = 'bootstrap'`, `claimed_user_id`) is how a later rule can tell who the instance's operator user is (seceng).
- Nothing here takes a delivery argument. The CLI's stdout is its delivery.

## R9. Paths outside the issue's `paths`

`bin/polycarpic`. Everything else is already covered: `tests/**`, `infra/ci/**`, `apps/worker/**`, `packages/db/**`, `packages/tenancy/**`, `layers.json`, and `scripts/layers/**` for the generated lint config.

## Conditions (each becomes a red test for qa and a build target for backend-lead)

**Step 1: schema and definers (0008, 0009)**
1. **First user.**
   - On an empty instance, `--bootstrap` exits 0. Its link signs up through `/sign-up/email`, and that user has their own Person only.
   - On the second empty clone, a bootstrap invitation is claimed by a verified, token-less mocked Google callback.
   - After the first user exists, `--bootstrap` exits 2, and the counts of `invitation` and `audit_event` rows are unchanged.
2. **Plain invite.** On a non-empty instance, the plain invite exits 0 and writes:
   - one row: `issued_via 'operator'`, `entity_id` and `inviter_user_id` null, role `viewer`, email lower-cased;
   - one `audit_event`: `kind 'invitation.issued'`, `entity_id` null, `actor 'operator:cli'`, `actor_user_id` null, payload keys exactly `{invitation_id, issued_via}`.

   Signing up with its link leaves `visible_entities()` with one element, the Person.
3. **Empty instance.** The plain invite exits 2 and writes nothing, the audit included.
4. **Re-issue and concurrency.**
   - A second `--bootstrap` on an empty instance revokes the first. The first row's `revoked_at` is set, one `invitation.revoked` audit row names it, its link is refused 403, and exactly one row is live.
   - Two concurrent `--bootstrap` runs on separate connections both exit 0, and exactly one live bootstrap row remains. Without the advisory lock, the unique index would fail one run with `23505`, so both exiting 0 proves the lock.
5. **The bootstrap rule (O6).** With one user seeded by the superuser, a live bootstrap invitation planted by the superuser is refused on all three `USER_INSERTING` routes (`/sign-up/email` with its token; the Google callback and `/magic-link/verify` token-less), and no user row is left. A token-less verified sign-up for an email holding both a planted bootstrap row and a live operator row claims the operator row only.

   Successful bootstrap on the token-less routes is shown on one route (C1). The predicate is the same SQL for every route, and POLY-87 C6 covers each route's plumbing. This narrows O6's "each of the three".

**Step 2: CLI behaviour**
6. **Link.** stdout is exactly one line matching `^<PUBLIC_ORIGIN>/sign-up\?invitation=[A-Za-z0-9_-]{43}\n$`, and `hashInvitationToken` of the token equals the row's `token_hash`. With `BETTER_AUTH_URL` and `ORIGIN` set to other values, the printed origin is still `PUBLIC_ORIGIN` (O8).
7. **The token goes nowhere else (O7).** Across C1–C4, a refused run and a failed one, the token and the link appear in:
   - no captured stderr or logger line;
   - no column of the `invitation` or `audit_event` rows;
   - no text or parameter recorded by a spy on the pool client's `query`. This replaces O7's query-log check: the database is never sent the token, so there is nothing for its log to hold.

   A forced failure at commit (a deferred trigger planted by the test) prints no link and exits 1.
8. **Expiry.** `expires_at - created_at = interval '7 days'` exactly, for both kinds.
9. **Exit codes and argv.**
   - Each bad argument exits 1 with nothing on stdout: no email, two emails, an unknown flag, and O10's table of bad addresses (255 characters; a CR, LF, NUL, space or DEL; no `@`; two; an empty side).
   - Through `sh bin/polycarpic cli user invite …` with `DATABASE_HOST` unset: 1, a `config.refused` line on stderr, and no connection attempt.
   - Through the same entry, a successful plain invite: 0 and one stdout line.
10. **Lock bound (O4).** A `poly_app` session holding the advisory key makes `--bootstrap` exit 1 within 3 s and write nothing.

**Step 3: the wrapper**
11. **`withOperatorTx` (O1).**
    - All 4 × 4 nesting pairs throw `NestedContextError`.
    - Inside it, `current_user` is `poly_worker`, `app.actor` is `operator:cli`, and `app.user_id` is empty. Its handle has no `enterNewUser`.
    - After commit and after rollback, the next checkout from a `max: 1` pool reads both settings empty.
    - The export surfaces of `@poly/db`, `/auth`, `/session`, `/migrate` and `/startup` contain no `withOperatorTx`.

**Step 4: catalog (pgTAP 06)**
12. **Who may call (O2).**
    - `issue_operator_invitation` raises `42501` under a `withSystem`-shaped context (`poly_worker` with `app.user_id` set) and with `app.user_id` forged.
    - It is refused for lack of EXECUTE as `poly_app`, `poly_govern` and `poly_authz`.
    - With `app.actor` forged to `system:x` and no user, it succeeds, and the audit row says `operator:cli` (O5).
    - The definer refuses O10's bad addresses with `22023`.
    - `definers.json` lists it as owner `poly_govern`, EXECUTE `["poly_worker"]`, and `search_path = ''` (the C-15 check).
13. **Grants and shape (O2, O3).**
    - `poly_worker` holds no INSERT or UPDATE on `invitation` or `audit_event`, whether on the table or on any column (`has_table_privilege`, `has_column_privilege`).
    - `poly_govern`'s INSERT columns on `invitation` are exactly R1's.
    - A `poly_app` INSERT that supplies `issued_via` is refused `42501`, and no login role can UPDATE `issued_via`. An owner-issued row reads `'owner'`.
    - A superuser insert of an operator row with an `entity_id`, an `inviter_user_id`, or role `owner` fails `23514`. A second live bootstrap row fails `23505`.
14. **Revocation scope (O4).** No `poly_govern` UPDATE policy lets `revoked_at` change on a non-bootstrap row or a claimed bootstrap row. S10's set-once still refuses un-revoking.
15. **Closure (POLY-87 C23 as changed by B; O11).**
    - On a freshly migrated database with no user, every `USER_INSERTING` route is refused, and no `user` row exists afterwards.
    - INSERT on `invitation` is held only by `poly_app` (under the owner policy) and by `poly_govern` (under `invitation_operator_issue`).
    - The `pg_proc` scan finds exactly one `app` function whose body inserts into `invitation` (`issue_operator_invitation`) and none that inserts into `public."user"`.

**Step 5: lint (O9)**
16. Each of these is red, in every form POLY-140 C1 covers:
    - `@poly/db/operator` imported from `apps/worker/src/main.ts`, `apps/worker/src/cli/main.ts` or `packages/tenancy/src/x.ts`;
    - `./operator.ts` imported by `packages/db/src/index.ts`;
    - the literal `issue_operator_invitation`, plain or escaped, outside its file.

    The same import from `user-invite.ts`, and the literal in `operator-invitation.ts`, are green.

## Seceng's conditions: where each one went

| O | Ruling | Where |
|---|---|---|
| O1, O3, O11 | Accepted as written | R1, R3; C2, C11, C13, C15 |
| O2 | Accepted. The definer checks only the user context; it does not check the actor. | R2 step 1; C12, C13 |
| O4 | Accepted, with `lock_timeout` at 2 s instead of 5 s, so C10 costs 2 s. The issuer's normal wait is milliseconds (unmeasured; C4 measures it). | R2 step 3; C4, C10, C14 |
| O5 | Accepted: separate `invitation.revoked` rows, and the payload is exactly `{invitation_id, issued_via}` | R2 steps 4 and 7; C2, C4, C12 |
| O6 | Accepted for the rule. The success test covers two routes, not three (C5 says why); the refusal test covers all three. | R2; C1, C5 |
| O7 | Accepted. The query-log check is replaced by a spy on the client's queries. | R4, R5; C6, C7 |
| O8 | Accepted. `PUBLIC_ORIGIN` is already checked for the worker (read, `check.ts:121`). `exec -T` is POLY-98's. | R0, R5; C6 |
| O9 | Accepted, with one named caller file instead of a glob | R6; C16 |
| O10 | Accepted, in both places, with the email lower-cased | R2 step 2, R4, R5; C9, C12 |

## Review checklist (pre-registered; read at the build check, at the build-green sha)

| # | Check | Evidence I will read |
|---|---|---|
| A1 | 0008 is generated: `check-migrations` is clean, and the snapshot holds `issued_via` and both checks | `migrations/0008_*.sql`, `meta/` |
| A2 | 0009 matches R1–R2: the order (user check → email → lock → revoke → user check → insert → audit), `lock_timeout 2s`, `search_path`, the grants, the two policies verbatim, the unique index | `0009_*.sql`; `definers.json` |
| A3 | Claim and accept differ from 0007 only by the bootstrap predicate | a diff of the function bodies |
| A4 | `withOperatorTx` is a fourth `Kind`, sets one setting and runs on `workerPool`; no other entry point exports it | `context.ts`, `operator.ts`, `index.ts`, `package.json` |
| A5 | One `stdout.write` (the link), after the wrapper resolves; the logger goes to stderr; no token, link or email in any log call | `apps/worker/src/cli/*.ts` |
| A6 | Exit-code mapping: only `InstanceStateRefused` gives 2 | `user-invite.ts` |
| A7 | `layers.json` keys as R6; the generated config is fresh; no plugin change | `layers.json`, `scripts/layers/` |
| A8 | The CI map as R7, with no `.github/workflows` diff | `changes.mjs`, `git diff --stat main...` |
| A9 | The timing guard against a same-day control | the lead's numbers at gate 3 |
| A10 | ARCH §3.1c, §3.3 and the `packages/db` row describe the four wrappers, the operator path and `issued_via` (I edit ARCH at the build check) | `docs/ARCH/index.html` |

**Doc follow-ups, not this loop's build:**
- SECURITY C-01, C-84 and C-15, and new threats from T-98 on, are seceng's (`seceng-ruling-review.md`, "SECURITY doc edits").
- INFRA §7.5 and the first-user runbook step say the invite sends an email. After this loop it prints the link once, and the wrapper must use `exec -T`. That text is the INFRA owner's.
