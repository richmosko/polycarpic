# POLY-142 ruling (gate 1): operator invite CLI

Architect, read at 9d58648. Each claim is marked **read** (with its file), **measured** (with the command), or **(unmeasured)**. An unmeasured claim is a condition a red test settles; no build step rests on it alone. **Status: draft for seceng-142's review. It gates once seceng's addendum is folded in.**

## R0. What this loop ships, and what waits for POLY-98

- **Ships:** the command `polycarpic cli user invite <email> [--bootstrap]`, run inside the worker image. The image dispatcher `bin/polycarpic` gains one entry, `cli`, which runs `apps/worker/src/cli/main.ts`. Every later operator subcommand (INFRA §7.5: `user reset-mfa`, `membership remove-owner`, `secrets rotate`) hangs off that one entry, so the dispatcher does not grow per command.
  - The name moves from the issue's `polycarpic user invite` to `polycarpic cli user invite`. This matches INFRA's "`polycarpic cli` subcommands" (read, `docs/INFRA/index.html` §9.3) and maps one-to-one onto `polycarpic-ops cli user invite`. Criterion 1 is amended in place.
- **Waits for POLY-98:** the host wrapper `polycarpic-ops cli …` (it becomes `docker compose exec worker /app/bin/polycarpic cli …`). Nothing in this loop touches `infra/`.
- **How it runs in this loop:** tests run the command two ways. In-process, through the exported `runUserInvite` (R5), against a cloned database as `poly_worker`. As a child process, through `sh bin/polycarpic cli user invite …`, which proves the dispatch, the configuration refusal and the exit codes. On a box, before POLY-98, an operator could run `docker compose exec worker /app/bin/polycarpic cli user invite …`. Today that exits 1 at the configuration check: the worker service in `infra/compose/prod.yml` sets no `DATABASE_*` or `PUBLIC_ORIGIN` (read). That is the correct refusal, and the service environment belongs to POLY-97.

## R1. Schema

**0008 (generated from `schema/tenancy.ts`).**
- New column `invitation.issued_via text NOT NULL DEFAULT 'owner'`.
- Check `invitation_issued_via_check`: `issued_via IN ('owner', 'operator', 'bootstrap')`.
- Check `invitation_operator_shape_check`: `issued_via = 'owner' OR (entity_id IS NULL AND inviter_user_id IS NULL AND role = 'viewer')`. This is the role rule for operator rows that POLY-87 R1 left to this loop.
- `poly_app`'s INSERT column grant (read, `0003_tenancy_rules.sql:305`) does not name `issued_via`, so an owner-issued row always takes `'owner'`. No grant changes here.

**0009 (custom, the 0003/0007 pattern; `SET search_path = ''` on every function; each one also goes in `packages/db/sql/definers.json`).**
- `app.issue_operator_invitation(text, bytea, boolean) RETURNS TABLE (o_invitation_id uuid, o_expires_at timestamptz)`, owner `poly_govern`, EXECUTE `poly_worker` alone (R2).
- `CREATE OR REPLACE` of `app.claim_invitations` and `app.accept_invitations`, adding the bootstrap predicate (R2). Their owner, grants and every other clause stay as built.
- A partial unique index `invitation_one_live_bootstrap` on `((true)) WHERE issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL`. The database itself then holds at most one unclaimed, unrevoked bootstrap row, whatever the lock does.
- **`poly_govern` grants:** `INSERT (email, role, token_hash, expires_at, issued_via)` and `UPDATE (revoked_at)` on `invitation`.
- **`poly_govern` policies on `invitation`:**
  - `invitation_operator_issue FOR INSERT TO poly_govern WITH CHECK (entity_id IS NULL AND inviter_user_id IS NULL AND issued_via IN ('operator', 'bootstrap') AND role = 'viewer')`;
  - `invitation_bootstrap_revoke FOR UPDATE TO poly_govern USING (issued_via = 'bootstrap' AND claimed_at IS NULL) WITH CHECK (issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NOT NULL)`.
  - Permissive policies OR together. A claim UPDATE by `accept_invitations` still passes the existing `claimed_user_id = app.current_user_id()` check. The new one only adds the revoke of an unclaimed bootstrap row. `invitation_set_once()` still makes `revoked_at` set-once (read, 0007).
- `poly_worker` gets no grant on `invitation` beyond its existing column SELECT (read, `0003:298–299`), and no INSERT on any table here.

## R2. The definers

**`issue_operator_invitation(p_email, p_hash, p_bootstrap)`**, with `SET lock_timeout = '5s'`, in this order:
1. Refuse with `42501` unless `app.current_user_id()` is null and `current_setting('app.actor', true) = 'operator:cli'`. A `withSystem` transaction (user set, actor `system:<job>`) is refused, and so is a bare `poly_worker` session.
2. Refuse with `22023` unless `p_email` matches `^[^\s@]+@[^\s@]+$` and is at most 254 characters. The 32-byte hash is enforced by the existing check (`23514`).
3. `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('app.issue_operator_invitation', 0))`. Every call takes it, bootstrap or not.
4. With `p_bootstrap`: revoke every row with `issued_via = 'bootstrap' AND claimed_at IS NULL AND revoked_at IS NULL` (`revoked_at = now()`), collecting the ids. **Then** raise `55000` with message `instance_not_empty` if any `public."user"` row exists (`SELECT u.id`; `poly_govern` holds that column, read 0007).
   - The revoke comes first on purpose. If a sign-up holds that row's lock, the UPDATE waits until it commits. The next statement takes a new snapshot (READ COMMITTED), sees the new user and refuses. The whole call then rolls back, the revoke included. (unmeasured; C4 measures it)
5. Without `p_bootstrap`: raise `55000` with message `instance_empty` if no `user` row exists.
6. Insert the row: `p_email` as given, role `viewer`, `p_hash`, `expires_at = now() + interval '7 days'`, and `issued_via` `'bootstrap'` or `'operator'`. The caller cannot choose the expiry.
7. Insert `audit_event (entity_id NULL, actor_user_id NULL, actor 'operator:cli', kind 'invitation.issued', subject_user_id NULL, payload {invitation_id, issued_via, expires_at, revoked: [ids]})`. The payload carries no email and no hash: the invitation id leads to both. A bootstrap writes the same kind.
8. Return the id and expiry.

**`claim_invitations`** adds `AND (i.issued_via <> 'bootstrap' OR NOT EXISTS (SELECT u.id FROM public."user" u))`.
**`accept_invitations`** adds the same predicate, with `WHERE u.id <> v_uid`, because by then this transaction's own user exists. Accept still re-selects exactly the rows claim would lock (POLY-87 R2).

## R3. `withOperatorTx` (`@poly/db/operator`)

- `context.ts` gains a fourth kind, `withOperatorTx`, so the existing nesting check refuses it inside and around `withTenant`, `withSystem` and `withContextFreeTx`.
- `withOperatorTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T>` runs on `workerPool()`. Setup: assert `app.user_id` is empty (`ContextNotEmptyError`, the `withContextFreeTx` check), then `set_config('app.actor', 'operator:cli', true)`. Nothing else is set. It takes no actor argument.
- New file `packages/db/src/operator.ts` re-exports `withOperatorTx` (and `close`, so the CLI can end the pool). It is the subpath `./operator` in `packages/db/package.json` and in `layers.json`.
- `@poly/db`, `/auth`, `/session`, `/migrate` and `/startup` must not export it (C10 tests the export surface). The confinement rule cannot see a re-export from `context.ts`, so the test is the guard there.

## R4. Tenancy

- `packages/tenancy/src/invitation.ts` gains:
  - `newInvitationToken(): { token: string; hash: Buffer }`: 32 bytes from `randomBytes`, base64url, hashed through `hashInvitationToken`;
  - `invitationLink(origin: string, token: string): string`, which returns `<origin>/sign-up?invitation=<token>`.
- New file `packages/tenancy/src/operator-invitation.ts`: `issueOperatorInvitation(tx, { email, bootstrap }) → { token, invitationId, expiresAt }`. It is the one file holding the literal `issue_operator_invitation`.
  - It maps `55000`, by message, to `InstanceStateRefused` with reason `'not_empty'` or `'empty'`. Every other error is rethrown unchanged.

## R5. The CLI

- `apps/worker/src/cli/main.ts`:
  - `argv` is `user invite <email> [--bootstrap]`. Exactly one positional, and `--bootstrap` may come before or after it. Anything else prints usage to stderr and exits 1.
  - Then `loadConfig('worker')`. That is the full check, so the worker's `DATABASE_*` and `PUBLIC_ORIGIN` are validated before any pool exists. On failure: `config.refused` lines on stderr, exit 1.
  - Then `assertSchemaNotBehind('worker')`; on failure exit 1.
  - Then `runUserInvite`, `close()`, and `process.exit(code)`.
  - The logger is created with stderr as its stream.
- `apps/worker/src/cli/user-invite.ts` exports `runUserInvite({ email, bootstrap }, { stdout, stderr, origin }): Promise<0 | 1 | 2>`. It is the only file allowed to import `@poly/db/operator`.
  - **stdout:** exactly one line, `invitationLink(origin, token)` followed by `\n`, and nothing else, ever.
  - **stderr:** a human line, `invitation recorded (<bootstrap|operator>), expires <ISO>`, and one log line `invitation.issued {outcome: 'ok', invitation_id, issued_via}`. The token, the hash and the email appear in neither.
  - **Exit codes:**
    - 0 when the invitation is issued;
    - 2 for `InstanceStateRefused`, with one stderr line: `refused: the instance already has a user` or `refused: the instance has no user; use --bootstrap`;
    - 1 for anything else (usage, configuration, schema guard, `42501`, `22023`, `55P03`, `23505`), as a stderr line without SQL text.
- `bin/polycarpic` gains `cli) exec node "$here/apps/worker/src/cli/main.ts" "$@" ;;`, and its usage line names `cli`.
- `apps/worker/package.json` gains `@poly/tenancy`.

## R6. Confinement (`layers.json`, generated)

- `packages.db.subpaths` += `"./operator"`; `packages.worker.allow` += `"tenancy"`, `"db/operator"`.
- `confined` += `"packages/db/src/operator.ts": ["apps/worker/src/cli/user-invite.ts"]`. The rule matches exact files (read, `scripts/layers/plugin.mjs:391`), so the caller is one named file, not `apps/worker/src/cli/**`. Criterion 6 is amended in place. Each later subcommand that needs the wrapper is added by name, which makes it a review point.
- `reservedLiterals` += `"issue_operator_invitation": ["packages/tenancy/src/operator-invitation.ts"]` and `"operator:cli": ["packages/db/src/context.ts"]`. The second keeps any other source from setting the actor the definer trusts.
- The plugin itself does not change.

## R7. Tests and cost

| File | Area | Covers | Cost (unmeasured) |
|---|---|---|---|
| `tests/db/operator-invite.test.ts` (new) | `auth` | C1–C9, C12, C13 | ≤ 5 s file time: two `cloneMigrated` databases, two BetterAuth sign-ups, two child processes |
| `tests/db/pgtap/06_operator_invitation.sql` (new; run by `pgtap.test.ts`) | `tenancy` | C11, C14 | ≤ 1 s |
| `tests/db/wrappers.test.ts` (edited) | `tenancy` | C10 | ≤ 1 s |
| `tests/layers/` fixtures | lint job | C15 | lint job |
| `tests/image/dockerfile.test.ts` (edited: `cli` in the dispatch list) | node | C9 | 0 |

- **No new area.** The issue proposed an `operator` area. Adding one changes the `changes` job's outputs and `ci.yml` (read: lines 159–162, 186 and 539–542), plus five `tests/ci` files that pin the area list. Its tests also need BetterAuth sign-up and `@poly/tenancy`, which are already the `auth` area's.
  - So `operator-invite.test.ts` joins `auth`.
  - `DB_AREAS.auth.paths` and `TABLE.db` each gain `^apps\/worker\/src\/cli\/`, `^apps\/worker\/src\/startup\.ts$`, `^apps\/worker\/package\.json$` and `^bin\/polycarpic$`.
  - `tests/ci/db-filter-imports.test.ts` adds `apps/worker/src/cli/main.ts` to its roots, and `tests/ci/db-areas.test.ts` adds the file to its `auth` pin.
  - This loop does not edit `.github/workflows/`.
- **Guard (the POLY-87 wording).** Measure the branch head against main at the merge base in the same session, n ≥ 3 each, on the battery-step median. The cap is +7 s, the table's estimate rounded up. Over the cap, the loop cuts its own files (shared clones, fewer spawns). Suite-wide cuts are POLY-143's. The 100 s job budget stays a warning on main.
- This branch touches `packages/db/**`, which is in `DB_SHARED`, so CI runs every area here (read, `changes.mjs:9`).

## R8. Room for POLY-144 (not built)

- POLY-144's caller is a signed-in user under `withTenant`, as `poly_app`, delivered by email. It gets its own definer (EXECUTE `poly_app`, and its own rate limit and audit). It does not widen this one: `issue_operator_invitation` stays EXECUTE `poly_worker` and actor-gated.
- What it reuses: `newInvitationToken`, `invitationLink`, the no-entity acceptance, and the `issued_via` column, whose check POLY-144 widens with a new value in its own migration.
- Nothing here takes a delivery argument. The CLI's stdout is its delivery.

## R9. Paths outside the issue's `paths`

`bin/polycarpic`. Everything else is covered: `tests/**`, `infra/ci/**`, `apps/worker/**`, `packages/db/**`, `packages/tenancy/**`, `layers.json`, and the generated lint config under `scripts/layers/**`.

## Conditions (each becomes a red test for qa and a build target for backend-lead)

**Step 1: schema and definers (0008, 0009)**
1. On an empty instance, `--bootstrap` exits 0. Its link signs up through `/sign-up/email`, and that user has their own Person only. Afterwards a second `--bootstrap` exits 2, and the counts of `invitation` and `audit_event` rows are unchanged.
2. On a non-empty instance, the plain invite exits 0 and writes one row (`issued_via 'operator'`, `entity_id` and `inviter_user_id` null, role `viewer`) and one `audit_event` (`kind 'invitation.issued'`, `entity_id` null, `actor 'operator:cli'`, `actor_user_id` null, a payload naming the row's id). Signing up with its link leaves `visible_entities()` with one element.
3. On an empty instance, the plain invite exits 2 and writes no row.
4. A second `--bootstrap` on an empty instance revokes the first: the first row's `revoked_at` is set, its link is refused 403, and exactly one row is live. Two concurrent `--bootstrap` runs on separate connections both exit 0, leaving exactly one live bootstrap row and two audit rows. A lock-free variant (a test that drops the advisory call) would fail with `23505`, so both exiting 0 is the lock's proof.
5. With a user present, a superuser-planted live bootstrap row is refused at `/sign-up/email` (403, no user created). A token-less verified sign-up for an email holding both a planted bootstrap row and a live operator row claims the operator row only, and the bootstrap row stays unclaimed.

**Step 2: CLI behaviour**
6. stdout is exactly one line matching `^<PUBLIC_ORIGIN>/sign-up\?invitation=[A-Za-z0-9_-]{43}\n$`. `sha256` of the decoded token equals the row's `token_hash`.
7. The token text appears in no captured stderr or log line, and in no column of the `invitation` or `audit_event` row, across C1–C4 and a refused run.
8. `expires_at - created_at = interval '7 days'` exactly, for both kinds.
9. Exit codes. Bad argv (no email, two emails, an unknown flag, a malformed email) gives 1 with nothing on stdout. Run through `sh bin/polycarpic cli user invite …`: with `DATABASE_HOST` unset, the result is 1, a `config.refused` line on stderr, and no connection attempt (an unroutable `DATABASE_HOST` that would hang proves it); a successful plain invite gives 0 with one stdout line.

**Step 3: the wrapper**
10. `withOperatorTx` nested inside each of the other three, and each of them inside it, throws `NestedContextError`. Inside it, `current_user` is `poly_worker`, `app.actor` is `operator:cli`, and `app.user_id` is empty. After commit and after rollback, the next checkout from a `max: 1` pool reads both settings empty. The export surface of `@poly/db`, `/auth`, `/session`, `/migrate` and `/startup` contains no `withOperatorTx`.

**Step 4: catalog (pgTAP 06)**
11. `issue_operator_invitation` is refused with `42501` in each of these cases: called by `poly_app`; under a `withSystem`-shaped context (`app.user_id` set, actor `system:x`); by `poly_worker` with no actor; and by `poly_worker` with `app.user_id` forged. `poly_worker` has no INSERT on `invitation`, on the table or on any column. `poly_govern`'s INSERT columns on `invitation` are exactly R1's. `definers.json` lists the function with its owner and EXECUTE, and `search_path = ''` (the C-15 check).
12. A `poly_app` INSERT that supplies `issued_via` is refused `42501`. An owner-issued row reads `'owner'`. A superuser insert of an operator row with an `entity_id`, or with role `owner`, fails `23514`. A second live bootstrap row inserted by the superuser fails `23505`.
13. A `poly_govern` UPDATE of `revoked_at` on a claimed bootstrap row, or on an operator row, changes nothing (the policy filters it out).
14. **(POLY-87 C23, as changed by B)** On a freshly migrated database with no user, every `USER_INSERTING` route is refused and no `user` row exists. pgTAP shows INSERT on `invitation` for `poly_app` and `poly_govern` only. The only function in schema `app` whose body inserts into `invitation` is `issue_operator_invitation`, and none inserts into `public."user"`.

**Step 5: lint**
15. Each of these is red, in every form POLY-140 C1 covers:
    - `@poly/db/operator` imported from `apps/worker/src/main.ts`, from `apps/worker/src/cli/main.ts`, from `packages/tenancy/src/x.ts` and from `packages/db/src/index.ts` (by a relative path);
    - the literal `issue_operator_invitation` outside its file;
    - the literal `operator:cli` outside `context.ts`.

    The same import from `user-invite.ts` is green.

## For seceng

- **C-84 wording is yours.** The fact to word: `db/auth` and `db/operator` are the two context-free paths, and only `db/auth` sets `app.user_id`. The operator path sets `app.actor` only, and a definer trusts that only together with an empty `app.user_id`, on the `poly_worker` role.
- **Trust.** Anyone who can run SQL as `poly_worker` can issue a no-entity invitation (R-2's power for that role). Today that is only the worker container. The audit row records each one.
- **The link on stdout.** It goes to the operator's terminal, and to scrollback or a `docker logs` capture if the operator pipes it there. It expires in 7 days and is single use. Should the INFRA runbook tell the operator to clear scrollback?
- **The bootstrap window.** Until the first user signs up, anyone holding the live bootstrap link becomes the first user, and so the owner of the box's first Person. A re-issue revokes the old link.

## Review checklist (pre-registered; read at the build check, at the build-green sha)

| # | Check | Evidence I will read |
|---|---|---|
| A1 | 0008 is generated: `check-migrations` is clean, and the snapshot holds `issued_via` and both checks | `migrations/0008_*.sql`, `meta/` |
| A2 | 0009 matches R1–R2: the order (actor check → advisory lock → revoke → user check → insert → audit), `lock_timeout`, `search_path`, the grants and the two policies verbatim, the unique index | `0009_*.sql`; `definers.json` |
| A3 | Claim and accept differ from 0007 only by the bootstrap predicate | a diff of the function bodies |
| A4 | `withOperatorTx` is a fourth `Kind`, sets one setting, and runs on `workerPool`; no other entry point exports it | `context.ts`, `operator.ts`, `index.ts`, `package.json` |
| A5 | The CLI writes exactly one `stdout.write`, the link; the logger goes to stderr; no token or email in any log call | `apps/worker/src/cli/*.ts` |
| A6 | Exit-code mapping: only `InstanceStateRefused` gives 2 | `user-invite.ts` |
| A7 | `layers.json` keys as R6; the generated config is fresh; no plugin change | `layers.json`, `scripts/layers/` |
| A8 | The CI map as R7; no `.github/workflows` diff | `changes.mjs`, `git diff --stat main...` |
| A9 | Timing guard against a same-day control | the lead's numbers at gate 3 |
| A10 | ARCH §3.1c, §3.3 and the `packages/db` row describe the four wrappers, the operator path and `issued_via` (I edit ARCH at the build check) | `docs/ARCH/index.html` |

Follow-ups, not this loop: INFRA §7.5 and the runbook's first-user step say the invite sends an email. After this loop it prints the link once. That text must change (the INFRA owner's, in this loop's paths or the next docs PR).
