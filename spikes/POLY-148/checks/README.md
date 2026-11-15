# POLY-148 spike checks (contract)

Written before the harness (POLY-148a). Run: `spikes/POLY-148/bin/up`, then `node spikes/POLY-148/checks/run.mjs [handle service cookie second-factor pages]`, then `spikes/POLY-148/bin/down`.
Node 26, no npm dependencies of their own. Needs Docker and `pnpm install` at the repo root (the checks load `better-auth/crypto` from `packages/auth` to hash seed passwords).
Each line prints PASS, FAIL, REPORT or UNMEASURED with its reasons; exit 1 on any FAIL or UNMEASURED. A measured FAIL is a valid result. `POLY148_OPTION=2` grades option 2 instead of option 1.

## What the harness provides (everything under `spikes/POLY-148/` except `checks/`)

| piece | contract |
|---|---|
| `bin/up` | Starts all of the below and exits 0 only when all four answer. `bin/up --option 2` starts option 2 instead. Idempotent. |
| `bin/down` | Stops all of it. |
| Caddy | `127.0.0.1:58480`, plain HTTP. The app origin is `http://127.0.0.1:58480`. `/api/auth/*` goes to the service; everything else goes to web (plus `/sign-in*` and `/sign-up*` to the service if the pages move). |
| web | `127.0.0.1:58481`. No BetterAuth instance and no auth secret. Answers 404 to `/api/auth/*`. Serves `GET /spike/whoami`: it reads only the handle cookie, resolves it through the database as `poly_app`, and answers `200 {"userId","sessionId"}` or `401`. Option 2: it resolves the BetterAuth session cookie instead. |
| sign-in service | `127.0.0.1:58482`. A second Node process from this workspace. It runs `packages/auth/src` as shipped: imported in place, or copied byte for byte. The handle hook is added outside those files, and better-auth resolves to the pin in `packages/auth/package.json`. It connects as `poly_auth` and answers 404 outside `/api/auth/*` (and the pages, if moved). Config: `baseURL` `http://127.0.0.1:58480`, `tlsMode` `real-domain`, `requireClientIp` false, `rateLimit` off, and `BETTER_AUTH_SECRET` in its environment and nowhere else. Google is `clientId` `qa-google` with `clientSecret` `qa-google-secret`. Its outbound `fetch` to `accounts.google.com`, `oauth2.googleapis.com`, `openidconnect.googleapis.com` and `www.googleapis.com` goes to `http://127.0.0.1:58488` with path and query kept. `sendMagicLink` POSTs JSON `{email, url, token}` to `http://127.0.0.1:58489/mail`. |
| handle cookie | Named `__Host-poly_handle` (override with `POLY148_HANDLE_COOKIE`). It is set on the response of every path that creates or replaces a session. Its value is base64url. |
| Postgres | Docker container `poly148-pg`, database `poly148`, superuser `postgres`, reached by `docker exec`. Migrated with the product chain (`packages/db` migrations and `packages/db/sql/roles.sql`) plus the spike's own SQL. |
| `app.session_handle` | `session_id uuid NOT NULL REFERENCES public.session(id) ON DELETE CASCADE`, and `handle_hash bytea NOT NULL UNIQUE`, which is `sha256` of the cookie value's UTF-8 bytes exactly as set. Not used with `--option 2`, where `public.session.token` holds `sha256(token)` as lowercase hex or base64url. |
| roles | Each runtime login role, `poly_app` and `poly_auth` included, has password `qa-<role>` and can log in over TCP inside the container (`docker exec poly148-pg psql postgresql://poly_app:qa-poly_app@127.0.0.1:5432/poly148`). `poly_app` is web. `poly_auth` is the service: LOGIN, NOSUPERUSER, NOBYPASSRLS, NOCREATEROLE, NOCREATEDB, a member of no role. It holds only the grants it needs; the checks list them from the catalog. Every other role is as `roles.sql` defines it. |
| `.run/pids.json` | `{"web": <pid>, "service": <pid>, "caddy": <pid or container>, "serviceEntry": "<path relative to spikes/POLY-148>", "authSource": "<the directory the service loads packages/auth/src/*.ts from, relative to spikes/POLY-148>"}`. |

The checks own ports `58488` (fake Google) and `58489` (mail sink), so leave both free. The checks also create schema `qa148`, a trigger on `public.session`, `public."user"`, `public.invitation` and `public.entity` that logs the writing login role, and their own users. Do not use those names.

## How the checks reach each path (all through Caddy unless noted)

| path | how |
|---|---|
| sign-in by email | `POST /api/auth/sign-in/email`, for a user and credential account the checks insert as superuser (password hashed with the pinned `hashPassword`). |
| magic link | `POST /api/auth/sign-in/magic-link`, then a `GET` of the mailed URL's path and query. |
| OAuth callback | `POST /api/auth/sign-in/social` (`google`), then `GET /api/auth/callback/google?code=qa148.<base64url email>&state=<state>`. The fake Google issues an unsigned `id_token` for that email. |
| second-factor step | TOTP is enrolled through `/two-factor/enable` and `/two-factor/verify-totp`, after the checks set `second_step_at` (POLY-89's grant does not exist yet) and `recent_auth_at`. Then a held sign-in, then `verify-totp` or `verify-backup-code`. |
| rotation | The first TOTP verify, `/two-factor/disable` and `/change-password` with `revokeOtherSessions`. |
| passkey | A software ES256 authenticator (attestation `none`), driving `generate-register-options`, `verify-registration`, `generate-authenticate-options` and `verify-authentication`. |
| refresh | The session row is aged as superuser, then the checks send `GET /spike/whoami` and then `GET /api/auth/ok`. |
| sign-up | A no-entity invitation is inserted as superuser, then `POST /api/auth/sign-up/email` with `invitationToken`. |
| cookies | A browser-shaped jar sends each cookie only where its Path allows and drops any `__Host-` or `__Secure-` cookie that breaks its prefix rule. The checks never read `document.cookie`. |

What the record must contain beyond these lines: `RECORD.md`.
