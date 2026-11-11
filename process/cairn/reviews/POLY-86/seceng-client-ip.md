# POLY-86: the client IP behind Caddy (SecEng ruling, S19)

Reviewer: seceng-86. Trigger: the lead's visual leg @ f99b888, finding 4. Every sign-in logs that BetterAuth "could not determine a client IP" and falls back to one shared bucket per path, so one client's failures throttle sign-in for every user (T-02, T-09).

## What BetterAuth 1.7.18 does (code-read, `@better-auth/core/dist/utils/ip.mjs`)

- By default `getIP` reads `x-forwarded-for` only (`DEFAULT_IP_HEADERS`).
- With no `trustedProxies`, it accepts the header only when it holds **exactly one** entry and that entry is a valid IP. Two or more entries, or an invalid value, resolve to null.
- An IPv6 address is bucketed by its /64 (the `ipv6Subnet` default).
- In development and test it falls back to `127.0.0.1`. In production a null IP means the shared bucket (`rate-limiter/index.mjs`). The same `getIP` also fills `session.ip_address`, which Settings → Sessions shows.

## Ruling

1. **The app trusts one header: `X-Forwarded-For`, as Caddy writes it, with one entry.**
   - Set `advanced.ipAddress: { ipAddressHeaders: ['x-forwarded-for'], ipv6Subnet: 64 }` in `options.ts`.
   - Set **no `trustedProxies`**, so BetterAuth's single-entry rule applies.
   - No other header is read: not `X-Real-IP`, `CF-Connecting-IP`, `Forwarded` or `X-Vercel-Forwarded-For`.
   - `disableIpTracking` stays unset.
2. **Caddy overwrites the header and never appends to it.**
   - The `web` site block's `reverse_proxy` sets `header_up X-Forwarded-For {remote_host}` explicitly, so the result does not depend on Caddy's defaults.
   - Caddy sets no `trusted_proxies`, because nothing sits in front of it. DNS records are DNS-only; the Cloudflare proxy is off.
   - A client-sent value is replaced by the TCP peer's address.
   - **The pair fails safe.** If Caddy were misconfigured to append, the header would hold two entries. The app would then resolve null and refuse (point 3), and a forged leading entry would never be trusted.
   - Putting a CDN or tunnel in front of Caddy changes this trust and needs a new SecEng ruling.
3. **An unresolved IP is refused, never pooled.**
   - `authOptions` input gains `requireClientIp: boolean`. `apps/web` passes `!dev` from `$app/environment`.
   - When it is true, `handleAuthRequest` answers **503** to an `/api/auth/*` request whose `x-forwarded-for` is not exactly one valid IP. It logs `client_ip_unresolved` with the path only, never the header's value, and does not call `auth.handler`.
   - A shared bucket is the denial of service in finding 4, so failing closed is the better outage: it is loud, and it is visible at the first deploy.
   - `/healthz` is outside `/api/auth/*` and is unaffected.
   - The Playwright e2e sends `X-Forwarded-For` through `extraHTTPHeaders`, so the e2e exercises this path.
4. **Limits pinned in `options.ts`** (C-04 says 5 a minute). Set `rateLimit.customRules` to `{ window: 60, max: 5 }` for these paths:
   - `/sign-in/email`, `/sign-in/magic-link`, `/sign-up/email`, `/request-password-reset`;
   - `/two-factor/verify-totp`, `/two-factor/verify-backup-code`, `/passkey/verify-authentication`.

   `storage` stays `'memory'` (S6).

## Tests (in `tests/db/auth-route-policy.test.ts` or `auth-session.test.ts`)

- With `X-Forwarded-For: 203.0.113.5`, the 6th wrong-password `/sign-in/email` within 60 s answers 429. A request at the same moment with `203.0.113.6` still answers 401.
- With `requireClientIp: true`, each of these answers 503 and writes no row:
  - no header;
  - `198.51.100.1, 203.0.113.5` (two entries);
  - `not-an-ip`.
- With `requireClientIp: false`, the request with no header proceeds.
- `2001:db8::1` and `2001:db8::2` share one bucket, and `2001:db8:0:1::1` does not.
- A session created with `X-Forwarded-For: 203.0.113.5` lists `203.0.113.5` in Settings → Sessions.

## Placement

- **App side, points 1, 3 and 4: in POLY-86.** All of it is in `packages/auth` and `apps/web/src`, inside the issue's paths. It binds the build as an S condition (S19), like S1–S18.
- **Caddy side, point 2: on POLY-95**, which writes the Caddyfile (it already carries the Caddy security headers). The lead places it. The compose-policy lint (C-70) or the post-deploy probe asserts it: a request with a forged `X-Forwarded-For` reaches `web` with exactly one entry, equal to the peer.
- Until POLY-95's Caddyfile ships, no deployed instance exists, so nothing runs pooled in production.

## Follow-ups for the lead

1. POLY-95: point 2 and its lint or probe assertion.
2. Per-email sign-in limit (C-04 "per IP and per email"). BetterAuth's limiter keys only on IP and path, so the per-email half needs our own counter. It is not in POLY-86.
3. Vercel target (ARCH §7.6): `memory` storage is per serverless instance, and Vercel's header contract differs. When that target is built, it needs its own client-IP and limiter-storage ruling.
