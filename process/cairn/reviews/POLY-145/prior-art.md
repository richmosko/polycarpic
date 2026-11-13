# POLY-145 — prior art (seceng)

Every claim below cites the page or file it came from and the date it was read (2026-11-13 UTC). Where a source did not settle a point, that is said and the point is left open. Nothing is stated from memory.

## Supabase

| Claim | Source |
|---|---|
| Every request maps to one of three Postgres roles: `anon` (not signed in), `authenticated` (signed in), and `service_role`, "Full access. It bypasses RLS, so keep it server-side". | https://supabase.com/docs/guides/database/postgres/row-level-security (read 2026-11-13) |
| `auth.uid()` "Returns the ID of the user making the request" and returns null with no authenticated user. Their own test recipe sets identity with `set local role` and `set local request.jwt.claim.sub`. | same page |
| The function bodies (auth service migration): `uid()`, `role()` and `email()` are `language sql stable` and read `request.jwt.claim.<name>`, falling back to the `request.jwt.claims` JSON. So `auth.uid()` reads an ordinary setting; Postgres does not verify anything. | https://github.com/supabase/auth/blob/master/migrations/20220224000811_update_auth_functions.up.sql (read 2026-11-13; summarised by the fetch tool, not quoted verbatim) |
| A secret key authorizes access "through the built-in `service_role` Postgres role", which has `BYPASSRLS`; "A secret key bypasses every Row Level Security policy you have." Keep it out of browsers, shipped apps and source control. | https://supabase.com/docs/guides/api/api-keys (read 2026-11-13) |
| Supabase holds the private signing key for keys it generates ("extracting of the private key … is not possible"). ES256 recommended, RS256 supported, HS256 "Not recommended for production". JWKS at `/auth/v1/.well-known/jwks.json`, cached at the edge up to 10 minutes plus client caches. The API gateway verifies API keys and mints a short-lived JWT forwarded to the project's servers. | https://supabase.com/docs/guides/auth/signing-keys (read 2026-11-13) |
| Access tokens are "usually between 5 minutes and 1 hour", default 1 hour. A signed-out session's token is not refused by default: the page suggests checking the JWT's `session_id` against `auth.sessions` if you need that, and says "Most applications rarely need such strong guarantees." | https://supabase.com/docs/guides/auth/sessions (read 2026-11-13) |

**What this means for us.** Supabase's security property is not "Postgres verifies the user". It is "the components that can set the identity setting are Supabase's own (PostgREST, the gateway, Auth), not the customer's code". The customer's server code that needs more holds `service_role` and bypasses RLS entirely. Whether PostgREST or Postgres itself checks the JWT signature was not stated on any Supabase page read; the PostgREST docs below settle that PostgREST does.

Not found, so not claimed: how Supabase's Edge Functions or Realtime reach Postgres; whether `auth.sessions` is checked on every request by any Supabase component.

## PostgREST (the data layer Supabase uses)

| Claim | Source |
|---|---|
| A low-privilege `authenticator` role connects and "become[s]" other roles per request with `SET LOCAL ROLE`; the role is named by the JWT's `role` claim and must be granted to the authenticator. The example creates it `LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER`. | https://docs.postgrest.org/en/stable/references/auth.html (read 2026-11-13) |
| PostgREST verifies the JWT itself, with an HMAC secret or a JWK/JWKS (RS256 in the example), and does not let the client choose the algorithm. | same page |
| Per request: start transaction (read-only for GET), set transaction-scoped settings including the role and `request.jwt.claims`, run the optional `db-pre-request` function, run one generated query or RPC call, end. | https://docs.postgrest.org/en/stable/references/transactions.html (read 2026-11-13) |

**What this means for us.** Because the authenticator is a member of every role it can switch to, anyone who holds the authenticator's password and can open a connection can `SET ROLE` to any of them and set any claims (see Postgres below). The protection is that only PostgREST holds that password and PostgREST only runs SQL it generated. This is option (c), and it is also option (d1) underneath.

## Neon `pg_session_jwt` (a JWT verifier that runs inside Postgres)

| Claim | Source |
|---|---|
| "pg_session_jwt is a PostgreSQL extension designed to handle authenticated sessions through a JWT." `auth.init()` loads the JWK; `auth.jwt_session_init(jwt)` sets the session's JWT, which must be signed by that key; `auth.user_id()` returns the verified `sub`. | https://github.com/neondatabase/pg_session_jwt (read 2026-11-13) |
| "JWK can only be set at postmaster startup, from the configuration file, or by client request in the connection startup packet (e.g., from libpq's PGOPTIONS variable), whereas the JWT can be set anytime at runtime." | same page (verbatim) |
| Without a JWK it falls back to PostgREST-style `request.jwt.claims`, and the README warns that "request.jwt.claims is a regular PostgreSQL parameter that can be modified by any database user". | same page |
| Neon's own RLS guide says only "The Data API handles JWT validation and provides the `auth.user_id()` function"; it does not say whether that runs in Postgres. | https://neon.com/docs/guides/neon-rls (read 2026-11-13) |

**What this means for us — a finding, unmeasured.** Read literally, the key can be supplied by the client that opens the connection. If so, a web process that opens its own connections could hand Postgres its own key and then mint any token, which is today's weakness again. Option (b) built on this extension needs either a proof that a startup-packet value cannot override the server's, or a guard of our own (for example, a check that the loaded key's thumbprint equals one pinned in a table the app cannot write). This must be measured before (b) is priced as secure. The supported algorithms were not listed on the page.

## Hasura (a second widely used data layer)

| Claim | Source |
|---|---|
| The engine verifies the JWT ("Hasura then verifies and decodes the JWT to extract `x-hasura-*` session variable claim values"), with a public key, HMAC secret or `jwk_url`; the session variables feed its permission rules. | https://hasura.io/docs/2.0/auth/authentication/jwt/ (read 2026-11-13) |

Not found on that page, so not claimed: whether the session variables reach Postgres as settings, and what the admin secret bypasses.

**What this means for us.** Same shape as PostgREST: verification sits in a generic gateway, not in Postgres.

## PostgreSQL itself

| Claim | Source |
|---|---|
| "PostgreSQL will accept a setting for any two-part parameter name" (placeholders). The page states no privilege for setting one. | https://www.postgresql.org/docs/current/runtime-config-custom.html (read 2026-11-13) |
| `SET ROLE` needs the `SET` option on the target role, directly or through memberships; superusers may pick any role. `RESET ROLE` "can be executed by any user". `SET ROLE` cannot be used inside a `SECURITY DEFINER` function. | https://www.postgresql.org/docs/current/sql-set-role.html (read 2026-11-13) |

**What this means for us.** A dotted setting such as `app.user_id` is writable by any role, so no policy may trust one unless something the caller cannot forge accompanies it. A login role that may `SET ROLE` to every user role can also `RESET ROLE` and switch again, so (d1) is not a barrier against SQL as that login role.

## BetterAuth 1.7.18 (our pinned version)

Read from the installed source (`node_modules/.pnpm/better-auth@1.7.18/node_modules/better-auth/dist/`) and its docs.

| Claim | Source |
|---|---|
| A session's `token` is `generateId(32)` and is stored as-is; `findSession` looks the row up by `token` equality. Not hashed. | `db/internal-adapter.mjs` lines 272–298 and 349–375 (read 2026-11-13) |
| The session cookie carries the token signed with the auth secret; `getSession` verifies it with `ctx.getSignedCookie(…, ctx.context.secret)`. So a raw token from the database is not a usable cookie without the secret. | `api/routes/session.mjs` line 40 (read 2026-11-13) |
| The cookie cache, when on, lets the server trust a signed cookie without reading the database until it expires; revoked sessions "may remain active on other devices until the cookie cache expires". We have it off (`packages/auth/src/options.ts`: `cookieCache: { enabled: false }`). | https://www.better-auth.com/docs/concepts/session-management (read 2026-11-13) |
| The `jwt` plugin keeps its private signing key in the database (`jwks` table), encrypted with the auth secret unless `disablePrivateKeyEncryption` is set, and decrypts it to sign. | `plugins/jwt/sign.mjs` lines 61–68, `plugins/jwt/utils.mjs` (read 2026-11-13) |

**What this means for us.** Any process that runs BetterAuth holds the auth secret, can read the session table, and (with the jwt plugin) can decrypt the signing key. So BetterAuth's jwt plugin, run inside web, gives web the power to mint tokens: it cannot be the signer for option (b). The signer must be a separate process with its own secret. Hashing session tokens at rest is not a BetterAuth setting found in this version's source; doing it for (e1) means our own lookup, not BetterAuth's.
