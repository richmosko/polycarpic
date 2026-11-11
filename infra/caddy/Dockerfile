# Caddy 2.11.9 with golang.org/x/net raised to the fixed release: the published 2.11.9 binary bundles x/net 0.60.0
# (CVE-2026-78661, HIGH, fixed in 0.62.0) and there is no newer 2.11 tag. Drop the replace when a Caddy release carries it.
FROM caddy:2.11.9-builder@sha256:1b828679ae08622c534d8e83ed80c6c25d343202f0586fe3b52d8e0ce33413b9 AS build
RUN xcaddy build v2.11.9 --replace golang.org/x/net=golang.org/x/net@v0.62.0 --output /usr/bin/caddy

FROM caddy:2.11.9@sha256:0c2243efcf437ab7f7a978f1027fcf0d4f9be8a75df27b1b3fbc5dbe0ffa8cf0
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
# A locked placeholder account (random password nobody holds) so the Caddyfile adapts without the secret. Compose
# mounts the real staging_basic_auth file over it; if that mount is missing, compose refuses to start.
RUN mkdir -p /run/secrets \
 && echo "locked $(caddy hash-password --plaintext "$(head -c 32 /dev/urandom | base64)")" > /run/secrets/staging_basic_auth
