# POLY-138 ruling review (seceng)

Reviewed: `process/cairn/reviews/POLY-138/ruling.md` @ `d3957dc2423ff7a146e46a037e120d8d36d9258b`. Code read: `infra/caddy/`, `infra/compose/`, `infra/postgres/Dockerfile`, `.dockerignore` at the same tree.

**Verdict: 7 findings.** R1, R3, R4, R6, R7, R8 and R9 are accepted as written. None of the findings changes the target Caddyfile's existing lines. Findings 3, 4 and 6 add test rows or lint rows that qa can pin at tests-red. Findings 1, 2 and 7 add wording and follow-ups. Finding 5 is a decision for the Principal and comes with a recommendation. Tests may start on R1–R9 now. Finding 5 adds at most one Caddyfile line and one test row if it is taken.

## What I checked and accept

- **R1.** Set, not append, on all four upstreams. The test uses a comma list plus a second header line (M8). Using `{remote_host}` rather than `{client_ip}` is correct. Deleting `X-Real-IP` and `Forwarded` is good defence in depth.
- **R3 regex, traced by hand:**
  - `/sign-up?invitation=X` → `/sign-up`.
  - `/api/auth/reset-password/T?cb=…` → `/api/auth/reset-password`. The first alternative eats `/T`, the second eats the query.
  - `/api/auth` (no slash) is unchanged.
  - An encoded `/api/auth%2F…/T` keeps `T`. Only an attacker writes that URL, though, so the token in it is the attacker's own. Not a finding.
  - Leaving `log_credentials` unset keeps `Cookie`, `Authorization` and `Proxy-Authorization` redacted.
- **R2.** Matching on presence (`*`) is stronger than matching the value. Header-name case is not a bypass, because Go canonicalizes names and HTTP/2 lowercases them. The browser sets the value, and page script cannot. Only Caddy publishes a port, so no route on the origin bypasses it.
- **R4.** Caddy retries only on dial failure, where the request was never sent, so no request is replayed.
- **R6.** Holding on 17.12 and keeping the upgrade is the right trade: OS fixes keep landing.
- **R7.** The test pins the property (effective x/net and the checksum env), not the mechanism.
- **R8.** Config accepted. **D1 (b)** recommended; see finding 7.
- **R9.** Accepted.

## Findings

1. **The forged-header test cannot show that Caddy sees the real client.** In M8 the peer is `172.20.0.1`, the Docker bridge gateway. In production the same thing happens to every client whenever Docker's userland proxy terminates the connection. That covers a published IPv6 bind with an IPv4-only container network, and loopback/hairpin traffic. All clients then share one rate-limit bucket (T-02, T-09: the DoS S19 exists to prevent), and staging's `remote_ip` allowlist sees the gateway. R1's container test passes in that state.
   - **Act:** the ruling names this as a deploy condition and not a container-test property. POLY-104's post-deploy probe, run from off the box, asserts that the address Caddy passes on is the prober's own public address, not a `10.20x.*` or `172.*` gateway. Equivalently, `provision-check` asserts that `POLY_BIND_ADDR` is IPv4 and that Docker's `userland-proxy` is off.
   - Follow-up F5 for the lead. I carry it into C-04.
2. **`web` reaches `auth` without passing through Caddy and can set any `X-Forwarded-For`.** In `prod.yml` and `staging.yml`, `web` and `auth` share both `default` and `edge-<p>`. A compromised `web` can send `POST http://auth:3000/api/auth/sign-in/email` with a fresh `X-Forwarded-For` on each request. That defeats the per-address limit. The per-user counter and lock (C-88) still bind, so the gain is password spraying across users at no per-address cost.
   - ARCH's sign-in service paragraph says web "shares no network with the service beyond the edge", which is false for `default`.
   - **Act in this loop:** the ruling records it. Architect (138e) corrects that ARCH sentence. I add it to SECURITY as an Open Risk entry for the Principal (brief B below).
   - **Fix, follow-up F6:**
     - give Caddy a fixed address on each edge network (`ipv4_address` in `edge.yml`);
     - `auth` honours `X-Forwarded-For` only when the socket peer is that address, and answers 503 otherwise (`packages/auth`, outside this issue's paths);
     - optionally, move `auth` off `default` onto its own network with `postgres`.

   A network split alone does not close it, because both still share `edge-<p>`.
3. **R5 `edge-alias` misses the service name.** Compose registers each service's own name on every network the service joins, and Caddy resolves names across both of its edge networks.
   - **Act:** add to the rule:
     - on `polycarpic-edge-<p>`, the only services allowed are `web` and `auth`. That also stops a staging service *named* `prod-web` from answering to that name;
     - in `edge.yml`, `caddy` is the only service.

   One fail fixture for each.
4. **R2's test misses the sign-in service's path.** The R2 row says "the same path proxies", but a worker script can be requested under either upstream.
   - **Act:** the R2 test sends `Service-Worker: script` to an `/api/auth/*` path *and* to a web path on each site, and repeats one case with the lowercase name `service-worker`.
5. **Persistence through the HTTP cache is open (decision for the Principal, brief A).** The refusal closes the service-worker route. A compromised `web` has a second route that survives clean-up: it sets `Cache-Control: max-age=31536000, immutable` on the sign-in page, or serves altered bodies under the real `/_app/immutable/*` file names. Vite names those files by content hash, so redeploying the same clean build reuses the poisoned names, and the browser keeps the altered copies for up to a year.
   - **Recommendation, in this loop:**
     - Caddy overrides `Cache-Control: no-store` on every response outside `/_app/immutable/*`, as a deferred `header` with a `not path` matcher in `security_headers`;
     - a container test shows an upstream's `max-age` is replaced on `/sign-in` and left alone on `/_app/immutable/x.js`;
     - I write a recovery step into SECURITY's Incident Response: after a web compromise, Caddy sends `Clear-Site-Data: "cache", "storage"` for 30 days.

   R-25's text must not claim that the service-worker refusal stops all persistence. I will word it to match whatever is decided.
6. **Two log gaps in R3/R5.**
   - (a) The lint (`caddy-log`) also refuses the global `debug` option. At debug level, `reverse_proxy` logs each upstream round trip, and no test covers that path.
   - (b) The R3 marker test adds a second failure mode: an upstream that accepts the connection and closes it without answering, beside the stopped upstream. M9/M10 measured only the dial failure.
7. **D1 matters for security after R6.** With the server packages held, a Postgres security minor arrives only when the Renovate signal fires.
   - Under D1 (c), a fixed server CVE waits for someone to remember a monthly manual check.
   - **Act:** D1 states this. (b) is recommended for that reason too. The workflow's structure test pins:
     - `permissions: contents: read`;
     - no `secrets.*` reference;
     - `on: schedule` (and `workflow_dispatch`) only, never `pull_request_target`;
     - the Renovate image pinned by digest.

## Briefs for the Principal (the lead relays)

**A. Old pages kept in the browser's cache (finding 5).**
- *Mechanism:* if someone took control of the `web` server, they could tell every visitor's browser to keep the sign-in page and its scripts for a year. The browser would keep showing that altered page after we clean the server, and the page could send typed passwords elsewhere. Blocking service workers, which is already decided, closes one way to do this. The cache is a second way.
- *What an attacker reaches:* passwords typed by anyone who visited during the compromise, for months afterwards.
- *Stronger option (recommended):* Caddy, which the attacker would not control, forbids the browser from caching any page; only the content-named script files stay cacheable. After an incident, Caddy tells browsers to wipe their stored copies of the site for 30 days.
- *Cost:* one config line and one test now. Pages load from the server every time, which they effectively already do for signed-in pages. The incident step costs nothing until it is used.
- *Without it:* this is accepted as part of R-25.

**B. A hijacked web server can dodge the per-address sign-in limit (finding 2).**
- *Mechanism:* the sign-in service limits attempts per visitor address, and it learns that address from a label Caddy writes. The `web` server can talk to the sign-in service directly and write any label it likes.
- *What an attacker reaches:* only someone already in control of `web`. They could try one common password against many accounts without the per-address limit stopping them. The per-account lock still stops repeated guesses at any one account.
- *Stronger option:* the sign-in service believes the label only when it comes from Caddy's fixed address.
- *Cost:* a small change in the sign-in code plus a fixed address for Caddy, as a follow-up loop. It does not block the first deploy.
- *Recommendation:* accept until that follow-up lands, as an Open Risk.

## Delta review: replacement ruling @ `d5ead294a69f1da09ca1d25830e1f48904736182`

**ACCEPT.** I reviewed the diff against `538c4bf1`. Each of the seven findings is answered:

| Finding | Where the ruling answers it | Checked |
|---|---|---|
| 1 | R1 names the deploy condition; F5 | — |
| 2 | R1 records the bypass and the ARCH correction; F6; my Open Risk | — |
| 3 | R5: the existing `edge-network` rule plus two new fail fixtures | `infra/lint/compose-policy.mjs` lines 218, 221 and 248 already allow only `web` and `auth` on the edge networks, and only `caddy` in `edge.yml` |
| 4 | The R2 test row | — |
| 5 | R10 and D3 | Measured (M14) |
| 6 | R3 and `caddy-log` refuse `debug`; the R3 row adds the accept-then-close case | Measured (M15) |
| 7 | D1 | — |

Two notes; neither changes the ruling:

- **R10's own reach.** R10 stops a hijacked `web` from making a *page* stick in the cache. It does not reach altered bodies already cached under real `/_app/immutable/*` names. Only the `Clear-Site-Data` incident step clears those. My Incident Response and R-25 text will say so.
- **R10 is not in the target Caddyfile block.** If D3 is taken, the build adds the snippet and its two imports (`caddy-cache` pins them). The lint must be checked against that text, not the R-text block.

## Delta review: Addendum 1 @ `03ac06f8b1c300f565c4d6542a0005b914ec2362`

**ACCEPT.** Keeping the filter as the control for any line that carries a request is right. The gate rests on the isolated test, which goes red when the filter is removed, and the stack-level tests stay as regression checks.

One condition on the build: the isolated test must read its global block from `infra/caddy/Caddyfile` at test time, not from a copy. A pasted copy would let the shipped filter drift while the gate stays green. I check this at the build review.

## Delta review: Addendum 2 @ `04edd0f3e81140d794e175f2d13184098528db92`

**ACCEPT.** I checked the claim myself. I ran `docker buildx imagetools inspect --raw` on all four index digests and compared each Linux platform manifest and attestation entry by digest:

- **Builder** `1b828679…` against `f9beaa5d…`: identical.
- **Runtime** `0c2243ef…` against `4851e54a…`: identical, except that the new index adds `linux/riscv64` and its attestation. Nothing was removed or changed.

The amd64 and arm64 images we build from and ship are therefore byte-identical, and taking the new index digest adds no new code to our supply chain. R7's tests re-measure x/net and the checksum env at build-green.

## Follow-ups (the lead files after merge)

- F5. The post-deploy probe or `provision-check` asserts that Caddy sees the real client address: an IPv4 bind, `userland-proxy` off, and the probe's own address echoed back (finding 1).
- F6. `auth` trusts `X-Forwarded-For` only from Caddy's fixed edge address; optionally `auth` gets its own database network (finding 2).
- F7. If brief A is declined in this loop: the `Cache-Control` override and the `Clear-Site-Data` incident step.
