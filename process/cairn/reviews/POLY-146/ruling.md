# POLY-146 — gate 1 ruling (architect)

Scope: the issue file's nine criteria. Identity is still asserted by web and worker; nothing here touches stage 1.
Measured = read from the tree at `fb3933cb` or from the installed package source; anything else is tagged `(unmeasured)`.

## R1 — The operator pool (`packages/db`, `apps/worker/src/cli`)

- `pool.ts`: `PoolConfig` gains `operator?: Env`. A new `operatorPool()` builds from `config.operator ?? process.env`, the same
  `connectionFrom()` path. **Before it builds the pool**, it refuses unless that env's `DATABASE_USER` is exactly `poly_operator`:
  it throws `OperatorPoolRefused` (new class, exported on `db/operator`) and no connection is attempted. `close()` ends it too.
  The worker pool is never touched by `withOperatorTx`.
- `context.ts`: `withOperatorTx` runs on `operatorPool`, not `workerPool`. Body otherwise unchanged (empty `app.user_id` assert,
  `app.actor = 'operator:cli'` local).
- Fail closed in a worker process: there `DATABASE_USER` is `poly_worker`, so the pre-connect check refuses. The second layer
  is the database: poly_worker loses EXECUTE (R2), so a forced call is `42501`.
- `apps/worker/src/cli/main.ts`: `loadConfig('operator')` (R3). **Drop `assertSchemaNotBehind`**: it reads
  `drizzle.__drizzle_migrations`, which poly_operator may not (criterion 3, "nothing else"). The call itself is the guard: an
  image ahead of the schema hits `42883` (no such function) and exits 1 "failed". The logger `service` is `'operator'` in both
  `main.ts` and `user-invite.ts`.
- The CLI stays in `apps/worker/src/cli`; `layers.json` is unchanged (`db/operator` stays confined to `user-invite.ts`).

## R2 — The role and the grants

- `packages/db/sql/roles.sql`: add `('poly_operator', true)` to the VALUES list (gets the same `NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS` line), and to the `GRANT CONNECT ON DATABASE` list. Nothing else in roles.sql: not to `public` USAGE.
- New migration `0010_operator_role.sql` (`drizzle-kit generate --custom`, journal + snapshot updated by the tool):
  `SET ROLE poly_govern;` REVOKE EXECUTE ON FUNCTION `app.issue_operator_invitation(text, bytea, boolean)` FROM poly_worker;
  GRANT it TO poly_operator; `SET ROLE poly_owner;` `GRANT USAGE ON SCHEMA app TO poly_operator;` Ends on poly_owner.
  The function owner is poly_govern, so the grant change must run as poly_govern (as 0009 did); poly_owner owns schema `app`.
- `packages/db/sql/definers.json`: the issuer's `execute` becomes `["poly_operator"]`. 0009 is never edited, its comment included.
- Policies: neither `invitation_operator_issue` nor `invitation_bootstrap_revoke` names poly_worker (both `TO poly_govern`), and the
  function body names no role. Nothing else changes. Measured: grep of 0009.
- The role needs no USAGE on `public` and no `drizzle` access: the definer has `search_path = ''` and runs as poly_govern;
  `withOperatorTx` calls only `pg_catalog` functions.

## R3 — The service, `bin/polycarpic`, and the config registry

- `packages/config/src/registry.ts`: `Service` and `SERVICES` gain `'operator'`. `DATABASE_PASSWORD_FILE` rows add `'operator'`.
  `AUTH_SECRET_FILE` becomes `services: ['web']`. No other row names operator. `check.ts`: `DB_USER.operator = 'poly_operator'`.
  `log.ts`: `LogService` gains `'operator'`. A set `AUTH_SECRET_FILE` in worker or operator is then `forbidden` by the existing rule.
- `bin/polycarpic` is unchanged: there is no `operator` verb; the service runs the existing `cli` verb.
- Compose (`prod.yml`, `staging.yml`), devops-engineer-146 builds it:
  `operator:` `<<: *hardened`, `image: *app-image`, `user: "10006:10006"` (staging `"10106:10106"`), `restart: "no"`,
  `profiles: [operator]`, `entrypoint: ["/app/bin/polycarpic", "cli"]` (so `docker compose --profile operator run --rm operator
  user invite <email>` appends the args), `networks: [default]`, `mem_limit: 256m`, `tmpfs: [/tmp]`, the migrate healthcheck,
  one secret `{source: db_password_operator__operator, target: db_password_operator}` from `<prefix>operator/db_password_operator`.
  Its environment follows the siblings' current variable names; the `DATABASE_*` / `PUBLIC_ORIGIN` wiring of every service is
  POLY-97's.
- Worker in both files: remove the `AUTH_SECRET_FILE` env line, the `auth_secret` mount and the `auth_secret__worker` secret.
- `infra/lint/policy.json`: `secretMatrix.{prod,staging}.worker` drops `auth_secret`; add `operator: ["db_password_operator"]`.
  `compose-policy.mjs`: one new rule `operator-one-shot`: a service mounting `db_password_operator` must be named `operator`,
  have `restart: "no"` and `profiles` exactly `[operator]`. The matrix already refuses the secret on any other service.
- `pg_hba.prod.conf` / `pg_hba.staging.conf`: `host polycarpic poly_operator 10.201.1.0/24 scram-sha-256` (staging `10.202.1.0/24`),
  next to the poly_migrator line, before the final reject.

## R4 — Token hashing (better-auth 1.7.18, read from the installed `dist`, and the current docs pages)

- `verification: { ..., storeIdentifier: 'hashed' }` and `magicLink({ sendMagicLink: input.sendMagicLink, storeToken: 'hashed' })`.
  Types: `storeIdentifier: 'plain'|'hashed'|{hash}|{default, overrides}` (`@better-auth/core` init-options);
  `storeToken: 'plain'|'hashed'|{type:'custom-hasher', hash}`, default `'plain'` (plugin source and docs).
- Mechanics (`db/verification-token-storage.mjs`, `internal-adapter.mjs`): `'hashed'` stores base64url(SHA-256(the whole
  identifier, prefix included)). Every create/find/consume/delete/update goes through the same transform, and every plugin we
  enable (OAuth state, two-factor, passkey, magic link) and the reset route use the internal adapter only, never the table
  directly. Measured: grep of `dist`. So the routes and their behaviour are unchanged; only the stored column changes.
- Magic link with both on: stored = H(`magic-link:` + H(token)). Reset: stored = H(`reset-password:` + token). The emailed token
  and URL are unchanged.
- **A fallback we accept:** with `'hashed'`, find and consume also try the plain identifier when the hashed one misses (an upgrade
  path). A value read from the table is refused anyway for the prefixed identifiers (`reset-password:`, `magic-link:`,
  `auth-state:`): the presented value is re-prefixed, and a stored base64url hash has no colon. Unprefixed identifiers (passkey
  challenge, two-factor cookie ids) come from signed cookies. seceng-146 to confirm, or raise, in SECURITY.
- Reset sending is not wired in production (`sendResetPassword` is unset, so the route answers `RESET_PASSWORD_DISABLED`); the
  mailer is POLY-137's. The tests patch it in through the harness's `mk(mode, patch)`, as `auth-route-policy.test.ts` does today.
- Nothing in our code or tests reads `verification.identifier`. Measured: grep of `packages`, `apps`, `tests`.

## R5 — Tests (qa-engineer-146 writes them red)

No new `tests/db/*.test.ts` file: a new one must enter `infra/ci/changes.mjs` DB_AREAS and `tests/ci/db-areas.test.ts`, which
are outside this issue's paths and a full-CI trigger.

| AC | Test | File | Layer |
|---|---|---|---|
| 1 | storeIdentifier and storeToken are `'hashed'` in `authOptions` (read the plugin object if it exposes its options; else skip) | `packages/auth/src/options.test.ts` | unit |
| 1 | reset: the stored identifier is not `reset-password:<token>` and contains no token; the token resets once; a second use refused | `tests/db/auth-route-policy.test.ts`, one top-level describe outside `describe.each` | tests/db |
| 1 | magic link: same three assertions | same | tests/db |
| 1 | the stored identifier (whole, and the part after any prefix) presented at `POST /reset-password`, `GET /reset-password/:token` and `GET /magic-link/verify` is refused | same | tests/db |
| 2 | worker loads with no `AUTH_SECRET_FILE`; worker and operator with one set → `forbidden`; web without it → `not_set` | `tests/config/check-config.test.ts` | unit |
| 2 | fail rows: prod worker mounts `auth_secret`; staging worker mounts `auth_secret` → `secret-matrix` | `tests/infra/lint.test.ts` + `baseline.ts` | compose lint |
| 3 | poly_operator catalog-exact: attributes (LOGIN, the five NOs, no CONNECTION LIMIT, no `pg_db_role_setting`); no membership either way; database ACL = CONNECT; namespace ACL = USAGE on `app` only; function ACL = EXECUTE on the issuer only; no relation, column, sequence, or default ACL naming it | `tests/db/pgtap/06_operator_invitation.sql`, new C13 block | pgTAP |
| 3 | LOGIN set and role-hygiene set include poly_operator | `pgtap/01_roles.sql`, `03_role_hygiene.sql`, `helpers/api.ts` `LOGIN` | pgTAP |
| 4 | C12: EXECUTE held by poly_operator alone; `run_as('poly_worker', …)` issue → `ERR:42501`; the behaviour rows run as poly_operator | `pgtap/06_operator_invitation.sql` | pgTAP |
| 4 | definer allowlist lists the issuer EXECUTE `['poly_operator']` | `tests/db/operator-invite.test.ts` (the existing line-362 case) | tests/db |
| 5 | `withOperatorTx` with `DATABASE_USER=poly_worker` (configure and process.env) throws `OperatorPoolRefused` and opens no connection; inside `fn`, `current_user` is poly_operator | `tests/db/operator-invite.test.ts` | tests/db |
| 5 | child `bin/polycarpic cli` with `DATABASE_USER=poly_worker` exits 1 with `config.refused` on `DATABASE_USER` | same | tests/db |
| 6 | repo clean includes the operator service; fail rows: prod and staging worker or web mounts `db_password_operator` → `secret-matrix`; operator `restart: unless-stopped` → `operator-one-shot`; operator without the profile → `operator-one-shot` | `tests/infra/lint.test.ts` + `baseline.ts` | compose lint (rendered) |
| 7 | the repo's two `pg_hba` files hold the poly_operator line with the app subnet and scram, before the final reject | `tests/infra/lint.test.ts` (static read) | compose lint |
| 8 | the existing operator-invite cases run as poly_operator (`dbEnv('poly_operator')`, `configure({ operator })`, no `AUTH_SECRET_FILE` in the child env) | `tests/db/operator-invite.test.ts`, `pgtap/06` | tests/db, pgTAP |

Cost `(unmeasured)`: the pgTAP rows are catalog queries, well under 1 s; the hash block adds about six HTTP round trips on an
existing boot, 1–2 s; the operator-invite additions one child spawn, about 1 s. Estimate +2–4 s on the `db` job, judged against a
same-day control on `main`. Compose-lint rows each run the CLI end to end: about six new rows on the `lint` job, not `db`.

## R6 — Ownership, by file (no file is shared)

- **backend-lead-146:** `packages/auth/src/options.ts`; `packages/config/src/{registry,check,log}.ts`;
  `packages/db/src/{pool,context,operator}.ts`; `packages/db/sql/{roles.sql,definers.json}`;
  `packages/db/migrations/0010_operator_role.sql` and `migrations/meta/*`; `apps/worker/src/cli/{main,user-invite}.ts`.
- **devops-engineer-146:** `infra/compose/{prod,staging}.yml`; `infra/lint/{policy.json,compose-policy.mjs}`;
  `infra/postgres/{pg_hba.prod.conf,pg_hba.staging.conf}`; `docs/INFRA/**` (§7.5).
- **qa-engineer-146:** every test file above, including `packages/*/src/*.test.ts` and `tests/**`.
- **seceng-146:** `docs/SECURITY/**`. **architect:** this file and `docs/ARCH/**`.
- Unchanged by anyone: `bin/polycarpic`, `layers.json`, `Dockerfile`, `infra/ci/**`.

## Addendum 1 — seceng-146's review (two musts, accepted)

- **A1.1 (R3, T-99, C-01):** the CLI is the `run` container's PID 1, so its stdout (the link) would reach the log driver. The
  `operator` service sets `logging: {driver: "none"}`; `operator-one-shot` also requires it. The runbook command is
  `docker compose --profile operator run --rm operator user invite <email>`. devops-engineer-146 measures on local Docker before
  build green: the attached `run` still prints the link, and `docker logs` on that container yields nothing `(unmeasured)`.
  If the attached output is lost, stop and tell the lead; never fall back to `json-file`. R5 gains one fail row: operator
  without `logging.driver: none` → `operator-one-shot`.
- **A1.2 (R5, C13):** add effective-privilege rows, since an ACL naming PUBLIC slips past the named-ACL checks: over every
  function in `app` and `public`, `has_function_privilege('poly_operator', oid, 'EXECUTE')` is true for the issuer alone; among
  non-`pg_*`/`information_schema` schemas, USAGE is true for `app` alone and CREATE false everywhere; `has_database_privilege`
  TEMP and CREATE are false. Catalog queries, under 1 s `(unmeasured)`.
- **A1.3 (R1):** the code comment on the pre-connect check calls it a seatbelt; the boundary is that no process but `operator`
  holds the password.
