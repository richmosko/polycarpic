# Caddy 2.11.9 with golang.org/x/net raised to the fixed release: the published 2.11.9 binary bundles x/net 0.60.0
# (CVE-2026-78661, HIGH, fixed in 0.62.0) and there is no newer 2.11 tag. Drop the replace when a Caddy release carries it.
FROM caddy:2.11.9-builder@sha256:f9beaa5ddbe7df6f26ebbcf9cbf44e05a1917b9bba464f0c3229038d7e2e6e13 AS build
# XCADDY_SETCAP=0 (the builder image sets 1): the binary must carry no file capability. edge.yml drops every capability, and the kernel then refuses
# to exec a binary with an effective one (`operation not permitted`, POLY-104 F18). Caddy listens on 8080 and 8443 and needs none.
RUN XCADDY_SETCAP=0 xcaddy build v2.11.9 --replace golang.org/x/net=golang.org/x/net@v0.62.0 --output /usr/bin/caddy

FROM caddy:2.11.9@sha256:4851e54a46b206517c574821bb5cc67f170d2156041e9fbc4c9193b45e84a75b
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
# A locked placeholder account (random password nobody holds) so the Caddyfile adapts without the secret. Compose
# mounts the real staging_basic_auth file over it; if that mount is missing, compose refuses to start.
RUN mkdir -p /run/secrets \
 && echo "locked $(caddy hash-password --plaintext "$(head -c 32 /dev/urandom | base64)")" > /run/secrets/staging_basic_auth
