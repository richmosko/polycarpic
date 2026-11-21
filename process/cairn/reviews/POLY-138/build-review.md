# POLY-138 build review (seceng)

Reviewed: `4b98851c5c4903dbf302f6f44f0ec2230ffe7c16`, `git diff main...4b98851c`. This is a reading only: qa has the machine, so I ran nothing except reading the files.

**Verdict: 2 required findings, both in `infra/renovate/check-report.sh` and its test.** Everything else is accepted. The Caddy, compose, Postgres and `.dockerignore` changes are sound as built.

## Accepted

- **Caddyfile.** It matches the ruled text plus R10, with nothing extra.
  - `(upstream)` sets `X-Forwarded-For {remote_host}`, deletes `X-Real-IP` and `Forwarded`, and carries `lb_try_duration 10s`. It is imported in all four `reverse_proxy` blocks.
  - `@sw header Service-Worker *` with `respond @sw 403` comes first in `app.`'s `route`. In `staging.` it sits after the allowlist and before `basic_auth`.
  - The global `log` filter is as ruled. No site has a `log` directive, and the file has no `debug` and no `log_credentials`.
  - `(no_store)` is imported at site level on both HTTPS sites. It is not imported in `handle_errors` or in the `http://` block.
- **Forged-header test (R1, `caddy-edge.test.ts`).** It sends a two-entry header, a second `X-Forwarded-For` line, `X-Real-IP` and `Forwarded` to both sites and both upstreams. It asserts one line, one entry, equal to the peer, no forged value, and neither deleted header. Header lines are counted from `rawHeaders`, so a second line cannot hide behind a comma join. That is correct.
  - The test cannot show that production sees the real client. Its peer is Docker's gateway; that stays a deploy condition (follow-up F5, carried into C-04).
- **Service-worker test (R2).**
  - The 403 holds on a web path and an `/api/auth/*` path, on `app.` and on `staging.` with and without credentials, and carries the security headers.
  - The lowercase name and any value are refused. Without the header, the same paths proxy.
- **Cache test (R10).**
  - The upstream's `max-age=31536000, immutable` arrives as exactly one `no-store` on `/`, `/sign-in` and `/api/auth/session` on both sites.
  - `/_app/immutable/x.js` keeps the upstream's value.
  - Lookalike paths are `no-store`: `/x/_app/immutable/y.js`, `/_app/immutable` and `/_app/version.json`.
  - Caddy's path matcher ignores case, so `/_APP/IMMUTABLE/…` is also exempt. That is not a bypass. Pages are `no-store`, so after clean-up no cached page refers to such a name, and the clean app never does. Altered files already cached under real immutable names are reached only by RB-2's `Clear-Site-Data` step, as ruled.
- **Log test (R3).** My condition from Addendum 1 is met: the isolated test reads the global block from `infra/caddy/Caddyfile` at test time. It also asserts the filtered paths appear, so a silent log cannot pass.
- **Lint (`lint-edge.test.ts`).** Every ruled rule id has fail fixtures, including the two I asked for under `edge-network`, the `debug` refusal, and the `caddy-cache` mutations: not deferred, wrong value, a matcher that is too wide or too narrow, and an import in the wrong block.
- **Caddy build (R7).**
  - The effective x/net (the `=>` line) is ≥ 0.62.0 on the built binary.
  - The checksum env is checked in the pinned builder.
  - A static test refuses the eight tokens in the Dockerfile.
  - The Addendum 2 digests are in, and I verified them earlier as identical for every Linux platform.
- **Postgres (R6).**
  - The FROM line is 17.12 at the ruled digest.
  - `apt-mark hold "postgresql-$PG_MAJOR" "postgresql-client-$PG_MAJOR"` comes first in the same `RUN`, in both Dockerfiles.
  - The upgrade stays, and nothing new is added to apt: no source, key or unauthenticated flag. C-80's apt rule holds.
- **Workflow (`renovate-check.yml`).**
  - Permissions are `contents: read`; triggers are `schedule` and `workflow_dispatch` only.
  - `actions/checkout` is pinned by SHA with `persist-credentials: false`, so no token sits in `.git/config` for the container to read.
  - There is no secret and no token in the environment. The repo is mounted read-only.
  - The Renovate image is pinned by digest and runs with `--platform=local --dry-run=lookup`.
  - The structure test pins all of this.
- **`.dockerignore` (R9).** Accepted.

## Findings (required before the verdict)

1. **A broken lookup still reads as "No update is due" (fails open).**
   - *Mechanism:* the script fails closed only on a missing or malformed report, or on one with no dependencies. When Renovate cannot reach a registry, it still writes a well-formed report, with an empty `updates` list for each dependency it could not look up and the reason in `warnings`. Docker Hub's anonymous rate limit on shared GitHub runners is the likely cause, and Debian's mirror being down is another. The fixture shows the shape: every dependency carries `warnings: []`, and the report has top-level and per-repository `problems: []`. `check-report.sh` reads neither, so it exits 0 and the scheduled run is green.
   - *Effect:* the Principal chose option (b) because a red run is the only signal. Since R6, that signal is the only way a Postgres security minor reaches the image. A green run that looked at nothing is the failure the script's header says it prevents.
   - *Fix:* exit 2 when any of these is non-empty: the top-level `problems`, any `repositories.*.problems`, or any `deps[].warnings`.
   - *Tests:* a fail fixture for each of the three. Derive them from `fixtures/renovate-report-due.json` by adding one warning or problem, and assert exit 2, a message on stderr, and no "No update is due". A message for each also lets the red run say what broke.
2. **A pin that stops being extracted goes unwatched without a sound.**
   - *Mechanism:* the script requires only that *some* dependency was extracted. Suppose the `age=` regex stops matching after a reworded `RUN`, or a Dockerfile moves out of `includePaths`. The other dependencies still extract, the run stays green, and that pin is never checked again.
   - *Fix:* exit 2 unless the report lists each expected pair: `postgres` and `age` (the regex manager) in `infra/postgres/Dockerfile`, and `caddy` from both FROM lines plus the `xcaddy build` literal (the regex manager) in `infra/caddy/Dockerfile`. Keep the expected list in one place, the script or a file beside it, and have a static test check it against the two Dockerfiles. That way adding a pin without listing it also fails.
   - *Tests:* the real fixture passes the check. The same fixture with one expected dependency removed exits 2.

`dockerfile` extracts `age` with `skipReason: unknown-registry`. That is benign and must not trip finding 1's check, so do not fail on `skipReason`.

## Notes (no action needed for the verdict)

- `weakChecksums` checks four variables in the builder's `go env`. `GOFLAGS` and `GONOSUMCHECK` are covered only by the static Dockerfile check. That is enough, because the builder is digest-pinned and M4 measured both as empty.
- D2 (no access log) is built as ruled and still awaits the Principal. If an access log is added later, the `caddy-log` rule refuses it until it carries the same filter and is re-ruled.

## SECURITY

Edited in this loop: C-04, R-2's client-address line, R-25, C-80 and RB-2. Brief B, the per-address limit dodged by a compromised `web`, is recorded in R-2's residual list, where the same reach was already accepted; it is not a new entry. The C-80 sentence "a broken lookup fails the run" describes the rule that findings 1 and 2 make true.

## Follow-ups (the lead files after merge)

Unchanged from the ruling review: F5 (deploy shows the real client address), F6 (`auth` trusts the header only from Caddy's fixed address), and F3 (Renovate coverage for the Node image, pnpm and Actions).

## Delta review: `check-report.sh` @ `36fe64dc867b85c9f6ab8208a923613eecc95430`, tests @ `e535ed3336d77718c8f3148c5c92991c0134d796`

**One finding remains; findings 1 and 2 are otherwise met.** It is a small change, and the verdict can follow once it lands.

- **Met:** a non-empty `problems`, top-level or per repository, exits 2. So does any `deps[].warnings`, in object or string form, with or without an update elsewhere in the report. A missing or null `warnings` stays clean, as it should. A pin absent from the report exits 2, whether it is one pin, a whole manager or a whole Dockerfile, and a missing pin does not hide an update on another pin.
- **PINS covers every pin in both Dockerfiles** the ruling watches: the postgres FROM, `age=` (regex), and the Caddy builder FROM, runtime FROM and `xcaddy build` literal (regex). The static test holds the Dockerfiles to exactly those five, so adding a pin fails until it is listed.
- **C-80 matches the code.** Its sentence says the check "fails the run when the lookup is broken: Renovate reports a problem or a lookup warning, or an expected pin is missing from the report". Once finding 3 lands, that is still true, because a skipped pin counts as a broken lookup.

3. **A pin that is present but skipped still exits 0.**
   - *Mechanism:* a dependency Renovate extracts but does not look up carries `skipReason` and no `updates`. The missing-pin check counts it as present, and the update check sees nothing due. The likely causes:
     - a FROM line rewritten through a build `ARG` (`contains-variable`);
     - a `packageRules` entry with `enabled: false` (`disabled`);
     - a value Renovate cannot parse (`invalid-value`).

     In each case the pin is no longer watched and the run stays green. That is the same silent loss as finding 2.
   - *Fix:* in the PINS match, count a dependency only when `skipReason` is absent or null. The dockerfile manager's own `age` entry, with `unknown-registry`, is not in PINS, so it stays benign.
   - *Test:* the real report with `skipReason: "contains-variable"` set on the postgres FROM dependency exits 2 and names it. The same case set on the regex `age` pin exits 2 too.

Note (no action needed): the `--replace golang.org/x/net@v0.62.0` version in `infra/caddy/Dockerfile` is not watched. A later x/net security release would not turn the run red. Follow-up F1, which drops the replace, removes this. Until then, R7's test pins only the floor, ≥ 0.62.0.
